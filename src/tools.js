// Tools = MCP servers in ~/.askq/mcp.json. Ask Q ships one (askq-phone: send things to your phone, reminders) and
// every tool you create lives in ~/.askq/tools/<name>, made from templates/tool.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { P, APP, readJSON, writePrivate, loadConfig } from './config.js';

export const NAME = /^[a-z][a-z0-9-]{1,39}$/;

export function readMcp() { return readJSON(P.mcp, { mcpServers: {} }); }
export function writeMcp(m) { writePrivate(P.mcp, JSON.stringify(m, null, 2) + '\n'); }

// The built-in tool. Always present; setup and sync re-add it if it was removed.
export function ensureBuiltins() {
  const m = readMcp();
  m.mcpServers ||= {};
  m.mcpServers['askq-phone'] = { command: process.execPath, args: [path.join(APP, 'src', 'phone-mcp.js')], env: { ASKQ_HOME: path.dirname(P.config) } };
  writeMcp(m);
}

export function register(name, dir, entry = 'index.js') {
  const m = readMcp();
  m.mcpServers[name] = { command: process.execPath, args: [path.join(dir, entry)],
    env: { ASKQ_HOME: path.dirname(P.config), ASKQ_SECRETS: path.join(P.secrets, `${name}.json`) } };
  writeMcp(m);
}

export function unregister(name) {
  const m = readMcp();
  delete m.mcpServers[name];
  writeMcp(m);
}

