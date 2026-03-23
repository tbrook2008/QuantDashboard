// ═══════════════════════════════════════════════════════
//  MarketPulse — Market Data Routes
// ═══════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const market   = require('../market/stream');
const alpaca   = require('../alpaca/client');
const db       = require('../db');
const ind      = require('../indicators');
const { getQuoteCache, getSubscribed, addSymbols } = require('../alpaca/stream');

// GET /api/market/bars/:symbol
// Query params: timeframe (1D,5M,15M,1H), limit
router.get('/bars/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { timeframe = '1D', limit = 200 } = req.query;

  try {
    // Try cache first
    const cached = db.getBars(symbol.toUpperCase(), timeframe, parseInt(limit));
    if (cached.length >= 20) {
      return res.json({ symbol, timeframe, bars: cached, source: 'cache' });
    }

    // Fetch fresh
    let bars;
    const timespanMap = { '1D': 'day', '1W': 'week', '1H': 'hour', '5M': 'minute', '15M': 'minute', '1M': 'minute' };
    const multiplierMap = { '1D': 1, '1W': 1, '1H': 1, '5M': 5, '15M': 15, '1M': 1 };

    const timespan   = timespanMap[timeframe]   || 'day';
    const multiplier = multiplierMap[timeframe] || 1;

    // Try Alpaca first, then Polygon
    bars = await alpaca.getBars(symbol.toUpperCase(), timeframe === '1D' ? '1Day' : `${multiplier}${timespan === 'minute' ? 'Min' : 'Hour'}`, parseInt(limit));

    if (!bars || bars.length === 0) {
      bars = await market.getHistoricalBars(symbol.toUpperCase(), timespan, multiplier, null, null, parseInt(limit));
    }

    // Cache it
    if (bars && bars.length > 0) {
      db.upsertBars(symbol.toUpperCase(), timeframe, bars);
    }

    res.json({ symbol, timeframe, bars: bars || [], source: 'live' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/indicators/:symbol
router.get('/indicators/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { timeframe = '1D' } = req.query;
  try {
    const bars = db.getBars(symbol.toUpperCase(), timeframe, 200);
    if (bars.length < 20) {
      return res.status(404).json({ error: 'Insufficient data for indicators' });
    }
    const result = ind.computeAll(bars);
    res.json({ symbol, timeframe, indicators: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/quotes
router.get('/quotes', (req, res) => {
  const cache = getQuoteCache();
  res.json({ quotes: cache });
});

// GET /api/market/quotes/:symbol
router.get('/quotes/:symbol', (req, res) => {
  const cache = getQuoteCache();
  const q = cache[req.params.symbol.toUpperCase()];
  res.json({ quote: q || null });
});

// GET /api/market/news
router.get('/news', async (req, res) => {
  const { tickers, limit = 20 } = req.query;
  try {
    const tickerArr = tickers ? tickers.split(',') : [];
    const articles  = await market.getNews(tickerArr, parseInt(limit));
    res.json({ articles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/crypto
router.get('/crypto', async (req, res) => {
  try {
    const prices = await market.getCryptoPrices();
    res.json({ prices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/watchlist
router.get('/watchlist', (req, res) => {
  const subscribed = getSubscribed();
  res.json({ symbols: subscribed });
});

// POST /api/market/watchlist — add symbols
router.post('/watchlist', (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols)) return res.status(400).json({ error: 'symbols must be array' });
  addSymbols(symbols.map(s => s.toUpperCase()));
  res.json({ success: true, symbols });
});

// GET /api/market/clock
router.get('/clock', async (req, res) => {
  try {
    const clock = await alpaca.getClock();
    if (!clock) {
      // Return simulated clock
      const now = new Date();
      const hour = now.getUTCHours();
      const min  = now.getUTCMinutes();
      const isWeekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
      const isOpen = isWeekday && (hour > 13 || (hour === 13 && min >= 30)) && hour < 20;
      return res.json({ is_open: isOpen, timestamp: now.toISOString() });
    }
    res.json(clock);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
