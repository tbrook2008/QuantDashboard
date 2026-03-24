const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth');
const { getAccount, getPositions, getOrders, submitOrder, cancelAllPositions } = require('../data/alpaca');

// Get overall account summary
router.get('/account', authMiddleware, async (req, res) => {
    try {
        const account = await getAccount();
        res.json({
            equity: account.equity,
            cash: account.cash,
            buying_power: account.buying_power,
            day_pnl: (parseFloat(account.equity) - parseFloat(account.last_equity)).toFixed(2),
            day_pnl_pct: (((parseFloat(account.equity) - parseFloat(account.last_equity)) / parseFloat(account.last_equity)) * 100).toFixed(2)
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to grab Alpaca account data" });
    }
});

// Get active positions and orders
router.get('/positions', authMiddleware, async (req, res) => {
    try {
        const [positions, orders] = await Promise.all([
            getPositions().catch(() => []),
            getOrders().catch(() => [])
        ]);
        
        res.json({ positions, orders });
    } catch (err) {
        res.status(500).json({ error: "Failed to grab portfolio positions" });
    }
});

module.exports = router;
