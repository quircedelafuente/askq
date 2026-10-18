// WhatsApp channel, as a linked device (like WhatsApp Web) using Baileys — an unofficial library. WhatsApp can ban
// numbers that use unofficial clients; the docs recommend a secondary number if that worries you.
//  · mode "group":  linked to YOUR number. You talk to Ask Q in a group where you are the only member.
//  · mode "number": Ask Q has its own number. It only answers the owner numbers in config.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, jidNormalizedUser, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { P, logger, loadConfig, saveConfig } from '../config.js';

const log = logger('whatsapp');
const quiet = pino({ level: 'silent' });
const MARK = '🅠 ';
const digits = s => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function socket() {
  fs.mkdirSync(P.whatsappAuth, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(P.whatsappAuth);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({ version, auth: state, logger: quiet, browser: Browsers.macOS('Desktop'), markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  return sock;
}

export const isLinked = () => fs.existsSync(path.join(P.whatsappAuth, 'creds.json'));

// `askq link whatsapp`: shows a QR (or an 8-letter code if you pass your number) and waits until the phone links.
export async function link({ phone } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const sock = await socket();
    const result = await new Promise(resolve => {
      let asked = false;
      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr && !asked) {
          asked = true;
          if (phone) {
            const code = await sock.requestPairingCode(digits(phone));
            console.log(`\nOn your phone: WhatsApp → Linked devices → Link a device → Link with phone number instead\nEnter this code: ${code.match(/.{1,4}/g).join('-')}\n`);
          } else {
            console.log('\nOn your phone: WhatsApp → Linked devices → Link a device, and scan this QR:\n');
            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
          }
        }
        if (connection === 'open') { resolve({ ok: true, me: digits(sock.user?.id) }); }
        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          resolve({ ok: false, retry: code === DisconnectReason.restartRequired || code === 515, code });
        }
      });
    });
    if (result.ok) { await new Promise(r => setTimeout(r, 3000)); sock.end(); return result; }
    sock.end();
    if (!result.retry) throw new Error(`WhatsApp closed the connection (${result.code}). Run the command again.`);
  }
  throw new Error('Could not link WhatsApp. Try again.');
}

export async function createChannel(cfg, onMessage) {
  if (!isLinked()) throw new Error('WhatsApp is not linked. Run: askq link whatsapp');
  const mode = cfg.whatsapp.mode;
  const owners = (cfg.whatsapp.owners || []).map(digits).filter(Boolean);
  const sent = new Set();          // ids of messages Ask Q sent, so it never answers itself
  let sock = null, target = null, open = false, retries = 0, stopped = false;

  async function findGroup() {
    const name = cfg.whatsapp.group || 'Ask Q';
    const saved = loadConfig().whatsapp.groupJid;
    const groups = Object.values(await sock.groupFetchAllParticipating());
    if (saved && groups.some(g => g.id === saved)) return saved;
    const found = groups.filter(g => g.subject === name);
    if (found.length === 1) return remember(found[0].id);
    if (found.length > 1) { log('GROUP', `several groups called "${name}"; rename the others`); return null; }
    try {
      const g = await sock.groupCreate(name, []);
      log('GROUP', 'created', g.id);
      return remember(g.id);
    } catch (e) {
      log('GROUP', `could not create "${name}" (${e.message}). Create a WhatsApp group with that name yourself (add someone, then remove them).`);
      return null;
    }
  }
  function remember(jid) { const c = loadConfig(); c.whatsapp.groupJid = jid; saveConfig(c); return jid; }

  async function media(m, kind) {
    const ext = kind === 'voice' ? '.ogg' : '.jpg';
    const file = path.join(P.media, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`);
    fs.writeFileSync(file, await downloadMediaMessage(m, 'buffer', {}, { logger: quiet, reuploadRequest: sock.updateMediaMessage }), { mode: 0o600 });
    return file;
  }

  function fromOwner(m) {
    const k = m.key;
    const cands = [k.remoteJid, k.remoteJidAlt, k.participant, k.participantAlt, k.senderPn].map(digits).filter(Boolean);
    return cands.some(d => owners.some(o => d.endsWith(o.slice(-9))));
  }

  async function handle(m) {
    if (!m.message || sent.has(m.key.id)) return;
    const jid = m.key.remoteJid;
    if (mode === 'group') { if (!target || jid !== target || !m.key.fromMe) return; }
    else { if (m.key.fromMe || jid.endsWith('@g.us') || !fromOwner(m)) return; target = jid; }
    const msg = m.message.ephemeralMessage?.message || m.message;
    const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || '';
    if (text.startsWith(MARK.trim())) return;
    if (msg.audioMessage) return onMessage({ kind: 'voice', file: await media(m, 'voice') });
    if (msg.imageMessage) return onMessage({ kind: 'photo', file: await media(m, 'photo'), text });
    if (text) return onMessage({ kind: 'text', text });
    return onMessage({ kind: 'other' });
  }

  async function start() {
    sock = await socket();
    // Messages you type on your phone can arrive as 'notify' or 'append'; anything older than this start is history.
    const since = Math.floor(Date.now() / 1000) - 5;
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages) if (Number(m.messageTimestamp) >= since) handle(m).catch(e => log('HANDLE-FAIL', e.message));
    });
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        open = true; retries = 0;
        if (mode === 'group') target = await findGroup().catch(e => { log('GROUP-FAIL', e.message); return null; });
        else if (!target && owners[0]) target = `${owners[0]}@s.whatsapp.net`;
        log('OPEN', jidNormalizedUser(sock.user.id), mode, target || '(no chat yet)');
      }
      if (connection === 'close') {
        open = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { log('LOGGED-OUT', 'unlinked from the phone; run: askq link whatsapp'); fs.rmSync(P.whatsappAuth, { recursive: true, force: true }); return; }
        if (stopped) return;
        const wait = Math.min(60_000, 2000 * 2 ** retries++);
        log('CLOSED', code, `retry in ${wait / 1000}s`);
        setTimeout(() => start().catch(e => log('START-FAIL', e.message)), code === DisconnectReason.restartRequired ? 0 : wait);
      }
    });
  }
  await start();

  async function deliver(content) {
    const r = await sock.sendMessage(target, content);
    if (r?.key?.id) { sent.add(r.key.id); if (sent.size > 500) sent.delete(sent.values().next().value); }
  }

  return {
    async send({ text, files = [] }) {
      for (let i = 0; i < 20 && !open; i++) await new Promise(r => setTimeout(r, 500));
      if (!open || !target) throw new Error(mode === 'group' ? `WhatsApp group "${cfg.whatsapp.group}" not found yet` : 'No owner number configured');
      if (text) await deliver({ text: MARK + text });
      for (const f of files) {
        const ext = path.extname(f).toLowerCase(), mimetype = MIME[ext] || 'application/octet-stream', data = fs.readFileSync(f);
        await deliver(mimetype.startsWith('image/') && ext !== '.gif' ? { image: data, mimetype } : { document: data, mimetype, fileName: path.basename(f) });
      }
    },
    async stop() { stopped = true; sock?.end(); },
  };
}
