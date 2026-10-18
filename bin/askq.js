#!/usr/bin/env node
// askq — set up and manage your Ask Q assistant. Run `askq help`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync, execFileSync } from 'node:child_process';
import { P, APP, HOME, loadConfig, saveConfig, ensureDirs, getToken, rotateToken, setEnv, loadEnv, claudeEnv, readJSON, writePrivate } from '../src/config.js';

const [cmd, ...args] = process.argv.slice(2);
const isMac = process.platform === 'darwin';
const bold = s => `\x1b[1m${s}\x1b[0m`, dim = s => `\x1b[2m${s}\x1b[0m`, green = s => `\x1b[32m${s}\x1b[0m`, red = s => `\x1b[31m${s}\x1b[0m`;
const ok = s => console.log(`${green('✓')} ${s}`), bad = s => console.log(`${red('✗')} ${s}`), info = s => console.log(`  ${s}`);

// ---------- prompts ----------
// One readline for the whole run; answers are queued so piped input (tests, scripts) works as well as a terminal.
let rl = null, muted = false;
const lines = [], waiting = [];
function io() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = s => { if (!muted) write(s); };
  rl.on('line', l => { const w = waiting.shift(); w ? w(l) : lines.push(l); });
  rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
  return rl;
}
const close = () => { rl?.close(); rl = null; };
function question(q, { hidden = false } = {}) {
  io();
  process.stdout.write(q);
  muted = hidden && !!process.stdin.isTTY;
  return new Promise(r => {
    const done = a => { if (muted) process.stdout.write('\n'); muted = false; r(a); };
    lines.length ? done(lines.shift()) : waiting.push(done);
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

function tailscaleServe(port, httpsPort) {
  const ts = tailscaleBin();
  if (!ts) return { ok: false, why: 'Tailscale is not installed.' };
  let st; try { st = JSON.parse(execFileSync(ts, ['status', '--json'], { encoding: 'utf8' })); } catch { return { ok: false, why: 'Tailscale is not running or not logged in. Run: sudo tailscale up' }; }
  if (st.BackendState !== 'Running') return { ok: false, why: `Tailscale is ${st.BackendState}. Run: sudo tailscale up` };
  const host = String(st.Self?.DNSName || '').replace(/\.$/, '');
  const r = spawnSync(ts, ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, why: (r.stderr || r.stdout).trim().slice(0, 400) + (/access denied|permission/i.test(r.stderr) ? `\nRun once: sudo tailscale set --operator=$USER  (then askq setup again)` : '')
    + (/https|certificate|cert/i.test(r.stderr + r.stdout) ? '\nYour tailnet needs HTTPS certificates turned on.' : '') };
  return { ok: true, url: `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}/ask` };
}

async function printSiri(url) {
  console.log(`\n${bold('Siri shortcut')} — follow docs/siri-shortcut.md (2 minutes). You need:`);
  console.log(`  URL:    ${url || '(run askq setup to expose it through Tailscale)'}`);
  console.log(`  Token:  run ${bold('askq token --show')} on this machine, or scan ${bold('askq token --qr')} with your iPhone camera.`);
}

// ---------- commands ----------
async function setup() {
  console.log(`${bold('Ask Q setup')} ${dim(`(${HOME})`)}\n`);
  const cfg = await init();
  cfg.name = await askText('Your name', cfg.name || os.userInfo().username);
  cfg.language = await askText('Default language for answers (en, es, fr…)', cfg.language);
  cfg.timezone = await askText('Your timezone', cfg.timezone);
  saveConfig(cfg);
  writeWorkspace(cfg);

  // Claude
  console.log(`\n${bold('1. Claude')}`);
  let c = claudeWorks();
  if (c.ok) ok('Claude Code works on this machine.');
  else {
    info(c.why);
    const how = await choose('How do you want to pay for Claude?', [
      { label: 'My Claude subscription (Pro/Max)', hint: 'run `claude setup-token` in another terminal and paste the token', value: 'sub' },
      { label: 'An API key', hint: 'from console.anthropic.com, pay per use', value: 'api' },
    ]);
    const key = how === 'sub' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
    setEnv(key, await askSecret(how === 'sub' ? 'Token from `claude setup-token` (hidden): ' : 'Anthropic API key (hidden): '));
    c = claudeWorks();
    if (c.ok) ok('Claude Code works.');
    else { setEnv(key, ''); bad(`Claude still does not answer: ${c.why}\n  The key was not saved. Fix it and run askq setup again (or askq doctor).`); }
  }

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
  saveConfig(cfg);
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
    ok(`Ask Q runs in the background (${r.kind}) and starts at boot.`);
    if (r.kind === 'systemd' && !r.linger) info(`To keep it running when you are logged out: sudo loginctl enable-linger ${os.userInfo().username}`);
  } catch (e) { bad(e.message); }

  // Tailscale
  console.log(`\n${bold('6. Private access from your phone (Tailscale)')}`);
  info('Tailscale connects your phone and this machine privately. You need the Tailscale app on your phone,');
  info('signed in with Google/Apple/Microsoft/GitHub — this machine must use the SAME account. (Guide: docs/getting-started.md)');
  let url = null;
  const port = parseInt(await askText('HTTPS port on your tailnet', '443'), 10) || 443;
  let t = tailscaleServe(loadConfig().port, port);
  for (let tries = 0; !t.ok && tries < 3; tries++) {
    bad(t.why);
    if (!tailscaleBin()) {
      info(isMac ? 'Install the Tailscale app: https://tailscale.com/download/mac (sign in with the same account as your phone).'
        : 'Install it with: curl -fsSL https://tailscale.com/install.sh | sh');
    } else if (/not running|not logged in|NeedsLogin|Stopped|tailscale up/i.test(t.why) && !isMac) {
      if (!await askYes('Log this machine in to Tailscale now? (opens a link to sign in)')) break;
      spawnSync('sudo', [tailscaleBin(), 'up'], { stdio: 'inherit' });
      spawnSync('sudo', [tailscaleBin(), 'set', `--operator=${os.userInfo().username}`], { stdio: 'inherit' });
    } else if (/HTTPS certificates/.test(t.why)) {
      await question('Enable HTTPS at https://login.tailscale.com/admin/dns ("HTTPS Certificates" → Enable HTTPS), then press Enter… ');
    } else if (/operator/.test(t.why) && !isMac) {
      if (!await askYes('Allow Ask Q to configure Tailscale without sudo (tailscale set --operator)?')) break;
      spawnSync('sudo', [tailscaleBin(), 'set', `--operator=${os.userInfo().username}`], { stdio: 'inherit' });
    } else if (!await askYes('Try again?')) break;
    t = tailscaleServe(loadConfig().port, port);
  }
  if (t.ok) { url = t.url; ok(`Reachable only from your Tailscale devices: ${url}`); }
  else info('When Tailscale is ready, run askq setup again (your answers are kept).');
  close();
  await printSiri(url);
  console.log(`\nDone. Check everything with ${bold('askq doctor')}.`);
}

async function doctor() {
  const cfg = loadConfig();
  const v = +process.versions.node.split('.')[0];
  v >= 20 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} (needs 20+)`);
  fs.existsSync(P.config) ? ok(`Config: ${P.config}`) : bad('Not set up: run askq setup');
  fs.existsSync(path.join(P.workspace, 'CLAUDE.md')) ? ok('Workspace') : bad('Workspace missing: run askq setup');
  if (!args.includes('--fast')) { const c = claudeWorks(); c.ok ? ok('Claude Code answers') : bad(`Claude Code: ${c.why}`); }
  const fx = readJSON(P.effectTools, null);
  fx ? ok(`Tools: ${Object.keys(readJSON(P.mcp, { mcpServers: {} }).mcpServers).length} (${fx.readOnly.length} read-only functions, ${fx.effect.length} need "yes")`) : bad('Tools not synced: askq tools sync');
  const svc = await import('../src/service.js');
  svc.installed() ? ok('Background service installed') : bad('Background service not installed (askq setup, or run it with: askq run)');
  (await health()) ? ok(`Service answering on 127.0.0.1:${cfg.port}`) : bad('Service not answering: askq start, then askq logs');
  if (cfg.channel === 'whatsapp') { const { isLinked } = await import('../src/chat/whatsapp.js'); isLinked() ? ok(`WhatsApp linked (${cfg.whatsapp.mode} mode)`) : bad('WhatsApp not linked: askq link whatsapp'); }
  if (cfg.channel === 'telegram') (cfg.telegram.chatId && loadEnv().TELEGRAM_BOT_TOKEN) ? ok('Telegram paired') : bad('Telegram not paired: askq link telegram');
  if (cfg.voiceNotes) (fs.existsSync(P.stt) && which('ffmpeg')) ? ok('Voice notes') : bad('Voice notes enabled but not installed: askq setup');
  const ts = tailscaleBin();
  if (!ts) bad('Tailscale not installed');
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
  askq token [--show|--qr|--rotate]           the key your Siri shortcut uses

  askq tool new <name> ["what it does"]       create a tool (the assistant does this for you when you ask)
  askq tool list | test <name> [fn] [json] | deps <name> <pkg…> | remove <name>
  askq tools sync             re-read tools (which functions need your "yes")
  askq secret set <tool> <KEY>                store a password or API key for a tool (hidden input)

  askq run                    run in the foreground (what the background service runs)
  askq uninstall              remove the background service (keeps ${HOME})
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
    case 'tool': await tool(); break;
    case 'tools': if (args[0] === 'sync') { const { sync } = await import('../src/tools.js'); await sync(); } else throw new Error('Use: askq tools sync'); break;
    case 'secret': await secret(); break;
    case 'uninstall': { const svc = await import('../src/service.js'); svc.uninstall(); ok(`Service removed. Your data is still in ${HOME}.`); break; }
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
    default: throw new Error(`Unknown command "${cmd}". Run: askq help`);
  }
  close();
  if (cmd !== 'run') process.exit(0);
} catch (e) { close(); console.error(red(`Error: ${e.message}`)); process.exit(1); }
