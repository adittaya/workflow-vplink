#!/bin/bash
set -e

REPO="https://github.com/adittaya/VPLINK-3.0"
DIR="$HOME/vplink3.0"

# ── Termux detection ──────────────────────────────────
is_termux() {
  [ -n "$PREFIX" ] && [ -d /data/data/com.termux ] 2>/dev/null
}

SUDO=""
PKG_INSTALL=""
TERMUX=0

if is_termux; then
  TERMUX=1
  PKG_INSTALL="pkg install -y"
  SUDO=""
elif command -v sudo &>/dev/null; then
  SUDO="sudo"
fi

echo "╔══════════════════════════════════════════════╗"
echo "║        VPLink 3.0 — Automated Installer      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

detect_pkg_manager() {
  if is_termux; then echo "pkg"
  elif command -v apt &>/dev/null; then echo "apt"
  elif command -v yum &>/dev/null; then echo "yum"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v pacman &>/dev/null; then echo "pacman"
  elif command -v zypper &>/dev/null; then echo "zypper"
  elif command -v apk &>/dev/null; then echo "apk"
  else echo "unknown"; fi
}

install_system_deps() {
  PKG_MANAGER=$(detect_pkg_manager)
  echo "  Package manager: $PKG_MANAGER"
  echo "  Platform: $([ "$TERMUX" = 1 ] && echo 'Termux (Android)' || echo 'Standard Linux')"

  if [ "$TERMUX" = 1 ]; then
    # Termux: install Chromium via x11-repo, no Xvfb/VNC
    pkg update -y
    pkg install -y x11-repo
    pkg install -y curl git chromium nodejs
  else
    case "$PKG_MANAGER" in
      apt)
        if grep -qi "ubuntu 24" /etc/os-release 2>/dev/null || grep -qi "ubuntu 25" /etc/os-release 2>/dev/null || grep -qi "debian 13" /etc/os-release 2>/dev/null; then
          LIBPOSTFIX="t64"
        else
          LIBPOSTFIX=""
        fi
        PLAYWRIGHT_DEPS="libnss3 libnspr4 libatk1.0-0${LIBPOSTFIX} libatk-bridge2.0-0${LIBPOSTFIX} libcups2${LIBPOSTFIX} libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2"
        ASOUND="libasound2${LIBPOSTFIX}"
        $SUDO apt update -qq
        $SUDO apt install -y -qq curl git xvfb x11vnc $PLAYWRIGHT_DEPS $ASOUND
        ;;
      yum|dnf)
        $SUDO $PKG_MANAGER install -y curl git xorg-x11-server-Xvfb x11vnc nss nspr atk at-spi2-atk cups-libs libdrm dbus-libs libxkbcommon libXcomposite libXdamage libXfixes libXrandr libgbm pango cairo alsa-lib
        ;;
      pacman)
        $SUDO pacman -Sy --noconfirm curl git xorg-server-xvfb x11vnc nss nspr atk at-spi2-atk cups libdrm dbus libxkbcommon libxcomposite libxdamage libxfixes libxrandr libgbm pango cairo alsa-lib
        ;;
      zypper)
        $SUDO zypper install -y curl git xvfb x11vnc nss nspr atk at-spi2-atk cups-libs libdrm dbus-1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 pango cairo alsa-lib
        ;;
      apk)
        $SUDO apk add curl git xvfb x11vnc nss nspr atk at-spi2-atk cups-libs libdrm dbus libxkbcommon libxcomposite libxdamage libxfixes libxrandr libgbm pango cairo alsa-lib
        ;;
      *)
        echo "  WARNING: Unknown package manager. Install manually."
        ;;
    esac
  fi
}

# ── 1. System dependencies ──────────────────────────
echo "[1/6] Installing system dependencies..."
install_system_deps
echo ""

# ── 2. Node.js ──────────────────────────────────────
echo "[2/6] Checking Node.js..."
if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1 | tr -d v)" -ge 18 ]; then
  echo "  Node.js $(node -v) already installed"
elif [ "$TERMUX" = 1 ]; then
  echo "  Installing Node.js via pkg..."
  pkg install -y nodejs
  echo "  Node.js $(node -v) installed"
