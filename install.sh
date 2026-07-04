#!/bin/bash
set -e

REPO="https://github.com/adittaya/VPLINK-3.0"
DIR="$HOME/vplink3.0"

echo "╔══════════════════════════════════════════════╗"
echo "║        VPLink 3.0 — Automated Installer      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

detect_pkg_manager() {
  if command -v apt &>/dev/null; then echo "apt"
  elif command -v yum &>/dev/null; then echo "yum"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v pacman &>/dev/null; then echo "pacman"
  elif command -v zypper &>/dev/null; then echo "zypper"
  elif command -v apk &>/dev/null; then echo "apk"
  else echo "unknown"; fi
}

install_deps() {
  PKG_MANAGER=$(detect_pkg_manager)
  echo "  Package manager: $PKG_MANAGER"

  case "$PKG_MANAGER" in
    apt)
      sudo apt update -qq
      sudo apt install -y -qq curl git xvfb x11vnc libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
      ;;
    yum|dnf)
      sudo $PKG_MANAGER install -y curl git xorg-x11-server-Xvfb x11vnc nss nspr atk at-spi2-atk cups-libs libdrm dbus-libs libxkbcommon libXcomposite libXdamage libXfixes libXrandr libgbm pango cairo alsa-lib
      ;;
    pacman)
      sudo pacman -Sy --noconfirm curl git xorg-server-xvfb x11vnc nss nspr atk at-spi2-atk cups libdrm dbus libxkbcommon libxcomposite libxdamage libxfixes libxrandr libgbm pango cairo alsa-lib
      ;;
    zypper)
      sudo zypper install -y curl git xvfb x11vnc nss nspr atk at-spi2-atk cups-libs libdrm dbus-1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 pango cairo alsa-lib
      ;;
    apk)
      sudo apk add curl git xvfb x11vnc nss nspr atk at-spi2-atk cups-libs libdrm dbus libxkbcommon libxcomposite libxdamage libxfixes libxrandr libgbm pango cairo alsa-lib
      ;;
    *)
      echo "  WARNING: Unknown package manager. Install dependencies manually."
      ;;
  esac
}

# ── 1. System dependencies ──────────────────────────
echo "[1/5] Installing system dependencies..."
install_deps
echo ""

# ── 2. Node.js ──────────────────────────────────────
echo "[2/5] Checking Node.js..."
if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1 | tr -d v)" -ge 18 ]; then
  echo "  Node.js $(node -v) already installed"
else
  echo "  Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &>/dev/null
  sudo apt install -y -qq nodejs &>/dev/null
  echo "  Node.js $(node -v) installed"
fi
echo ""

# ── 3. Clone repo ───────────────────────────────────
echo "[3/5] Setting up VPLink 3.0..."
if [ -d "$DIR" ]; then
  echo "  Updating existing installation..."
  cd "$DIR" && git pull
else
  echo "  Cloning repo..."
  git clone "$REPO" "$DIR"
fi
echo ""

# ── 4. Playwright browsers ──────────────────────────
echo "[4/5] Installing Playwright browsers..."
cd "$DIR"
npm install playwright &>/dev/null
npx playwright install chromium 2>&1 | tail -1
echo ""

# ── 5. Install command ─────────────────────────────
echo "[5/5] Installing vplink3.0 command..."
if [ -f /usr/local/bin/vplink3.0 ]; then
  sudo cp "$DIR/vplink3.0.sh" /usr/local/bin/vplink3.0
else
  sudo cp "$DIR/vplink3.0.sh" /usr/local/bin/vplink3.0
  sudo chmod +x /usr/local/bin/vplink3.0
fi
echo ""

# ── Done ────────────────────────────────────────────
echo "╔══════════════════════════════════════════════╗"
echo "║  Installation complete!                      ║"
echo "║                                              ║"
echo "║  Run: vplink3.0                              ║"
echo "╚══════════════════════════════════════════════╝"
