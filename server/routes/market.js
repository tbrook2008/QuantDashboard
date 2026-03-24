const express = require('express');
const router = express.Router();
const { addClient } = require('../sse');
const { getNews, getTopMovers } = require('../data/polygon');
const { generateResponse } = require('../ai/llm');
const { authMiddleware } = require('../auth');

// Establish SSE connection
router.get('/stream', (req, res) => {
    // Basic token extraction for SSE since JS EventSource doesn't support custom headers easily
    const token = req.query.token;
    if (!token) return res.status(401).end();
    
    addClient(req, res);
});

// Initial dashboard load via REST
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const [newsRaw, movers] = await Promise.all([
            getNews().catch(() => []),
            getTopMovers().catch(() => [])
        ]);

        // Kick off parallel LLM tasks for rapid sentiment scoring using lightweight 'flash' models
        const mappedNews = await Promise.all((newsRaw || []).slice(0, 8).map(async article => {
            try {
                const prompt = `Classify the sentiment of this financial headline as EXACTLY ONE WORD (BULLISH, BEARISH, or NEUTRAL):\nHeadline: ${article.title}\nSummary: ${article.description || ''}`;
                
                // Spawn the specific 'flash' tier agent thread
                const sentiment = await generateResponse(prompt, 'flash');
                
                return { 
                    ...article, 
                    aiSentiment: sentiment.trim().toUpperCase().replace(/[^A-Z]/g, '') 
                };
            } catch (e) {
                return { ...article, aiSentiment: "NEUTRAL" };
            }
        }));

        res.json({ news: mappedNews, movers });
    } catch (err) {
        console.error("Dashboard endpoint error:", err);
        res.status(500).json({ error: "Failed to load dashboard capabilities" });
    }
});

module.exports = router;
