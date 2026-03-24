const express = require('express');
const router = express.Router();
const { isSetupComplete, setupMasterPassword, verifyPassword, generateToken, authMiddleware } = require('../auth');
const { setKey, getAllKeys } = require('../keys');

// Check if app has been setup yet
router.get('/status', async (req, res) => {
    try {
        const setup = await isSetupComplete();
        res.json({ setupComplete: setup });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// Setup master password
router.post('/setup', async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    const alreadySetup = await isSetupComplete();
    if (alreadySetup) {
        return res.status(403).json({ error: "App is already setup" });
    }

    try {
        await setupMasterPassword(password);
        const token = generateToken();
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: "Failed to setup master password" });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: "Password is required" });
    }
    
    try {
        const valid = await verifyPassword(password);
        if (!valid) {
            return res.status(401).json({ error: "Invalid password" });
        }
        const token = generateToken();
        res.json({ success: true, token });
    } catch (err) {
        res.status(500).json({ error: "Login failed" });
    }
});

// Save API Keys (Wizard or Settings page) - Requires Auth
router.post('/keys', authMiddleware, async (req, res) => {
    const keys = req.body; // e.g. { ALPACA_KEY: '...', GEMINI_KEY: '...' }
    try {
        for (const [keyName, keyValue] of Object.entries(keys)) {
            if (keyValue && keyValue.trim() !== '') {
                await setKey(keyName, keyValue.trim());
            }
        }
        res.json({ success: true, message: "Keys saved successfully" });
    } catch (err) {
        res.status(500).json({ error: "Failed to save keys" });
    }
});

// Get configured keys (obfuscated, just boolean flags to show they exist)
router.get('/keys/status', authMiddleware, async (req, res) => {
    try {
        const allKeys = getAllKeys();
        const statusMap = {};
        for (const [k, v] of Object.entries(allKeys)) {
            statusMap[k] = !!v;
        }
        res.json({ keys: statusMap });
    } catch (err) {
        res.status(500).json({ error: "Failed to load keys status" });
    }
});

module.exports = router;
