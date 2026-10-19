# Getting started from zero

This guide assumes nothing: no server, no Tailscale, no terminal experience. Follow it top to bottom.
It takes about **40 minutes** the first time (15–20 if you use your own Mac).

You'll create or use these accounts:

| Account | What for | Cost |
|---|---|---|
| **Claude** (claude.ai) | The brain of your assistant | Pro or Max subscription, or pay-per-use API |
| **Tailscale** | A private connection between your phone and your Ask Q machine | Free (Personal plan) |
| **Oracle Cloud** *(optional)* | A free server that's always on | Free (Always Free) |
| **Telegram** *(optional)* | Chat with Ask Q, if you don't use WhatsApp | Free |

---

## Step 1 — Claude

1. Go to **https://claude.ai** and sign up (Google, Apple or email).
2. Subscribe to **Pro** or **Max** (Settings → Billing). Ask Q uses your subscription; there's no extra charge.
   *Prefer paying per use?* Create an API key at **https://console.anthropic.com** instead and keep it for Step 4.

## Step 2 — A machine that stays on

Pick **one**:

### Option A: a free server (recommended)

1. Go to **https://www.oracle.com/cloud/free/** → **Start for free**.
2. Fill in your details. It asks for a card **only to verify you**; Always Free resources are never charged.
   ⚠️ The **home region** you choose can't be changed later. Pick the one closest to you.
3. When the console opens: **☰ menu → Compute → Instances → Create instance**.
   - **Image**: click *Edit* → *Change image* → **Ubuntu** → **24.04**.
   - **Shape**: *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory (Always Free eligible).
   - **SSH keys**: choose **Generate a key pair** and click **Save private key**. Keep that file safe — it's your key to the server.
   - Click **Create**. If you get "Out of capacity", choose another *Availability domain* or try again in a few hours.
4. When the instance shows **Running**, copy its **Public IP address**.
5. Connect to it from your computer:
   - **Mac**: open *Terminal*. **Windows**: open *PowerShell*.
   - Type (replace the path and the IP):
     ```bash
     ssh -i ~/Downloads/ssh-key-2026-10-18.key ubuntu@123.45.67.89
     ```
     On Mac/Linux, if it complains the key is "too open", first run `chmod 600 ~/Downloads/ssh-key-*.key`.
   - Answer `yes` the first time. You're in when the prompt shows `ubuntu@…`.

### Option B: your own Mac

Open **Terminal** (Spotlight → "Terminal"). That's it. Keep the Mac on and plugged in:
System Settings → Energy → turn on **Prevent automatic sleeping when the display is off**.

### Option C: Windows

Open **PowerShell as Administrator** (Start → type "PowerShell" → right click → *Run as administrator*) and use the
Windows command in Step 4. *Windows support is experimental.*

## Step 3 — Tailscale on your phone

Tailscale creates a private network that only your devices can join. It's how your iPhone reaches Ask Q without
opening anything to the internet.

1. On your iPhone, install **Tailscale** from the App Store.
2. Open it → **Get Started** → sign in with **Google, Apple, Microsoft or GitHub**. This creates your free
   Tailscale account. Remember which one you used: the server must use the **same** one.
3. Allow the VPN configuration when iOS asks. You'll see a "VPN" icon while it's connected; leave it on.

## Step 4 — Install Ask Q

On the machine from Step 2 (the SSH window, or Terminal on your Mac), paste:

```bash
curl -fsSL https://raw.githubusercontent.com/quircedelafuente/askq/main/install.sh | bash
```

On Windows (PowerShell as Administrator):

```powershell
irm https://raw.githubusercontent.com/quircedelafuente/askq/main/install.ps1 | iex
```

