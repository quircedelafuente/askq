# Troubleshooting & FAQ

Start with `askq doctor` — it checks every piece and tells you the command that fixes it. `askq logs` shows what happened.

## Siri

| Symptom | Fix |
|---|---|
| "Something went wrong" right away | Is Tailscale connected on the iPhone? Is the URL right? |
| Nothing happens, and `askq logs` shows no `SIRI` line | The question never reached the machine. If you edited your Tailscale **access controls** (https://login.tailscale.com/admin/acls), allow your phone to reach this machine on port 443. Test from another device on your tailnet: `curl https://<machine>.<tailnet>.ts.net/health` should print `ok`. |
| 401 / "unauthorized" | The `Authorization` header must be your token (just the token). Re-copy it with `askq siri`. |
| Siri stops before the answer | Tasks over ~30 s: say "okay" to hear the result. |
| The same phrase repeats | Move **Dictate Text** inside the **Repeat**. |
| Spanish (or other) read with an English accent | Choose a voice in your language in **Speak Text**. |

## WhatsApp

- **Not linked / logged out**: `askq link whatsapp`. If you remove the linked device on your phone, Ask Q stops until you link again.
- **Group not found**: create a group with the exact name from `askq setup` (default "Ask Q") and `askq restart`.
- **No answer in "own number" mode**: check your number is in the owners list (with country code) in `askq setup`.

## Telegram

- **Pairing doesn't finish**: send exactly `/start 123456` (the code shown) to *your* bot.
- **Bot token changed**: `askq link telegram --new-token`.

## Claude

- **"Claude Code is not signed in"**: run `askq setup` again (step 1), or `claude setup-token` and paste the token.
- **Usage limits**: with a subscription, Ask Q shares your plan's limits with your other Claude usage.

## Codex, Cursor, Antigravity

- **"<engine> is not signed in"**: run `askq ai` and pick it again; it reopens the sign-in.
- **Codex: "No eligible workspace supports Codex CLI"**: your ChatGPT workspace has Codex CLI turned off. Pick your
  personal workspace when signing in, use an OpenAI API key, or switch engine with `askq ai` ([more](engines.md)).

## Background service

- **Linux/WSL**: `systemctl --user status askq` and `journalctl --user -u askq`.
- **macOS**: `launchctl print gui/$(id -u)/dev.askq.agent`; logs in `~/.askq/state/logs/`.
- **Run it in the foreground to see errors**: `askq stop && ASKQ_DEBUG=1 askq run`.

## FAQ

**Is it free?** Ask Q is free and open source (MIT). You pay for Claude (your subscription or API usage). The server can be free.

**Does it work without Siri?** Yes: WhatsApp, Telegram, or `askq ask` in the terminal.

**Can it use my Claude.ai connectors (Gmail, Drive…)?** Ask Q uses the tools in `~/.askq/mcp.json`. Add any MCP server there (local or remote) and run `askq tools sync`.

**Can several people use one Ask Q?** It's designed as a personal assistant: one person, one installation.

**Where's my data?** In `~/.askq` on your machine. Requests are processed by Anthropic's API like any Claude Code session.