else
  PKG_MANAGER=$(detect_pkg_manager)
  echo "  Installing Node.js via $PKG_MANAGER..."
  case "$PKG_MANAGER" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - 2>&1 | tail -1
      $SUDO apt install -y -qq nodejs
      ;;
    yum|dnf)
      $SUDO $PKG_MANAGER install -y nodejs 2>&1 | tail -1
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm nodejs npm 2>&1 | tail -1
      ;;
    zypper)
      $SUDO zypper install -y nodejs 2>&1 | tail -1
      ;;
    apk)
      $SUDO apk add nodejs npm 2>&1 | tail -1
      ;;
    *)
      echo "  Unsupported package manager. Install Node.js >=18 manually."
      exit 1
      ;;
  esac
  echo "  Node.js $(node -v) installed"
fi
echo ""

# ── 3. Clone repo ───────────────────────────────────
echo "[3/6] Setting up VPLink 3.0..."
if [ -d "$DIR" ]; then
  echo "  Updating existing installation..."
  cd "$DIR" && git pull
else
  echo "  Cloning repo..."
  git clone "$REPO" "$DIR"
fi
cd "$DIR"
echo ""

# ── 4. Install npm dependencies & Playwright ────────
echo "[4/6] Installing Playwright + browsers..."
if [ "$TERMUX" = 1 ]; then
  # Termux: use playwright-core + system Chromium
  npm install playwright-core 2>&1 | tail -2
  echo "  Termux: using system Chromium at $(which chromium-browser || which chromium)"
else
  npm install 2>&1 | tail -2
  npx playwright install chromium 2>&1 | tail -1
fi
echo ""

# ── 5. Install command ─────────────────────────────
echo "[5/6] Installing vplink3.0 command..."
if [ "$TERMUX" = 1 ]; then
  ln -sf "$DIR/vplink3.0.sh" "$PREFIX/bin/vplink3.0"
  chmod +x "$PREFIX/bin/vplink3.0"
else
  $SUDO ln -sf "$DIR/vplink3.0.sh" /usr/local/bin/vplink3.0
  $SUDO chmod +x /usr/local/bin/vplink3.0
fi
echo "  Symlinked to $DIR/vplink3.0.sh"

# ── 6. Credential setup ────────────────────────────
echo "[6/6] Credential setup..."
CONFIG_DIR="$HOME/.vplink3.0"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="$CONFIG_DIR/config.json"

if [ -f "$CONFIG_FILE" ] && [ -s "$CONFIG_FILE" ]; then
  echo "  Config already exists at $CONFIG_FILE"
  read -p "  Overwrite credentials? (y/N): " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[yY] ]]; then
    echo "  Skipping credential setup."
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║  Installation complete!                      ║"
    echo "║                                              ║"
    echo "║  Run: vplink3.0                              ║"
    echo "╚══════════════════════════════════════════════╝"
    exit 0
  fi
fi

echo ""
echo "  Enter your Supabase credentials for proxy rotation."
echo "  (Leave blank and press Enter to skip — proxy feature disabled)"
echo ""

read -p "  Supabase URL: " SB_URL
read -p "  Supabase Anon/Publishable Key: " SB_KEY
read -p "  Supabase Secret/Service Key: " SB_SECRET

if [ -n "$SB_URL" ] && [ -n "$SB_KEY" ]; then
  cat > "$CONFIG_FILE" <<EOF
{
  "supabase_url": "${SB_URL}",
  "supabase_key": "${SB_KEY}",
  "supabase_secret": "${SB_SECRET}",
  "proxy_enabled": true,
  "proxy_tier": "premium",
  "youtube_traffic": false,
  "mobile_profile": false,
  "random_urls": [],
  "vnc_port": 5900,
  "views": 1
}
EOF
  echo "  Credentials saved to $CONFIG_FILE"
else
  cat > "$CONFIG_FILE" <<EOF
{
  "supabase_url": "",
  "supabase_key": "",
  "supabase_secret": "",
  "proxy_enabled": false,
  "proxy_tier": "premium",
  "youtube_traffic": false,
  "mobile_profile": false,
  "random_urls": [],
  "vnc_port": 5900,
  "views": 1
}
EOF
  echo "  Empty config saved (proxy disabled)."
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Installation complete!                      ║"
echo "║                                              ║"
echo "║  Run: vplink3.0                              ║"
echo "╚══════════════════════════════════════════════╝"
