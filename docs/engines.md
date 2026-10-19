# Choosing the AI (engine)

Ask Q runs a coding agent on your machine and gives it your tools. You choose which one in `askq setup` (step 1),
and you can switch any time with `askq ai` (just that question, no full setup).

| Engine | Pay with | Status |
|---|---|---|
| **Claude Code** (default) | Claude Pro/Max subscription, or Anthropic API key | Reference engine, fully tested |
| **OpenAI Codex** | ChatGPT subscription, or OpenAI API key | Beta |
| **Cursor** | Cursor subscription, or Cursor API key | Beta |
| **Google Antigravity** | Google account (Antigravity plan), or Gemini API key | Beta |

Everything else works the same with any engine: Siri, WhatsApp/Telegram, voice notes, photos, reminders, early
answers, and creating tools by asking. Tools are standard MCP servers, so every engine can use them.

## What changes between engines

**The "yes" rule.** With every engine, tools that pay, book or send (anything that doesn't declare itself read-only)
only run right after you said "yes".

- **Claude Code** checks both tools *and* shell commands (for example, a command that uploads data with `curl`).
- **Codex, Cursor and Antigravity** reach your tools through a small proxy (`src/mcp-proxy.mjs`) that applies the same
  rule to every tool call. Their **shell commands are not checked**: the assistant could, in theory, send data out with
  a shell command without asking. If that matters to you, use Claude Code.

**Instructions.** Your `~/.askq/workspace/CLAUDE.md` is copied to `AGENTS.md`, which Codex, Cursor and Antigravity read.
Edit `CLAUDE.md`; the copy is refreshed on every message.

**Where the tools are configured.**
- Claude Code and Codex get them on every run; nothing is written outside `~/.askq`.
- Cursor reads them from `~/.askq/workspace/.cursor/mcp.json` (written by Ask Q).
- Antigravity only reads a global file, so Ask Q adds its tools to `~/.gemini/config/mcp_config.json` with names starting
  with `askq-`. Your other servers in that file are left alone.

## Signing in

`askq setup` and `askq ai` install the engine if it's missing and opens its sign-in:

| Engine | Install | Sign in |
|---|---|---|
| Codex | `npm install -g @openai/codex` | `codex login --device-auth` (ChatGPT) or an API key |
| Cursor | `curl https://cursor.com/install -fsS \| bash` | `cursor-agent login`, or a `CURSOR_API_KEY` (stored in `~/.askq/.env`) |
| Antigravity | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | the first run prints a Google link; to use a Gemini API key instead, set `"modelProvider": "gemini"` in `~/.gemini/antigravity-cli/settings.json` and `GEMINI_API_KEY` |

Check it with `askq doctor`: it says "<engine> answers" when it's ready.

Codex sign-in says **"No eligible workspace supports Codex CLI"** (`codex_cli_workspace_disabled`): your ChatGPT
account belongs to a workspace (work or school) whose admin hasn't enabled Codex CLI. Sign in again and pick your
personal workspace, use an OpenAI API key, or choose another engine with `askq ai`.

## Known limits (beta engines)

- Codex: MCP tool calls in `codex exec` can be cancelled as "needs approval" in some versions; Ask Q sets each tool
  server to approve automatically (the proxy decides). If tools keep failing, update Codex.
- Cursor and Antigravity have no system-prompt option, so Ask Q's instructions (voice style, the "yes" rule) are sent
  at the start of each message.
- Antigravity runs with its own permission prompts turned off (there's nobody to answer them); the proxy still applies
  the "yes" rule to tools.
