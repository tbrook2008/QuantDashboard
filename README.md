# MarketPulse — AI Trading Intelligence Dashboard

A production-grade quantitative trading dashboard with real-time market data, AI-powered trade analysis via Claude, and direct Alpaca Markets execution.

---

## Features

- **Real-Time Market Data** — Alpaca WebSocket + Polygon.io + CoinGecko
- **TradingView-Style Charts** — Candlestick charts with RSI, MACD, Bollinger Bands, EMA, VWAP
- **AI Trading Engine** — Claude reads market data and makes structured trade decisions
- **Alpaca Integration** — Paper and live trading, full order management
- **4 Pages:** Markets overview, Chart analysis, AI Trader, Portfolio
- **3 AI Modes:** Approval (you review), Autonomous (fully automated), Paused
- **Risk Controls** — Max position size, daily loss limits, confidence thresholds
- **Kill Switch** — Emergency close all positions instantly

---

## Quick Start

### 1. Prerequisites

- **Node.js v18+** — https://nodejs.org
- **Alpaca account** (free paper account) — https://alpaca.markets
- **Anthropic API key** — https://console.anthropic.com
- **Polygon.io key** (optional, free tier) — https://polygon.io

### 2. Install & Configure

```bash
git clone https://github.com/tbrook2008/QuantDashboard.git
cd QuantDashboard
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
ALPACA_API_KEY=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
ANTHROPIC_API_KEY=your_anthropic_key
POLYGON_API_KEY=your_polygon_key
```

### 3. Run

```bash
bash start.sh
```

Open http://localhost:3000

> **Without API keys:** The dashboard runs fully in demo/simulated mode. Add keys in ⚙ Settings or in `.env` for live data.

---

## API Keys

| Key | Where to get | Required for |
|-----|-------------|--------------|
| Alpaca (paper) | alpaca.markets → Paper Trading | Live quotes, order execution |
| Anthropic | console.anthropic.com | AI trade analysis |
| Polygon.io | polygon.io → Free tier | Historical bars, news |
| CoinGecko | No key needed (free) | Crypto prices |

---

## AI Modes

| Mode | Behavior |
|------|----------|
| **Approval** | AI analyzes and suggests trades. You approve or reject each one. |
| **Autonomous** | AI trades automatically (within risk rules). Monitor closely. |
| **Paused** | AI scans and logs but takes no action. |

**Start with Approval mode until you trust the AI's strategy.**

---

## Risk Controls

Configure in the AI Trader page or `.env`:

- **Max Position Size** — Maximum % of portfolio per trade (default: 5%)
- **Max Daily Loss** — AI stops trading if portfolio drops this % in a day (default: 2%)
- **Min Confidence** — Only execute trades above this confidence score (default: 70%)

---

## Architecture

```
marketpulse/
├── server/
│   ├── index.js          # Express server entry
│   ├── db.js             # SQLite database
│   ├── sse.js            # Server-Sent Events (real-time push)
│   ├── indicators.js     # RSI, MACD, BB, ATR, ADX, VWAP, regime detection
│   ├── ai/
│   │   └── engine.js     # Claude AI trading engine
│   ├── alpaca/
│   │   ├── client.js     # Alpaca REST API
│   │   └── stream.js     # Alpaca WebSocket stream
│   ├── market/
│   │   └── stream.js     # Polygon.io + CoinGecko
│   └── routes/           # Express API routes
├── public/
│   ├── index.html        # Single-page app shell
│   ├── css/main.css      # Full stylesheet
│   └── js/
│       ├── app.js        # Bootstrap + router
│       ├── api.js        # Backend API client
│       ├── sse.js        # SSE client (real-time)
│       ├── charts.js     # TradingView Lightweight Charts
│       ├── home.js       # Markets page
│       ├── trader.js     # AI Trader page
│       └── portfolio.js  # Portfolio page
├── data/
│   └── marketpulse.db    # SQLite (auto-created)
├── .env.example
├── package.json
└── start.sh
```

---

## Deploy to Railway (Cloud)

1. Push to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables (your API keys) in Railway dashboard
4. Deploy — Railway auto-detects Node.js and runs `npm start`

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Markets page |
| `2` | Charts page |
| `3` | AI Trader page |
| `4` | Portfolio page |
| `Esc` | Close modal |

---

## Disclaimer

MarketPulse is for educational and research purposes. Trading involves significant financial risk. Past AI performance does not guarantee future results. Always monitor autonomous systems closely and use appropriate risk controls.

---

## License

MIT License — see LICENSE
