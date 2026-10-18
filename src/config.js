// Paths and settings. Everything Ask Q keeps lives in ~/.askq (or $ASKQ_HOME):
//   config.json   settings chosen in `askq setup` (mode 600)
//   env           secrets passed to Claude Code (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN), mode 600
//   token         bearer token the Siri shortcut sends
//   mcp.json      tools (MCP servers) the assistant can use
//   workspace/    where Claude Code runs: CLAUDE.md (who you are) and .claude/ (settings, guard hook, skills)
//   tools/        tools you create; secrets/ their keys; state/ sessions, logs, WhatsApp login, media
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = process.env.ASKQ_HOME || path.join(os.homedir(), '.askq');
export const P = {
  config: path.join(HOME, 'config.json'),
  env: path.join(HOME, 'env'),
  token: path.join(HOME, 'token'),
  mcp: path.join(HOME, 'mcp.json'),
  workspace: path.join(HOME, 'workspace'),
  tools: path.join(HOME, 'tools'),
  secrets: path.join(HOME, 'secrets'),
  state: path.join(HOME, 'state'),
  media: path.join(HOME, 'state', 'media'),
  logs: path.join(HOME, 'state', 'logs'),
  internalToken: path.join(HOME, 'state', 'internal-token'),
  effectTools: path.join(HOME, 'state', 'effect-tools.json'),
  sessions: path.join(HOME, 'state', 'sessions.json'),
  reminders: path.join(HOME, 'state', 'reminders.json'),
  whatsappAuth: path.join(HOME, 'state', 'whatsapp-auth'),
  stt: path.join(HOME, 'stt'),
};

export const DEFAULTS = {
  name: '',                 // how the assistant addresses you
  language: 'en',           // default reply language (it still answers in the language you speak)
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  port: 7811,               // local port of the Siri gateway (only reachable through Tailscale)
  channel: 'whatsapp',      // 'whatsapp' | 'telegram' | 'none' — where Ask Q sends you things and where you can chat
  whatsapp: {
    mode: 'group',          // 'group' = a group on your own number · 'number' = Ask Q has its own number
    group: 'Ask Q',         // group name in 'group' mode
    owners: [],             // in 'number' mode: phone numbers allowed to talk to it (digits, with country code)
  },
  telegram: { chatId: null },   // the bot token lives in `env` as TELEGRAM_BOT_TOKEN
  voiceNotes: false,        // transcribe voice notes locally (faster-whisper)
  sessionMinutes: 15,       // Siri: after this long, a new conversation starts
  guard: {
    exempt: ['mcp__askq-phone__send_to_phone', 'mcp__askq-phone__remind_me', 'mcp__askq-phone__list_reminders', 'mcp__askq-phone__cancel_reminder'],
    require: [],            // extra tool names (or prefixes ending in *) that always need your "yes"
  },
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
};

export function ensureDirs() {
  for (const d of [HOME, P.tools, P.secrets, P.state, P.media, P.logs]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

export function loadConfig() {
  try { return merge(DEFAULTS, JSON.parse(fs.readFileSync(P.config, 'utf8'))); } catch { return structuredClone(DEFAULTS); }
}
export function saveConfig(cfg) {
  ensureDirs();
  writePrivate(P.config, JSON.stringify(cfg, null, 2) + '\n');
}

export function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, data, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
export const readText = f => { try { return fs.readFileSync(f, 'utf8').trim() || null; } catch { return null; } };
export const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

// KEY=value lines (only the keys Ask Q knows). Values are never printed anywhere.
export function loadEnv() {
  const out = {};
  for (const line of (readText(P.env) || '').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
// Environment for Claude Code. `claude setup-token` prints tokens labelled "sk-ant-at01-" but Claude Code only accepts
// "sk-ant-oat01-" (same token body); with the wrong label it just says "Not logged in". Fixed here, at the point of use.
export function claudeEnv() {
  const env = loadEnv();
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.startsWith('sk-ant-at01-')) env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-' + env.CLAUDE_CODE_OAUTH_TOKEN.slice('sk-ant-at01-'.length);
  return env;
}
export function setEnv(key, value) {
  const env = loadEnv();
  if (value == null || value === '') delete env[key]; else env[key] = value;
  writePrivate(P.env, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

export function getToken({ create = false } = {}) {
  let t = readText(P.token);
  if (!t && create) { t = crypto.randomBytes(32).toString('base64url'); writePrivate(P.token, t + '\n'); }
  return t;
}
export function rotateToken() {
  const t = crypto.randomBytes(32).toString('base64url');
  writePrivate(P.token, t + '\n');
  return t;
}
export function internalToken() {
  let t = readText(P.internalToken);
  if (!t) { t = crypto.randomBytes(32).toString('base64url'); writePrivate(P.internalToken, t + '\n'); }
  return t;
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
export const sameSecret = (a, b) => !!a && !!b && crypto.timingSafeEqual(sha(a), sha(b));

export function logger(name) {
  const file = path.join(P.logs, `${name}.log`);
  return (...a) => {
    const line = `${new Date().toISOString()} ${a.join(' ')}\n`;
    try { fs.mkdirSync(P.logs, { recursive: true, mode: 0o700 }); fs.appendFileSync(file, line, { mode: 0o600 }); } catch {}
    if (process.env.ASKQ_DEBUG) process.stderr.write(`[${name}] ${line}`);
  };
}
