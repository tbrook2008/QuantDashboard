const express = require('express');
const router  = express.Router();
const engine  = require('../ai/engine');
const db      = require('../db');

router.get('/status', (req, res) => {
  res.json(engine.getStatus());
});

router.get('/trades', (req, res) => {
  const { limit = 100 } = req.query;
  res.json({ trades: db.getRecentTrades(parseInt(limit)) });
});

router.get('/stats', (req, res) => {
  res.json({ stats: db.getTradeStats() });
});

router.get('/pending', (req, res) => {
  res.json({ decisions: engine.getPendingDecisions() });
});

router.post('/approve/:id', async (req, res) => {
  try {
    const result = await engine.approveDecision(parseInt(req.params.id));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reject/:id', (req, res) => {
  res.json(engine.rejectDecision(parseInt(req.params.id)));
});

router.post('/mode', (req, res) => {
  const { mode } = req.body;
  if (!['approval','autonomous','paused'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  engine.setMode(mode);
  res.json({ success: true, mode });
});

router.post('/run', async (req, res) => {
  try { res.json(await engine.runNow()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/watchlist', (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols)) return res.status(400).json({ error: 'symbols must be array' });
  engine.setWatchlist(symbols.map(s => s.toUpperCase()));
  res.json({ success: true, symbols });
});

router.get('/equity-curve', (req, res) => {
  const { days = 30 } = req.query;
  res.json({ curve: db.getEquityCurve(parseInt(days)) });
});

module.exports = router;
