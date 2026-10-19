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

server.registerTool('tell_user_now', {
  description: "For tasks that take a while: tell the user right now, in one short sentence, what you are going to do and where the result will arrive (\"Okay, I'll book it and send the ticket to your WhatsApp\"). They hear/see it immediately while you keep working; your final answer is delivered when you finish. Use at most once per request, never for questions.",
  inputSchema: { text: z.string().min(1).describe('One short sentence in the user\'s language') },
  annotations: { readOnlyHint: true },
}, async ({ text: t }) => {
  try {
    const r = await call('early', { text: t });
    return text(r.delivered
      ? 'Delivered: the user already got your message. Keep working; your final answer will be sent to them when you finish, so write it as a short message with the key details. If you send the result yourself with send_to_phone, that is all they will get: the final answer is not sent again.'
      : 'Not needed now (the user already got an answer). Just finish the task normally.');
  } catch (e) { return fail(e); }
});

server.registerTool('open_login_page', {
  description: "When a tool needs the user to sign in to a website (its error says there is no session / the session expired / log in, or the user asks to log in), call this with the tool's name. Ask Q opens that website in a browser on this machine and sends the user a private link: they sign in on the real page from their phone, so passwords and 2-step codes never go through the chat. Ask Q tells them when the session is saved; then the tool works. Never ask the user for their password instead.",
  inputSchema: { tool: z.string().describe('Tool name, as in askq tool list (e.g. blackboard-mcp)') },
  annotations: { readOnlyHint: true },
}, async ({ tool }) => {
  try {
    const r = await call('login', { tool });
    return text(r.sent
      ? `Done: the sign-in link is already in the user's chat (expires in ${r.expiresInMinutes} min). Tell them briefly to open it and sign in; they'll get a message when it's saved. Don't repeat the link.`
      : `Give the user this sign-in link (expires in ${r.expiresInMinutes} min): ${r.link}`);
  } catch (e) { return fail(e); }
});

server.registerTool('ask_for_secret', {
  description: "When a tool needs a password, API key or other secret that the user must give (read in the tool with secret('KEY')), call this instead of asking in the chat. The user gets a private one-time link to a form; what they type is saved straight into that tool's secrets and never reaches you or the chat. They get a message when it's saved; then test the tool. For websites with a normal sign-in page (SSO, 2-step codes), prefer open_login_page.",
  inputSchema: {
    tool: z.string().describe('Tool name (e.g. gym-booking)'),
    keys: z.array(z.string()).min(1).max(8).describe('Secret names in CAPITALS, as the tool reads them (e.g. ["USERNAME", "PASSWORD"])'),
    note: z.string().optional().describe('Short help shown on the form, e.g. where to find the API key'),
  },
  annotations: { readOnlyHint: true },
}, async a => {
  try {
    const r = await call('secret', a);
    return text(r.sent
      ? `Done: the private link is in the user's chat (expires in ${r.expiresInMinutes} min). Tell them briefly to open it and type it there, not in the chat. Don't repeat the link.`
      : `Give the user this private link to type it (expires in ${r.expiresInMinutes} min): ${r.link}`);
  } catch (e) { return fail(e); }
});

// Read-only as far as the "yes" rule goes: it only touches Ask Q itself, and only when the user asks for it.
server.registerTool('update_ask_q', {
  description: 'Check for a new version of Ask Q, or install it, when the user asks ("update yourself", "are there updates?"). With install: true it downloads and installs the update; Ask Q restarts by itself right after this answer, so tell the user it will be back in a few seconds. Ask Q also checks every 12 hours on its own.',
  inputSchema: { install: z.boolean().describe('false = only check; true = install if there is one') },
  annotations: { readOnlyHint: true },
}, async ({ install }) => {
  try {
    const r = await call('update', { install });
    if (!r.ok) return text(`Could not ${install ? 'update' : 'check'}: ${r.why}`);
    if (!r.behind) return text(`Ask Q is up to date (${r.current}).`);
    return text(install && r.updated
      ? `Updated ${r.current} → ${r.now}. What's new:\n${r.summary}\nAsk Q restarts in a few seconds, after this answer.`
      : `An update is available (${r.behind} changes):\n${r.summary}`);
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
