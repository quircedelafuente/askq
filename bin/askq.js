#!/usr/bin/env node
// askq — set up and manage your Ask Q assistant. Run `askq help`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { findToken } from '../src/claude-token.js';
import { ENGINES, engineName } from '../src/engines.js';
import { P, APP, HOME, loadConfig, saveConfig, ensureDirs, getToken, rotateToken, setEnv, loadEnv, claudeEnv, readJSON, writePrivate } from '../src/config.js';

const [cmd, ...args] = process.argv.slice(2);
const SHORTCUT = 'https://www.icloud.com/shortcuts/bb7e05a8316a4b3ab19bba51307ba3f8';
const isMac = process.platform === 'darwin';
const bold = s => `\x1b[1m${s}\x1b[0m`, dim = s => `\x1b[2m${s}\x1b[0m`, green = s => `\x1b[32m${s}\x1b[0m`, red = s => `\x1b[31m${s}\x1b[0m`;
const ok = s => console.log(`${green('✓')} ${s}`), bad = s => console.log(`${red('✗')} ${s}`), info = s => console.log(`  ${s}`);

// ---------- prompts ----------
// One readline for the whole run; answers are queued so piped input (tests, scripts) works as well as a terminal.
// In a terminal, Esc while a question is waiting rejects it with Esc (setup saves what was answered and exits).
let rl = null, muted = false, pending = null, escHooked = false;
const lines = [], waiting = [];
class Esc extends Error { constructor() { super('cancelled'); } }
function io() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = s => { if (!muted) write(s); };
  rl.on('line', l => { const w = waiting.shift(); w ? w(l) : lines.push(l); });
  rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
  if (process.stdin.isTTY && !escHooked) {   // once: readline is re-created after close(), stdin stays
    escHooked = true;
    process.stdin.on('keypress', (_, k) => { if (k?.name === 'escape' && k.sequence === '\x1b') pending?.(); });
  }
  return rl;
}
const close = () => { rl?.close(); rl = null; };
function question(q, { hidden = false } = {}) {
  io();
  process.stdout.write(q);
  muted = hidden && !!process.stdin.isTTY;
  return new Promise((r, j) => {
    const done = a => { pending = null; if (muted) process.stdout.write('\n'); muted = false; r(a); };
    if (lines.length) return done(lines.shift());
    waiting.push(done);
    pending = () => { waiting.splice(waiting.indexOf(done), 1); pending = null; muted = false; process.stdout.write('\n'); j(new Esc()); };
  });
}
async function askText(q, def = '') { const a = (await question(`${q}${def ? dim(` [${def}]`) : ''}: `)).trim(); return a || def; }
async function askYes(q, def = true) { const a = (await question(`${q} ${dim(def ? '[Y/n]' : '[y/N]')}: `)).trim().toLowerCase(); return a ? /^(y|yes|s|si|sí)$/.test(a) : def; }
async function choose(q, options, def = 0) {
  console.log(q);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}${o.hint ? dim(` — ${o.hint}`) : ''}`));
  const a = parseInt(await askText('Choose', String(def + 1)), 10);
  return options[(a >= 1 && a <= options.length ? a : def + 1) - 1].value;
}
const askSecret = async q => (await question(q, { hidden: true })).trim();

// ---------- helpers ----------
const which = c => { try { return execFileSync('which', [c], { encoding: 'utf8' }).trim(); } catch { return null; } };
const tailscaleBin = () => process.env.ASKQ_TAILSCALE !== undefined ? (process.env.ASKQ_TAILSCALE || null) : which('tailscale') || (isMac && fs.existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale') ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : null);
async function health() { try { const r = await fetch(`http://127.0.0.1:${loadConfig().port}/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; } }

