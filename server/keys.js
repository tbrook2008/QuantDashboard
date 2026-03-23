// ═══════════════════════════════════════════════════════
//  MarketPulse — Runtime Key Manager
//  Stores API keys in SQLite and applies them at runtime.
//  No server restart needed. Keys never hit the filesystem.
// ═══════════════════════════════════════════════════════
const db = require('./db');

// In-memory cache of active keys per user (populated from DB on load)
const _userKeys = new Map();

function loadKeys(userId) {
  if (!userId) return {};
  const keys = {
    alpacaKey:     db.getUserConfig(userId, 'alpaca_key', process.env.ALPACA_API_KEY || ''),
    alpacaSecret:  db.getUserConfig(userId, 'alpaca_secret', process.env.ALPACA_SECRET_KEY || ''),
    alpacaEnv:     db.getUserConfig(userId, 'alpaca_env', 'paper'), // 'paper' | 'live'
    anthropicKey:  db.getUserConfig(userId, 'anthropic_key', process.env.ANTHROPIC_API_KEY || ''),
    polygonKey:    db.getUserConfig(userId, 'polygon_key', process.env.POLYGON_API_KEY || ''),
    llmProvider:   db.getUserConfig(userId, 'llm_provider', 'anthropic'),
    geminiKey:     db.getUserConfig(userId, 'gemini_key', process.env.GEMINI_API_KEY || ''),
  };
  _userKeys.set(userId, keys);
  return keys;
}

function getKeys(userId) {
  if (!userId) return {};
  if (!_userKeys.has(userId)) return loadKeys(userId);
  return _userKeys.get(userId);
}

function setKeys(userId, updates) {
  if (!userId) throw new Error('userId required');
  // Persist each provided key to DB
  const allowed = ['alpacaKey', 'alpacaSecret', 'alpacaEnv', 'anthropicKey', 'polygonKey', 'llmProvider', 'geminiKey'];
  
  const currentKeys = getKeys(userId);
  for (const key of allowed) {
    if (updates[key] !== undefined && updates[key] !== null) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
      db.setUserConfig(userId, dbKey, updates[key]);
      currentKeys[key] = updates[key];
    }
  }
  _userKeys.set(userId, currentKeys);
  return currentKeys;
}

function getAlpacaBaseUrl(userId) {
  const env = getKeys(userId).alpacaEnv || 'paper';
  return env === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
}

function isConfigured(userId) {
  const k = getKeys(userId);
  return {
    alpaca:    !!(k.alpacaKey && k.alpacaSecret),
    anthropic: !!k.anthropicKey,
    gemini:    !!k.geminiKey,
    polygon:   !!k.polygonKey,
    alpacaEnv: k.alpacaEnv || 'paper',
    llmProvider: k.llmProvider || 'anthropic',
  };
}

module.exports = { getKeys, setKeys, loadKeys, getAlpacaBaseUrl, isConfigured };
