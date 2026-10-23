# WhatsApp and Telegram

The chat channel does two things: you can **talk to Ask Q** there (text, voice notes, photos), and Ask Q **sends you
things** there — tickets, PDFs, screenshots, reminders, and a note every time it does something after your "yes".

Choose it in `askq setup`. Change it any time by running setup again.

**Start over.** Write "new conversation". Ask Q also starts a new conversation by itself after 2 hours without
messages, like Siri does after 15 minutes. Change it with `"chatSessionMinutes"` in `~/.askq/config.json`
(`0` = never forget).

## WhatsApp

Ask Q connects as a *linked device* (like WhatsApp Web) using [Baileys](https://github.com/WhiskeySockets/Baileys).

> ⚠️ Baileys is **not an official WhatsApp API**. WhatsApp may restrict or ban numbers that use unofficial clients.
> It's widely used and Ask Q only sends a few messages to you, but if this matters, use a **secondary number** or
> choose Telegram.

Two modes:

| Mode | How it works | Good for |
|---|---|---|
| **A group on my own number** (default) | Linked to your WhatsApp. You chat in a group called "Ask Q" where you're the only member. Ask Q's replies start with 🅠. | No second phone needed |
| **Its own number** | A second WhatsApp number (spare SIM, eSIM, or WhatsApp Business on a second number) linked to Ask Q. It only answers the numbers you list. | "Hey Google, send a WhatsApp to Ask Q" on Android; keeping your own account untouched |

Link it:

```bash
askq link whatsapp               # shows a QR: WhatsApp → Linked devices → Link a device
askq link whatsapp 34600111222   # or get an 8-letter code instead (your number with country code)
```

In group mode Ask Q tries to create the group itself. If WhatsApp doesn't allow it, create a group with that name
(add any contact, then remove them) and restart: `askq restart`.

## Telegram

1. In Telegram, open **@BotFather** → `/newbot` → pick a name → copy the token.
2. `askq link telegram` → paste the token → send the `/start 123456` message it shows to your bot.

Only that chat can talk to your bot. No webhook or open port is needed.

## Voice notes

Enable them in `askq setup`. They're transcribed locally with faster-whisper (needs `ffmpeg` and `python3`, ~500 MB).
Use a smaller model on small machines: set `ASKQ_STT_MODEL=base` in the service environment.
