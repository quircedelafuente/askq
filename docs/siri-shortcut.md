# Siri shortcut

The shortcut sends what you say to your Ask Q and speaks the answer. If Ask Q asks you something ("Should I book it?"),
the shortcut listens again, so you can just say "yes".

You need two things from your Ask Q machine:

- **Token** and **URL** — `askq setup` shows both as QR codes at the end; show them again any time with `askq siri`.
  Scan each with the iPhone camera, tap the text, Copy. (Or print them: `askq token --show`, and the URL is like
  `https://my-server.tail1234.ts.net/ask`.)

Your iPhone must have the **Tailscale** app installed and connected to the same account.

## Install it (1 tap)

1. On your iPhone, open **[the Ask Q shortcut](https://www.icloud.com/shortcuts/bb7e05a8316a4b3ab19bba51307ba3f8)** → **Add Shortcut**.
2. It asks two questions: paste your **token** and your **URL**.
3. Say **"Hey Siri, Ask Q"**. Siri says "I'm listening": ask your question.

It's a conversation: Siri reads each answer and listens again, so you can follow up or just say "yes" when Ask Q asks
"Should I book it?". When you're done, don't answer (or tap to close Siri).

The shortcut is built from [`shortcut/build.py`](../shortcut/build.py), so you can see exactly what it does: it only
sends what you say to your own URL.

## Or build it yourself (iPhone or Mac, ~2 minutes)

Open **Shortcuts** → **+** (new shortcut) → name it **Ask Q** (that's what you'll say to Siri). Add these actions in order:

1. **Repeat** → set it to **8** times.
2. Inside the Repeat, add **Dictate Text**.
   - Language: your language. Stop listening: **After Pause**.
3. **If** → *Dictated Text* **is** `stop` → inside it, **Stop This Shortcut**. (End If.)
4. **Get Contents of URL**
   - URL: your Ask Q URL
   - Method: **POST**
   - Headers: add `Authorization` with value `Bearer YOUR-TOKEN` (the word Bearer, a space, then the token)
   - Request Body: **JSON** → add field `text` (Text) = *Dictated Text*
5. **Speak Text** → *Contents of URL*. (Pick a voice in your language under "Show More".)
6. **If** → *Contents of URL* **does not contain** `?` → inside it, **Stop This Shortcut**. (End If.)
7. End Repeat.

That's it. Say **"Hey Siri, Ask Q"**, wait for the beep, and speak.

> Why the loop: when Ask Q needs a "yes" (to book, pay or send) its answer ends with a question mark, so the shortcut
> listens again. When the answer is just information, it stops.

## Tips

- **Long tasks answer early.** For things that take a while ("get me the ticket and send it to my WhatsApp"), Ask Q
  answers within seconds with what it's going to do ("Okay, I'll get it and send it to your WhatsApp"), Siri closes,
  and the result arrives in your WhatsApp/Telegram when it's done.
- **Slow tasks.** Siri gives up after ~30 seconds. If something takes longer, Ask Q answers "On it… can you say okay in
  a few seconds?" and keeps listening — say "okay" and you'll get the result. Long tasks
  also arrive in your WhatsApp/Telegram if you ask ("send me the ticket").
- **Start over.** Say "new conversation". Otherwise Ask Q remembers the last 15 minutes.
- **Language.** Ask Q answers in the language you speak. If Siri reads Spanish with an English accent, choose a
  Spanish voice in the Speak Text action, or set Siri's language to yours.
- **Action Button / Back Tap.** Assign the shortcut to the iPhone Action Button or to Settings → Accessibility → Touch →
  Back Tap for one-tap access.
- **Mac, iPad, Apple Watch.** The same shortcut syncs through iCloud and works there too.
- **"Something went wrong" / 401.** The token in the header is wrong: it must be `Bearer ` + token, no extra spaces.
  Check with `askq logs`.
- **The same phrase keeps coming back.** The Dictate Text action is outside the Repeat. Move it inside.
