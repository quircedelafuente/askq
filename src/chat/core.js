// What every chat channel does with a message: voice notes are transcribed on this machine, photos are saved so the
// assistant can look at them, "new conversation" (or 2 hours of silence) starts over, and slow answers get an "on it" first.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { P, APP, logger, loadConfig } from '../config.js';
import { ask, resetSession } from '../agent.js';
import { isNewConversation } from '../confirm.js';

const log = logger('chat');
const SLOW_S = 25;

export function transcribe(file) {
  const py = process.platform === 'win32' ? path.join(P.stt, 'Scripts', 'python.exe') : path.join(P.stt, 'bin', 'python');
  if (!fs.existsSync(py)) return Promise.reject(new Error('Voice notes are off. Turn them on with: askq setup'));
  return new Promise((resolve, reject) => {
    const p = spawn(py, ['-I', path.join(APP, 'src', 'stt', 'transcribe.py'), file], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ASKQ_STT_MODEL: process.env.ASKQ_STT_MODEL || 'small' } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`transcribe ${code}: ${err.slice(-300)}`)));
  });
}

export async function createChat(cfg) {
  const { createChannel } = await import(`./${cfg.channel}.js`);
  const name = cfg.channel;
  let channel;
  const reply = text => channel.send({ text }).catch(e => log('SEND-FAIL', e.message));

  // msg: { kind: 'text'|'voice'|'photo'|'other', text?, file? }
  async function onMessage(msg) {
    let text = String(msg.text || '').trim();
    if (msg.kind === 'voice') {
      try { text = await transcribe(msg.file); } catch (e) { log('VOICE-FAIL', e.message); return reply(`I couldn't listen to that voice note. ${/off/.test(e.message) ? e.message : 'Please type it.'}`); }
      if (!text) return reply("I couldn't understand anything in that voice note.");
      await reply(`🎙️ «${text}»`);
    } else if (msg.kind === 'photo') {
      text = `[The user sent a photo: ${msg.file} (open it with Read)]${text ? ' ' + text : ''}`;
    } else if (msg.kind !== 'text') return reply('I understand text, voice notes and photos.');
    if (!text) return;
    log('IN', name, JSON.stringify(text.slice(0, 200)));
    if (isNewConversation(text)) { resetSession(name); return reply('Okay, starting over.'); }
    const slow = setTimeout(() => reply('On it…'), SLOW_S * 1000);
    const job = ask(text, { channel: name, expires: loadConfig().chatSessionMinutes, onEarly: t => { clearTimeout(slow); reply(t); } });
    const answer = await job;
    clearTimeout(slow);
    if (job.turn.sent) return log('FINAL-SKIPPED', 'already sent');   // the result is already in the chat
    await reply(answer);
  }

  channel = await createChannel(cfg, msg => onMessage(msg).catch(e => log('FAIL', e.message)));
  return channel;
}
