// Give a tool a password or API key from your phone. Ask Q sends you a one-time link to a small form; what you type
// is saved straight into that tool's secrets file (~/.askq/secrets/<tool>.json, mode 600). It never goes through the
// chat or the AI: the assistant only learns that it was saved.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, logger } from './config.js';
import { NAME, setSecret, readMcp } from './tools.js';

const log = logger('secret');
const TTL_MS = 15 * 60_000;
const KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const forms = new Map();   // id → form

export function startSecret(tool, keys, { note = '', onEnd } = {}) {
  if (!NAME.test(tool) || tool === 'askq-phone' || !(readMcp().mcpServers[tool] || fs.existsSync(path.join(P.tools, tool)))) throw new Error(`No tool called "${tool}".`);
  keys = [...new Set((keys || []).map(String))];
  if (!keys.length || keys.length > 8 || !keys.every(k => KEY.test(k))) throw new Error('keys: 1 to 8 names in CAPITALS (e.g. PASSWORD, API_KEY).');
  for (const f of forms.values()) if (f.tool === tool) end(f, 'cancelled');
  const f = { id: crypto.randomBytes(24).toString('hex'), tool, keys, note: String(note).slice(0, 300), onEnd };
  f.timer = setTimeout(() => end(f, 'expired'), TTL_MS);
  f.timer.unref?.();
  forms.set(f.id, f);
  log('START', tool, keys.join(','));
  return { id: f.id };
}

function end(f, status) {
  if (!forms.delete(f.id)) return;
  clearTimeout(f.timer);
  log('END', f.tool, status);
  f.onEnd?.(status, f.keys);
}

const headers = type => ({ 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTTP for /secret/<id>. Returns false if the path is not a secret form. The unguessable id is the key; one use only.
export async function handle(req, res, url, readBody) {
  const m = url.pathname.match(/^\/secret\/([0-9a-f]{48})$/);
  if (!m) return false;
  const f = forms.get(m[1]);
  if (!f) { res.writeHead(404, headers('text/html; charset=utf-8')); res.end(page('This link has expired or was already used. Ask Ask Q for a new one.')); return true; }
  if (req.method === 'GET') {
    res.writeHead(200, headers('text/html; charset=utf-8'));
    res.end(page(`<p>For the tool <b>${esc(f.tool)}</b>${f.note ? `: ${esc(f.note)}` : ''}</p>
<form id="f">${f.keys.map(k => `<label>${esc(k)}<input type="password" name="${k}" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>`).join('')}
<label class="row"><input type="checkbox" id="show"> Show</label><button>Save</button></form>
<p class="dim">Saved only on your Ask Q machine. It doesn't go through the chat or the AI.</p>
<script>
const f = document.getElementById('f');
document.getElementById('show').onchange = e => { for (const i of f.querySelectorAll('input[name]')) i.type = e.target.checked ? 'text' : 'password'; };
f.onsubmit = async e => {
  e.preventDefault();
  const values = Object.fromEntries(new FormData(f));
  const r = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }).catch(() => null);
  document.querySelector('main').innerHTML = r && r.ok ? '<h1>Saved ✓</h1><p>You can close this page.</p>' : '<h1>Not saved</h1><p>The link expired. Ask Ask Q for a new one.</p>';
};
</script>`));
    return true;
  }
  if (req.method === 'POST') {
    let values;
    try { values = JSON.parse(await readBody(req) || '{}').values || {}; } catch { values = {}; }
    if (!f.keys.every(k => typeof values[k] === 'string' && values[k].length && values[k].length < 4000)) { res.writeHead(400, headers('text/plain')); res.end('missing'); return true; }
    for (const k of f.keys) setSecret(f.tool, k, values[k]);
    end(f, 'saved');
    res.writeHead(204, headers('text/plain')); res.end();
    return true;
  }
  res.writeHead(405, headers('text/plain')); res.end();
  return true;
}

const page = body => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ask Q secret</title><style>
:root{--bg:#111;--fg:#eee;--dim:#999;--neon:#c6f700;--field:#262626}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f4f4f2;--fg:#111;--dim:#555;--neon:#4d6b00;--field:#e2e2de}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,-apple-system,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px}h1{font-size:20px}b,h1 span{color:var(--neon)}.dim{color:var(--dim);font-size:13px}
label{display:grid;gap:6px;margin:14px 0;font-weight:600}label.row{display:flex;align-items:center;font-weight:400}
input[name]{font:16px system-ui;padding:12px;border-radius:8px;border:1px solid var(--field);background:var(--field);color:var(--fg)}
button{width:100%;font:16px system-ui;font-weight:600;padding:12px;border:0;border-radius:8px;background:var(--neon);color:var(--bg)}
</style></head><body><main><h1><span>Ask Q</span> · secret</h1>${body}</main></body></html>`;
