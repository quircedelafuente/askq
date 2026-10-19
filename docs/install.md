# Install

Ask Q needs a machine that stays on. Pick one:

## Free server

[Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) includes an Arm VM (up to 4 cores, 24 GB RAM) that's
free for good — more than enough.

1. Create an account (it asks for a card to verify you; Always Free resources aren't charged).
2. Create a VM: **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (Ampere). If it says "out of capacity", try another
   availability domain or try again later.
3. SSH into it and run the installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/quircedelafuente/askq/main/install.sh | bash
   ```
4. After setup, you can close the VM's public SSH port in Oracle's security list and SSH through Tailscale instead
   (`ssh ubuntu@your-vm.your-tailnet.ts.net`).

Any VPS works the same way (Hetzner, DigitalOcean…), and so does a Raspberry Pi 4/5 at home.

## Your Mac

Run the installer in Terminal. Setup offers Tailscale and walks you through installing the app (with Homebrew if you have it).
Keep the Mac awake: System Settings → Energy → "Prevent automatic sleeping when the display is off" (on a laptop,
keep it plugged in). A bonus on Mac: tools can use your Mac apps through AppleScript and Shortcuts.

## Linux PC

Run the installer. It uses a systemd user service; to keep it running when you're logged out it enables "linger"
(it tells you if it needs `sudo loginctl enable-linger $USER`).

## Windows (experimental)

Open PowerShell **as Administrator** and run:

```powershell
irm https://raw.githubusercontent.com/quircedelafuente/askq/main/install.ps1 | iex
```

It installs WSL2 with Ubuntu (restart the first time and run it again), turns on systemd in WSL, keeps WSL running
while you're logged in, and runs the Linux installer inside it. Stop the PC from sleeping if you want Ask Q always
available.

## Paying for Claude

During setup, choose:

- **Your Claude subscription (Pro/Max)** — setup opens the Claude sign-in (`claude setup-token`) and keeps the token for you. Fixed
  monthly price; usage counts toward your plan's limits.
- **An API key** from console.anthropic.com — pay per use.

If you're already logged in to Claude Code on that machine, setup detects it and skips this step.

## Update

Ask Q checks for a new version every 12 hours and installs it by itself when it's not busy, then tells you in the chat
what changed. You can also ask in the chat ("update yourself") or run `askq update` (`--check` to only look).
To be told instead of updating automatically, set `"autoUpdate": false` in `~/.askq/config.json`.

## Uninstall

```bash
askq uninstall              # lists what it removes and asks first: service, Tailscale address, ~/.askq, the command
askq uninstall --keep-data  # only stops and removes the background service
```
