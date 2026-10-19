# Ask Q

**Your own AI assistant that gets real things done.** Say *"Hey Siri, Ask Q: get me a bus ticket to Madrid on Thursday at 9"* and the ticket lands in your WhatsApp a minute later.

Ask Q runs [Claude Code](https://claude.com/claude-code) on **your** machine (a free cloud server or your own computer) and gives it tools to act for you: book, buy, check, remind, send. You talk to it from **Siri**, **WhatsApp** or **Telegram**.

And you can teach it anything: *"create a tool for my gym's website"* — it builds the tool, tests it, and from your next message you can ask for it by voice. Even if that website has no API.

```
"Hey Siri, Ask Q…"  ─┐
WhatsApp / Telegram ─┼─►  your machine (private, via Tailscale)  ─►  Claude Code  ─►  your tools  ─►  real actions
"Hey Google, send a  ┘                                                                     │
 WhatsApp to Ask Q…"                                      tickets, files, reminders ◄──────┘  back to your phone
```

## What people use it for

- 🚌 Buy bus or train tickets with their pass and get the PDF on WhatsApp
- 🎾 Book the padel court, the gym class, the study room
- 📅 "What do I have this week?" across calendar, email and university portals
- ⏰ "Remind me to call the bank on Monday at 10"
- 🔧 Anything else: *"create a tool for…"* and it builds it

## Why it's different

- **It's yours.** Everything runs on your machine with your data. No company holds your passwords.
- **No extra bill.** Use your Claude subscription (Pro/Max) or an API key. The server can be [free](docs/install.md#free-server).
- **Build your own tools by asking.** Every tool is a standard [MCP](https://modelcontextprotocol.io) server, so it also works in Claude Desktop, Claude Code and any MCP client.
- **Private by default.** Nothing is exposed to the internet: your phone reaches it through [Tailscale](https://tailscale.com). Actions that pay, book or send ask you first.

## Install

> **New to servers, Tailscale or the terminal?** Follow [Getting started from zero](docs/getting-started.md): every account, click and command, step by step.

**Linux, macOS, or a free cloud server** (one command):

```bash
curl -fsSL https://raw.githubusercontent.com/quircedelafuente/askq/main/install.sh | bash
```

**Windows** (PowerShell as Administrator; it sets up WSL2):

```powershell
irm https://raw.githubusercontent.com/quircedelafuente/askq/main/install.ps1 | iex
```

The installer adds what's missing (Node.js, Claude Code, Tailscale) and walks you through setup. Then:

1. **Siri** → add [the Ask Q shortcut](ICLOUD_LINK) on your iPhone and paste your URL and token ([details](docs/siri-shortcut.md))
2. **WhatsApp or Telegram** → link it during setup, or later with `askq link whatsapp` / `askq link telegram`
3. **Android** → [docs/android.md](docs/android.md)

Check everything with `askq doctor`.

## Create a tool

Just ask, from Siri, the chat or the terminal:

> "Create a tool that checks the opening hours and books classes at my gym, gym-example.com"

Ask Q follows a built-in recipe ([the `new-tool` skill](workspace/.claude/skills/new-tool/SKILL.md)): finds the cleanest way in (official API → the site's own JSON calls → driving the site with a headless browser), writes the tool in `~/.askq/tools/<name>`, marks which functions only read and which have real effects, tests it, and tells you if it needs a password — which you set yourself with `askq secret set <tool> KEY`, never in the chat.

More: [docs/creating-tools.md](docs/creating-tools.md).

## Commands

```
askq setup                    interactive setup (run again to change anything)
askq doctor                   check that everything works
askq ask "question"           talk to it from the terminal
askq link whatsapp|telegram   link a chat channel
askq tool new|list|test|remove
askq secret set <tool> <KEY>  store a password or API key for a tool
askq start|stop|restart|status|logs
```

## Docs

- [Getting started from zero](docs/getting-started.md) — every account and step, for beginners
- [Install](docs/install.md) — free server, your own Mac/PC, Windows
- [Siri shortcut](docs/siri-shortcut.md)
- [WhatsApp and Telegram](docs/channels.md)
- [Android](docs/android.md)
- [Creating tools](docs/creating-tools.md)
- [Security](docs/security.md) — how it's protected and its limits
- [Troubleshooting & FAQ](docs/troubleshooting.md)

## Requirements

- A machine that stays on: a free cloud VM, a Mac, a Linux box, a Raspberry Pi 4/5, or Windows with WSL2
- A Claude subscription (Pro or Max) or an Anthropic API key
- A free Tailscale account, on that machine and on your phone

## License

[MIT](LICENSE) © Quirce de la Fuente. Not affiliated with Anthropic, Apple, Google, Meta or Telegram. Claude is a trademark of Anthropic; Siri is a trademark of Apple.
