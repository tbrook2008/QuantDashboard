const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth');
const engine = require('../ai/engine');
const { cancelAllPositions } = require('../data/alpaca');

// Get current state and live event logs
router.get('/status', authMiddleware, (req, res) => {
    res.json(engine.getStatus());
});

// Update the engine running mode (PAUSED / APPROVAL / AUTO)
router.post('/mode', authMiddleware, (req, res) => {
    const { mode } = req.body;
    engine.setEngineState(mode);
    res.json({ success: true, mode });
});

// Kill Switch for safety
router.post('/kill', authMiddleware, async (req, res) => {
    try {
        engine.setEngineState('PAUSED');
        await cancelAllPositions();
        res.json({ success: true, message: "Engine stopped & Alpaca array liquidated." });
    } catch(e) {
        res.status(500).json({ error: "Failed to kill active portfolio positions" });
    }
});

module.exports = router;
