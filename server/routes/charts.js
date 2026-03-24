const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../auth');
const { getYahooAggs } = require('../data/yahoo');
const { calculateEMA, calculateRSI } = require('../indicators');
const { generateResponse } = require('../ai/llm');

// Retrieve historical data and indicator bundles for the Charting UI
router.get('/data/:ticker', authMiddleware, async (req, res) => {
    const { ticker } = req.params;
    const { timeframe = '1D' } = req.query; // 1m, 15m, 1h, 1D
    
    // Yahoo Finance intervals
    let interval = '1d', range = '3mo';
    if (timeframe === '1m') { interval = '1m'; range = '5d'; }
    if (timeframe === '15m') { interval = '15m'; range = '1mo'; }
    if (timeframe === '1h') { interval = '60m'; range = '3mo'; }

    try {
        const bars = await getYahooAggs(ticker, interval, range);
        
        if (!bars || bars.length === 0) {
            return res.json({ bars: [], indicators: {}, error: "No chart data available for this timeline." });
        }

        const closes = bars.map(b => b.close);
        
        const indicators = {
            ema20: calculateEMA(closes, 20),
            rsi14: calculateRSI(closes, 14)
        };

        // LLM Commentary Strip Context
        const latestRsi = indicators.rsi14[indicators.rsi14.length - 1];
        const latestPrice = closes[closes.length - 1];
        const latestEma = indicators.ema20[indicators.ema20.length - 1];
        
        const prompt = `You are a high-speed market technician. Provide a very concise 2-sentence technical read on ${ticker.toUpperCase()} on the ${timeframe} timeframe. Price is $${latestPrice}. RSI(14) is ${latestRsi?.toFixed(2)}. EMA(20) is ${latestEma?.toFixed(2)}. Give the verdict fast.`;
        
        // Spawn asynchronous LLM call (Flash)
        const commentary = await generateResponse(prompt, 'flash').catch(() => "AI Analysis offline.");

        res.json({
            bars,
            indicators,
            commentary
        });

    } catch (err) {
        console.error("Chart data error:", err);
        res.status(500).json({ error: "Failed to fetch chart datasets" });
    }
});

module.exports = router;
