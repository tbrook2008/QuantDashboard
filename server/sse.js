// ═══════════════════════════════════════════════════════
//  MarketPulse — SSE Manager (Server-Sent Events)
//  Pushes real-time data from server → all browser clients
// ═══════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();

// Store all connected SSE clients
const clients = new Set();

// ── SSE endpoint ─────────────────────────────────────────
router.get('/stream', (req, res) => {
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send initial heartbeat
  res.write('data: {"type":"connected"}\n\n');

  // Register client
  clients.add(res);

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write('data: {"type":"heartbeat"}\n\n');
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ── Broadcast to all clients ─────────────────────────────
function broadcast(type, data) {
  const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// ── Typed broadcast helpers ──────────────────────────────
function quoteUpdate(symbol, quote) {
  broadcast('quote', { symbol, ...quote });
}

function barUpdate(symbol, timeframe, bar) {
  broadcast('bar', { symbol, timeframe, bar });
}

function aiDecision(decision) {
  broadcast('ai_decision', decision);
}

function aiThinking(symbol, step, content) {
  broadcast('ai_thinking', { symbol, step, content });
}

function orderUpdate(order) {
  broadcast('order_update', order);
}

function positionUpdate(positions) {
  broadcast('positions', { positions });
}

function accountUpdate(account) {
  broadcast('account', { account });
}

function newsUpdate(article) {
  broadcast('news', { article });
}

function systemAlert(level, message) {
  broadcast('alert', { level, message });
}

module.exports = router;
module.exports.broadcast       = broadcast;
module.exports.quoteUpdate     = quoteUpdate;
module.exports.barUpdate       = barUpdate;
module.exports.aiDecision      = aiDecision;
module.exports.aiThinking      = aiThinking;
module.exports.orderUpdate     = orderUpdate;
module.exports.positionUpdate  = positionUpdate;
module.exports.accountUpdate   = accountUpdate;
module.exports.newsUpdate      = newsUpdate;
module.exports.systemAlert     = systemAlert;
module.exports.clients         = clients;
