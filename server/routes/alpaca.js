// ═══════════════════════════════════════════════════════
//  MarketPulse — Alpaca Routes
// ═══════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const alpaca  = require('../alpaca/client');
const db      = require('../db');

// GET /api/alpaca/account
router.get('/account', async (req, res) => {
  try {
    const account = await alpaca.getAccount();
    if (!account) return res.json({ account: null, demo: true });
    // Snapshot equity
    db.snapshotEquity({
      equity:    parseFloat(account.equity),
      cash:      parseFloat(account.cash),
      pnl_day:   parseFloat(account.equity) - parseFloat(account.last_equity),
      pnl_total: 0,
    });
    res.json({ account });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/alpaca/positions
router.get('/positions', async (req, res) => {
  try {
    const positions = await alpaca.getPositions();
    res.json({ positions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/alpaca/positions — close all
router.delete('/positions', async (req, res) => {
  try {
    await alpaca.closeAllPositions();
    res.json({ success: true, message: 'All positions closed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/alpaca/positions/:symbol
router.delete('/positions/:symbol', async (req, res) => {
  try {
    await alpaca.closePosition(req.params.symbol);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/alpaca/orders
router.get('/orders', async (req, res) => {
  const { status = 'all', limit = 50 } = req.query;
  try {
    const orders = await alpaca.getOrders(status, parseInt(limit));
    res.json({ orders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/alpaca/orders — manual order
router.post('/orders', async (req, res) => {
  try {
    const { symbol, qty, side, type, limitPrice, stopLoss, takeProfit, tif } = req.body;
    if (!symbol || !qty || !side) {
      return res.status(400).json({ error: 'symbol, qty, and side required' });
    }
    const order = await alpaca.submitOrder({ symbol, qty, side, type, limitPrice, stopLoss, takeProfit, tif });
    res.json({ order });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/alpaca/orders/:orderId — cancel order
router.delete('/orders/:orderId', async (req, res) => {
  try {
    await alpaca.cancelOrder(req.params.orderId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/alpaca/orders — cancel all
router.delete('/orders', async (req, res) => {
  try {
    await alpaca.cancelAllOrders();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/alpaca/portfolio/history
router.get('/portfolio/history', async (req, res) => {
  const { period = '1M', timeframe = '1D' } = req.query;
  try {
    const history = await alpaca.getPortfolioHistory(period, timeframe);
    // Also return our equity snapshots as fallback
    const snapshots = db.getEquityCurve(30);
    res.json({ history, snapshots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/alpaca/killswitch — EMERGENCY: close everything
router.post('/killswitch', async (req, res) => {
  try {
    await alpaca.cancelAllOrders();
    await alpaca.closeAllPositions();
    res.json({ success: true, message: '🚨 Kill switch activated — all positions closed, all orders cancelled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
