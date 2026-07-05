#!/bin/bash

SCRIPT="$(readlink -f "$0")"  # resolve symlinks to real path
SCRIPT_DIR="$(dirname "$SCRIPT")"
AUTOMATION="$SCRIPT_DIR/automation.js"
CONFIG_MODULE="$SCRIPT_DIR/config.js"
PROXY_ROTATOR="$SCRIPT_DIR/proxy-rotator.js"
PROFILE_GENERATOR="$SCRIPT_DIR/profile-generator.js"

NODE_BIN="node"
[ -x "$PREFIX/bin/node" ] && NODE_BIN="$PREFIX/bin/node"

# ── Color helpers ──────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'

info()  { echo -e "  ${CYAN}${1}${NC}"; }
ok()    { echo -e "  ${GREEN}✓${NC} ${1}"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} ${1}"; }
fail()  { echo -e "  ${RED}✗${NC} ${1}"; }

# ── Detect Termux ─────────────────────────────────────
is_termux() {
  [ -n "$PREFIX" ] && [ -d /data/data/com.termux ] 2>/dev/null
}

if is_termux; then
  TERMUX=1
else
  TERMUX=0
fi

# ── Config helpers ─────────────────────────────────────
cfg_get() { $NODE_BIN "$CONFIG_MODULE" --get "$1" 2>/dev/null; }
cfg_set() { $NODE_BIN "$CONFIG_MODULE" --set "$1" "$2" 2>/dev/null; }

# ── PID tracking ───────────────────────────────────────
PIDS=()

track_pid() {
  PIDS+=("$1")
}

cleanup_pids() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  PIDS=()
  # Remove stale lock files
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null
}

trap 'echo ""; echo "Interrupted."; cleanup_pids; exit 130' SIGINT SIGTERM

# ── VNC detection ──────────────────────────────────────
detect_vnc() {
  local ports
  ports=$(ss -tlnp 2>/dev/null | grep -oP '(?<=:)\d+' | grep '^59[0-9][0-9]$' | sort -u || true)
  if [ -z "$ports" ]; then
    echo ""
    return 1
  fi
  echo ""
  info "${GREEN}VNC server(s) detected on port(s):${NC} $(echo "$ports" | tr '\n' ' ')"
  echo ""
}

# ── Load saved config ──────────────────────────────────
SAVED_KEY=$(cfg_get "last_key" 2>/dev/null)
SAVED_VIEWS=$(cfg_get "views" 2>/dev/null)
SAVED_PROXY=$(cfg_get "proxy_enabled" 2>/dev/null)
SAVED_TIER=$(cfg_get "proxy_tier" 2>/dev/null)
SAVED_YT=$(cfg_get "youtube_traffic" 2>/dev/null)
SAVED_MOBILE=$(cfg_get "mobile_profile" 2>/dev/null)
SAVED_VNC_PORT=$(cfg_get "vnc_port" 2>/dev/null)

[ -z "$SAVED_VIEWS" ] || [ "$SAVED_VIEWS" = "0" ] && SAVED_VIEWS=1

# ════════════════════════════════════════════════════════
#  QUESTIONS
# ════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         VPLink 3.0 — Interactive             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Link / Key ──────────────────────────────────────
DEFAULT_INPUT=""
[ -n "$SAVED_KEY" ] && DEFAULT_INPUT="$SAVED_KEY"
read -p "Enter vplink URL or key [${DEFAULT_INPUT}]: " INPUT
INPUT="${INPUT:-$DEFAULT_INPUT}"
KEY=$(echo "$INPUT" | sed 's|https\?://vplink.in/||' | xargs)
while [ -z "$KEY" ]; do
  read -p "Key cannot be empty. Enter vplink URL or key: " INPUT
  KEY=$(echo "$INPUT" | sed 's|https\?://vplink.in/||' | xargs)
done
cfg_set "last_key" "$KEY"

