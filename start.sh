#!/bin/bash
# ═══════════════════════════════════════════════════════
#  MarketPulse — Start Script
# ═══════════════════════════════════════════════════════

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║    MARKETPULSE — AI Trading Dashboard ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "  ❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  ❌ Node.js v18+ required (found v$NODE_VERSION)"
  exit 1
fi

echo "  ✅ Node.js $(node -v)"

# Create .env if not exists
if [ ! -f ".env" ]; then
  echo "  📝 Creating .env from template..."
  cp .env.example .env
  echo "  ⚠️  Add your API keys to .env before trading"
fi

# Create data directory
mkdir -p data

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "  📦 Installing dependencies..."
  npm install
fi

echo ""
echo "  🚀 Starting MarketPulse on http://localhost:3000"
echo "  Press Ctrl+C to stop"
echo ""

node server/index.js
