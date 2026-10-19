#!/usr/bin/env node
// Sits between an engine without tool hooks (Codex, Cursor, Antigravity) and one MCP server, and applies the "yes"
// rule (src/guard-core.mjs) to every tool call before forwarding it. Blocked calls get an error result explaining
// why, so the assistant asks the user instead.
//   mcp-proxy.mjs <server-name> <command> [args…]
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { check } from './guard-core.mjs';

const [server, cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
const send = line => process.stdout.write(line.endsWith('\n') ? line : line + '\n');

// Whole lines only, so a reply we write never lands in the middle of one from the server.
readline.createInterface({ input: child.stdout }).on('line', send);

let queue = Promise.resolve();   // keep requests in order
readline.createInterface({ input: process.stdin }).on('line', line => {
  queue = queue.then(async () => {
    let m; try { m = JSON.parse(line); } catch { return child.stdin.write(line + '\n'); }
    if (m.method === 'tools/call' && m.id !== undefined) {
      const r = await check({ tool: `mcp__${server}__${m.params?.name}`, args: m.params?.arguments || {}, callId: `${server}:${m.id}`, interactive: 'deny' });
      if (r.decision === 'deny') return send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `Not done: ${r.reason}` }], isError: true } }));
    }
    child.stdin.write(line + '\n');
  });
}).on('close', () => queue.then(() => child.stdin.end()));

child.on('exit', code => process.exit(code ?? 0));
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => child.kill(s));
