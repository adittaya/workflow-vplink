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
        # Use dpkg to detect if libcups2t64 (transitional suffix) is available
        LIBPOSTFIX=""
        if dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libcups2 2>/dev/null || echo 0)" ge 2.4 2>/dev/null; then
          LIBPOSTFIX="t64"
        elif grep -qi "ubuntu 24" /etc/os-release 2>/dev/null; then
          LIBPOSTFIX="t64"
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
    npm install playwright-core || { echo "  ERROR: npm install playwright-core failed"; exit 1; }
    echo "  Termux: using system Chromium at $(which chromium-browser || which chromium)"
  else
    npm install || { echo "  ERROR: npm install failed"; exit 1; }
    npx playwright install chromium || { echo "  ERROR: playwright chromium install failed"; exit 1; }
  fi
echo ""

# ── 5. Install commands ───────────────────────────
echo "[5/7] Installing vplink3.0 commands..."
if [ "$TERMUX" = 1 ]; then
  ln -sf "$DIR/vplink3.0.sh" "$PREFIX/bin/vplink3.0"
  chmod +x "$PREFIX/bin/vplink3.0"
  ln -sf "$DIR/vplink-desktop.sh" "$PREFIX/bin/vplink-desktop" 2>/dev/null || true
else
  $SUDO ln -sf "$DIR/vplink3.0.sh" /usr/local/bin/vplink3.0
  $SUDO chmod +x /usr/local/bin/vplink3.0
  $SUDO ln -sf "$DIR/vplink-desktop.sh" /usr/local/bin/vplink-desktop
  $SUDO chmod +x /usr/local/bin/vplink-desktop
fi
echo "  vplink3.0 → $(which vplink3.0)"
echo "  vplink-desktop → $(which vplink-desktop || echo 'not installed (Termux)')"

# ── 6. Credential setup ────────────────────────────
echo "[6/7] Credential setup..."
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
    echo "║  Commands:                                   ║"
    echo "║    vplink3.0          — Run automation        ║"
    echo "║    vplink-desktop     — Virtual desktop mgmt  ║"
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
read -s -p "  Supabase Secret/Service Key: " SB_SECRET
echo ""

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
  chmod 600 "$CONFIG_FILE"
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
  chmod 600 "$CONFIG_FILE"
  echo "  Empty config saved (proxy disabled)."
fi

# ── 7. VNC password (optional) ─────────────────────
echo "[7/7] Virtual desktop setup..."
if [ "$TERMUX" = 1 ]; then
  echo "  Skipping (Termux — no virtual desktop needed)"
elif command -v x11vnc &>/dev/null; then
  echo ""
  echo "  VPLink can run in a virtual desktop (Xvfb + VNC) on your VPS."
  echo "  This lets Chrome run in headed mode with a viewable display."
  echo ""
  read -p "  Set up VNC password for remote desktop access? (y/N): " SET_VNC
  if [[ "$SET_VNC" =~ ^[yY] ]]; then
    echo ""
    "$DIR/vplink-desktop.sh" password --set
    echo ""
    ok "VNC password configured"
    echo ""
    read -p "  Install persistent virtual desktop service? (y/N): " INSTALL_SVC
    if [[ "$INSTALL_SVC" =~ ^[yY] ]] && command -v systemctl &>/dev/null; then
      "$DIR/vplink-desktop.sh" service --install 2>/dev/null || {
        warn "systemd service install skipped (manual: vplink-desktop service --install)"
      }
    fi
  else
    echo "  VNC password skipped. Start virtual desktop later with:"
    echo "    vplink-desktop start --vnc"
  fi
else
  echo "  x11vnc not available. Install manually or run without VNC."
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Installation complete!                      ║"
echo "║                                              ║"
echo "║  Commands:                                   ║"
echo "║    vplink3.0          — Run automation        ║"
echo "║    vplink-desktop     — Virtual desktop mgmt  ║"
echo "╚══════════════════════════════════════════════╝"