# ── 2. Multiple URLs feature ───────────────────────────
MULTI_URLS=""
read -p "Use multiple vplink URLs (random rotation)? (y/N): " MULTI_CHOICE
if [[ "$MULTI_CHOICE" =~ ^[yY] ]]; then
  read -p "Enter all URLs/keys (comma-separated): " MULTI_INPUT
  MULTI_URLS=$(echo "$MULTI_INPUT" | xargs)
  # Save to config
  cfg_set "random_urls" "$MULTI_URLS"
fi

# ── 3. Views ───────────────────────────────────────────
read -p "How many views? (${SAVED_VIEWS}): " VIEWS
VIEWS="${VIEWS:-$SAVED_VIEWS}"
[[ ! "$VIEWS" =~ ^[0-9]+$ ]] && VIEWS=$SAVED_VIEWS
cfg_set "views" "$VIEWS"

# ── 4. Proxy rotation ──────────────────────────────────
PROXY_ENABLED="$SAVED_PROXY"
if [ -z "$PROXY_ENABLED" ] || [ "$PROXY_ENABLED" = "false" ]; then PROXY_ENABLED="n"; else PROXY_ENABLED="y"; fi
read -p "Enable proxy rotation? (y/N) [${PROXY_ENABLED}]: " PROXY_CHOICE
PROXY_CHOICE="${PROXY_CHOICE:-$PROXY_ENABLED}"
if [[ "$PROXY_CHOICE" =~ ^[yY] ]]; then
  PROXY_ENABLED="true"
  read -p "Proxy tier? (normal/premium) [${SAVED_TIER:-premium}]: " PROXY_TIER
  PROXY_TIER="${PROXY_TIER:-${SAVED_TIER:-premium}}"
  cfg_set "proxy_enabled" true
  cfg_set "proxy_tier" "$PROXY_TIER"
else
  PROXY_ENABLED="false"
  cfg_set "proxy_enabled" false
fi

# ── 5. YouTube traffic ─────────────────────────────────
YT_ENABLED="$SAVED_YT"
[ -z "$YT_ENABLED" ] || [ "$YT_ENABLED" = "false" ] && YT_DEFAULT="n" || YT_DEFAULT="y"
read -p "Simulate YouTube traffic source? (y/N) [${YT_DEFAULT}]: " YT_CHOICE
YT_CHOICE="${YT_CHOICE:-$YT_DEFAULT}"
if [[ "$YT_CHOICE" =~ ^[yY] ]]; then
  YT_ENABLED="true"
  cfg_set "youtube_traffic" true
else
  YT_ENABLED="false"
  cfg_set "youtube_traffic" false
fi

# ── 6. Mobile profiles ─────────────────────────────────
MOBILE_ENABLED="$SAVED_MOBILE"
[ -z "$MOBILE_ENABLED" ] || [ "$MOBILE_ENABLED" = "false" ] && MOB_DEFAULT="n" || MOB_DEFAULT="y"
read -p "Use random mobile profile per view? (y/N) [${MOB_DEFAULT}]: " MOB_CHOICE
MOB_CHOICE="${MOB_CHOICE:-$MOB_DEFAULT}"
if [[ "$MOB_CHOICE" =~ ^[yY] ]]; then
  MOBILE_ENABLED="true"
  cfg_set "mobile_profile" true
else
  MOBILE_ENABLED="false"
  cfg_set "mobile_profile" false
fi

