// ═══════════════════════════════════════════════════════
//  MarketPulse — Runtime Key Manager
//  Stores API keys in SQLite and applies them at runtime.
//  No server restart needed. Keys never hit the filesystem.
// ═══════════════════════════════════════════════════════
const db = require('./db');

// In-memory cache of active keys (populated from DB on load)
let _keys = {};

function loadKeys() {
  _keys = {
    alpacaKey:     db.getConfig('alpaca_key', process.env.ALPACA_API_KEY || ''),
    alpacaSecret:  db.getConfig('alpaca_secret', process.env.ALPACA_SECRET_KEY || ''),
    alpacaEnv:     db.getConfig('alpaca_env', 'paper'), // 'paper' | 'live'
    anthropicKey:  db.getConfig('anthropic_key', process.env.ANTHROPIC_API_KEY || ''),
    polygonKey:    db.getConfig('polygon_key', process.env.POLYGON_API_KEY || ''),
  };
  return _keys;
}

function getKeys() {
  if (!Object.keys(_keys).length) loadKeys();
  return _keys;
}

function setKeys(updates) {
  // Persist each provided key to DB
  const allowed = ['alpacaKey', 'alpacaSecret', 'alpacaEnv', 'anthropicKey', 'polygonKey'];
  for (const key of allowed) {
    if (updates[key] !== undefined && updates[key] !== null) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
      db.setConfig(dbKey, updates[key]);
      _keys[key] = updates[key];
    }
  }
  return _keys;
}

function getAlpacaBaseUrl() {
  const env = _keys.alpacaEnv || db.getConfig('alpaca_env', 'paper');
  return env === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets';
}

function isConfigured() {
  const k = getKeys();
  return {
    alpaca:    !!(k.alpacaKey && k.alpacaSecret),
    anthropic: !!k.anthropicKey,
    polygon:   !!k.polygonKey,
    alpacaEnv: k.alpacaEnv || 'paper',
  };
}

// Call this on server start
loadKeys();

module.exports = { getKeys, setKeys, loadKeys, getAlpacaBaseUrl, isConfigured };
