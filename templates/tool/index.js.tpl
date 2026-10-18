#!/usr/bin/env node
// __NAME__ — __DESCRIPTION__
// An Ask Q tool (an MCP server). Rules every tool follows:
//  · Each function declares `readOnlyHint`. true = only reads (no confirmation needed). false = has real effects
//    (books, pays, sends, deletes): Ask Q's guard only lets it run right after the user says "yes".
//  · Secrets (passwords, API keys, cookies) are never in this file: read them with secret('KEY'). The user sets them
//    with `askq secret set __NAME__ KEY`.
//  · Return short, plain results the assistant can read aloud; put files in ~/.askq/state/media and return the path.
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const secrets = (() => { try { return JSON.parse(fs.readFileSync(process.env.ASKQ_SECRETS, 'utf8')); } catch { return {}; } })();
function secret(key) {
  if (!secrets[key]) throw new Error(`Missing secret ${key}. The user must run: askq secret set __NAME__ ${key}`);
  return secrets[key];
}
const ok = data => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: e.message || String(e) }] });

const server = new McpServer({ name: '__NAME__', version: '0.1.0' });

// Example read-only function. Replace it with the real ones.
server.registerTool('ping', {
  description: 'Check that the __NAME__ tool is installed and working.',
  inputSchema: { message: z.string().optional().describe('Anything; it is echoed back') },
  annotations: { readOnlyHint: true },
}, async ({ message }) => {
  try { return ok({ ok: true, echo: message ?? null }); } catch (e) { return fail(e); }
});

// Example of a function with real effects (uncomment and adapt):
// server.registerTool('book', {
//   description: 'Book a slot. Has real effects: the user must confirm first.',
//   inputSchema: { date: z.string().describe('YYYY-MM-DD'), time: z.string().describe('HH:MM') },
//   annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
// }, async ({ date, time }) => {
//   try { /* call the API or drive the website here */ return ok(`Booked ${date} ${time}`); } catch (e) { return fail(e); }
// });

void secret;
await server.connect(new StdioServerTransport());
