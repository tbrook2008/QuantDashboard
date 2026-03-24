const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth');
const { setKey, getAllKeys } = require('../keys');

// Load configurations (mask API keys slightly)
router.get('/', authMiddleware, (req, res) => {
    const keys = getAllKeys();
    res.json({
        alpaca_key: keys.ALPACA_KEY ? keys.ALPACA_KEY.substring(0, 4) + '...' : '',
        polygon_key: keys.POLYGON_KEY ? '***' : '',
        llm_key: keys.LLM_KEY ? '***' : '',
        watchlist: keys.WATCHLIST ? JSON.parse(keys.WATCHLIST) : ['SPY', 'QQQ', 'BTC']
    });
});

// Save settings globally to DB
router.post('/', authMiddleware, async (req, res) => {
    const { alpaca_key, alpaca_secret, polygon_key, llm_key, watchlist } = req.body;
    try {
        if (alpaca_key) await setKey('ALPACA_KEY', alpaca_key);
        if (alpaca_secret) await setKey('ALPACA_SECRET', alpaca_secret);
        if (polygon_key) await setKey('POLYGON_KEY', polygon_key);
        if (llm_key) await setKey('LLM_KEY', llm_key);
        
        if (watchlist && Array.isArray(watchlist)) {
            await setKey('WATCHLIST', JSON.stringify(watchlist.map(w=>w.trim().toUpperCase()).filter(Boolean)));
        }
        
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: "Settings failed to save" });
    }
});

module.exports = router;
