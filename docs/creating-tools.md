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