# ── 7. VNC ─────────────────────────────────────────────
VNC_NEEDED="n"
VNC_PORT="${SAVED_VNC_PORT:-5900}"
VNC_DETECTED=""
if [ "$TERMUX" = 0 ]; then
  if detect_vnc; then
    VNC_DETECTED="yes"
    read -p "Use existing VNC? (Y/n): " USE_VNC
    if [[ ! "$USE_VNC" =~ ^[nN] ]]; then
      VNC_NEEDED="y"
      read -p "VNC port? (${VNC_PORT}): " VNC_PORT_IN
      VNC_PORT="${VNC_PORT_IN:-$VNC_PORT}"
    else
      read -p "Start a separate VNC? (y/N): " START_VNC
      [[ "$START_VNC" =~ ^[yY] ]] && VNC_NEEDED="y"
      read -p "VNC port? (${VNC_PORT}): " VNC_PORT_IN
      VNC_PORT="${VNC_PORT_IN:-$VNC_PORT}"
    fi
  else
    read -p "VNC viewer needed? (y/N): " VNC_CHOICE
    if [[ "$VNC_CHOICE" =~ ^[yY] ]]; then
      VNC_NEEDED="y"
      read -p "VNC port? (${VNC_PORT}): " VNC_PORT_IN
      VNC_PORT="${VNC_PORT_IN:-$VNC_PORT}"
    fi
  fi
  cfg_set "vnc_port" "$VNC_PORT"
fi

# ════════════════════════════════════════════════════════
#  SUMMARY + CONFIRM
# ════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║               Run Summary                    ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Views:        $VIEWS"
echo "║  Key:          $KEY"
if [ -n "$MULTI_URLS" ]; then
echo "║  Multi-URL:    enabled ($(echo "$MULTI_URLS" | tr ',' '\n' | wc -l) keys)"
fi
echo "║  Proxy:        $([[ "$PROXY_ENABLED" = true ]] && echo "enabled (${PROXY_TIER})" || echo "disabled")"
echo "║  YouTube src:  $([[ "$YT_ENABLED" = true ]] && echo "enabled" || echo "disabled")"
echo "║  Mobile prof:  $([[ "$MOBILE_ENABLED" = true ]] && echo "enabled" || echo "disabled")"
[ "$TERMUX" = 1 ] && echo "║  Mode:          Termux (headless)"
if [[ "$VNC_NEEDED" =~ ^[yY] ]]; then
echo "║  VNC:          :$VNC_PORT"
else
echo "║  VNC:          disabled"
fi
echo "╚══════════════════════════════════════════════╝"
echo ""

read -p "Proceed? (Y/n): " CONFIRM
[[ "$CONFIRM" =~ ^[nN] ]] && { echo "Aborted."; exit 0; }
echo ""

# ════════════════════════════════════════════════════════
#  RUN LOOP
# ════════════════════════════════════════════════════════

export NODE_PATH="$SCRIPT_DIR/node_modules"
export VPLINK_TERMUX="$TERMUX"

