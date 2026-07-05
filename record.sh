#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "Cleaning up..."
  pkill -9 -f "Xvfb" 2>/dev/null
  pkill -9 -f "x11vnc" 2>/dev/null
  pkill -9 -f "chrome.*remote-debugging" 2>/dev/null
  pkill -9 -f "playwright" 2>/dev/null
  pkill -9 -f "record.js" 2>/dev/null
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null
}

trap 'cleanup; exit 130' SIGINT SIGTERM EXIT

cleanup
sleep 1

# Start Xvfb
echo "Starting Xvfb on :99 (1280x720)..."
Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
sleep 2
if ! pgrep -x Xvfb > /dev/null; then
  echo "Retrying Xvfb..."
  Xvfb :99 -screen 0 1280x720x24 &>/dev/null &
  sleep 2
fi

# Start x11vnc
echo "Starting x11vnc on port 5900..."
x11vnc -display :99 -forever -shared -rfbport 5900 &>/dev/null &
sleep 1

export DISPLAY=:99
export NODE_PATH="$SCRIPT_DIR/node_modules"

echo ""
echo "══════════════════════════════════════════════"
echo "  VPLink Flow Recorder"
echo "  DISPLAY=:99  VNC=localhost:5900"
echo "══════════════════════════════════════════════"
echo ""

cd "$SCRIPT_DIR"
node record.js "$@"
RC=$?

cleanup

echo "Done (exit code: $RC)"
exit $RC
