#!/usr/bin/env bash
# Ask Q installer for Linux, macOS and Windows (inside WSL2).
#   curl -fsSL https://raw.githubusercontent.com/quircedelafuente/askq/main/install.sh | bash
# Installs what is missing (git, Node.js 20+, Claude Code, Tailscale), puts Ask Q in ~/.askq/app, adds the `askq`
# command and starts `askq setup`. It asks before using sudo. Re-running it updates Ask Q.
set -euo pipefail

REPO="${ASKQ_REPO:-https://github.com/quircedelafuente/askq.git}"
APP="${ASKQ_APP:-$HOME/.askq/app}"
BIN="$HOME/.local/bin"
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
die()  { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
TTY=/dev/tty; [ -r "$TTY" ] || TTY=/dev/stdin
confirm() { local a; read -r -p "$1 [Y/n] " a <"$TTY" || true; [[ -z "$a" || "$a" =~ ^[YySs] ]]; }

OS="$(uname -s)"
case "$OS" in
  Linux)  PLATFORM=linux; grep -qi microsoft /proc/version 2>/dev/null && PLATFORM=wsl ;;
  Darwin) PLATFORM=mac ;;
  *) die "Unsupported system: $OS. On Windows, use install.ps1 (it sets up WSL2)." ;;
esac
bold "Ask Q installer ($PLATFORM, $(uname -m))"

SUDO=""; [ "$(id -u)" -ne 0 ] && have sudo && SUDO="sudo"
apt_install() { have apt-get || die "Install $* with your package manager and run this again."; $SUDO apt-get update -qq && $SUDO apt-get install -y -qq "$@"; }

# git, curl
if ! have git || ! have curl; then
  step "Installing git and curl"
  if [ "$PLATFORM" = mac ]; then xcode-select --install 2>/dev/null || true; die "Finish installing the Xcode command line tools, then run this again."; fi
  apt_install git curl ca-certificates
fi

# Node.js 20+
node_ok() { have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
if ! node_ok; then
  step "Installing Node.js 22"
  if [ "$PLATFORM" = mac ]; then
    have brew || die "Install Homebrew (https://brew.sh) or Node.js 20+ (https://nodejs.org), then run this again."
    brew install node
  else
    confirm "Node.js 20+ is needed. Install Node.js 22 from NodeSource (uses sudo)?" || die "Node.js 20+ is required."
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    apt_install nodejs
  fi
  node_ok || die "Node.js 20+ is still not available."
fi

# Claude Code
export PATH="$BIN:$PATH"
if ! have claude; then
  step "Installing Claude Code"
  curl -fsSL https://claude.ai/install.sh | bash
  have claude || die "Claude Code did not install. See https://docs.claude.com/en/docs/claude-code/setup"
fi

# Optional extras for voice notes in the chat
if [ "$PLATFORM" != mac ] && ! have ffmpeg && confirm "Install ffmpeg and python3-venv (needed if you want voice notes in WhatsApp/Telegram)?"; then
  apt_install ffmpeg python3-venv
fi

# Tailscale (private access from your phone; nothing is opened to the internet)
if [ -n "${ASKQ_SKIP_TAILSCALE:-}" ]; then :
elif ! have tailscale && [ ! -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  step "Tailscale"
  if [ "$PLATFORM" = mac ]; then
    echo "Install the Tailscale app from https://tailscale.com/download/mac (or: brew install --cask tailscale) and log in."
  elif confirm "Install Tailscale (uses sudo)?"; then
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
fi
if [ -z "${ASKQ_SKIP_TAILSCALE:-}" ] && have tailscale && [ "$PLATFORM" != mac ]; then
  if ! tailscale status >/dev/null 2>&1; then
    step "Log in to Tailscale (use the same account as on your phone)"
    $SUDO tailscale up
  fi
  # let Ask Q configure `tailscale serve` without sudo
  $SUDO tailscale set --operator="$USER" >/dev/null 2>&1 || true
fi

# Keep Ask Q running after you log out (servers): systemd "linger"
if [ "$PLATFORM" != mac ] && have loginctl && ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  $SUDO loginctl enable-linger "$USER" 2>/dev/null || echo "Could not enable linger; run: sudo loginctl enable-linger $USER"
fi

# Ask Q itself
step "Installing Ask Q in $APP"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only --quiet
else mkdir -p "$(dirname "$APP")"; git clone --depth 1 --quiet "$REPO" "$APP"; fi
(cd "$APP" && npm ci --omit=dev --no-fund --no-audit --loglevel=error)
mkdir -p "$BIN"
ln -sf "$APP/bin/askq.js" "$BIN/askq"
chmod +x "$APP/bin/askq.js"
case ":$PATH:" in *":$BIN:"*) ;; *) for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do [ -f "$rc" ] && ! grep -q '.local/bin' "$rc" && echo 'export PATH="$HOME/.local/bin:$PATH"' >>"$rc"; done ;; esac

# Browser support for tools that drive websites (headless Chromium + the system libraries it needs)
if [ "$PLATFORM" != mac ] && [ -z "${ASKQ_NO_SETUP:-}" ] && confirm "Install browser support for tools that use websites without an API (~400 MB, uses sudo)?"; then
  (cd "$APP" && $SUDO npx --yes playwright@1 install-deps chromium && npx --yes playwright@1 install chromium) || echo "Browser support failed; tools can install it later."
fi

if [ -n "${ASKQ_NO_SETUP:-}" ]; then bold "Ask Q installed. Run: askq setup"; exit 0; fi
bold "Ask Q installed. Starting setup…"
exec "$BIN/askq" setup <"$TTY"
