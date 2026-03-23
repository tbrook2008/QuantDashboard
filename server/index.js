// ═══════════════════════════════════════════════════════
//  MarketPulse — Main Server
// ═══════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const { createServer } = require('http');

const app = express();
const httpServer = createServer(app);

// ── Middleware ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off for CDN scripts
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ───────────────────────────────────────────────
const { router: authRouter, authenticateToken } = require('./routes/auth');

app.use('/api/auth',    authRouter);
app.use('/api/market',  authenticateToken, require('./routes/market'));
app.use('/api/alpaca',  authenticateToken, require('./routes/alpaca'));
app.use('/api/ai',      authenticateToken, require('./routes/ai'));
app.use('/api/config',  authenticateToken, require('./routes/config'));

// ── SSE — Server-Sent Events (real-time push to browser) ─
app.use('/sse',         require('./routes/sse'));

// ── Serve frontend ───────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Initialize services ──────────────────────────────────
const db         = require('./db');
const { startAIEngine } = require('./ai/engine');
const { initAlpacaStream } = require('./alpaca/stream');
const { initMarketStream } = require('./market/stream');
const sseManager = require('./sse');

// Start everything
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   MarketPulse — http://localhost:${PORT}     ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  // Init DB first — everything else depends on it
  db.init();

  // Check which keys are configured
  const hasAlpaca    = process.env.ALPACA_API_KEY && process.env.ALPACA_API_KEY !== 'your_paper_api_key_here';
  const hasAnthropic = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here';
  const hasPolygon   = process.env.POLYGON_API_KEY && process.env.POLYGON_API_KEY !== 'your_polygon_api_key_here';

  console.log(`  API Keys:`);
  console.log(`  ${hasAlpaca    ? '✅' : '⚪'} Alpaca    ${hasAlpaca    ? '(live data + trading)' : '(simulated — add key to .env)'}`);
  console.log(`  ${hasAnthropic ? '✅' : '⚪'} Anthropic ${hasAnthropic ? '(AI trading active)'   : '(disabled — add key to .env)'}`);
  console.log(`  ${hasPolygon   ? '✅' : '⚪'} Polygon   ${hasPolygon   ? '(live bars + news)'    : '(simulated — add key to .env)'}`);
  console.log('');

  // Start streams (both gracefully fall back to simulation if no keys)
  await initAlpacaStream(sseManager);
  await initMarketStream(sseManager);

  // Start AI engine (pauses itself if no Anthropic key)
  const aiMode = db.getConfig('ai_mode') || process.env.AI_MODE || 'approval';
  startAIEngine(sseManager);

  console.log(`\n  AI Trader: ${aiMode.toUpperCase()} mode`);
  console.log(`  Ready! Open http://localhost:${PORT} in your browser\n`);
});

module.exports = { app, httpServer };
