// Sign in to a website from your phone. A tool that needs your login (SSO, 2-step codes…) declares it in its
// package.json:
//   "askq": { "login": { "url": "https://site/login", "check": "https://site/api/me", "state": ".auth/state.json",
//                        "done": "^https://site/home", "hint": "Choose Yes on Stay signed in" } }
// Ask Q opens that page in a browser on this machine and gives you a private link. On the phone you see the real page
// and sign in yourself: taps, typing and scrolling go to the browser. Passwords go straight to the website, never
// through the chat or the AI. When `check` answers 2xx (or the address matches `done`, or you tap Done), the session
// (Playwright storageState: cookies + local storage) is saved in the tool's folder and the browser closes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { P, APP, readJSON, logger } from './config.js';

const log = logger('login');
const TTL_MS = 15 * 60_000;
const sessions = new Map();   // id → session

export function loginSpec(tool) {
  const dir = path.join(P.tools, tool);
  const spec = readJSON(path.join(dir, 'package.json'), {})?.askq?.login;
  if (!spec?.url) throw new Error(`The tool "${tool}" has no login page (package.json → askq.login).`);
  const state = path.resolve(dir, spec.state || '.auth/state.json');
  if (path.relative(dir, state).startsWith('..')) throw new Error('askq.login.state must be inside the tool folder.');
  return { ...spec, state, dir };
}

