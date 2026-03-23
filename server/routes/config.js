const express = require('express');
const router  = express.Router();
const db      = require('../db');
const keys    = require('../keys');

router.get('/', (req, res) => {
  const configured = keys.isConfigured();
  res.json({
    ai_mode:           db.getConfig('ai_mode', 'approval'),
    ai_interval:       db.getConfig('ai_interval', '5'),
    max_position_size: db.getConfig('max_position_size', '0.05'),
    max_daily_loss:    db.getConfig('max_daily_loss', '0.02'),
    min_confidence:    db.getConfig('min_confidence', '70'),
    alpaca_env:        configured.alpacaEnv,
    has_alpaca_key:    configured.alpaca,
    has_anthropic_key: configured.anthropic,
    has_polygon_key:   configured.polygon,
  });
});

// Save API keys at runtime — no restart needed
router.post('/keys', async (req, res) => {
  try {
    const { alpacaKey, alpacaSecret, alpacaEnv, anthropicKey, polygonKey, liveConfirmed } = req.body;

    if (alpacaEnv === 'live' && !liveConfirmed) {
      return res.status(400).json({ error: 'Live trading requires liveConfirmed: true' });
    }

    const updates = {};
    if (alpacaKey?.trim())    updates.alpacaKey    = alpacaKey.trim();
    if (alpacaSecret?.trim()) updates.alpacaSecret  = alpacaSecret.trim();
    if (alpacaEnv)            updates.alpacaEnv     = alpacaEnv;
    if (anthropicKey?.trim()) updates.anthropicKey  = anthropicKey.trim();
    if (polygonKey?.trim())   updates.polygonKey    = polygonKey.trim();

    keys.setKeys(updates);

    if (updates.alpacaKey || updates.alpacaSecret || updates.alpacaEnv) {
      try { const { reinitStream } = require('../alpaca/stream'); await reinitStream(require('../sse')); } catch {}
    }
    if (updates.anthropicKey) {
      try { require('../ai/engine').reinitAI(); } catch {}
    }

    if (alpacaEnv === 'live') console.warn('⚠️  LIVE TRADING ACTIVATED');

    res.json({ success: true, configured: keys.isConfigured() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Instant paper/live switch
router.post('/env', async (req, res) => {
  const { env, confirmed } = req.body;
  if (!['paper', 'live'].includes(env)) return res.status(400).json({ error: 'Invalid env' });
  if (env === 'live' && !confirmed) return res.status(400).json({ error: 'Must confirm with confirmed: true' });
  keys.setKeys({ alpacaEnv: env });
  try { const { reinitStream } = require('../alpaca/stream'); await reinitStream(require('../sse')); } catch {}
  console.log(`🔄 Switched to ${env.toUpperCase()} trading`);
  res.json({ success: true, env, configured: keys.isConfigured() });
});

// Trading config (intervals, risk, mode)
router.post('/', (req, res) => {
  const allowed = ['ai_mode','ai_interval','max_position_size','max_daily_loss','min_confidence'];
  const updated = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) { db.setConfig(k, String(req.body[k])); updated[k] = req.body[k]; }
  }
  if (updated.ai_interval) {
    try { require('../ai/engine').startAIEngine(require('../sse')); } catch {}
  }
  res.json({ success: true, updated });
});

module.exports = router;
