// ═══════════════════════════════════════════════════════
//  MarketPulse — API Client
//  All HTTP calls to the backend
// ═══════════════════════════════════════════════════════

const API = {
  base: '',

  async get(path) {
    const res = await fetch(this.base + path);
    if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API POST ${path} → ${res.status}`);
    return res.json();
  },

  async put(path, body) {
    const res = await fetch(this.base + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API PUT ${path} → ${res.status}`);
    return res.json();
  },

  async del(path) {
    const res = await fetch(this.base + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API DELETE ${path} → ${res.status}`);
    return res.json();
  },

  // Market
  async getBars(symbol, timeframe = '1D', limit = 200) {
    return this.get(`/api/market/bars/${symbol}?timeframe=${timeframe}&limit=${limit}`);
  },
  async getIndicators(symbol, timeframe = '1D') {
    return this.get(`/api/market/indicators/${symbol}?timeframe=${timeframe}`);
  },
  async getQuotes() {
    return this.get('/api/market/quotes');
  },
  async getNews(tickers = [], limit = 20) {
    const p = tickers.length ? `?tickers=${tickers.join(',')}&limit=${limit}` : `?limit=${limit}`;
    return this.get(`/api/market/news${p}`);
  },
  async getCrypto() {
    return this.get('/api/market/crypto');
  },
  async getClock() {
    return this.get('/api/market/clock');
  },

  // Alpaca
  async getAccount() {
    return this.get('/api/alpaca/account');
  },
  async getPositions() {
    return this.get('/api/alpaca/positions');
  },
  async getOrders(status = 'all', limit = 50) {
    return this.get(`/api/alpaca/orders?status=${status}&limit=${limit}`);
  },
  async submitOrder(params) {
    return this.post('/api/alpaca/orders', params);
  },
  async cancelOrder(id) {
    return this.del(`/api/alpaca/orders/${id}`);
  },
  async closePosition(symbol) {
    return this.del(`/api/alpaca/positions/${symbol}`);
  },
  async closeAllPositions() {
    return this.del('/api/alpaca/positions');
  },
  async getPortfolioHistory(period = '1M') {
    return this.get(`/api/alpaca/portfolio/history?period=${period}`);
  },
  async killSwitch() {
    return this.post('/api/alpaca/killswitch', {});
  },

  // AI
  async getAIStatus() {
    return this.get('/api/ai/status');
  },
  async getAITrades(limit = 100) {
    return this.get(`/api/ai/trades?limit=${limit}`);
  },
  async getAIStats() {
    return this.get('/api/ai/stats');
  },
  async getPending() {
    return this.get('/api/ai/pending');
  },
  async approveDecision(id) {
    return this.post(`/api/ai/approve/${id}`, {});
  },
  async rejectDecision(id) {
    return this.post(`/api/ai/reject/${id}`, {});
  },
  async setAIMode(mode) {
    return this.post('/api/ai/mode', { mode });
  },
  async runAIEngine() {
    return this.post('/api/ai/run', {});
  },
  async setAIWatchlist(symbols) {
    return this.put('/api/ai/watchlist', { symbols });
  },
  async getEquityCurve(days = 30) {
    return this.get(`/api/ai/equity-curve?days=${days}`);
  },

  // Config
  async getConfig() {
    return this.get('/api/config');
  },
  async saveConfig(cfg) {
    return this.post('/api/config', cfg);
  },
};

// ── Formatting helpers ───────────────────────────────────
function fmt(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return '–';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtDollar(n) {
  if (n === null || n === undefined) return '–';
  const v = parseFloat(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '–';
  const v = parseFloat(n);
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updown(val) {
  return parseFloat(val) >= 0 ? 'up' : 'dn';
}

// ── Toast notification ───────────────────────────────────
function toast(msg, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Key management (runtime, no restart needed) ───────────
API.saveKeys = function(payload) {
  return this.post('/api/config/keys', payload);
};
API.switchEnv = function(env, confirmed) {
  return this.post('/api/config/env', { env, confirmed });
};
API.getAIStatus = function() {
  return this.get('/api/ai/status');
};
