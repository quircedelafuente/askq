// The Ask Q service (`askq run`, normally started by systemd/launchd). One process:
//  · Siri gateway: POST /ask with the bearer token → one assistant turn → plain text for Siri to read.
//    Listens on 127.0.0.1 only; Tailscale (`tailscale serve`) is the only way in from your phone.
//  · Chat channel (WhatsApp or Telegram): you chat with Ask Q, and it can send you files and reminders.
//  · Internal API for the askq-phone tool and the guard (127.0.0.1, internal token).
import http from 'node:http';
import crypto from 'node:crypto';
import { P, loadConfig, getToken, internalToken, sameSecret, readJSON, writePrivate, logger, ensureDirs } from './config.js';
import { ask, resetSession } from './agent.js';
import { isNewConversation } from './confirm.js';
import { createChat } from './chat/core.js';

const log = logger('service');
const cfg = loadConfig();
ensureDirs();
const TOKEN = getToken({ create: true });
const INTERNAL = internalToken();
const MAX_WAIT_S = 32;    // Siri drops a voice session after ~30-40 s: answer before that and finish on the next phrase

// ---------- chat channel ----------
let chat = null;
if (cfg.channel === 'whatsapp' || cfg.channel === 'telegram') {
  try { chat = await createChat(cfg); }
  catch (e) { log('CHANNEL-FAIL', cfg.channel, e.message); }
}
const notify = async (text, files = []) => {
  if (!chat) throw new Error(`No chat channel is connected (channel: ${cfg.channel}). Run: askq link ${cfg.channel === 'none' ? 'whatsapp' : cfg.channel}`);
  await chat.send({ text, files });
};

// ---------- reminders ----------
// 'YYYY-MM-DD HH:MM' in the user's timezone → epoch ms
function zonedToEpoch(local, tz) {
  const [d, t] = local.split(' '); const [y, mo, da] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asTz = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (asTz - guess);
}
const readReminders = () => readJSON(P.reminders, []);
const saveReminders = r => writePrivate(P.reminders, JSON.stringify(r, null, 1));
setInterval(async () => {
  const due = readReminders().filter(r => r.at <= Date.now());
  for (const r of due) {
    try { await notify(`⏰ ${r.text}`); saveReminders(readReminders().filter(x => x.id !== r.id)); log('REMINDER', r.id); }
    catch (e) { log('REMINDER-FAIL', r.id, e.message); }
  }
}, 30_000).unref();

