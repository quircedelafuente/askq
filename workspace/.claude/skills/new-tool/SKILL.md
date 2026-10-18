---
name: new-tool
description: Create a new Ask Q tool (an MCP server) so the assistant can do something new, e.g. "create a tool for my gym's website", "make a tool to check my bus times", "build a tool that books padel courts". Use whenever the user asks for a new capability, integration or tool, or to change an existing one in ~/.askq/tools.
---

# Creating an Ask Q tool

A tool is a small MCP server in `~/.askq/tools/<name>/index.js`. Ask Q registers it, its functions become available to
you on the next message, and the guard knows which functions have real effects from their annotations.

## 1. Understand the job (briefly)
- What should the user be able to say? ("book padel Saturday at 11", "what's my balance?")
- Which website or service, and does it need the user's login?
- If something essential is unclear, ask ONE short question. Otherwise decide sensibly and go.

## 2. Find the cleanest way in (in this order)
1. **Official API** (documented, with an API key) → use `fetch`.
2. **The website's own JSON calls**: open the site and watch its network requests; many "no API" sites call clean JSON
   endpoints you can reuse. Prefer these over clicking through pages.
3. **Drive the website** with Playwright (headless Chromium) only if 1 and 2 are impossible.
   Install it for this tool with `askq tool deps <name> playwright` and `npx playwright install chromium`.
   If Chromium fails to start because of missing system libraries, you cannot fix that yourself (no sudo): tell the
   user to run once on the server `sudo npx playwright install-deps chromium`.

Never try to bypass CAPTCHAs, bot protection or paywalls, and respect the site's terms. If the site blocks automation,
tell the user plainly and suggest an alternative.

## 3. Create it
```bash
askq tool new <name> "<one-line description>"     # lowercase-with-dashes; creates ~/.askq/tools/<name>
```
Then edit `~/.askq/tools/<name>/index.js` (it already contains the pattern) and update its README.md.

Rules (non-negotiable):
- Every function has `annotations: { readOnlyHint: true }` if it only reads, or `readOnlyHint: false` if it books,
  pays, buys, sends, cancels, deletes or changes anything. When in doubt, `false`.
- Function names are verbs in snake_case (`list_slots`, `book_slot`). Descriptions say what it does and what it returns.
- Inputs use zod with `.describe()`. Dates as `YYYY-MM-DD`, times as `HH:MM`, in the user's timezone.
- Secrets (passwords, API keys, cookies) ONLY through `secret('KEY')`. You never ask the user to paste a password in
  the chat and you never write one to a file. Tell them to run on the server: `askq secret set <name> KEY`
  (it prompts without echoing).
- Return short results. Files (tickets, PDFs, screenshots) go to `~/.askq/state/media/` and you return the path; then
  offer to send them with `askq-phone` → `send_to_phone`.
- Errors: throw with a clear human message ("Login failed: check the password with askq secret set …").
- Extra npm packages: `askq tool deps <name> <package…>` (never `npm install` inside the folder directly).

## 4. Check it
```bash
askq tool test <name>                         # starts it and lists functions with their read-only flag
askq tool test <name> <function> '<json args>'  # calls one (only call read-only ones without the user's yes)
askq tools sync                               # updates the guard; run after every change
```
Fix until it works. Test read-only functions for real; for functions with effects, test up to the step just before
the real action (or with a dry-run flag) unless the user explicitly asks you to do it for real.

## 5. Tell the user
In 2–3 sentences: what they can now ask, any secret they must set (exact command), and one example phrase.
The new tool is available from their next message.
