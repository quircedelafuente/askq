// Telegram channel: your own bot (create it with @BotFather, free). Official API, long polling — no webhook, so no
// open port is needed. It only answers the chat you paired with `askq link telegram`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, logger, loadEnv, loadConfig, saveConfig } from '../config.js';

const log = logger('telegram');
const token = () => loadEnv().TELEGRAM_BOT_TOKEN;

async function api(method, params = {}, form = null) {
  const t = token();
  if (!t) throw new Error('No Telegram bot token. Run: askq link telegram');
  const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, form
    ? { method: 'POST', body: form }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(65_000) });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

// `askq link telegram`: checks the bot token and waits for you to send /start <code> to the bot.
export async function link() {
  const me = await api('getMe');
  const code = crypto.randomInt(100000, 999999).toString();
  console.log(`\nOpen Telegram and send this message to @${me.username}:\n\n    /start ${code}\n\nWaiting…`);
  let offset = 0;
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (m?.text?.trim() === `/start ${code}`) {
        const c = loadConfig(); c.telegram.chatId = m.chat.id; saveConfig(c);
        await api('getUpdates', { offset, timeout: 0 });
        await api('sendMessage', { chat_id: m.chat.id, text: '✅ Paired. This chat is now Ask Q.' });
        return { ok: true, bot: me.username };
      }
    }
  }
  throw new Error('No /start message received in 10 minutes.');
}

async function download(fileId, ext) {
  const f = await api('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${token()}/${f.file_path}`);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const file = path.join(P.media, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext || path.extname(f.file_path)}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()), { mode: 0o600 });
  return file;
}

export async function createChannel(cfg, onMessage) {
  const chatId = cfg.telegram.chatId;
  if (!chatId || !token()) throw new Error('Telegram is not paired. Run: askq link telegram');
  let stopped = false, offset = 0;

  (async function poll() {
    let errors = 0;
    while (!stopped) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        errors = 0;
        for (const u of updates) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m || m.chat.id !== chatId) continue;     // only your chat
          if (m.voice || m.audio) onMessage({ kind: 'voice', file: await download((m.voice || m.audio).file_id, '.ogg') });
          else if (m.photo) onMessage({ kind: 'photo', file: await download(m.photo.at(-1).file_id, '.jpg'), text: m.caption || '' });
          else if (m.text) onMessage({ kind: 'text', text: m.text.replace(/^\/start\b.*/, '').trim() || m.text });
          else onMessage({ kind: 'other' });
        }
      } catch (e) {
        log('POLL-FAIL', e.message);
        await new Promise(r => setTimeout(r, Math.min(60_000, 2000 * 2 ** errors++)));
      }
    }
  })();
  log('OPEN', `chat ${chatId}`);

  return {
    async send({ text, files = [] }) {
      for (let i = 0; text && i < text.length; i += 4000) await api('sendMessage', { chat_id: chatId, text: text.slice(i, i + 4000) });
      for (const f of files) {
        const isImage = /\.(png|jpe?g|webp)$/i.test(f);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append(isImage ? 'photo' : 'document', new Blob([fs.readFileSync(f)]), path.basename(f));
        await api(isImage ? 'sendPhoto' : 'sendDocument', {}, form);
      }
    },
    async stop() { stopped = true; },
  };
}
