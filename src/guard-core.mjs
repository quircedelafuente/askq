// The "yes" rule, shared by every engine. Tools with real effects (paying, booking, sending to other people, deleting,
// uploading data out of the machine) only run right after you said "yes" to a question, and one "yes" only covers
// the kind of action you approved.
//
// Which tools have effects comes from the tools themselves: every MCP tool can declare `readOnlyHint: true`.
// `askq tools sync` reads those annotations into state/effect-tools.json. A tool that does not say it is read-only is
// treated as having effects. You can override with guard.exempt / guard.require in config.json.
//
// The "yes" is decided by Ask Q from what you said (src/agent.js writes it to state/turn.json and to ASKQ_YES /
// ASKQ_TURN), never by the model, so instructions hidden in an email or a web page cannot approve anything.
//
// Claude Code calls this through a PreToolUse hook (src/guard.mjs). Other engines (Codex, Cursor, Antigravity) reach
// tools through src/mcp-proxy.mjs, which calls it before forwarding each tool call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.ASKQ_HOME || path.join(os.homedir(), '.askq');
const STATE = path.join(HOME, 'state');
const USED = path.join(STATE, 'guard-used');
const LOG = path.join(STATE, 'logs', 'guard.log');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const matches = (list, name) => (list || []).some(p => p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : p === name);

// Through the shell: things that send data out of the machine. Requests to local services (127.0.0.1) do not count.
const BASH = /\b(sendmail|mutt|msmtp|swaks|rclone|scp|sftp|ssh|nc|ncat|socat|ftp)\s/i;
const UPLOAD = /\bcurl\b[^|;&\n]*\s(-d|--data\S*|-F|--form|-T|--upload-file|-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE))\b|\bwget\b[^|;&\n]*--(post|method|body)/i;
const onlyLocal = cmd => { const u = cmd.match(/https?:\/\/[^\s'"]+/g) || []; return u.length > 0 && u.every(x => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(x)); };

const ASK = 'This action has real effects and the user has not confirmed it. Tell them exactly what you will do (who, what text, which day, how much) and ask whether to do it; wait for their "yes" in the next message.';
const log = (...a) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true, mode: 0o700 }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${a.join(' ')}\n`, { mode: 0o600 }); } catch {} };

// The current turn: from the environment (Claude Code passes it to hooks) or from state/turn.json (MCP servers of
// other engines may not get the environment). Null when no Ask Q turn is running.
function currentTurn(env) {
  if (env.ASKQ === '1') return { turn: env.ASKQ_TURN || '', yes: env.ASKQ_YES === '1' && !!env.ASKQ_TURN, question: env.ASKQ_QUESTION || '' };
  const t = readJSON(path.join(STATE, 'turn.json'), null);
  return t && t.until > Date.now() ? t : null;
}

// tool: "mcp__<server>__<name>" or "Bash" · args: the call's arguments · callId: unique per call (or '').
// Returns { decision: 'pass' | 'allow' | 'deny', reason }. 'pass' = not an action with effects.
// interactive: what to do when no Ask Q turn is running ('pass' for Claude Code's own prompt, 'deny' for the proxy).
export async function check({ tool, args = {}, callId = '', env = process.env, interactive = 'pass' }) {
  const cfg = readJSON(path.join(HOME, 'config.json'), {});
  const effects = readJSON(path.join(STATE, 'effect-tools.json'), { readOnly: [], effect: [] });
  let sensitive = false;
  if (tool.startsWith('mcp__')) {
    const exempt = matches(cfg.guard?.exempt, tool);
    const required = matches(cfg.guard?.require, tool);
    sensitive = required || (!exempt && !effects.readOnly.includes(tool));
  } else if (tool === 'Bash') {
    const cmd = String(args.command || '');
    sensitive = BASH.test(cmd) || (UPLOAD.test(cmd) && !onlyLocal(cmd)) || matches(cfg.guard?.require, 'Bash');
  }
  if (!sensitive) return { decision: 'pass' };

  const summary = tool === 'Bash' ? `Bash: ${String(args.command).slice(0, 200)}` : `${tool.replace(/^mcp__/, '')} ${JSON.stringify(args).slice(0, 200)}`;
  const t = currentTurn(env);
  if (!t) return interactive === 'pass' ? { decision: 'pass' } : (log('BLOCKED', 'no turn:', summary), { decision: 'deny', reason: ASK });
  if (!t.yes) { log('BLOCKED', summary); return { decision: 'deny', reason: ASK }; }

  // The "yes" only covers recipients the assistant named in its question: if an email or web page changes the
  // recipient along the way, it does not go through.
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const question = norm(t.question), qDigits = question.replace(/\D/g, '');
  const recipients = [];
  for (const k of ['to', 'cc', 'bcc', 'recipient', 'recipients', 'para', 'phone', 'number', 'email', 'chat']) for (const v of [].concat(args[k] ?? [])) if (v && typeof v !== 'object') recipients.push(String(v));
  const unnamed = recipients.filter(v => {
    const s = norm(v), d = s.replace(/\D/g, '');
    const keys = [s, s.split('@')[0]].filter(x => x.length >= 3);
    return !(keys.some(x => question.includes(x)) || (d.length >= 6 && qDigits.includes(d.slice(-9))));
  });
  if (unnamed.length) {
    log('BLOCKED', 'recipient not named in the question:', unnamed.join(', '), '·', summary);
    return { decision: 'deny', reason: `The user did not confirm sending to ${unnamed.join(', ')}: it was not in your question. Ask again naming exactly who.` };
  }

  // One "yes" covers up to 6 actions of the SAME tool in this turn (e.g. two messages to the same person), never a
  // different kind of action.
  const turn = `turn:${t.turn}`;
  const use = `${turn}|${callId}|${tool}`;
  let used = []; try { used = fs.readFileSync(USED, 'utf8').split('\n').filter(Boolean).slice(-500); } catch {}
  if (callId && used.includes(use)) return { decision: 'allow', reason: 'Confirmed by the user.' };
  const previous = used.filter(u => u.split('|')[0] === turn);
  if (previous.length >= 6 || previous.some(u => u.split('|')[2] !== tool)) {
    log('BLOCKED', 'second kind of action with the same yes:', summary);
    return { decision: 'deny', reason: 'Their "yes" was for a different action. For this one, ask again saying exactly what you will do.' };
  }
  fs.writeFileSync(USED, [...used, use].join('\n') + '\n', { mode: 0o600 });
  log('ALLOWED', summary);

  // Tell the user on their phone what was done (best effort).
  let token = '';
  try { token = fs.readFileSync(path.join(STATE, 'internal-token'), 'utf8').trim(); } catch {}
  await fetch(`http://127.0.0.1:${cfg.port || 7811}/internal/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: `🔐 Ask Q did this after your "yes": ${summary}` }), signal: AbortSignal.timeout(3000) }).catch(() => {});
  return { decision: 'allow', reason: 'Confirmed by the user.' };
}