// ---------- Siri ----------
let last = { key: '', t: 0 };     // last phrase, to detect a shortcut stuck in a loop
let pending = null;               // a slow answer the user has not heard yet
const clean = s => s.replace(/```[\s\S]*?```/g, '').replace(/[*_`#>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '\n').trim();
const looksSpanish = t => /[áéíóúñ¿¡]|\b(qu[eé]|el|la|los|las|de|mi|me|tengo|hay|para|con|por|vale|dale|ya)\b/i.test(t);
const onIt = t => looksSpanish(t) ? 'Estoy en ello, tarda un poco. ¿Me dices «vale» en unos segundos y te lo cuento?' : 'On it, this takes a moment. Can you say "okay" in a few seconds so I can tell you?';

// Brute force: 5 wrong tokens in 15 min from one address → blocked for 1 h, and you get a message.
const fails = new Map();
const blocked = ip => (fails.get(ip)?.until || 0) > Date.now();
function failed(ip) {
  const prev = fails.get(ip);
  const f = prev && Date.now() - prev.since < 15 * 60_000 ? prev : { n: 0, since: Date.now(), until: 0 };
  if (++f.n >= 5) { f.until = Date.now() + 60 * 60_000; notify(`🔐 Ask Q blocked ${ip} for 1 hour after ${f.n} attempts with a wrong token.`).catch(() => {}); }
  fails.set(ip, f);
}

async function siri(text) {
  const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wait = p => Promise.race([p, new Promise(r => setTimeout(() => r(null), MAX_WAIT_S * 1000))]);
  if (isNewConversation(text)) { resetSession('siri'); pending = null; return looksSpanish(text) ? 'Vale, empezamos de cero.' : 'Okay, starting over.'; }
  // A slow answer is waiting: a short phrase ("okay", "done?") just collects it, without a new turn.
  if (pending && key.split(' ').length <= 4) {
    const r = await wait(pending);
    if (r === null) return onIt(text);
    pending = null;
    return r;
  }
  // A badly built shortcut sends the same phrase again and again: never pass it on (it could repeat an action).
  if (last.key === key && Date.now() - last.t < 120_000) { last.t = Date.now(); log('REPEATED', JSON.stringify(text)); return 'I got the same phrase again. Your shortcut is probably not saving your new answer; check the variable in its loop. Say stop to exit.'; }
  last = { key, t: Date.now() };
  const job = ask(text, { channel: 'siri', expires: cfg.sessionMinutes });
  const r = await wait(job);
  if (r === null) { pending = job; return onIt(text); }
  pending = null;
  return r;
}

// ---------- HTTP ----------
const send = (res, code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
async function body(req, max = 20_000) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > max) throw Object.assign(new Error('too long'), { code: 413 }); }
  return b;
}
const bearer = req => String(req.headers.authorization || '').trim().replace(/^bearer\s+/i, '').trim();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'ok');

    if (url.pathname.startsWith('/internal/')) {
      // Only from this machine, with the internal token (not the Siri one).
      if (!sameSecret(bearer(req), INTERNAL) || req.headers['x-forwarded-for']) return send(res, 401, { error: 'unauthorized' }, 'application/json');
      const j = req.method === 'POST' ? JSON.parse(await body(req, 200_000) || '{}') : {};
      const route = url.pathname.slice('/internal/'.length);
      if (route === 'notify') { await notify(String(j.text || '')).catch(e => log('NOTIFY-FAIL', e.message)); return send(res, 200, { ok: true }, 'application/json'); }
      if (route === 'send') { await notify(j.text || '', j.files || []); log('SENT', (j.files || []).length, 'files'); return send(res, 200, { sent: true, channel: cfg.channel }, 'application/json'); }
      if (route === 'reminders' && req.method === 'GET') return send(res, 200, readReminders().map(r => ({ id: r.id, when: r.when, text: r.text })), 'application/json');
      if (route === 'reminders') {
        const at = zonedToEpoch(j.when, cfg.timezone);
        if (!(at > Date.now())) return send(res, 400, { error: `That time is in the past (${cfg.timezone}).` }, 'application/json');
        const r = { id: crypto.randomBytes(4).toString('hex'), when: j.when, at, text: String(j.text) };
        saveReminders([...readReminders(), r]);
        return send(res, 200, { scheduled: r.id, when: `${r.when} (${cfg.timezone})` }, 'application/json');
      }
      if (route === 'reminders/cancel') {
        const all = readReminders(); const left = all.filter(r => r.id !== j.id);
        if (left.length === all.length) return send(res, 404, { error: 'No reminder with that id.' }, 'application/json');
        saveReminders(left); return send(res, 200, { cancelled: j.id }, 'application/json');
      }
      return send(res, 404, { error: 'unknown' }, 'application/json');
    }

    if (req.method === 'POST' && (url.pathname === '/ask' || url.pathname === '/q')) {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
      if (blocked(ip)) return send(res, 429, 'blocked');
      if (!sameSecret(bearer(req), TOKEN)) { log('DENIED', ip); failed(ip); return send(res, 401, 'unauthorized'); }
      fails.delete(ip);
      const raw = await body(req);
      let text = raw;
      try { const j = JSON.parse(raw); text = j.text ?? j.texto ?? ''; } catch {}
      text = String(text).trim();
      if (!text) return send(res, 400, "I didn't hear anything.");
      log('SIRI', JSON.stringify(text.slice(0, 200)));
      return send(res, 200, clean(await siri(text)));
    }
    send(res, 404, 'not found');
  } catch (e) {
    log('HTTP-ERROR', e.message);
    send(res, e.code === 413 ? 413 : 500, e.code === 413 ? 'too long' : 'error');
  }
});

server.listen(cfg.port, '127.0.0.1', () => log('START', `port ${cfg.port}, channel ${cfg.channel}${chat ? '' : ' (not connected)'}`));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, async () => { log('STOP', s); await chat?.stop?.().catch(() => {}); process.exit(0); });
