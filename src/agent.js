// Runs one turn of the assistant: Claude Code without a screen (`claude -p`) in ~/.askq/workspace, with the tools
// in ~/.askq/mcp.json. Each channel (siri, whatsapp, telegram) keeps its own conversation (--resume).
// Only one turn runs at a time; the next one waits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { P, APP, loadConfig, loadEnv, readJSON, writePrivate, logger } from './config.js';
import { asksForYes, isYes } from './confirm.js';

const log = logger('agent');
const MAX_MINUTES = 15;

// Built-in Claude Code tools the assistant may use without asking (nobody is in front of a screen to approve).
// Actions with real effects are still stopped by the guard hook until you say "yes".
const BUILTIN = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill'];

export function allowedTools() {
  const servers = Object.keys(readJSON(P.mcp, {}).mcpServers || {});
  return [...BUILTIN, ...servers.map(s => `mcp__${s}`)];
}

const STYLE = {
  siri: lang => `VOICE MODE (Siri): everything you write is read aloud. Reply in the language the user spoke (default: ${lang}). Use 1 to 3 short sentences. No markdown, lists, emojis, file paths or ids. Say dates and times the way people speak.`,
  whatsapp: lang => `CHAT MODE (WhatsApp): reply in the language the user wrote in (default: ${lang}), short and direct like a chat. WhatsApp formatting only: *bold* with one asterisk, _italics_, lists with "- ", no tables, no # headings.`,
  telegram: lang => `CHAT MODE (Telegram): reply in the language the user wrote in (default: ${lang}), short and direct like a chat. Plain text with simple lists, no tables, no # headings.`,
  cli: lang => `TERMINAL MODE: reply in the language the user wrote in (default: ${lang}), concisely.`,
};
const RULES = `Before any action with real effects (booking, cancelling, paying, buying, sending something to another person, deleting), say exactly what you will do (who, what, when, how much) and end with a yes/no question. The user's answer arrives in the next message. Repeating the original request is NOT a yes: ask again. To send a file or message to the user's own phone, use the askq-phone tool.`;

function readSessions() { return readJSON(P.sessions, {}); }
function saveSession(channel, data) {
  const s = readSessions();
  s[channel] = { ...s[channel], ...data };
  writePrivate(P.sessions, JSON.stringify(s));
}
export function resetSession(channel) { saveSession(channel, { id: null, asked: false, lastReply: '' }); }

let queue = Promise.resolve();

// text: what the user said · channel: siri|whatsapp|telegram|cli · expires: minutes after which a new conversation starts
export function ask(text, { channel = 'cli', expires = null } = {}) {
  const job = queue.then(() => run(text, channel, expires));
  queue = job.catch(() => {});
  return job;
}

function run(text, channel, expires) {
  const cfg = loadConfig();
  const sess = readSessions()[channel] || {};
  const fresh = expires && (Date.now() - (sess.t || 0) > expires * 60_000);
  const resume = sess.id && !fresh ? sess.id : null;
  // The "yes" is decided here, from what the user said, and handed to the guard hook through the environment.
  const yes = !!resume && sess.asked === true && isYes(text);

  const args = ['-p', text, '--output-format', 'json',
    '--append-system-prompt', `${STYLE[channel](cfg.language)}\n${RULES}`,
    '--setting-sources', 'project,local',
    '--strict-mcp-config', '--mcp-config', P.mcp,
    '--allowedTools', ...allowedTools()];
  if (resume) args.push('--resume', resume);

  const env = { ...process.env, ...loadEnv(), PATH: `${path.join(P.state, 'bin')}${path.delimiter}${process.env.PATH}`, ASKQ: '1', ASKQ_HOME: path.dirname(P.config), ASKQ_CHANNEL: channel,
    ASKQ_YES: yes ? '1' : '0', ASKQ_TURN: crypto.randomUUID(), ASKQ_QUESTION: yes ? (sess.lastReply || '') : '' };
  if (yes) log('YES', channel, JSON.stringify(text));

  return new Promise(resolve => {
    const p = spawn(process.env.ASKQ_CLAUDE || 'claude', args, { cwd: P.workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { err += e.message; });
    const killer = setTimeout(() => p.kill('SIGTERM'), MAX_MINUTES * 60_000);
    p.on('close', code => {
      clearTimeout(killer);
      let reply;
      try {
        const j = JSON.parse(out);
        if (j.permission_denials?.length) log('DENIED', JSON.stringify(j.permission_denials).slice(0, 1500));
        reply = String(j.result || '').trim() || (j.is_error ? `Error: ${j.subtype || 'unknown'}` : 'I have no answer.');
        saveSession(channel, { id: j.session_id || resume, t: Date.now(), asked: asksForYes(reply), lastReply: reply.slice(0, 2000) });
        log('OK', channel, resume ? 'resume' : 'new', JSON.stringify(text.slice(0, 200)), '→', JSON.stringify(reply.slice(0, 300)));
      } catch {
        log('ERROR', channel, code, err.slice(0, 800), out.slice(0, 300));
        reply = /not logged in|login|authenticat|api key/i.test(err + out)
          ? 'Claude Code is not signed in on the server. Run: askq doctor'
          : 'Something failed on the server. Run: askq logs';
      }
      resolve(reply);
    });
  });
}

export const workspaceReady = () => fs.existsSync(path.join(P.workspace, 'CLAUDE.md'));
export { APP };
