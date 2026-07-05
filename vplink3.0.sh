#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOMATION="$SCRIPT_DIR/automation.js"

# ── Detect Termux ─────────────────────────────────────
is_termux() {
  [ -n "$PREFIX" ] && [ -d /data/data/com.termux ] 2>/dev/null
}

if is_termux; then
  TERMUX=1
else
  TERMUX=0
fi

cleanup() {
  pkill -9 -f "Xvfb :99" 2>/dev/null
  pkill -9 -f "x11vnc.*:99" 2>/dev/null
  pkill -9 -f "playwright" 2>/dev/null
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null
}

trap 'echo ""; echo "Interrupted."; cleanup; exit 130' SIGINT SIGTERM

# ── Ask for link ────────────────────────────────────────
read -p "Enter vplink URL or key: " INPUT
KEY=$(echo "$INPUT" | sed 's|https\?://vplink.in/||' | xargs)
while [ -z "$KEY" ]; do
  read -p "Key cannot be empty. Enter vplink URL or key: " INPUT
  KEY=$(echo "$INPUT" | sed 's|https\?://vplink.in/||' | xargs)
done

# ── Ask for views ───────────────────────────────────────
read -p "How many views? (1): " VIEWS
[[ ! "$VIEWS" =~ ^[0-9]+$ ]] && VIEWS=1

# ── Ask for VNC (skip on Termux) ────────────────────────
VNC_NEEDED="n"
if [ "$TERMUX" = 0 ]; then
  read -p "VNC viewer needed? (y/N): " VNC_NEEDED
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Starting $VIEWS view(s) with key: $KEY"
[ "$TERMUX" = 1 ] && echo "║  Mode: Termux (headless)" || echo "║  Mode: Desktop Linux"
[[ "$VNC_NEEDED" =~ ^[yY] ]] && echo "║  VNC: :5900 (connect anytime)" || echo "║  VNC: disabled"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Confirm ─────────────────────────────────────────────
read -p "Proceed? (Y/n): " CONFIRM
[[ "$CONFIRM" =~ ^[nN] ]] && { echo "Aborted."; exit 0; }
echo ""

export NODE_PATH="$SCRIPT_DIR/node_modules"
export VPLINK_TERMUX="$TERMUX"

for (( i=1; i<=$VIEWS; i++ )); do
  echo "══════════════════════════════════════════════"
  echo "  View $i of $VIEWS"
  echo "══════════════════════════════════════════════"

  cleanup
  sleep 2

  if [ "$TERMUX" = 0 ]; then
    # Standard Linux: start display server
    Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
    sleep 2

    if ! pgrep -x Xvfb > /dev/null; then
      echo "  Xvfb failed to start, retrying..."
      Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
      sleep 2
    fi

    if [[ "$VNC_NEEDED" =~ ^[yY] ]]; then
      x11vnc -display :99 -forever -shared -rfbport 5900 &>/dev/null &
      sleep 1
    fi

    export DISPLAY=:99
  fi

  cd "$SCRIPT_DIR"
  timeout 480 node "$AUTOMATION" "$KEY"
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -ne 0 ] && [ "$EXIT_CODE" -ne 124 ]; then
    echo "  ⚠️  Automation exited with code $EXIT_CODE"
  fi

  if [ -f "$SCRIPT_DIR/destination_url.txt" ]; then
    DEST=$(cat "$SCRIPT_DIR/destination_url.txt")
    mv "$SCRIPT_DIR/destination_url.txt" "$SCRIPT_DIR/destination_url_${i}.txt"
    echo "  Result $i: $DEST"
  fi
  echo ""
done

cleanup

echo "══════════════════════════════════════════════"
echo "  All $VIEWS view(s) completed"
echo "══════════════════════════════════════════════"
RESULTS=()
for (( i=1; i<=$VIEWS; i++ )); do
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