// Copy templates/tool into ~/.askq/tools/<name> and replace the placeholders.
export function scaffold(name, description = '') {
  if (!NAME.test(name)) throw new Error('Tool names use lowercase letters, numbers and dashes (e.g. "gym-booking").');
  if (name === 'askq-phone') throw new Error('That name is reserved.');
  const dir = path.join(P.tools, name);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists.`);
  const src = path.join(APP, 'templates', 'tool');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of fs.readdirSync(src)) {
    const text = fs.readFileSync(path.join(src, f), 'utf8').replaceAll('__NAME__', name).replaceAll('__DESCRIPTION__', description || `Ask Q tool: ${name}`);
    fs.writeFileSync(path.join(dir, f.replace(/\.tpl$/, '')), text);
  }
  // Share Ask Q's MCP SDK and zod instead of installing them again for every tool.
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  register(name, dir);
  return dir;
}

// Install a tool someone shared: a git repository (GitHub link) or a local folder with an MCP server in Node.
// It is copied to ~/.askq/tools/<name>, its packages installed, and its entry point (package.json bin/main, or
// index.js) registered. Returns { name, dir, login } (login: the tool declares a sign-in page, see web-login.js).
export function add(source, name) {
  const isGit = /^(https?:\/\/|git@)/.test(source);
  name ||= path.basename(source.replace(/\/+$/, '')).replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!NAME.test(name) || name === 'askq-phone') throw new Error(`"${name}" is not a valid tool name. Give one: askq tool add <source> <name>`);
  const dir = path.join(P.tools, name);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists. Remove it first: askq tool remove ${name}`);
  fs.mkdirSync(P.tools, { recursive: true, mode: 0o700 });
  if (isGit) {
    const r = spawnSync('git', ['clone', '--depth', '1', '--quiet', source, dir], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (r.status !== 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(/could not read Username|Authentication failed|not found|terminal prompts disabled/i.test(r.stderr)
        ? 'Could not download it: the repository is private or does not exist. If it is private, its owner must invite your GitHub account, and this machine must be signed in to GitHub once (in a terminal: gh auth login, then gh auth setup-git).'
        : `git clone failed: ${r.stderr.trim().slice(-300)}`);
    }
  } else {
    if (!fs.existsSync(path.join(source, 'package.json')) && !fs.existsSync(path.join(source, 'index.js'))) throw new Error(`${source} does not look like a Node tool (no package.json or index.js).`);
    fs.cpSync(source, dir, { recursive: true, filter: f => !/[\/](node_modules|\.git|\.auth|\.cache)$/.test(f) });
  }
  const pkg = readJSON(path.join(dir, 'package.json'), {});
  const entry = (typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && Object.values(pkg.bin)[0]) || pkg.main || 'index.js';
  if (!fs.existsSync(path.join(dir, entry))) throw new Error(`Could not find the tool's entry point (${entry}).`);
  if (fs.existsSync(path.join(dir, 'package.json'))) {
    const r = spawnSync('npm', ['install', '--omit=dev', '--no-fund', '--no-audit', '--quiet'], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm install failed: ${(r.stderr || '').trim().slice(-300)}`);
  }
  const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
  if (deps.playwright || deps['playwright-core']) {
    const cli = path.join(dir, 'node_modules', 'playwright', 'cli.js');
    if (fs.existsSync(cli)) spawnSync(process.execPath, [cli, 'install', 'chromium'], { cwd: dir, stdio: 'ignore', timeout: 10 * 60_000 });
  }
  // The sign-in page (askq login) uses Ask Q's own browser: download it now rather than on the first login.
  if (pkg.askq?.login?.url) spawnSync(process.execPath, [path.join(APP, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], { stdio: 'ignore', timeout: 10 * 60_000 });
  register(name, dir, entry);
  return { name, dir, login: !!pkg.askq?.login?.url };
}

async function connect(name, server) {
  const client = new Client({ name: 'askq', version: '1' });
  const transport = new StdioClientTransport({ command: server.command, args: server.args || [], env: { ...process.env, ...(server.env || {}) }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', d => { stderr += d; });
  try {
    await Promise.race([client.connect(transport), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 20 s')), 20_000))]);
  } catch (e) { await transport.close().catch(() => {}); throw new Error(`${e.message}${stderr ? `\n${stderr.slice(-800)}` : ''}`); }
  return client;
}

// Start every tool, read its list and annotations, and write state/effect-tools.json for the guard.
export async function sync({ quiet = false } = {}) {
  ensureBuiltins();
  const servers = readMcp().mcpServers;
  const readOnly = [], effect = [], report = [];
  for (const [name, server] of Object.entries(servers)) {
    try {
      const client = await connect(name, server);
      const { tools } = await client.listTools();
      await client.close();
      for (const t of tools) {
        const full = `mcp__${name}__${t.name}`;
        (t.annotations?.readOnlyHint === true ? readOnly : effect).push(full);
      }
      report.push({ name, ok: true, tools: tools.map(t => ({ name: t.name, readOnly: t.annotations?.readOnlyHint === true })) });
    } catch (e) { report.push({ name, ok: false, error: e.message }); }
  }
  writePrivate(P.effectTools, JSON.stringify({ readOnly, effect, synced: new Date().toISOString() }, null, 2));
  const exempt = loadConfig().guard?.exempt || [];
  if (!quiet) for (const r of report) {
    if (!r.ok) { console.log(`✗ ${r.name}: ${r.error}`); continue; }
    console.log(`✓ ${r.name}`);
    for (const t of r.tools) console.log(`    ${t.readOnly ? 'read-only   ' : exempt.includes(`mcp__${r.name}__${t.name}`) ? 'only you    ' : 'needs "yes" '} ${t.name}`);
  }
  return report;
}

// Start one tool and optionally call one of its functions (for testing while building it).
export async function test(name, fn, argsJson) {
  const server = readMcp().mcpServers[name];
  if (!server) throw new Error(`No tool called "${name}". See: askq tool list`);
  const client = await connect(name, server);
  try {
    const { tools } = await client.listTools();
    if (!fn) return tools.map(t => ({ name: t.name, readOnly: t.annotations?.readOnlyHint === true, description: t.description }));
    return await client.callTool({ name: fn, arguments: argsJson ? JSON.parse(argsJson) : {} });
  } finally { await client.close(); }
}

export function list() {
  const effects = readJSON(P.effectTools, { readOnly: [], effect: [] });
  return Object.entries(readMcp().mcpServers).map(([name, s]) => ({
    name, path: s.args?.[0] || s.command,
    readOnly: effects.readOnly.filter(t => t.startsWith(`mcp__${name}__`)).length,
    needsYes: effects.effect.filter(t => t.startsWith(`mcp__${name}__`)).length,
  }));
}

export function remove(name) {
  if (name === 'askq-phone') throw new Error('askq-phone is built in.');
  unregister(name);
  const dir = path.join(P.tools, name);
  if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.removed-${Date.now()}`);
}

// Secrets: one JSON file per tool in ~/.askq/secrets (mode 600). Tools read them through ASKQ_SECRETS.
export function setSecret(tool, key, value) {
  const f = path.join(P.secrets, `${tool}.json`);
  const s = readJSON(f, {});
  if (value === '') delete s[key]; else s[key] = value;
  writePrivate(f, JSON.stringify(s, null, 2));
}
export const secretKeys = tool => Object.keys(readJSON(path.join(P.secrets, `${tool}.json`), {}));
