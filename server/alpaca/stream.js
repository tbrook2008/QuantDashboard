// ═══════════════════════════════════════════════════════
//  MarketPulse — Alpaca WebSocket Stream
//  Real-time quotes → SSE → browser
// ═══════════════════════════════════════════════════════
const WebSocket = require('ws');

// Default watchlist — user can add more via UI
const DEFAULT_SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'DIA',        // Indices/ETFs
  'AAPL', 'MSFT', 'NVDA', 'TSLA',    // Mega caps
  'AMZN', 'GOOGL', 'META', 'AMD',    // Tech
  'GLD', 'SLV', 'USO',               // Commodities ETFs
];

let ws;
let sseManager;
let reconnectTimer;
let subscribedSymbols = new Set(DEFAULT_SYMBOLS);

// Latest quotes cache
const quoteCache = {};
const barCache = {};

function getQuoteCache() { return quoteCache; }
function getBarCache()   { return barCache; }
function getSubscribed() { return [...subscribedSymbols]; }

async function initAlpacaStream(sse) {
  sseManager = sse;

  if (!process.env.ALPACA_API_KEY || process.env.ALPACA_API_KEY === 'your_paper_api_key_here') {
    console.warn('⚠️  Alpaca keys not set — stream disabled. Live data required.');
    return;
  }

  const wsUrl = process.env.ALPACA_BASE_URL?.includes('live')
    ? 'wss://stream.data.alpaca.markets/v2/iex'
    : 'wss://stream.data.alpaca.markets/v2/iex'; // IEX free for both

  connect(wsUrl);
}

function connect(wsUrl) {
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    // Authenticate
    ws.send(JSON.stringify({
      action: 'auth',
      key:    process.env.ALPACA_API_KEY,
      secret: process.env.ALPACA_SECRET_KEY,
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msgs = JSON.parse(raw);
      for (const msg of msgs) {
        handleMessage(msg);
      }
    } catch (e) {
      // ignore parse errors
    }
  });

  ws.on('error', (e) => {
    console.error('Alpaca WS error:', e.message);
  });

  ws.on('close', () => {
    console.warn('Alpaca WS closed — reconnecting in 5s...');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(wsUrl), 5000);
  });
}

function handleMessage(msg) {
  switch (msg.T) {
    case 'success':
      if (msg.msg === 'authenticated') {
        subscribeAll();
        console.log('✅ Alpaca WS authenticated');
      }
      break;

    case 'q': // Quote
      const quote = {
        symbol: msg.S,
        bid:    msg.bp,
        ask:    msg.ap,
        price:  ((msg.bp || 0) + (msg.ap || 0)) / 2,
        time:   msg.t,
      };
      quoteCache[msg.S] = quote;
      if (sseManager) sseManager.quoteUpdate(msg.S, quote);
      break;

    case 'b': // Bar (minute)
      const bar = {
        open:   msg.o,
        high:   msg.h,
        low:    msg.l,
        close:  msg.c,
        volume: msg.v,
        time:   msg.t,
      };
      barCache[msg.S] = bar;
      if (sseManager) sseManager.barUpdate(msg.S, '1Min', bar);
      break;
  }
}

function subscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    action:  'subscribe',
    quotes:  [...subscribedSymbols],
    bars:    [...subscribedSymbols],
  }));
}

function addSymbols(symbols) {
  symbols.forEach(s => subscribedSymbols.add(s.toUpperCase()));
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'subscribe',
      quotes: symbols,
      bars:   symbols,
    }));
  }
}

function removeSymbols(symbols) {
  symbols.forEach(s => subscribedSymbols.delete(s.toUpperCase()));
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'unsubscribe',
      quotes: symbols,
      bars:   symbols,
    }));
  }
}



module.exports = { initAlpacaStream, addSymbols, removeSymbols, getQuoteCache, getBarCache, getSubscribed };

// ── Reinitialize stream with new keys (called after key update) ──
async function reinitStream(sse) {
  // Close existing WS
  if (ws) {
    try { ws.terminate(); } catch {}
    ws = null;
  }
  clearTimeout(reconnectTimer);
  // Re-init
  await initAlpacaStream(sse);
}

module.exports.reinitStream = reinitStream;