// Workspace = where Claude Code runs. CLAUDE.md is yours to edit; .claude/settings.json is rewritten by setup.
function writeWorkspace(cfg) {
  const ws = P.workspace;
  fs.mkdirSync(path.join(ws, '.claude', 'skills'), { recursive: true, mode: 0o700 });
  // CLAUDE.md is yours to edit: it is (re)written only while it is still exactly what Ask Q generated.
  const claudeMd = path.join(ws, 'CLAUDE.md'), generated = path.join(P.state, 'claude-md.generated');
  const render = fs.readFileSync(path.join(APP, 'workspace', 'CLAUDE.md.tpl'), 'utf8')
    .replaceAll('__NAME__', cfg.name || 'the user').replaceAll('__TIMEZONE__', cfg.timezone).replaceAll('__LANGUAGE__', cfg.language);
  const current = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf8') : null;
  if (current === null || current === (fs.existsSync(generated) ? fs.readFileSync(generated, 'utf8') : null)) {
    fs.writeFileSync(claudeMd, render, { mode: 0o600 });
    fs.mkdirSync(P.state, { recursive: true, mode: 0o700 });
    fs.writeFileSync(generated, render, { mode: 0o600 });
  }
  fs.cpSync(path.join(APP, 'workspace', '.claude', 'skills'), path.join(ws, '.claude', 'skills'), { recursive: true });
  const abs = p => `/${p}`;   // permission rules use //absolute/path
  const protect = [P.env, P.token, P.secrets + '/**', P.whatsappAuth + '/**', P.internalToken];
  const noWrite = [P.config, P.mcp, P.effectTools, path.join(ws, '.claude', 'settings.json'), path.join(APP, '**')];
  const settings = {
    hooks: { PreToolUse: [{ matcher: 'Bash|mcp__.*', hooks: [{ type: 'command', command: `"${process.execPath}" "${path.join(APP, 'src', 'guard.mjs')}"`, timeout: 15 }] }] },
    permissions: {
      deny: [
        ...protect.map(p => `Read(${abs(p)})`), ...protect.map(p => `Edit(${abs(p)})`), ...protect.map(p => `Write(${abs(p)})`),
        ...noWrite.map(p => `Edit(${abs(p)})`), ...noWrite.map(p => `Write(${abs(p)})`),
      ],
    },
  };
  writePrivate(path.join(ws, '.claude', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
}

// Everything that needs no questions: folders, token, workspace, built-in tool.
async function init() {
  ensureDirs();
  const cfg = loadConfig();
  if (!fs.existsSync(P.config)) saveConfig(cfg);
  getToken({ create: true });
  writeWorkspace(cfg);
  // `askq` on the assistant's PATH, so it can create and test tools itself
  const binDir = path.join(P.state, 'bin'), link = path.join(binDir, 'askq');
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(path.join(APP, 'bin', 'askq.js'), link);
  const { ensureBuiltins } = await import('../src/tools.js');
  ensureBuiltins();
  return cfg;
}

function claudeWorks() {
  const claude = process.env.ASKQ_CLAUDE || which('claude');
  if (!claude) return { ok: false, why: 'Claude Code is not installed (https://claude.com/claude-code).' };
  const r = spawnSync(claude, ['-p', 'Reply with exactly: OK', '--output-format', 'json', '--setting-sources', 'project,local', '--strict-mcp-config'],
    { cwd: fs.existsSync(P.workspace) ? P.workspace : os.homedir(), env: { ...process.env, ...claudeEnv() }, encoding: 'utf8', timeout: 90_000 });
  try { const j = JSON.parse(r.stdout); return j.is_error ? { ok: false, why: j.result || j.subtype } : { ok: true }; }
  catch { return { ok: false, why: (r.stderr || r.stdout || '').trim().slice(0, 300) || 'no answer' }; }
}

// One short turn with another engine (Codex, Cursor, Antigravity), to check it is installed and signed in.
function engineWorks(name) {
  if (name === 'claude') return claudeWorks();
  const e = ENGINES[name], bin = e.bin();
  if (!bin) return { ok: false, why: `${e.label} is not installed (${e.install}).` };
  const r = spawnSync(bin, e.args({ text: 'Reply with exactly: OK', system: 'Answer briefly.', resume: null, allowed: [] }),
    { cwd: fs.existsSync(P.workspace) ? P.workspace : os.homedir(), env: { ...process.env, ...e.env() }, encoding: 'utf8', timeout: 150_000, stdio: ['ignore', 'pipe', 'pipe'] });
  try { const j = e.parse(r.stdout); return j.text && !j.error ? { ok: true } : { ok: false, why: j.error || 'no answer' }; }
  catch { return { ok: false, why: (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ').slice(0, 300) || 'no answer' }; }
}

// Install and sign in to Codex, Cursor or Antigravity.
async function setupEngine(name) {
  const e = ENGINES[name];
  if (!e.bin()) {
    info(`${e.label} is not installed. It installs with: ${bold(e.install)}`);
    if (await askYes('Install it now?')) { close(); spawnSync('bash', ['-c', e.install], { stdio: 'inherit' }); }
    if (!e.bin()) return bad(`${e.label} is still not installed. Install it, open a new terminal and run askq setup again.`);
  }
  let c = engineWorks(name);
  if (c.ok) return ok(`${e.label} works on this machine.`);
  info(c.why);
  if (name === 'codex' && await choose('How do you want to pay for Codex?', [
    { label: 'My ChatGPT subscription', hint: 'you sign in with a code in your browser', value: 'sub' },
    { label: 'An OpenAI API key', hint: 'from platform.openai.com, pay per use', value: 'api' }]) === 'api') {
    const key = await askSecret('OpenAI API key (hidden): ');
    close(); spawnSync(e.bin(), ['login', '--with-api-key'], { input: key + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
  } else if (name === 'cursor' && await choose('How do you want to sign in to Cursor?', [
    { label: 'My Cursor account', hint: 'you sign in in your browser', value: 'login' },
    { label: 'A Cursor API key', hint: 'from cursor.com/dashboard → Integrations', value: 'api' }]) === 'api') {
    setEnv('CURSOR_API_KEY', await askSecret('Cursor API key (hidden): '));
  } else {
    console.log(`\n  ${e.label} will show a sign-in link. Open it on any device, sign in, and paste the code back here if it asks.\n`);
    close();
    if (name === 'antigravity') spawnSync(e.bin(), ['-p', 'Reply with exactly: OK'], { stdio: 'inherit', cwd: P.workspace });
    else spawnSync(e.bin(), e.login, { stdio: 'inherit', env: { ...process.env, ...e.env() } });
  }
  c = engineWorks(name);
  c.ok ? ok(`${e.label} works.`) : bad(`${e.label} still does not answer: ${c.why}\n  Fix it and run askq setup again (or askq doctor).`);
}

// Runs `claude setup-token` in a real terminal (so its sign-in screen works) and picks the token out of what it prints,
// so nobody has to copy it by hand. Returns '' if it can't (no terminal, cancelled): setup then asks to paste it.
async function claudeSetupToken() {
  const claude = process.env.ASKQ_CLAUDE || which('claude');
  if (!claude || !process.stdin.isTTY || !which('script')) return '';
  console.log(`\n  A Claude sign-in link will appear. Open it on any device (copy it, or scan the QR on a phone),`);
  console.log(`  sign in, approve, and paste the code back here if it asks.\n`);
  close();   // hand the keyboard to claude
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askq-'));
  const log = path.join(dir, 'out');
  const argv = isMac ? ['-q', log, claude, 'setup-token'] : ['-q', '-e', '-c', `'${claude.replace(/'/g, `'\\''`)}' setup-token`, log];
  const r = spawnSync('script', argv, { stdio: 'inherit' });
  let text = ''; try { text = fs.readFileSync(log, 'utf8'); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
  const token = findToken(text);
  if (!token && r.status !== 0) info('Claude sign-in did not finish.');
  return token;
}
async function setupVoice() {
  if (!which('ffmpeg')) { bad(`ffmpeg is needed for voice notes. Install it (${isMac ? 'brew install ffmpeg' : 'sudo apt install ffmpeg'}) and run askq setup again.`); return false; }
  const py = which('python3');
  if (!py) { bad('python3 is needed for voice notes.'); return false; }
  console.log('Installing local speech recognition (faster-whisper, ~500 MB with the model)…');
  let r = spawnSync(py, ['-m', 'venv', P.stt], { stdio: 'inherit' });
  if (r.status !== 0) { bad(`Could not create the Python environment.${isMac ? '' : ' Try: sudo apt install python3-venv'}`); return false; }
  r = spawnSync(path.join(P.stt, 'bin', 'pip'), ['install', '--quiet', 'faster-whisper', 'numpy'], { stdio: 'inherit' });
  if (r.status !== 0) { bad('pip install faster-whisper failed.'); return false; }
  ok('Voice notes on (they are transcribed on this machine, nothing is sent anywhere).');
  return true;
}

async function linkChannel(channel) {
  const cfg = loadConfig();
  const svc = await import('../src/service.js');
  const wasRunning = svc.installed() && await health();
  if (wasRunning) svc.control('stop');      // the service must not hold the WhatsApp/Telegram session while linking
  try {
    if (channel === 'whatsapp') {
      const { link } = await import('../src/chat/whatsapp.js');
      const phone = cfg.whatsapp.mode === 'number' ? '' : (args[1] || '');
      const r = await link({ phone });
      ok(`WhatsApp linked (${r.me}).`);
      if (cfg.whatsapp.mode === 'group') info(`Ask Q will use the group "${cfg.whatsapp.group}" (it tries to create it; if it can't, create it yourself with only you in it).`);
    } else if (channel === 'telegram') {
      if (!loadEnv().TELEGRAM_BOT_TOKEN || args.includes('--new-token')) {
        console.log('Create a bot: open Telegram, talk to @BotFather, send /newbot and copy the token it gives you.');
        setEnv('TELEGRAM_BOT_TOKEN', await askSecret('Bot token (hidden): '));
      }
      const { link } = await import('../src/chat/telegram.js');
      const r = await link();
      ok(`Telegram paired with @${r.bot}.`);
    } else throw new Error('Use: askq link whatsapp | telegram');
  } finally { if (wasRunning || svc.installed()) svc.control('start'); }
}

// Runs a command, shows its output, and turns any Tailscale link in it (e.g. "enable Serve/HTTPS on your tailnet") into
// a QR you can scan with your phone. Newer Tailscale versions wait until you approve that link, so this waits too.
function runShowingLinks(cmd, argv, timeout) {
  return new Promise(resolve => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', shown = false;
    const timer = setTimeout(() => p.kill(), timeout);
    const onData = async d => {
      out += d; process.stdout.write(d);
      const link = !shown && out.match(/https:\/\/login\.tailscale\.com\/\S+/);
      if (link) {
        shown = true;
        const QR = (await import('qrcode')).default;
        console.log(await QR.toString(link[0], { type: 'terminal', small: true }));
        info(bold('Open that link (or scan the QR with your phone), sign in and approve. I\'ll wait here.'));
      }
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('close', status => { clearTimeout(timer); resolve({ status, stdout: out, stderr: out }); });
    p.on('error', e => { clearTimeout(timer); resolve({ status: 1, stdout: '', stderr: e.message }); });
  });
}

async function tailscaleServe(port, httpsPort) {
  const ts = tailscaleBin();
  if (!ts) return { ok: false, why: 'Tailscale is not installed.' };
  let st; try { st = JSON.parse(execFileSync(ts, ['status', '--json'], { encoding: 'utf8' })); } catch { return { ok: false, why: 'Tailscale is not running or not logged in. Run: sudo tailscale up' }; }
  if (st.BackendState !== 'Running') return { ok: false, why: `Tailscale is ${st.BackendState}. Run: sudo tailscale up` };
  const host = String(st.Self?.DNSName || '').replace(/\.$/, '');
  const r = await runShowingLinks(ts, ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`], 15 * 60_000);
  if (r.status !== 0) return { ok: false, why: (r.stderr || r.stdout).trim().slice(0, 400) + (/access denied|permission/i.test(r.stderr) ? `\nRun once: sudo tailscale set --operator=$USER  (then askq setup again)` : '')
    + (/https|certificate|cert/i.test(r.stderr + r.stdout) ? '\nYour tailnet needs HTTPS certificates turned on.' : '') };
  return { ok: true, url: `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}/ask` };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const APP_STORE = 'https://apps.apple.com/app/tailscale/id1470499037';
const qrText = async t => (await import('qrcode')).default.toString(t, { type: 'terminal', small: true });
// "Running" when this machine is signed in to Tailscale; "missing" when it isn't installed.
function tsState() {
  const ts = tailscaleBin();
  if (!ts) return 'missing';
  try { return JSON.parse(execFileSync(ts, ['status', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).BackendState || 'Unknown'; }
  catch { return 'Stopped'; }
}
// Checks `ready()` every 2 s until it is true or time runs out. Esc stops waiting, like at a question.
async function waitFor(ready, what, ms = 30 * 60_000) {
  io();
  let esc = false;
  pending = () => { pending = null; esc = true; };
  console.log(dim(`  Waiting for ${what}… (Esc to stop setup)`));
  try {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(2000)) {
      if (esc) throw new Esc();
      if (ready()) return true;
    }
    return false;
  } finally { if (!esc) pending = null; }
}

function noSiri() {
  console.log(`\n${bold('Siri shortcut')}`);
  if (loadConfig().siri === false) {
    info('Skipped. Chat with Ask Q in WhatsApp or Telegram, or from the terminal with askq ask "…".');
    return info(`Got an iPhone later? Run ${bold('askq setup')} → Siri → Yes.`);
  }
  info('Off: the Siri shortcut needs Tailscale. Chat with Ask Q in WhatsApp or Telegram instead');
  info('(with WhatsApp on its own number you can also say "Hey Siri, send a WhatsApp to Ask Q").');
  info(`To turn on the Siri shortcut later: ${bold('askq setup')} → Tailscale → Yes.`);
}

// Ask Q is no longer published on the tailnet (Siri or Tailscale turned off).
function unpublish(cfg) {
  const ts = tailscaleBin(), url = loadConfig().url;
  if (ts && url && spawnSync(ts, ['serve', 'status'], { encoding: 'utf8' }).stdout?.includes(`127.0.0.1:${cfg.port}`)) {
    spawnSync(ts, ['serve', `--https=${new URL(url).port || 443}`, 'off']);
    ok('Ask Q is no longer published on Tailscale.');
  }
  const c = loadConfig(); c.url = null; saveConfig(c);
}

// Step 6: Siri is optional (no iPhone, chat only), and so is Tailscale. With Tailscale, the Siri shortcut reaches this
// machine through a private network; without it, nothing listens beyond this machine and Ask Q works through the chat.
async function setupTailscale(cfg, save) {
  console.log(`\n${bold('6. Siri')} ${dim('(talk to Ask Q with "Hey Siri, Ask Q" on an iPhone, iPad, Apple Watch or Mac)')}`);
  cfg.siri = await choose('Set up the Siri shortcut?', [
    { label: 'Yes, I have an iPhone', value: true },
    { label: 'No, skip Siri', hint: 'no iPhone · use the chat (WhatsApp/Telegram) only', value: false },
  ], cfg.siri === false ? 1 : 0);
  save();
  if (!cfg.siri) { unpublish(cfg); return null; }

  console.log(`\n${bold('   Tailscale')}`);
  info('Tailscale is a free private network between your own devices. The Siri shortcut uses it to reach this machine.');
  info(`${bold('Recommended:')} Ask Q stays invisible from the internet. Only your devices, signed in to your Tailscale account,`);
  info('can reach it: nothing is opened to the outside, and strangers can\'t even see it is there.');
  info('Without it, the Siri shortcut won\'t work; you\'d use Ask Q through the chat only. You can add it later.');
  const use = await choose('Use Tailscale?', [
    { label: 'Yes, use Tailscale', hint: 'recommended · free · about 5 minutes', value: true },
    { label: 'Continue without Tailscale', hint: 'chat only, no Siri shortcut', value: false },
  ], cfg.tailscale === false ? 1 : 0);
  cfg.tailscale = use; save();
  if (!use) { unpublish(cfg); return null; }

  const have = await choose('Do you already have Tailscale?', [
    { label: 'Yes, on my iPhone and on this machine', value: 'both' },
    { label: 'Only on my iPhone', value: 'phone' },
    { label: 'No, not yet', value: 'none' },
  ], tsState() === 'Running' ? 0 : 2);

  if (have === 'none') {
    console.log(`\n  ${bold('On your iPhone')}`);
    info('1. Open the App Store, search "Tailscale" and install it (or scan this QR with the camera):');
    console.log(await qrText(APP_STORE));
    info('2. Open Tailscale → Get Started → sign in with Google, Apple, Microsoft or GitHub.');
    info(`   ${bold('Remember which one:')} this machine must sign in with the same account.`);
    info('3. Allow the VPN configuration when iOS asks. Leave Tailscale connected (you\'ll see "VPN" at the top).');
    await question('  Press Enter when Tailscale is connected on your iPhone… ');
  }

  // This machine
  let state = tsState();
  if (have === 'both' && state !== 'Running') bad(state === 'missing' ? 'Tailscale is not installed on this machine yet.' : `Tailscale on this machine is not signed in (${state}).`);
  if (state === 'missing') {
    console.log(`\n  ${bold('On this machine')}`);
    if (isMac) {
      if (which('brew') && await askYes('Install the Tailscale app with Homebrew now? (it may ask for your Mac password)')) {
        close(); spawnSync('brew', ['install', '--cask', 'tailscale'], { stdio: 'inherit' });
      }
      if (!tailscaleBin()) {
        info('1. Download Tailscale for Mac: https://tailscale.com/download/mac (opening it in your browser).');
        info('2. Open the downloaded file and install it (Continue → Install), or get it from the Mac App Store.');
        spawnSync('open', ['https://tailscale.com/download/mac']);
        if (!await waitFor(() => !!tailscaleBin(), 'the Tailscale app to be installed')) { bad('Tailscale is not installed yet.'); return later(); }
      }
      ok('Tailscale is installed.');
    } else {
      if (!await askYes('Install Tailscale now? (uses sudo; it may ask for your password)')) return later();
      close(); spawnSync('bash', ['-c', 'curl -fsSL https://tailscale.com/install.sh | sh'], { stdio: 'inherit' });
      if (!tailscaleBin()) { bad('Tailscale did not install.'); return later(); }
      ok('Tailscale is installed.');
    }
    state = tsState();
  }
  if (state !== 'Running') {
    console.log(`\n  ${bold('Sign this machine in to Tailscale')} ${dim('(same account as your iPhone)')}`);
    if (isMac) {
      spawnSync('open', ['-a', 'Tailscale']);
      info('1. Tailscale is opening. If macOS asks to allow a VPN configuration or a system extension, allow it');
      info('   (if it says it was blocked: System Settings → General → Login Items & Extensions → allow Tailscale).');
      info('2. Click the Tailscale icon in the menu bar (top right of the screen) → Log in.');
      info('3. Sign in with the same account as on your iPhone.');
      if (!await waitFor(() => tsState() === 'Running', 'this Mac to sign in to Tailscale')) { bad('This Mac is not signed in to Tailscale yet.'); return later(); }
    } else {
      info('A sign-in link will appear: open it (or scan the QR with your phone) and sign in with the same account.');
      close();
      await runShowingLinks('sudo', [tailscaleBin(), 'up'], 15 * 60_000);
      if (tsState() !== 'Running') { bad('This machine is not signed in to Tailscale yet.'); return later(); }
    }
  }
  if (!isMac) spawnSync('sudo', ['-n', tailscaleBin(), 'set', `--operator=${os.userInfo().username}`], { stdio: 'ignore' });
  ok('This machine is on your Tailscale network.');

  // Publish Ask Q on the tailnet (HTTPS, only reachable from your devices)
  const port = parseInt(await askText('HTTPS port on your tailnet', '443'), 10) || 443;
  let t = await tailscaleServe(loadConfig().port, port);
  for (let tries = 0; !t.ok && tries < 3; tries++) {
    bad(t.why);
    if (/HTTPS certificates/.test(t.why)) {
      console.log(await qrText('https://login.tailscale.com/admin/dns'));
      info('Open https://login.tailscale.com/admin/dns (or scan the QR with your phone) → "HTTPS Certificates" → Enable HTTPS.');
      await question('Then press Enter… ');
    } else if (/operator/.test(t.why) && !isMac) {
      if (!await askYes('Allow Ask Q to configure Tailscale without sudo (tailscale set --operator)?')) break;
      spawnSync('sudo', [tailscaleBin(), 'set', `--operator=${os.userInfo().username}`], { stdio: 'inherit' });
    } else if (!await askYes('Try again?')) break;
    t = await tailscaleServe(loadConfig().port, port);
  }
  if (!t.ok) return later();
  ok(`Reachable only from your Tailscale devices: ${t.url}`);
  const c = loadConfig(); c.url = t.url; saveConfig(c);
  return t.url;
}
function later() { info(`When Tailscale is ready, run ${bold('askq setup')} again (your answers are kept).`); return null; }

// Everything the Siri shortcut asks for when you add it, as QR codes: scan with the iPhone camera, tap, copy, paste.
async function printSiri(url = loadConfig().url) {
  const QR = (await import('qrcode')).default;
  const qr = t => QR.toString(t, { type: 'terminal', small: true });
  console.log(`\n${bold('Siri shortcut')}`);
  info(`On your iPhone, add it from: ${SHORTCUT}`);
  info('It asks for two things. Scan each QR with the iPhone camera, tap the text, Copy, and paste it in.');
  console.log(`\n  ${bold('1. Token')}`);
  console.log(await qr(getToken({ create: true })));
  if (url) {
    console.log(`  ${bold('2. URL')}  ${url}`);
    console.log(await qr(url));
  } else info(`${bold('2. URL')}  not ready yet: finish the Tailscale step (askq setup), then run askq siri.`);
  info(`Then say "Hey Siri, Ask Q". Show this again any time with: ${bold('askq siri')}`);
}

// ---------- commands ----------
// Step 1 of setup, and `askq ai` on its own: pick the AI, install it and sign in.
async function chooseEngine(cfg, save) {
  console.log(`\n${bold('1. The AI')} ${dim('(what understands you and uses the tools)')}`);
  const names = Object.keys(ENGINES);
  cfg.engine = await choose('Which one?', names.map(n => ({ label: ENGINES[n].label, hint: n === 'claude' ? `recommended · ${ENGINES[n].account}` : `${ENGINES[n].account} · see docs/engines.md`, value: n })),
    names.indexOf(engineName(cfg)));
  save();
  let c = cfg.engine === 'claude' ? claudeWorks() : { ok: true, other: true };
  if (c.other) await setupEngine(cfg.engine);
  else if (c.ok) ok('Claude Code works on this machine.');
  else {
    info(c.why);
    const how = await choose('How do you want to pay for Claude?', [
      { label: 'My Claude subscription (Pro/Max)', hint: 'you sign in to Claude in your browser', value: 'sub' },
      { label: 'An API key', hint: 'from console.anthropic.com, pay per use', value: 'api' },
    ]);
    const key = how === 'sub' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
    let secret = how === 'sub' ? await claudeSetupToken() : '';
    if (secret) ok('Got your Claude token.');
    else secret = await askSecret(how === 'sub' ? 'Token from `claude setup-token` (hidden): ' : 'Anthropic API key (hidden): ');
    setEnv(key, secret);
    c = claudeWorks();
    if (c.ok) ok('Claude Code works.');
    else { setEnv(key, ''); bad(`Claude still does not answer: ${c.why}\n  The key was not saved. Fix it and run askq setup again (or askq doctor).`); }
  }
}

// What setup asks, written over the current config (the daemon and the channel links write other fields meanwhile).
function saveAnswers(cfg) {
  const c = loadConfig();
  for (const k of ['name', 'language', 'timezone', 'engine', 'channel', 'siri', 'tailscale']) c[k] = cfg[k];
  c.whatsapp = { ...c.whatsapp, mode: cfg.whatsapp.mode, group: cfg.whatsapp.group, owners: cfg.whatsapp.owners };
  saveConfig(c);
}

async function setup() {
  console.log(`${bold('Ask Q setup')} ${dim(`(${HOME})`)}`);
  if (process.stdin.isTTY) console.log(dim('Press Esc at any question to save your answers so far and exit.'));
  console.log();
  const cfg = await init();
  const save = () => saveAnswers(cfg);
  try { await setupSteps(cfg, save); }
  catch (e) {
    if (!(e instanceof Esc)) throw e;
    save(); close();
    console.log(`\n${green('✓')} Setup stopped. Your answers so far are saved; run ${bold('askq setup')} to continue.`);
  }
}

async function setupSteps(cfg, save) {
  cfg.name = await askText('Your name', cfg.name || os.userInfo().username);
  cfg.language = await askText('Default language for answers (en, es, fr…)', cfg.language);
  cfg.timezone = await askText('Your timezone', cfg.timezone);
  save();
  writeWorkspace(cfg);

  await chooseEngine(cfg, save);

  // Channel
  console.log(`\n${bold('2. Chat channel')} ${dim('(where Ask Q sends you tickets, files and reminders, and where you can chat with it)')}`);
  cfg.channel = await choose('Which one?', [
    { label: 'WhatsApp', hint: 'unofficial library; a secondary number is safest', value: 'whatsapp' },
    { label: 'Telegram', hint: 'official bot API', value: 'telegram' },
    { label: 'None for now', value: 'none' },
  ], ['whatsapp', 'telegram', 'none'].indexOf(cfg.channel));
  if (cfg.channel === 'whatsapp') {
    cfg.whatsapp.mode = await choose('How should Ask Q use WhatsApp?', [
      { label: 'A group on my own number', hint: 'no second phone needed; you chat in a group where only you are', value: 'group' },
      { label: 'Its own number', hint: 'Ask Q is a contact; best for "Hey Google, send a WhatsApp to Ask Q"', value: 'number' },
    ], cfg.whatsapp.mode === 'number' ? 1 : 0);
    if (cfg.whatsapp.mode === 'group') cfg.whatsapp.group = await askText('Group name', cfg.whatsapp.group);
    else cfg.whatsapp.owners = (await askText('Your phone number(s) it should answer, with country code (comma-separated)', cfg.whatsapp.owners.join(','))).split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
  }
  save();
  if (cfg.channel !== 'none' && await askYes(`Link ${cfg.channel} now?`)) await linkChannel(cfg.channel).catch(e => bad(e.message));

  // Voice notes
  if (cfg.channel !== 'none') {
    console.log(`\n${bold('3. Voice notes')}`);
    const want = await askYes('Understand voice notes you send in the chat (transcribed locally)?', cfg.voiceNotes);
    const c2 = loadConfig(); c2.voiceNotes = want ? await setupVoice() : false; saveConfig(c2);
  }

  // Tools
  console.log(`\n${bold('4. Tools')}`);
  const { sync } = await import('../src/tools.js');
  await sync({ quiet: true });
  ok('Tools ready. Create new ones by asking: "create a tool for …"');

  // Service
  console.log(`\n${bold('5. Background service')}`);
  const svc = await import('../src/service.js');
  if (await askYes('Run Ask Q in the background and start it at boot?')) try {
    const r = svc.install();
    let up = false;
    for (let i = 0; i < 20 && !(up = await health()); i++) await new Promise(res => setTimeout(res, 500));
    if (up) ok(`Ask Q runs in the background (${r.kind}) and starts at boot.`);
    else bad(`The background service was installed but is not answering. Try: askq start, then askq logs`);
    if (r.kind === 'systemd' && !r.linger) info(`To keep it running when you are logged out: sudo loginctl enable-linger ${os.userInfo().username}`);
  } catch (e) { bad(e.message); }

  // Tailscale
  const url = await setupTailscale(cfg, save);
  close();
  if (cfg.siri === false || cfg.tailscale === false) noSiri();
  else await printSiri(url);
  console.log(`\nDone. Check everything with ${bold('askq doctor')}.`);
}

// `askq ai`: switch the AI without going through the whole setup. Esc leaves it as it was.
async function ai() {
  const cfg = await init(), before = engineName(cfg);
  if (process.stdin.isTTY) console.log(dim('Press Esc to exit without changing anything.'));
  try { await chooseEngine(cfg, () => saveAnswers(cfg)); }
  catch (e) {
    if (!(e instanceof Esc)) throw e;
    if (cfg.engine !== before) { cfg.engine = before; saveAnswers(cfg); }
    close(); return console.log('No changes.');
  }
  close();
  // The service reads the AI on every message; reinstalling it refreshes its PATH in case the new one was just installed.
  const svc = await import('../src/service.js');
  if (svc.installed()) { svc.install(); ok(`Ask Q now uses ${ENGINES[cfg.engine].label}. Conversations start fresh.`); }
}

// `askq uninstall`: removes Ask Q from this machine after a "yes". --keep-data only removes the background service.
async function uninstall() {
  const svc = await import('../src/service.js');
  if (args.includes('--keep-data')) { svc.uninstall(); return ok(`Service removed. Your data is still in ${HOME}.`); }
  if (path.resolve(HOME) === os.homedir() || path.resolve(HOME) === '/') throw new Error(`Refusing to delete ${HOME}`);
  const cfg = loadConfig(), ts = tailscaleBin();
  const httpsPort = (() => { try { return new URL(cfg.url).port || '443'; } catch { return null; } })();
  const serving = ts && httpsPort && spawnSync(ts, ['serve', 'status'], { encoding: 'utf8' }).stdout?.includes(`127.0.0.1:${cfg.port}`);
  const link = path.join(os.homedir(), '.local', 'bin', 'askq');
  const ownLink = (() => { try { return fs.realpathSync(link) === fs.realpathSync(path.join(APP, 'bin', 'askq.js')); } catch { return false; } })();
  const appInside = !path.relative(HOME, APP).startsWith('..');
  const agy = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  const agyOurs = Object.keys(readJSON(agy, { mcpServers: {} }).mcpServers || {}).filter(k => k.startsWith('askq-'));

  console.log(bold('This removes Ask Q from this machine:'));
  info('• the background service');
  if (serving) info(`• the Tailscale address (${cfg.url || `https port ${httpsPort}`})`);
  info(`• ${HOME}: settings, token, tools and their passwords, WhatsApp link, conversations, logs${appInside ? ', the program' : ''}`);
  if (ownLink) info(`• the askq command (${link})`);
  if (agyOurs.length) info(`• Ask Q's tools in ${agy} (${agyOurs.length})`);
  info(dim(`Not touched: Claude Code, Node, Tailscale${appInside ? '' : `, the program in ${APP}`}.`));
  if (!await askYes('Uninstall Ask Q?', false)) return console.log('Nothing removed.');

  svc.uninstall(); ok('Background service removed');
  if (serving) { const r = spawnSync(ts, ['serve', `--https=${httpsPort}`, 'off'], { encoding: 'utf8' }); r.status === 0 ? ok('Tailscale address removed') : bad(`Tailscale: ${(r.stderr || '').trim()} (run: tailscale serve reset)`); }
  if (agyOurs.length) { const j = readJSON(agy, { mcpServers: {} }); for (const k of agyOurs) delete j.mcpServers[k]; writePrivate(agy, JSON.stringify(j, null, 2) + '\n'); ok('Antigravity config cleaned'); }
  if (ownLink) fs.rmSync(link, { force: true });
  fs.rmSync(HOME, { recursive: true, force: true }); ok(`Deleted ${HOME}`);
  console.log(`\nAsk Q is uninstalled. On your phone, also:`);
  if (cfg.channel === 'whatsapp') info('• WhatsApp → Settings → Linked devices → tap Ask Q\'s device → Log out (and delete the "Ask Q" group if you like)');
  if (cfg.channel === 'telegram') info('• Telegram: delete your bot with @BotFather → /deletebot');
  info('• Shortcuts: delete the "Ask Q" shortcut');
}

async function doctor() {
  const cfg = loadConfig();
  const v = +process.versions.node.split('.')[0];
  v >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} (needs 20+)`);
  fs.existsSync(P.config) ? ok(`Config: ${P.config}`) : bad('Not set up: run askq setup');
  fs.existsSync(path.join(P.workspace, 'CLAUDE.md')) ? ok('Workspace') : bad('Workspace missing: run askq setup');
  if (!args.includes('--fast')) { const e = ENGINES[engineName(cfg)], c = engineWorks(engineName(cfg)); c.ok ? ok(`${e.label} answers`) : bad(`${e.label}: ${c.why}`); }
  const fx = readJSON(P.effectTools, null);
  fx ? ok(`Tools: ${Object.keys(readJSON(P.mcp, { mcpServers: {} }).mcpServers).length} (${fx.readOnly.length} read-only functions, ${fx.effect.length} need "yes")`) : bad('Tools not synced: askq tools sync');
  const svc = await import('../src/service.js');
  svc.installed() ? ok('Background service installed') : bad('Background service not installed (askq setup, or run it with: askq run)');
  (await health()) ? ok(`Service answering on 127.0.0.1:${cfg.port}`) : bad('Service not answering: askq start, then askq logs');
  if (cfg.channel === 'whatsapp') { const { isLinked } = await import('../src/chat/whatsapp.js'); isLinked() ? ok(`WhatsApp linked (${cfg.whatsapp.mode} mode)`) : bad('WhatsApp not linked: askq link whatsapp'); }
  if (cfg.channel === 'telegram') (cfg.telegram.chatId && loadEnv().TELEGRAM_BOT_TOKEN) ? ok('Telegram paired') : bad('Telegram not paired: askq link telegram');
  if (cfg.voiceNotes) (fs.existsSync(P.stt) && which('ffmpeg')) ? ok('Voice notes') : bad('Voice notes enabled but not installed: askq setup');
  const ts = tailscaleBin();
  if (cfg.siri === false) info('Siri skipped: chat only (turn it on with askq setup)');
  else if (cfg.tailscale === false) info('Tailscale off: chat only, no Siri shortcut (turn it on with askq setup)');
  else if (!ts) bad('Tailscale not installed');
  else { const r = spawnSync(ts, ['serve', 'status'], { encoding: 'utf8' }); r.stdout.includes(`127.0.0.1:${cfg.port}`) ? ok(`Tailscale serves Ask Q: ${r.stdout.split('\n').find(l => l.startsWith('https://')) || ''}`) : bad('Tailscale is not serving Ask Q (askq setup, step 6)'); }
}

function logs() {
  const files = fs.existsSync(P.logs) ? fs.readdirSync(P.logs).filter(f => f.endsWith('.log')) : [];
  const n = parseInt(args[0], 10) || 30;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(P.logs, f), 'utf8').trim().split('\n').slice(-n);
    console.log(bold(`— ${f}`)); console.log(lines.join('\n'));
  }
  if (!files.length) console.log('No logs yet.');
}

async function tool() {
  const t = await import('../src/tools.js');
  const [sub, name, ...rest] = args;
  if (sub === 'new') {
    const dir = t.scaffold(name, rest.join(' '));
    ok(`Created ${dir}`); info('Edit index.js, then: askq tool test ' + name + ' && askq tools sync');
  } else if (sub === 'list' || !sub) {
    for (const x of t.list()) console.log(`${bold(x.name)}  ${dim(x.path)}  ${x.readOnly} read-only, ${x.needsYes} need "yes"`);
  } else if (sub === 'test') {
    console.log(JSON.stringify(await t.test(name, rest[0], rest[1]), null, 1));
  } else if (sub === 'remove') {
    t.remove(name); await t.sync({ quiet: true }); ok(`Removed ${name}`);
  } else if (sub === 'deps') {
    const dir = path.join(P.tools, name);
    if (!fs.existsSync(dir)) throw new Error(`No tool folder ${dir}`);
    const nm = path.join(dir, 'node_modules');
    if (fs.lstatSync(nm, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(nm);   // stop sharing Ask Q's packages
    const r = spawnSync('npm', ['install', '--no-fund', '--no-audit', ...rest], { cwd: dir, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('npm install failed');
    ok(`Installed in ${dir}`);
  } else throw new Error('Use: askq tool new <name> ["description"] | list | test <name> [function] [json] | deps <name> <pkg…> | remove <name>');
}

async function secret() {
  const t = await import('../src/tools.js');
  const [sub, toolName, key] = args;
  if (sub === 'set' && toolName && key) { t.setSecret(toolName, key, await askSecret(`${key} for ${toolName} (hidden): `)); ok('Saved.'); }
  else if (sub === 'list' && toolName) console.log(t.secretKeys(toolName).join('\n') || '(none)');
  else if (sub === 'remove' && toolName && key) { t.setSecret(toolName, key, ''); ok('Removed.'); }
  else throw new Error('Use: askq secret set <tool> <KEY> | list <tool> | remove <tool> <KEY>');
}

async function token() {
  if (args.includes('--rotate')) { rotateToken(); ok('New token created. Update it in your Siri shortcut.'); }
  const t = getToken({ create: true });
  if (args.includes('--qr')) { const QR = (await import('qrcode')).default; console.log(await QR.toString(t, { type: 'terminal', small: true })); info('Scan it with the iPhone camera and copy the text.'); }
  else if (args.includes('--show')) console.log(t);
  else info('askq token --show (print it) · --qr (scan it with your phone) · --rotate (new one)');
}

const HELP = `${bold('askq')} — your own assistant: Siri, WhatsApp or Telegram → Claude Code on your machine → your tools.

  ${bold('askq setup')}                 interactive setup (run again any time to change things)
  ${bold('askq doctor')} [--fast]       check that everything works
  askq start | stop | restart | status
  askq logs [lines]           recent logs
  askq ask "question"         talk to it from the terminal
  askq link whatsapp|telegram [your-number]   link a chat channel (QR, or a code if you give your number)
  askq ai                     choose the AI that does the work (Claude Code, Codex, Cursor, Antigravity)
  askq siri                   QR codes with what the Siri shortcut asks for (token and URL)
  askq token [--show|--qr|--rotate]           the key your Siri shortcut uses

  askq tool new <name> ["what it does"]       create a tool (the assistant does this for you when you ask)
  askq tool list | test <name> [fn] [json] | deps <name> <pkg…> | remove <name>
  askq tools sync             re-read tools (which functions need your "yes")
  askq secret set <tool> <KEY>                store a password or API key for a tool (hidden input)

  askq run                    run in the foreground (what the background service runs)
  askq uninstall [--keep-data]  remove Ask Q from this machine (asks first; --keep-data: only the service)
`;

try {
  switch (cmd) {
    case 'setup': await setup(); break;
    case 'init': await init(); ok(`Initialized ${HOME}`); break;
    case 'doctor': await doctor(); break;
    case 'run': await init(); await import('../src/daemon.js'); break;
    case 'start': case 'stop': case 'restart': case 'status': {
      const svc = await import('../src/service.js');
      if (!svc.installed()) throw new Error('The background service is not installed. Run: askq setup (or askq run)');
      const r = svc.control(cmd);
      if (cmd === 'status') console.log((await health()) ? green('running') : red('not running'));
      else if (r.status !== 0) throw new Error(r.stderr || `${cmd} failed`);
      else ok(cmd);
      break;
    }
    case 'logs': logs(); break;
    case 'ask': {
      if (!args.length) throw new Error('Use: askq ask "question"');
      const { ask } = await import('../src/agent.js');
      console.log(await ask(args.join(' '), { channel: 'cli', expires: 30 }));
      break;
    }
    case 'link': await linkChannel(args[0]); break;
    case 'token': await token(); break;
    case 'siri': { const c = loadConfig(); c.siri === false || c.tailscale === false ? noSiri() : await printSiri(); break; }
    case 'ai': case 'engine': case 'model': await ai(); break;
    case 'tool': await tool(); break;
    case 'tools': if (args[0] === 'sync') { const { sync } = await import('../src/tools.js'); await sync(); } else throw new Error('Use: askq tools sync'); break;
    case 'secret': await secret(); break;
    case 'uninstall': await uninstall(); break;
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
    default: throw new Error(`Unknown command "${cmd}". Run: askq help`);
  }
  close();
  if (cmd !== 'run') process.exit(0);
} catch (e) { close(); console.error(red(`Error: ${e.message}`)); process.exit(1); }
