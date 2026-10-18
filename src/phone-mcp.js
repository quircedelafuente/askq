#!/usr/bin/env node
// Built-in tool "askq-phone": lets the assistant send messages and files (tickets, PDFs, screenshots) to YOUR phone
// through the channel you chose (WhatsApp or Telegram), and schedule reminders. It talks to the Ask Q service on
// 127.0.0.1 with an internal token. It can only reach you, never other people, so it needs no "yes".
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, internalToken } from './config.js';

async function call(route, body) {
  const r = await fetch(`http://127.0.0.1:${loadConfig().port}/internal/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${internalToken()}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  }).catch(() => { throw new Error('The Ask Q service is not running (askq start).'); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const text = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: e.message }] });

const server = new McpServer({ name: 'askq-phone', version: '1.0.0' });

server.registerTool('send_to_phone', {
  description: "Send a message and/or files (absolute paths: PDFs, images, tickets…) to the user's own phone via their Ask Q channel (WhatsApp or Telegram). Only reaches the user.",
  inputSchema: { text: z.string().optional().describe('Message text'), files: z.array(z.string()).optional().describe('Absolute file paths to attach') },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ text: t, files = [] }) => {
  try {
    for (const f of files) if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
    return text(await call('send', { text: t, files: files.map(f => path.resolve(f)) }));
  } catch (e) { return fail(e); }
});

server.registerTool('remind_me', {
  description: "Schedule a reminder that will be sent to the user's phone. `when` is local time 'YYYY-MM-DD HH:MM' in the user's timezone.",
  inputSchema: { when: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/), text: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async a => { try { return text(await call('reminders', a)); } catch (e) { return fail(e); } });

server.registerTool('list_reminders', {
  description: 'List pending reminders.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => { try { return text(await call('reminders')); } catch (e) { return fail(e); } });

server.registerTool('cancel_reminder', {
  description: 'Cancel a pending reminder by id (from list_reminders).',
  inputSchema: { id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ id }) => { try { return text(await call('reminders/cancel', { id })); } catch (e) { return fail(e); } });

await server.connect(new StdioServerTransport());
