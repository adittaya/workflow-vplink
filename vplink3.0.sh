#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOMATION="$SCRIPT_DIR/generated_automation.js"

cleanup() {
  pkill -9 -f "Xvfb" 2>/dev/null
  pkill -9 -f "x11vnc" 2>/dev/null
  pkill -9 -f "chrome.*remote-debugging" 2>/dev/null
  pkill -9 -f "playwright" 2>/dev/null
  pkill -9 -f "generated_auto" 2>/dev/null
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null
}

trap 'echo ""; echo "Interrupted."; cleanup; exit 130' SIGINT SIGTERM

# ── Ask for link ────────────────────────────────────────
read -p "Enter vplink URL or key: " INPUT
KEY=$(echo "$INPUT" | sed 's|https\?://vplink.in/||' | xargs)
[ -z "$KEY" ] && { echo "Error: no key"; exit 1; }

# ── Ask for views ───────────────────────────────────────
read -p "How many views? " VIEWS
[[ ! "$VIEWS" =~ ^[0-9]+$ ]] && VIEWS=1

# ── Ask for VNC ─────────────────────────────────────────
read -p "VNC viewer needed? (y/N): " VNC_NEEDED

echo ""
echo "Starting $VIEWS view(s) with key: $KEY"
[ "$VNC_NEEDED" = "y" ] || [ "$VNC_NEEDED" = "Y" ] && echo "VNC on port 5900" || echo "VNC disabled"
echo ""

for (( i=1; i<=$VIEWS; i++ )); do
  echo "══════════════════════════════════════════════"
  echo "  View $i of $VIEWS"
  echo "══════════════════════════════════════════════"

  # Clean everything before each view
  cleanup
  sleep 2

  # Start display server
  Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
  sleep 2

  # Verify Xvfb is running
  if ! pgrep -x Xvfb > /dev/null; then
    echo "  Xvfb failed to start, retrying..."
    Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
    sleep 2
  fi

  # Start VNC only if needed
  if [ "$VNC_NEEDED" = "y" ] || [ "$VNC_NEEDED" = "Y" ]; then
    x11vnc -display :99 -forever -shared -rfbport 5900 &>/dev/null &
    sleep 1
  fi

  # Run automation
  export DISPLAY=:99
  export NODE_PATH="$SCRIPT_DIR/node_modules"
  cd "$SCRIPT_DIR"
  timeout 480 node "$AUTOMATION" "$KEY"
  EXIT_CODE=$?

  # Save result for this view
  if [ -f "$SCRIPT_DIR/destination_url.txt" ]; then
    DEST=$(cat "$SCRIPT_DIR/destination_url.txt")
    mv "$SCRIPT_DIR/destination_url.txt" "$SCRIPT_DIR/destination_url_${i}.txt"
    echo "  Result $i: $DEST"
  fi
  echo ""
done

# Clean up final
cleanup

# Summary
echo "══════════════════════════════════════════════"
echo "  All $VIEWS view(s) completed"
echo "══════════════════════════════════════════════"
for (( i=1; i<=$VIEWS; i++ )); do
  [ -f "$SCRIPT_DIR/destination_url_${i}.txt" ] && echo "  View $i: $(cat "$SCRIPT_DIR/destination_url_${i}.txt")"
done
echo ""
echo "Results saved in $SCRIPT_DIR/destination_url_*.txt"
