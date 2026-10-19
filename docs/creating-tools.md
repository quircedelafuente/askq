# Creating tools

A tool gives Ask Q a new ability. Technically it's a small [MCP](https://modelcontextprotocol.io) server in
`~/.askq/tools/<name>/index.js`. You don't need to write it: ask for it.

## By asking

From Siri, the chat or `askq ask`:

> "Create a tool to see free slots and book courts at padel-club-example.com"

Ask Q uses the [`new-tool` skill](../workspace/.claude/skills/new-tool/SKILL.md):

1. Picks the cleanest way in: official API → the website's own JSON requests → driving the website with a headless
   browser (Playwright) as a last resort.
2. Creates the tool with `askq tool new`, writes the functions, and marks each one as **read-only** or **with effects**.
3. Tests it with `askq tool test` and registers it with `askq tools sync`.
4. Tells you what you can now ask, and the exact command if it needs a password or API key.

The tool works from your next message.

## Passwords and API keys

Never paste them in the chat. On the Ask Q machine run:

```bash
askq secret set padel-club PASSWORD     # asks for it without showing it
```

They're stored in `~/.askq/secrets/<tool>.json` (only readable by you) and the tool reads them with `secret('PASSWORD')`.

## Read-only vs. effects

Each function declares `readOnlyHint`:

- `true` — only reads (forecast, timetable, balance). Runs without asking.
- `false` — books, pays, buys, sends, cancels or deletes. Ask Q must ask you first, and the guard blocks it until
  you say "yes".

A function that doesn't declare it is treated as having effects. See what each tool declares with `askq tools sync`.

## By hand

```bash
askq tool new my-tool "What it does"     # creates ~/.askq/tools/my-tool from the template
$EDITOR ~/.askq/tools/my-tool/index.js
askq tool deps my-tool playwright        # extra npm packages, if needed
askq tool test my-tool                   # list functions
askq tool test my-tool ping '{}'         # call one
askq tools sync                          # update the guard
```

## Use your tools elsewhere

Every tool is a standard MCP server. Add it to Claude Desktop, Claude Code or any MCP client with the same command
Ask Q uses (see `~/.askq/mcp.json`).

## Be a good citizen

Respect websites' terms of service, don't bypass CAPTCHAs or bot protection, and don't hammer sites with requests.
Automating your own account for your own use is usually fine; reselling access or scraping at scale is not.

## Tools with a website login

If a tool drives a website that needs the user's login (Microsoft/Google SSO, 2-step codes), it declares it in its
`package.json` instead of keeping a password:

```json
"askq": {
  "login": {
    "url": "https://site.com/login",
    "check": "https://site.com/api/me",
    "state": ".auth/state.json",
    "hint": "Choose Yes on \"Stay signed in?\""
  }
}
```

`askq login <tool>`, or asking Ask Q "log me in to <tool>", opens that page in a browser on the Ask Q machine and gives
you a private link (through Tailscale, or a temporary Cloudflare tunnel if you don't use it; it expires in 15 minutes). On your phone you see the real page live and sign in
yourself: taps, typing and scrolling go to that browser. As soon as `check` answers 2xx (or the address matches
`"done"`, a regex), the session — Playwright `storageState`, cookies and local storage — is saved to `state` inside the
tool's folder (mode 600) and you get a message. The tool opens its browser with that file.

## Passwords and API keys

A tool reads them with `secret('KEY')`. To give them, either ask in the chat — Ask Q sends you a one-time link to a
form, and what you type goes straight to `~/.askq/secrets/<tool>.json` without passing through the chat or the AI — or,
at the machine, run `askq secret set <tool> KEY`.

## Sharing a tool

A tool is a folder with an MCP server, so you can put it on GitHub and anyone with Ask Q installs it with:

```bash
askq tool add https://github.com/you/your-tool      # or just send the link in the chat: "install this tool: …"
```

It is cloned into `~/.askq/tools/<name>`, its packages installed, its entry point (`bin`, `main` or `index.js`)
registered, and Chromium installed if it uses Playwright. Never commit the `.auth/` folder: it holds your session.
For a private repository, invite your friend on GitHub; their machine needs to be signed in to GitHub once
(`gh auth login`, then `gh auth setup-git`).
