const express = require('express');
const router  = express.Router();
const db      = require('../db');
const keys    = require('../keys');

router.get('/', (req, res) => {
  const configured = keys.isConfigured(req.user.id);
  res.json({
    ai_mode:           db.getUserConfig(req.user.id, 'ai_mode', 'approval'),
    ai_interval:       db.getUserConfig(req.user.id, 'ai_interval', '5'),
    max_position_size: db.getUserConfig(req.user.id, 'max_position_size', '0.05'),
    max_daily_loss:    db.getUserConfig(req.user.id, 'max_daily_loss', '0.02'),
    min_confidence:    db.getUserConfig(req.user.id, 'min_confidence', '70'),
    alpaca_env:        configured.alpacaEnv,
    has_alpaca_key:    configured.alpaca,
    has_anthropic_key: configured.anthropic,
    has_gemini_key:    configured.gemini,
    has_polygon_key:   configured.polygon,
    llm_provider:      configured.llmProvider,
  });
});

// Save API keys at runtime — no restart needed
router.post('/keys', async (req, res) => {
  try {
    const { alpacaKey, alpacaSecret, alpacaEnv, anthropicKey, geminiKey, polygonKey, llmProvider, liveConfirmed } = req.body;

    if (alpacaEnv === 'live' && !liveConfirmed) {
      return res.status(400).json({ error: 'Live trading requires liveConfirmed: true' });
    }

    const updates = {};
    if (alpacaKey?.trim())    updates.alpacaKey    = alpacaKey.trim();
    if (alpacaSecret?.trim()) updates.alpacaSecret  = alpacaSecret.trim();
    if (alpacaEnv)            updates.alpacaEnv     = alpacaEnv;
    if (anthropicKey?.trim()) updates.anthropicKey  = anthropicKey.trim();
    if (geminiKey?.trim())    updates.geminiKey     = geminiKey.trim();
    if (polygonKey?.trim())   updates.polygonKey    = polygonKey.trim();
    if (llmProvider)          updates.llmProvider   = llmProvider;

    keys.setKeys(req.user.id, updates);

    if (updates.alpacaKey || updates.alpacaSecret || updates.alpacaEnv) {
      try { const { reinitStream } = require('../alpaca/stream'); await reinitStream(require('../sse')); } catch {}
    }

    if (alpacaEnv === 'live') console.warn('⚠️  LIVE TRADING ACTIVATED');

    res.json({ success: true, configured: keys.isConfigured(req.user.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Instant paper/live switch
router.post('/env', async (req, res) => {
  const { env, confirmed } = req.body;
  if (!['paper', 'live'].includes(env)) return res.status(400).json({ error: 'Invalid env' });
  if (env === 'live' && !confirmed) return res.status(400).json({ error: 'Must confirm with confirmed: true' });
  keys.setKeys(req.user.id, { alpacaEnv: env });
  try { const { reinitStream } = require('../alpaca/stream'); await reinitStream(require('../sse')); } catch {}
  console.log(`🔄 Switched to ${env.toUpperCase()} trading`);
  res.json({ success: true, env, configured: keys.isConfigured(req.user.id) });
});

// Trading config (intervals, risk, mode)
router.post('/', (req, res) => {
  const allowed = ['ai_mode','ai_interval','max_position_size','max_daily_loss','min_confidence'];
  const updated = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) { db.setUserConfig(req.user.id, k, String(req.body[k])); updated[k] = req.body[k]; }
  }
  // No need to restart engine since engine runs globally now
  res.json({ success: true, updated });
});

module.exports = router;
