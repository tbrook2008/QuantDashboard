require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadKeys } = require('./keys');

const authRoutes = require('./routes/auth');
const marketRoutes = require('./routes/market');
const chartsRoutes = require('./routes/charts');
const portfolioRoutes = require('./routes/portfolio');
const traderRoutes = require('./routes/trader');
const configRoutes = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes Mounted
app.use('/api/auth', authRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/charts', chartsRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/trader', traderRoutes);
app.use('/api/config', configRoutes);

// SPA view fallbacks for manual refreshes
app.get('*', (req, res) => {
    const route = req.path;
    
    if (route.startsWith('/api')) {
        return res.status(404).json({ error: "Endpoint Not Found" });
    }
    
    if (route === '/' || route === '/index.html' || route === '/markets') {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    } else if (route === '/login') {
        res.sendFile(path.join(__dirname, '../public/login.html'));
    } else if (route === '/charts') {
        res.sendFile(path.join(__dirname, '../public/charts.html'));
    } else if (route === '/trader') {
        res.sendFile(path.join(__dirname, '../public/trader.html'));
    } else if (route === '/portfolio') {
        res.sendFile(path.join(__dirname, '../public/portfolio.html'));
    } else if (route === '/settings') {
        res.sendFile(path.join(__dirname, '../public/settings.html'));
    } else {
        res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
    }
});

async function boot() {
    try {
        await loadKeys();
        console.log("Secure API keys context loaded.");
        app.listen(PORT, () => {
            console.log(`[MarketPulse] AI Engine & Dashboard running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("FATAL BOOT ERROR:", err);
        process.exit(1);
    }
}

boot();
