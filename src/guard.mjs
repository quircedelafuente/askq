#!/usr/bin/env node
// Guard (Claude Code PreToolUse hook). Tools with real effects (paying, booking, sending to other people, deleting,
// uploading data out of the machine) only run right after you said "yes" to a question, and one "yes" only covers
// the kind of action you approved.
//
// Which tools have effects comes from the tools themselves: every MCP tool can declare `readOnlyHint: true`.
// `askq tools sync` reads those annotations into state/effect-tools.json. A tool that does not say it is read-only is
// treated as having effects. You can override with guard.exempt / guard.require in config.json.
//
// The "yes" is decided by Ask Q from what you said (ASKQ_YES / ASKQ_TURN, see src/agent.js), never by the model,
// so instructions hidden in an email or a web page cannot approve anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.ASKQ_HOME || path.join(os.homedir(), '.askq');
const STATE = path.join(HOME, 'state');
const USED = path.join(STATE, 'guard-used');
const LOG = path.join(STATE, 'logs', 'guard.log');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const cfg = readJSON(path.join(HOME, 'config.json'), {});
const effects = readJSON(path.join(STATE, 'effect-tools.json'), { readOnly: [], effect: [] });
const matches = (list, name) => (list || []).some(p => p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : p === name);

// Through Bash: things that send data out of the machine. Requests to local services (127.0.0.1) do not count.
const BASH = /\b(sendmail|mutt|msmtp|swaks|rclone|scp|sftp|ssh|nc|ncat|socat|ftp)\s/i;
const UPLOAD = /\bcurl\b[^|;&\n]*\s(-d|--data\S*|-F|--form|-T|--upload-file|-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE))\b|\bwget\b[^|;&\n]*--(post|method|body)/i;
const onlyLocal = cmd => { const u = cmd.match(/https?:\/\/[^\s'"]+/g) || []; return u.length > 0 && u.every(x => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(x)); };

let input = '';
for await (const c of process.stdin) input += c;
let j; try { j = JSON.parse(input); } catch { process.exit(0); }
const tool = j.tool_name || '', args = j.tool_input || {};

let sensitive = false;
if (tool.startsWith('mcp__')) {
  const exempt = matches(cfg.guard?.exempt, tool);
  const required = matches(cfg.guard?.require, tool);
  sensitive = required || (!exempt && !effects.readOnly.includes(tool));
} else if (tool === 'Bash') {
  const cmd = String(args.command || '');
  sensitive = BASH.test(cmd) || (UPLOAD.test(cmd) && !onlyLocal(cmd)) || matches(cfg.guard?.require, 'Bash');
}
if (!sensitive) process.exit(0);

fs.mkdirSync(path.dirname(LOG), { recursive: true, mode: 0o700 });
const summary = tool === 'Bash' ? `Bash: ${String(args.command).slice(0, 200)}` : `${tool.replace(/^mcp__/, '')} ${JSON.stringify(args).slice(0, 200)}`;
const log = (...a) => { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${a.join(' ')}\n`, { mode: 0o600 }); } catch {} };
const decide = (decision, reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }));
  process.exit(0);
};
const ASK = 'This action has real effects and the user has not confirmed it. Tell them exactly what you will do (who, what text, which day, how much) and ask whether to do it; wait for their "yes" in the next message.';

// Interactive sessions (someone typing in `claude` inside the workspace): Claude Code's own permission prompt asks.
if (process.env.ASKQ !== '1') process.exit(0);
if (process.env.ASKQ_YES !== '1' || !process.env.ASKQ_TURN) { log('BLOCKED', summary); decide('deny', ASK); }

// The "yes" only covers recipients the assistant named in its question: if an email or web page changes the
// recipient along the way, it does not go through.
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const question = norm(process.env.ASKQ_QUESTION), qDigits = question.replace(/\D/g, '');
const recipients = [];
for (const k of ['to', 'cc', 'bcc', 'recipient', 'recipients', 'para', 'phone', 'number', 'email', 'chat']) for (const v of [].concat(args[k] ?? [])) if (v && typeof v !== 'object') recipients.push(String(v));
const unnamed = recipients.filter(v => {
  const t = norm(v), d = t.replace(/\D/g, '');
  const keys = [t, t.split('@')[0]].filter(x => x.length >= 3);
  return !(keys.some(x => question.includes(x)) || (d.length >= 6 && qDigits.includes(d.slice(-9))));
});
if (unnamed.length) { log('BLOCKED', 'recipient not named in the question:', unnamed.join(', '), '·', summary);
  decide('deny', `The user did not confirm sending to ${unnamed.join(', ')}: it was not in your question. Ask again naming exactly who.`); }

// One "yes" covers up to 6 actions of the SAME tool in this turn (e.g. two messages to the same person), never a
// different kind of action.
const turn = `turn:${process.env.ASKQ_TURN}`;
const use = `${turn}|${j.tool_use_id || ''}|${tool}`;
let used = []; try { used = fs.readFileSync(USED, 'utf8').split('\n').filter(Boolean).slice(-500); } catch {}
if (used.includes(use)) decide('allow', 'Confirmed by the user.');
const previous = used.filter(u => u.split('|')[0] === turn);
if (previous.length >= 6 || previous.some(u => u.split('|')[2] !== tool)) { log('BLOCKED', 'second kind of action with the same yes:', summary);
  decide('deny', 'Their "yes" was for a different action. For this one, ask again saying exactly what you will do.'); }
fs.writeFileSync(USED, [...used, use].join('\n') + '\n', { mode: 0o600 });
log('ALLOWED', summary);

// Tell the user on their phone what was done (best effort).
let port = cfg.port || 7811, token = '';
try { token = fs.readFileSync(path.join(STATE, 'internal-token'), 'utf8').trim(); } catch {}
fetch(`http://127.0.0.1:${port}/internal/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ text: `🔐 Ask Q did this after your "yes": ${summary}` }), signal: AbortSignal.timeout(3000) })
  .catch(() => {}).finally(() => decide('allow', 'Confirmed by the user.'));