for (( i=1; i<=VIEWS; i++ )); do
  echo "══════════════════════════════════════════════"
  echo "  View $i of $VIEWS"
  echo "══════════════════════════════════════════════"

  cleanup_pids
  sleep 1

  # ── Pick key (random if multi-URL enabled) ──────────
  CURRENT_KEY="$KEY"
  if [ -n "$MULTI_URLS" ]; then
    IFS=',' read -ra URL_ARR <<< "$MULTI_URLS"
    RAND_IDX=$(( RANDOM % ${#URL_ARR[@]} ))
    RAW="${URL_ARR[$RAND_IDX]}"
    CURRENT_KEY=$(echo "$RAW" | sed 's|https\?://vplink.in/||' | xargs)
    info "Picked key ${RAND_IDX}: ${CURRENT_KEY}"
  fi

  # ── Proxy ──────────────────────────────────────────
  if [ "$PROXY_ENABLED" = "true" ]; then
    info "Fetching proxy..."
    cd "$SCRIPT_DIR"
    # stdout = ip:port only (all status messages go to stderr → visible to user)
    PROXY_RESULT=$($NODE_BIN "$PROXY_ROTATOR" "$PROXY_TIER")
    if [ -n "$PROXY_RESULT" ]; then
      export VPLINK_PROXY="http://${PROXY_RESULT}"
      ok "Proxy: $VPLINK_PROXY"
    else
      warn "No proxy available, running without proxy"
      unset VPLINK_PROXY
    fi
  else
    unset VPLINK_PROXY
  fi

  # ── Profile (UA + viewport + YouTube headers) ──────
  if [ "$MOBILE_ENABLED" = "true" ] || [ "$YT_ENABLED" = "true" ]; then
    cd "$SCRIPT_DIR"
    PROFILE_OUTPUT=$($NODE_BIN "$PROFILE_GENERATOR" \
      "mobile=${MOBILE_ENABLED}" "youtube=${YT_ENABLED}")
    if [ -n "$PROFILE_OUTPUT" ]; then
      PROFILE_UA=$(echo "$PROFILE_OUTPUT" | sed -n '1p')
      PROFILE_VIEWPORT=$(echo "$PROFILE_OUTPUT" | sed -n '2p')
      PROFILE_REFERER=$(echo "$PROFILE_OUTPUT" | sed -n '3p')

      export VPLINK_USER_AGENT="$PROFILE_UA"
      VW=$(echo "$PROFILE_VIEWPORT" | cut -d'x' -f1)
      VH=$(echo "$PROFILE_VIEWPORT" | cut -d'x' -f2)
      [ -n "$VW" ] && export VPLINK_VIEWPORT_WIDTH="$VW"
      [ -n "$VH" ] && export VPLINK_VIEWPORT_HEIGHT="$VH"

      if [ "$YT_ENABLED" = "true" ] && [ -n "$PROFILE_REFERER" ]; then
        info "YouTube referer: $PROFILE_REFERER"
      fi
    fi
  else
    unset VPLINK_USER_AGENT VPLINK_VIEWPORT_WIDTH VPLINK_VIEWPORT_HEIGHT
  fi

  # ── Xvfb + VNC ─────────────────────────────────────
  if [ "$TERMUX" = 0 ]; then
    Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
    track_pid $!
    sleep 2

    if ! pgrep -x Xvfb > /dev/null; then
      warn "Xvfb failed, retrying..."
      Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
      track_pid $!
      sleep 2
    fi

    if [[ "$VNC_NEEDED" =~ ^[yY] ]]; then
      x11vnc -display :99 -forever -shared -rfbport "$VNC_PORT" &>/dev/null &
      track_pid $!
      sleep 1
      ok "VNC on port $VNC_PORT"
    fi

    export DISPLAY=:99
  fi

  # ── Run automation ─────────────────────────────────
  cd "$SCRIPT_DIR"
  info "Starting automation..."
  timeout 480 $NODE_BIN "$AUTOMATION" "$CURRENT_KEY"
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -ne 0 ] && [ "$EXIT_CODE" -ne 124 ]; then
    warn "Automation exited with code $EXIT_CODE"
  fi

  # ── Save result ────────────────────────────────────
  if [ -f "$SCRIPT_DIR/destination_url.txt" ]; then
    DEST=$(cat "$SCRIPT_DIR/destination_url.txt")
    mv "$SCRIPT_DIR/destination_url.txt" "$SCRIPT_DIR/destination_url_${i}.txt"
    ok "Result $i: $DEST"
  else
    warn "No destination URL captured for view $i"
  fi
  echo ""
done

# ── Final cleanup ─────────────────────────────────────
cleanup_pids

# ── Summary ────────────────────────────────────────────
echo "══════════════════════════════════════════════"
echo "  All $VIEWS view(s) completed"
echo "══════════════════════════════════════════════"
RESULTS=()
for (( i=1; i<=VIEWS; i++ )); do
  if [ -f "$SCRIPT_DIR/destination_url_${i}.txt" ]; then
    URL=$(cat "$SCRIPT_DIR/destination_url_${i}.txt")
    echo "  View $i: $URL"
    RESULTS+=("$URL")
  fi
done
UNIQUE=$(printf '%s\n' "${RESULTS[@]}" | sort -u | wc -l)
echo "  ───────────────────────────────────────────"
echo "  Unique destinations: $UNIQUE / ${#RESULTS[@]}"
echo ""
echo "Results saved in $SCRIPT_DIR/destination_url_*.txt"
