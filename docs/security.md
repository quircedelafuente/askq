# Security

Ask Q can act on your accounts, so it's built to be private and careful by default. This page explains what protects
you and, honestly, what doesn't.

## What protects you

**Nothing is exposed to the internet.** The service listens only on `127.0.0.1`. The only way in from outside is
`tailscale serve`, which is reachable only from devices in your own Tailscale network (your phone, your laptop).
There's no open port to scan.

**A token on top.** Even inside your tailnet, every Siri request needs a 256-bit bearer token, compared in constant
time. Five wrong attempts from one address block it for an hour and you get a message.

**Actions with effects need your "yes".** Before paying, booking, buying, sending something to another person or
deleting, Ask Q asks. A guard (a Claude Code hook) blocks those tool calls until you say "yes" in your next message.
The "yes" is detected by Ask Q from what *you* said — not by the model — so instructions hidden in an email or a web
page can't approve anything. One "yes" covers one kind of action, and only the recipients named in the question.

**Your data stays on your machine.** Messages, tools, secrets and logs live in `~/.askq` (mode 700). What you ask is
processed by Claude (Anthropic) like any Claude Code session.

**Website logins without passwords in the chat.** When a tool needs you to sign in (SSO, 2-step codes), Ask Q opens
the site in a browser on your machine and sends you a one-time link, valid 15 minutes. You type on the real page; the
password goes to the website, not to the chat or the AI. Only the resulting session is saved, in that tool's folder
(mode 600). Passwords and API keys a tool keeps work the same way: a one-time form whose answer goes straight to
`~/.askq/secrets/<tool>.json`.

**Those links without Tailscale.** With Tailscale they only open from your devices. Without it, Ask Q opens a temporary
Cloudflare quick tunnel (`https://<random>.trycloudflare.com`, no account) to a separate local server that serves only
those one-time pages — never `/ask` or the internal API — and closes it 15 minutes after the last link. Anyone with the
link could open it while it's valid (it's a long random address, sent only to your chat), and the traffic passes
through Cloudflare's servers, encrypted between your phone and Cloudflare. Tailscale avoids both.

**No third-party tool store.** Tools are created by you (or by Ask Q for you) on your machine. You can install a tool
someone shares with `askq tool add <link>`: it runs with your user's permissions, so only install tools from people you
trust, and its functions are still subject to the "yes" rule according to how they're marked.

## Limits you should know

- **Other engines (Codex, Cursor, Antigravity)** apply the "yes" rule to tools through a proxy, but do not check shell
  commands. Claude Code checks both. See [engines](engines.md).

- **The assistant has a shell.** To build and test tools, Claude Code can run commands as your user. The guard stops
  known ways of sending data out (uploads with curl, scp, ssh…) and Claude Code permission rules protect Ask Q's own
  config and secrets, but a determined prompt injection could still find other paths. Run Ask Q on a machine or
  server dedicated to it, not on a computer full of sensitive files.
- **The guard runs as your user.** A process running as you could, in theory, edit it. On a dedicated server this is
  rarely a concern; for more isolation run Ask Q under its own user account.
- **WhatsApp uses an unofficial library** (Baileys). See [channels](channels.md).
- **Reading isn't guarded.** The guard stops actions, not reads. If you connect your email, Ask Q can read it.

## Good practice

- Use a dedicated machine (a free cloud VM is ideal).
- Turn on Tailscale's [Tailnet Lock](https://tailscale.com/kb/1226/tailnet-lock) and 2FA on your Tailscale, Anthropic and email accounts.
- Rotate the token if you think it leaked: `askq token --rotate`.
- Review what happened: `askq logs` (every guarded action is logged and messaged to you).

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) instead of a public issue.
