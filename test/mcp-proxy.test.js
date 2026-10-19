// The proxy that applies the "yes" rule for engines without tool hooks (Codex, Cursor, Antigravity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askq-proxy-'));
fs.mkdirSync(path.join(home, 'state'), { recursive: true });
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: 1 }));
fs.writeFileSync(path.join(home, 'state', 'effect-tools.json'), JSON.stringify({ readOnly: ['mcp__shop__list'], effect: ['mcp__shop__buy'] }));
// A fake MCP server that answers every call with "done <tool>".
const fake = path.join(home, 'fake.mjs');
fs.writeFileSync(fake, `import readline from 'node:readline';
readline.createInterface({ input: process.stdin }).on('line', l => { const m = JSON.parse(l);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'done ' + (m.params?.name || m.method) }] } }) + '\\n'); });`);

function call(name, turn) {
  if (turn) fs.writeFileSync(path.join(home, 'state', 'turn.json'), JSON.stringify({ until: Date.now() + 60000, ...turn }));
  else fs.rmSync(path.join(home, 'state', 'turn.json'), { force: true });
  return new Promise(resolve => {
    const env = { ...process.env, ASKQ_HOME: home }; delete env.ASKQ; delete env.ASKQ_TURN;
    const p = spawn(process.execPath, [path.join(SRC, 'mcp-proxy.mjs'), 'shop', process.execPath, fake], { env });
    let out = '';
    p.stdout.on('data', d => { out += d; if (out.includes('\n')) { p.stdin.end(); } });
    p.on('close', () => resolve(JSON.parse(out.split('\n')[0]).result.content[0].text));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }) + '\n');
  });
}

test('read-only tools go through', async () => {
  assert.equal(await call('list', { turn: 'p1', yes: false }), 'done list');
});

test('tools with effects are blocked without a yes, also outside a turn', async () => {
  assert.match(await call('buy', { turn: 'p2', yes: false }), /^Not done/);
  assert.match(await call('buy', null), /^Not done/);
});

test('tools with effects go through after a yes', async () => {
  assert.equal(await call('buy', { turn: 'p3', yes: true, question: 'Buy it?' }), 'done buy');
});
