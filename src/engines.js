// The AI that does the work. Claude Code is the reference engine; Codex, Cursor and Antigravity are supported too.
// Each engine says how to run one turn without a screen, how to read its answer, and how to give it the tools.
//
// The "yes" rule: Claude Code applies it through a PreToolUse hook (src/guard.mjs) to tools AND shell commands.
// The other engines reach every tool through src/mcp-proxy.mjs, which applies the same rule to tool calls; their
// shell commands are not checked (see docs/engines.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { P, APP, claudeEnv, loadEnv, readJSON, writePrivate } from './config.js';

const which = c => { try { return execFileSync('which', [c], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const local = name => [path.join(os.homedir(), '.local', 'bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].find(f => fs.existsSync(f)) || null;
const PROXY = path.join(APP, 'src', 'mcp-proxy.mjs');

// Every tool server, wrapped in the proxy that applies the "yes" rule. The proxy finds the current turn in
// $ASKQ_HOME/state/turn.json, because Codex and Cursor pass MCP servers only a minimal environment.
function proxied() {
  const servers = readJSON(P.mcp, { mcpServers: {} }).mcpServers || {};
  return Object.fromEntries(Object.entries(servers).map(([name, s]) => [name, {
    command: process.execPath,
    args: [PROXY, name, s.command, ...(s.args || [])],
    env: { ...(s.env || {}), ASKQ_HOME: path.dirname(P.config), PATH: process.env.PATH || '' },
  }]));
}
// TOML values for Codex's -c overrides (JSON strings are valid TOML basic strings).
const toml = v => Array.isArray(v) ? `[${v.map(toml).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)} = ${toml(x)}`).join(', ')}}`
  : JSON.stringify(String(v));

export const ENGINES = {
  claude: {
    label: 'Claude Code',
    account: 'Claude subscription (Pro/Max) or Anthropic API key',
    bin: () => process.env.ASKQ_CLAUDE || which('claude') || local('claude'),
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    env: () => claudeEnv(),
    args({ text, system, resume, allowed }) {
      const a = ['-p', text, '--output-format', 'json', '--append-system-prompt', system, '--setting-sources', 'project,local',
        '--strict-mcp-config', '--mcp-config', P.mcp, '--allowedTools', ...allowed];
      if (resume) a.push('--resume', resume);
      return a;
    },
    parse(out) {
      const j = JSON.parse(out);
      return { text: String(j.result || '').trim(), session: j.session_id, error: j.is_error ? (j.result || j.subtype) : null, denied: j.permission_denials };
    },
  },

  codex: {
    label: 'OpenAI Codex',
    account: 'ChatGPT subscription (Plus/Pro/Business) or OpenAI API key',
    bin: () => process.env.ASKQ_CODEX || which('codex') || local('codex'),
    install: 'npm install -g @openai/codex',
    login: ['login', '--device-auth'],
    env: () => ({}),
    args({ text, system, resume }) {
      // Approval/sandbox flags go before `exec`: `exec resume` does not accept them.
      const a = ['-a', 'never', '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true',
        'exec', ...(resume ? ['resume'] : []), '--json', '--skip-git-repo-check', '--ignore-user-config',
        '-c', `developer_instructions=${toml(system)}`];
      for (const [name, s] of Object.entries(proxied())) {
        for (const [k, v] of Object.entries({ command: s.command, args: s.args, env: s.env })) a.push('-c', `mcp_servers.${name}.${k}=${toml(v)}`);
        // Without this, `codex exec` cancels MCP calls that "require approval" (openai/codex#24135). The proxy decides.
        a.push('-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`, '-c', `mcp_servers.${name}.startup_timeout_sec=30`);
      }
      if (resume) a.push(resume);
      a.push(text);
      return a;
    },
    parse(out) {
      let session, text = '', error = null;
      for (const line of out.split('\n')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'thread.started') session = e.thread_id;
        else if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = String(e.item.text || '').trim();
        else if (e.type === 'error' || e.type === 'turn.failed') error = e.message || e.error?.message || 'failed';
      }
      if (!session && !text) throw new Error('no JSON events');
      return { text, session, error: text ? null : error };
    },
  },

  cursor: {
    label: 'Cursor',
    account: 'Cursor subscription or Cursor API key',
    bin: () => process.env.ASKQ_CURSOR || which('cursor-agent') || local('cursor-agent') || local('agent'),
    install: 'curl https://cursor.com/install -fsS | bash',
    login: ['login'],
    env: () => ({ NO_OPEN_BROWSER: '1', ...(loadEnv().CURSOR_API_KEY ? { CURSOR_API_KEY: loadEnv().CURSOR_API_KEY } : {}) }),
    // Cursor has no system-prompt flag: the instructions go before the message.
    args({ text, system, resume }) {
      const a = ['-p', '--output-format', 'json', '--trust', '--approve-mcps', '--force', '--workspace', P.workspace];
      if (resume) a.push('--resume', resume);
      a.push(`<instructions>\n${system}\n</instructions>\n\n${text}`);
      return a;
    },
    parse(out) {
      const j = JSON.parse(out.trim().split('\n').pop());
      return { text: String(j.result || '').trim(), session: j.session_id, error: j.is_error ? (j.result || j.subtype) : null };
    },
    // Cursor only reads MCP servers from <project>/.cursor/mcp.json (or the global one).
    prepare() { writePrivate(path.join(P.workspace, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: proxied() }, null, 2) + '\n'); },
  },

  antigravity: {
    label: 'Google Antigravity',
    account: 'Google account (Antigravity plan) or Gemini API key',
    bin: () => process.env.ASKQ_AGY || which('agy') || local('agy'),
    install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    login: [],   // the first run signs in (it prints a Google link)
    env: () => ({}),
    // Headless runs soft-deny tools that would need approval; the proxy is what applies the "yes" rule.
    args({ text, system, resume }) {
      const a = ['--output-format', 'json', '--print-timeout', '15m', '--dangerously-skip-permissions'];
      if (resume) a.push('--conversation', resume);
      a.push('-p', `<instructions>\n${system}\n</instructions>\n\n${text}`);   // -p takes the prompt as its value
      return a;
    },
    parse(out) {
      const j = JSON.parse(out.trim().split('\n').pop());
      return { text: String(j.response || '').trim(), session: j.conversation_id || null, error: j.status && j.status !== 'SUCCESS' ? (j.error || j.status) : null };
    },
    // agy has no per-run MCP file: Ask Q's servers are merged into its global mcp_config.json under an "askq-" prefix
    // (other servers there are left alone).
    prepare() {
      const f = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
      const cur = readJSON(f, { mcpServers: {} });
      const others = Object.fromEntries(Object.entries(cur.mcpServers || {}).filter(([k]) => !k.startsWith('askq-')));
      const ours = Object.fromEntries(Object.entries(proxied()).map(([k, v]) => [k.startsWith('askq-') ? k : `askq-${k}`, v]));
      writePrivate(f, JSON.stringify({ ...cur, mcpServers: { ...others, ...ours } }, null, 2) + '\n');
    },
  },
};

export const engineName = cfg => (ENGINES[cfg.engine] ? cfg.engine : 'claude');

// Codex, Cursor and Antigravity read AGENTS.md (Cursor also reads CLAUDE.md). Keep it in step with CLAUDE.md.
export function prepareWorkspace(cfg) {
  const name = engineName(cfg);
  if (name !== 'claude') {
    const src = path.join(P.workspace, 'CLAUDE.md'), dst = path.join(P.workspace, 'AGENTS.md');
    try { fs.writeFileSync(dst, fs.readFileSync(src, 'utf8')); } catch {}
  }
  ENGINES[name].prepare?.();
}