It may ask for your password (that's `sudo`, for installing software) and to confirm a few things — press **Enter**
to accept. Then:

1. **Tailscale login.** It prints a link like `https://login.tailscale.com/a/1a2b3c…`. Open it on your phone or
   computer and sign in with **the same account as in Step 3**. The machine now appears in your Tailscale app.
   *(On a Mac, install the Tailscale app from https://tailscale.com/download/mac and sign in there instead.)*
2. **Setup questions.** `askq setup` starts:
   - **Name, language, timezone** — type them or press Enter.
   - **Claude** — if it isn't signed in yet:
     - With a subscription: open a **second** SSH/Terminal window on the same machine and run `claude setup-token`.
       It shows a link: open it, sign in to Claude, approve, and copy the token it gives you (starts with `sk-ant-`).
       Go back to the first window and paste it (it stays hidden).
     - With an API key: paste the key from console.anthropic.com.
   - **Chat channel** — see Step 5.
   - **Voice notes** — say yes if you want to send voice messages in the chat.
   - **Background service** — press Enter.
   - **Tailscale HTTPS** — the first time you'll probably see a message about HTTPS certificates. Open
     **https://login.tailscale.com/admin/dns**, scroll to **HTTPS Certificates**, click **Enable HTTPS**, then run
     `askq setup` again.
3. At the end it prints **your URL** (like `https://ask-q-server.tail1234.ts.net/ask`). Keep that window open for Step 6.

## Step 5 — WhatsApp or Telegram

During setup you choose one. You can change it later by running `askq setup` again.

**WhatsApp (group on your own number)** — no extra phone needed:
1. Setup shows a **QR code** in the terminal.
2. On your phone: WhatsApp → **Settings → Linked devices → Link a device** → scan it.
   *(QR too big for the window? Run `askq link whatsapp 34600111222` with your number and country code to get an
   8-letter code instead, and choose "Link with phone number instead" on the phone.)*
3. Ask Q creates a group called **Ask Q** where you're the only member. That's your chat with it. (If WhatsApp doesn't
   let it, create the group yourself: new group → add any contact → name it "Ask Q" → remove that contact. Then run `askq restart`.)

**WhatsApp (its own number)** — if you have a second number (spare SIM or eSIM): install WhatsApp with that number on
any phone, link it the same way, and save the number in your contacts as "Ask Q". Best for Android voice control.

**Telegram:**
1. In Telegram, search **@BotFather** → **Start** → send `/newbot` → choose a name (e.g. "My Ask Q") and a username
   ending in `bot`.
2. BotFather replies with a **token** (`123456:ABC…`). Paste it when setup asks.
3. Setup shows a message like `/start 482913`. Send exactly that to your new bot. Done.

## Step 6 — The Siri shortcut

1. On your iPhone, make sure **Tailscale is connected** (Step 3).
2. Open **[the Ask Q shortcut](ICLOUD_LINK)** on the iPhone → **Add Shortcut**.
3. It asks two questions:
   - **URL** — type the URL from Step 4 (or send it to yourself in the chat and copy it).
   - **Token** — on the machine run `askq token --qr`, point the iPhone camera at the QR, tap the text that appears
     and copy it. Paste it here.
4. Say **"Hey Siri, Ask Q"** → after the beep: *"What's the weather tomorrow?"*

If it doesn't answer, run `askq doctor` on the machine: it tells you what's missing.

## Step 7 — Your first tool

Ask, by voice or in the chat (the chat is more comfortable for this):

> "Create a tool to see free classes and book them at my gym, gym-example.com"

Ask Q builds and tests it (a couple of minutes). If the site needs your login, it tells you to store it on the
machine — passwords never go through the chat:

```bash
askq secret set gym-example PASSWORD
```

From your next message: *"Hey Siri, Ask Q: book the 7 pm spinning class tomorrow"* → *"Should I book it?"* → *"Yes."*

---

## Where to go from here

- Teach it more about you: edit `~/.askq/workspace/CLAUDE.md` (your city, routes, preferences).
- [Creating tools](creating-tools.md) · [Security](security.md) · [Troubleshooting](troubleshooting.md)
- Lock it down further: in the Oracle console you can now close port 22 to the internet and connect with
  `ssh ubuntu@<your-machine>.<tailnet>.ts.net` through Tailscale.
