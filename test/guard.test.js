// Guard behaviour: which tool calls pass, which are blocked until the user says "yes".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'guard.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askq-guard-'));
fs.mkdirSync(path.join(home, 'state'), { recursive: true });
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: 1, guard: { exempt: ['mcp__askq-phone__send_to_phone'], require: [] } }));
fs.writeFileSync(path.join(home, 'state', 'effect-tools.json'), JSON.stringify({ readOnly: ['mcp__weather__forecast'], effect: ['mcp__shop__buy'] }));

function guard(input, env = {}) {
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ASKQ_HOME: home, ASKQ: '1', ASKQ_YES: '0', ASKQ_TURN: 't0', ...env } });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'pass';
}
const yes = (turn, question) => ({ ASKQ_YES: '1', ASKQ_TURN: turn, ASKQ_QUESTION: question });

test('read-only and exempt tools pass', () => {
  assert.equal(guard({ tool_name: 'mcp__weather__forecast', tool_input: {} }), 'pass');
  assert.equal(guard({ tool_name: 'mcp__askq-phone__send_to_phone', tool_input: { text: 'x' } }), 'pass');
});

test('tools with effects, or unknown tools, need a yes', () => {
  assert.equal(guard({ tool_name: 'mcp__shop__buy', tool_input: {} }), 'deny');
  assert.equal(guard({ tool_name: 'mcp__new__thing', tool_input: {} }), 'deny');
  assert.equal(guard({ tool_name: 'mcp__shop__buy', tool_input: {}, tool_use_id: 'u1' }, yes('t1', 'Buy it?')), 'allow');
});

test('one yes covers one kind of action', () => {
  assert.equal(guard({ tool_name: 'mcp__shop__buy', tool_input: {}, tool_use_id: 'a' }, yes('t2', 'Buy it?')), 'allow');
  assert.equal(guard({ tool_name: 'mcp__mail__send', tool_input: {}, tool_use_id: 'b' }, yes('t2', 'Buy it?')), 'deny');
});

test('recipients must have been named in the question', () => {
  assert.equal(guard({ tool_name: 'mcp__mail__send', tool_input: { to: 'someone@else.com' }, tool_use_id: 'c' }, yes('t3', 'Send it to ana@example.com?')), 'deny');
  assert.equal(guard({ tool_name: 'mcp__mail__send', tool_input: { to: 'ana@example.com' }, tool_use_id: 'd' }, yes('t4', 'Send it to ana@example.com?')), 'allow');
});

test('Bash: uploads out of the machine need a yes, local calls do not', () => {
  const upload = ['curl', '-X', 'POST', 'https://example.com/up', '-d', '@file'].join(' ');
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: upload } }), 'deny');
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: 'curl -s http://127.0.0.1:7811/health' } }), 'pass');
  assert.equal(guard({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }), 'pass');
});

test('interactive sessions are left to Claude Code', () => {
  assert.equal(guard({ tool_name: 'mcp__shop__buy', tool_input: {} }, { ASKQ: '' }), 'pass');
});