async function launch() {
  const { chromium, devices } = await import('playwright');
  const opts = { headless: true };
  try { return { browser: await chromium.launch(opts), devices }; }
  catch (e) {
    if (!/Executable doesn't exist|install/i.test(e.message)) throw e;
    log('INSTALL', 'chromium');
    const r = spawnSync(process.execPath, [path.join(APP, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], { encoding: 'utf8', timeout: 10 * 60_000 });
    if (r.status !== 0) throw new Error(`Could not install the browser: ${(r.stderr || r.stdout).trim().slice(-300)}`);
    return { browser: await chromium.launch(opts), devices };
  }
}

function broadcast(s, event, data) {
  const msg = `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  for (const res of s.clients) res.write(msg);
}

async function finish(s, status, text) {
  if (s.closed) return;
  s.closed = true;
  clearInterval(s.poll); clearTimeout(s.timer);
  broadcast(s, 'status', { status, text });
  for (const res of s.clients) res.end();
  await s.browser.close().catch(() => {});
  sessions.delete(s.id);
  log('END', s.tool, status);
  s.onEnd?.(status);
}

async function save(s) {
  const state = await s.context.storageState();
  fs.mkdirSync(path.dirname(s.spec.state), { recursive: true, mode: 0o700 });
  const tmp = s.spec.state + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, s.spec.state);
}

async function signedIn(s) {
  const url = s.page.url();
  if (s.spec.done && !new RegExp(s.spec.done).test(url)) return false;
  if (s.spec.check) {
    const r = await s.context.request.get(s.spec.check, { failOnStatusCode: false, timeout: 10_000 }).catch(() => null);
    return !!r && r.ok() && !/login|signin|saml/i.test(new URL(r.url()).pathname);
  }
  return !!s.spec.done;
}

// Opens the login page for `tool` and returns { id }. onEnd(status) is called with 'saved', 'cancelled' or 'expired'.
export async function startLogin(tool, { onEnd } = {}) {
  const spec = loginSpec(tool);
  for (const s of sessions.values()) if (s.tool === tool) await finish(s, 'cancelled', 'A new link was opened.');
  const { browser, devices } = await launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], locale: spec.locale });
  const page = await context.newPage();
  const s = { id: crypto.randomBytes(24).toString('hex'), tool, spec, browser, context, page, clients: new Set(), frame: null, onEnd, closed: false };
  sessions.set(s.id, s);
  // The browser tab streams JPEG frames; every phone watching gets them.
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    s.frame = { data, w: metadata.deviceWidth, h: metadata.deviceHeight };
    broadcast(s, 'frame', s.frame);
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  page.on('framenavigated', f => { if (f === page.mainFrame()) broadcast(s, 'status', { status: 'open', url: f.url() }); });
  await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(e => log('GOTO', e.message));
  s.timer = setTimeout(() => finish(s, 'expired', 'This link expired. Ask for a new one.'), TTL_MS);
  let busy = false;
  s.poll = setInterval(async () => {
    if (busy || s.closed) return;
    busy = true;
    try { if (await signedIn(s)) { await page.waitForTimeout(1500); await save(s); await finish(s, 'saved', 'Signed in. You can close this page.'); } }
    catch (e) { log('POLL', e.message); }
    finally { busy = false; }
  }, 2500);
  log('START', tool);
  return { id: s.id };
}

// Taps, typing and scrolling from the phone. Coordinates are CSS pixels of the emulated screen.
async function input(s, j) {
  const p = s.page;
  if (j.type === 'tap') return p.touchscreen.tap(+j.x, +j.y);
  if (j.type === 'text') return p.keyboard.insertText(String(j.text || ''));
  if (j.type === 'key' && ['Enter', 'Backspace', 'Tab'].includes(j.key)) return p.keyboard.press(j.key);
  if (j.type === 'scroll') return p.mouse.wheel(0, Math.max(-2000, Math.min(2000, +j.dy || 0)));
  if (j.type === 'back') return p.goBack({ timeout: 10_000 }).catch(() => {});
  if (j.type === 'done') { await save(s); return finish(s, 'saved', 'Saved. You can close this page.'); }
  if (j.type === 'cancel') return finish(s, 'cancelled', 'Cancelled.');
}

const headers = type => ({ 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });

// HTTP for /login/<id>[/events|/input]. Returns false if the path is not a login route. The unguessable id is the key.
export async function handle(req, res, url, readBody) {
  const m = url.pathname.match(/^\/login\/([0-9a-f]{48})(\/events|\/input)?$/);
  if (!m) return false;
  const s = sessions.get(m[1]);
  if (!s) { res.writeHead(404, headers('text/html; charset=utf-8')); res.end(GONE); return true; }
  if (!m[2] && req.method === 'GET') {
    res.writeHead(200, headers('text/html; charset=utf-8'));
    res.end(PAGE.replace('__TOOL__', esc(s.tool)).replace('__HINT__', esc(s.spec.hint || '')));
    return true;
  }
  if (m[2] === '/events' && req.method === 'GET') {
    res.writeHead(200, { ...headers('text/event-stream'), Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    s.clients.add(res);
    req.on('close', () => s.clients.delete(res));
    if (s.frame) res.write(`event: frame\ndata: ${JSON.stringify(s.frame)}\n\n`);
    return true;
  }
  if (m[2] === '/input' && req.method === 'POST') {
    try { await input(s, JSON.parse(await readBody(req) || '{}')); res.writeHead(204, headers('text/plain')); res.end(); }
    catch (e) { log('INPUT', e.message); res.writeHead(400, headers('text/plain')); res.end('error'); }
    return true;
  }
  res.writeHead(405, headers('text/plain')); res.end();
  return true;
}

const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const GONE = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ask Q sign-in</title><body style="font:16px system-ui;padding:24px;background:#111;color:#eee">This sign-in link has expired or was already used. Ask Ask Q for a new one.</body>';

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Ask Q sign-in</title>
<style>
:root{--bg:#111;--fg:#eee;--dim:#999;--neon:#c6f700;--btn:#262626}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f4f4f2;--fg:#111;--dim:#555;--neon:#4d6b00;--btn:#e2e2de}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px system-ui,-apple-system,sans-serif}
header{padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px}
header b{color:var(--neon)}#st{color:var(--dim);font-size:13px}
#hint{padding:0 16px 8px;color:var(--dim);font-size:13px}#hint:empty{display:none}
#wrap{padding:0 16px}#screen{width:100%;display:block;border-radius:10px;touch-action:none;background:#000;min-height:200px}
#bar{position:sticky;bottom:0;background:var(--bg);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:grid;gap:8px}
.row{display:flex;gap:8px}input{flex:1;min-width:0;font:16px system-ui;padding:10px;border-radius:8px;border:1px solid var(--btn);background:var(--btn);color:var(--fg)}
button{font:15px system-ui;padding:10px 12px;border-radius:8px;border:0;background:var(--btn);color:var(--fg)}
button.go{background:var(--neon);color:var(--bg);font-weight:600}
</style></head><body>
<header><div><b>Ask Q</b> · sign in to __TOOL__</div><div id="st">connecting…</div></header>
<div id="hint">__HINT__</div>
<div id="wrap"><img id="screen" alt="The website, live"></div>
<div id="bar">
  <div class="row"><input id="t" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Tap a field above, then type here"><button id="eye" aria-label="Show text">👁</button><button class="go" id="send">Send</button></div>
  <div class="row"><button data-k="Enter">⏎ Enter</button><button data-k="Backspace">⌫</button><button data-k="Tab">Tab</button><button id="back">← Back</button><button id="done">✓ Done</button></div>
</div>
<script>
const base = location.pathname, img = document.getElementById('screen'), st = document.getElementById('st'), t = document.getElementById('t');
let w = 412, h = 915;
const post = j => fetch(base + '/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j) }).catch(() => {});
const es = new EventSource(base + '/events');
es.addEventListener('frame', e => { const f = JSON.parse(e.data); w = f.w; h = f.h; img.src = 'data:image/jpeg;base64,' + f.data; st.textContent = 'live'; });
es.addEventListener('status', e => { const s = JSON.parse(e.data); if (s.text) { st.textContent = s.text; if (s.status !== 'open') { es.close(); document.getElementById('bar').remove(); } } });
es.onerror = () => { st.textContent = 'reconnecting…'; };
// tap = click there; drag = scroll
let start = null;
img.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY, last: e.clientY, moved: false }; img.setPointerCapture(e.pointerId); });
img.addEventListener('pointermove', e => { if (!start) return; const dy = start.last - e.clientY; if (Math.abs(e.clientY - start.y) > 8) start.moved = true; if (start.moved && Math.abs(dy) > 4) { post({ type: 'scroll', dy: dy * w / img.clientWidth }); start.last = e.clientY; } });
img.addEventListener('pointerup', e => { if (start && !start.moved) { const r = img.getBoundingClientRect(); post({ type: 'tap', x: (e.clientX - r.left) * w / r.width, y: (e.clientY - r.top) * h / r.height }); } start = null; });
const sendText = () => { if (t.value) { post({ type: 'text', text: t.value }); t.value = ''; } };
document.getElementById('send').onclick = sendText;
t.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendText(); setTimeout(() => post({ type: 'key', key: 'Enter' }), 150); } });
document.getElementById('eye').onclick = () => { t.type = t.type === 'password' ? 'text' : 'password'; };
for (const b of document.querySelectorAll('[data-k]')) b.onclick = () => post({ type: 'key', key: b.dataset.k });
document.getElementById('back').onclick = () => post({ type: 'back' });
document.getElementById('done').onclick = () => { if (confirm('Save this session now? Tap OK only when you are signed in.')) post({ type: 'done' }); };
</script></body></html>`;
