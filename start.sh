#!/bin/bash
# MarketPulse Dashboard — Local Server Launcher
# Double-click this file or run: bash start.sh

PORT=8080
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║      MARKETPULSE  DASHBOARD          ║"
echo "  ║   Starting local server for live     ║"
echo "  ║   data access (no CORS issues)       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  → Server: http://localhost:$PORT"
echo "  → Press Ctrl+C to stop"
echo ""

# Kill anything already on the port
lsof -ti :$PORT | xargs kill -9 2>/dev/null

# Open browser after a short delay
(sleep 1 && open "http://localhost:$PORT") &

# Start the server
cd "$DIR"
python3 -m http.server $PORT
