// ═══════════════════════════════════════════════════════
//  MarketPulse — Database (SQLite via better-sqlite3)
// ═══════════════════════════════════════════════════════
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/marketpulse.db');
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema ──────────────────────────────────────────────
  db.exec(`
    -- AI Trade Journal
    CREATE TABLE IF NOT EXISTS trade_journal (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
      symbol      TEXT    NOT NULL,
      action      TEXT    NOT NULL,  -- BUY | SELL | HOLD | SKIP
      qty         REAL,
      price       REAL,
      confidence  INTEGER,
      reasoning   TEXT,
      indicators  TEXT,              -- JSON blob
      regime      TEXT,
      order_id    TEXT,              -- Alpaca order ID if executed
      status      TEXT    DEFAULT 'pending', -- pending|approved|rejected|filled|failed
      pnl         REAL,              -- filled in when position closes
      approved_by TEXT    DEFAULT 'AI'
    );

    -- Price Bar Cache (for indicator calculation)
    CREATE TABLE IF NOT EXISTS price_bars (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT    NOT NULL,
      timeframe  TEXT    NOT NULL,
      timestamp  TEXT    NOT NULL,
      open       REAL,
      high       REAL,
      low        REAL,
      close      REAL,
      volume     REAL,
      UNIQUE(symbol, timeframe, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_bars ON price_bars(symbol, timeframe, timestamp DESC);

    -- News Cache
    CREATE TABLE IF NOT EXISTS news_cache (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT    NOT NULL DEFAULT (datetime('now')),
      headline   TEXT    NOT NULL,
      summary    TEXT,
      source     TEXT,
      url        TEXT,
      tickers    TEXT,               -- JSON array
      sentiment  TEXT                -- positive|negative|neutral
    );

    -- Config Store
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Performance Snapshots (equity curve)
    CREATE TABLE IF NOT EXISTS equity_snapshots (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      equity    REAL,
      cash      REAL,
      pnl_day   REAL,
      pnl_total REAL
    );
  `);

  console.log('✅ Database initialized');
  return db;
}

function get() {
  if (!db) throw new Error('DB not initialized. Call db.init() first.');
  return db;
}

// ── Trade Journal ────────────────────────────────────────
function insertTrade(trade) {
  const stmt = get().prepare(`
    INSERT INTO trade_journal
      (symbol, action, qty, price, confidence, reasoning, indicators, regime, order_id, status, approved_by)
    VALUES
      (@symbol, @action, @qty, @price, @confidence, @reasoning, @indicators, @regime, @order_id, @status, @approved_by)
  `);
  return stmt.run({
    ...trade,
    indicators: JSON.stringify(trade.indicators || {}),
  });
}

function updateTradeStatus(id, status, orderId, pnl) {
  get().prepare(`
    UPDATE trade_journal SET status=?, order_id=?, pnl=? WHERE id=?
  `).run(status, orderId, pnl ?? null, id);
}

function getRecentTrades(limit = 50) {
  return get().prepare(`
    SELECT * FROM trade_journal ORDER BY timestamp DESC LIMIT ?
  `).all(limit);
}

function getTradeStats() {
  return get().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
      SUM(pnl) as total_pnl,
      AVG(pnl) as avg_pnl,
      MAX(pnl) as best_trade,
      MIN(pnl) as worst_trade
    FROM trade_journal
    WHERE status = 'filled' AND pnl IS NOT NULL
  `).get();
}

// ── Price Bars ───────────────────────────────────────────
function upsertBars(symbol, timeframe, bars) {
  const stmt = get().prepare(`
    INSERT OR REPLACE INTO price_bars (symbol, timeframe, timestamp, open, high, low, close, volume)
    VALUES (@symbol, @timeframe, @timestamp, @open, @high, @low, @close, @volume)
  `);
  const insert = get().transaction((bars) => {
    for (const bar of bars) stmt.run({ symbol, timeframe, ...bar });
  });
  insert(bars);
}

function getBars(symbol, timeframe, limit = 200) {
  return get().prepare(`
    SELECT * FROM price_bars
    WHERE symbol=? AND timeframe=?
    ORDER BY timestamp DESC LIMIT ?
  `).all(symbol, timeframe, limit).reverse();
}

// ── Config ───────────────────────────────────────────────
function getConfig(key, defaultVal = null) {
  const row = get().prepare('SELECT value FROM config WHERE key=?').get(key);
  return row ? row.value : defaultVal;
}

function setConfig(key, value) {
  get().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

// ── Equity Snapshots ─────────────────────────────────────
function snapshotEquity(data) {
  get().prepare(`
    INSERT INTO equity_snapshots (equity, cash, pnl_day, pnl_total)
    VALUES (@equity, @cash, @pnl_day, @pnl_total)
  `).run(data);
}

function getEquityCurve(days = 30) {
  return get().prepare(`
    SELECT * FROM equity_snapshots
    WHERE timestamp >= datetime('now', ? || ' days')
    ORDER BY timestamp ASC
  `).all(`-${days}`);
}

// ── News ─────────────────────────────────────────────────
function insertNews(article) {
  get().prepare(`
    INSERT OR IGNORE INTO news_cache (timestamp, headline, summary, source, url, tickers, sentiment)
    VALUES (@timestamp, @headline, @summary, @source, @url, @tickers, @sentiment)
  `).run({ ...article, tickers: JSON.stringify(article.tickers || []) });
}

function getRecentNews(limit = 20) {
  return get().prepare(`
    SELECT * FROM news_cache ORDER BY timestamp DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  init, get,
  insertTrade, updateTradeStatus, getRecentTrades, getTradeStats,
  upsertBars, getBars,
  getConfig, setConfig,
  snapshotEquity, getEquityCurve,
  insertNews, getRecentNews,
};
