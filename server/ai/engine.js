// ═══════════════════════════════════════════════════════
//  MarketPulse — AI Trading Engine
//  Three modes: approval | autonomous | paused
//  Autonomous: market-hours aware, continuous scan,
//  confidence-gated real execution via Alpaca.
// ═══════════════════════════════════════════════════════
const cron       = require('node-cron');
const db         = require('../db');
const indicators = require('../indicators');
const alpaca     = require('../alpaca/client');
const keys       = require('../keys');
const llmManager = require('./llm');
const { getQuoteCache }    = require('../alpaca/stream');
const { getHistoricalBars, getIntradayBars } = require('../market/stream');

let anthropic;
let sseManager;
let engineRunning  = false;
let currentMode;
let cronJob;
let autonomousPoll; // setInterval handle for market-hours continuous scan

// ── Default watchlist ─────────────────────────────────────
const DEFAULT_WATCHLIST = [
  'AAPL','MSFT','NVDA','TSLA','AMZN','META','GOOGL','AMD','JPM','V',
  'SPY','QQQ','IWM','GLD','TLT','XLK','XLF','XLE','ARKK',
  'BTCUSD','ETHUSD','SOLUSD',
];

const CRYPTO_SYMBOLS = new Set(['BTCUSD','ETHUSD','SOLUSD','DOGEUSD']);

// ── LLM client ────────────────────────────────────────────
function getAIClient(userId) {
  return llmManager.getProvider(userId);
}

function reinitAI() {
  // Now created on demand per user, so no-op
}

// ── Market hours check ────────────────────────────────────
function isMarketHours() {
  const now  = new Date();
  const day  = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false; // weekend
  // NYSE: 9:30 AM – 4:00 PM ET = 13:30–20:00 UTC (standard time)
  const hours = now.getUTCHours() * 60 + now.getUTCMinutes();
  return hours >= 810 && hours < 1200; // 13:30–20:00 UTC
}

function isCryptoSymbol(sym) { return CRYPTO_SYMBOLS.has(sym); }

// ── Start Engine ──────────────────────────────────────────
function startAIEngine(sse) {
  sseManager = sse;

  // Clear any existing schedulers
  if (cronJob)        { cronJob.stop(); cronJob = null; }
  if (autonomousPoll) { clearInterval(autonomousPoll); autonomousPoll = null; }

  // We now run a single global loop every 1 minute.
  // Each user's interval is checked inside the loop or we just run every minute.
  // To keep it simple, we run the cycle every minute and analyze active users.
  console.log(`🤖 AI engine: Global loop started (1m intervals)`);
  cronJob = cron.schedule('* * * * *', async () => {
    if (engineRunning) return;
    engineRunning = true;
    try { await runGlobalAnalysisCycle(); }
    catch (e) { console.error('Global cycle error:', e.message); }
    finally { engineRunning = false; }
  });

  // Run immediately
  setTimeout(async () => {
    if (!engineRunning) {
      engineRunning = true;
      try { await runGlobalAnalysisCycle(); } finally { engineRunning = false; }
    }
  }, 3000);
}

// ── Main Analysis Cycle ───────────────────────────────────
async function runGlobalAnalysisCycle() {
  const users = db.getActiveUsers();
  for (const user of users) {
    const mode = db.getUserConfig(user.id, 'ai_mode') || 'paused';
    if (mode === 'paused') continue;

    // TODO: rate limiting logic per user interval if needed
    // For now we run every minute for active users to ensure crypto scanning
    await runUserAnalysisCycle(user.id, mode);
  }
}

async function runUserAnalysisCycle(userId, mode) {
  const client = getAIClient(userId);
  if (!client) return;

  // Check daily loss limit before running
  const account = await alpaca.getAccount(userId);
  if (account) {
    const equity    = parseFloat(account.equity);
    const lastClose = parseFloat(account.last_equity || account.equity);
    if (lastClose > 0) {
      const dayLossPct = (equity - lastClose) / lastClose;
      const maxLoss    = parseFloat(db.getUserConfig(userId, 'max_daily_loss') || '0.02');
      if (dayLossPct < -maxLoss) {
        console.warn(`🛑 User ${userId} daily loss limit reached — paused`);
        return;
      }
    }
  }

  const positions = await alpaca.getPositions(userId);
  const watchlist = JSON.parse(db.getUserConfig(userId, 'ai_watchlist') || JSON.stringify(DEFAULT_WATCHLIST));

  const toAnalyze = watchlist.filter(sym => {
    if (isCryptoSymbol(sym)) return true;
    return isMarketHours();
  });

  if (toAnalyze.length === 0) {
    const crypto = watchlist.filter(isCryptoSymbol);
    for (const sym of crypto) {
      try { await analyzeSymbol(userId, mode, sym, account, positions, client); await sleep(2000); } catch {}
    }
    return;
  }

  for (const symbol of toAnalyze) {
    try {
      await analyzeSymbol(userId, mode, symbol, account, positions, client);
      await sleep(1500);
    } catch (e) {
      console.error(`Analysis error ${symbol} user ${userId}:`, e.message);
    }
  }

  if (account) {
    db.snapshotEquity({
      user_id:   userId,
      equity:    parseFloat(account.equity),
      cash:      parseFloat(account.cash),
      pnl_day:   parseFloat(account.equity) - parseFloat(account.last_equity || account.equity),
      pnl_total: 0,
    });
  }
}

// ── Analyze a single symbol ───────────────────────────────
async function analyzeSymbol(userId, mode, symbol, account, positions, client) {
  broadcast_thinking(symbol, 'data', `Fetching data for ${symbol}...`);

  const bars = await getHistoricalBars(symbol, 'day', 1, null, null, 100);
  if (!bars || bars.length < 20) return;

  const quotes    = getQuoteCache();
  const lastQuote = quotes[symbol];
  const price     = lastQuote?.price || bars[bars.length - 1].close;

  broadcast_thinking(symbol, 'indicators', 'Computing indicators...');
  const ind = indicators.computeAll(bars);
  if (!ind) return;

  const currentPosition = positions?.find(p => p.symbol === symbol);
  const recentTrades    = db.getRecentTrades(userId, 20).filter(t => t.symbol === symbol && t.pnl !== null);
  const winRate         = recentTrades.length > 0
    ? (recentTrades.filter(t => t.pnl > 0).length / recentTrades.length * 100).toFixed(1)
    : 'N/A';

  const news = db.getRecentNews(5).filter(n => {
    try { return JSON.parse(n.tickers || '[]').includes(symbol); } catch { return false; }
  });

  broadcast_thinking(symbol, 'reasoning', 'Claude is analyzing...');

  const prompt = buildPrompt({ symbol, price, bars, ind, account, currentPosition, winRate, news });

  let decision;
  try {
    const responseText = await client.analyze(buildSystemPrompt(userId), prompt);
    decision = parseDecision(responseText, symbol, ind, price);
    if (!decision) throw new Error('Unparseable AI response');
  } catch (e) {
    console.error(`Claude API error ${symbol}:`, e.message);
    broadcast_thinking(symbol, 'error', `API error: ${e.message}`);
    return;
  }

  broadcast_thinking(symbol, 'decision',
    `→ ${decision.action} (${decision.confidence}% confidence)`);

  // Log to DB
  const row = db.insertTrade({
    user_id:     userId,
    symbol,
    action:      decision.action,
    qty:         decision.qty,
    price,
    confidence:  decision.confidence,
    reasoning:   decision.reasoning,
    indicators:  ind,
    regime:      ind.regime?.regime,
    order_id:    null,
    status:      'pending',
    approved_by: 'AI_AUTO', // Always autonomous now
  });
  const tradeId       = row.lastInsertRowid;
  decision.id         = tradeId;
  decision.tradeId    = tradeId;

  if (sseManager) sseManager.aiDecision({ ...decision, id: tradeId });

  // Skip HOLD/SKIP
  if (decision.action === 'HOLD' || decision.action === 'SKIP') {
    db.updateTradeStatus(tradeId, 'skipped', null, null);
    return;
  }

  // Confidence gate
  const minConf = parseInt(db.getUserConfig(userId, 'min_confidence') || '70');
  if (decision.confidence < minConf) {
    db.updateTradeStatus(tradeId, 'skipped', null, null);
    broadcast_thinking(symbol, 'skip',
      `Skipped — confidence ${decision.confidence}% below threshold ${minConf}%`);
    return;
  }

  // Pure autonomous execution
  await executeDecision(userId, decision, tradeId, account);
}

// ── Real Order Execution ──────────────────────────────────
async function executeDecision(userId, decision, tradeId, account) {
  if (!account) {
    console.error('Cannot execute — no account data (Alpaca key missing?)');
    db.updateTradeStatus(tradeId, 'failed', null, null);
    if (sseManager) sseManager.systemAlert('error',
      'Execution failed — add Alpaca API key in Settings');
    return;
  }

  // Risk: position sizing
  const equity    = parseFloat(account.equity);
  const maxPct    = parseFloat(db.getUserConfig(userId, 'max_position_size') || '0.05');
  const maxDollar = equity * maxPct;
  const price     = decision.price;
  const maxQty    = Math.floor(maxDollar / Math.max(price, 0.01));
  const qty       = Math.min(decision.qty || 1, Math.max(maxQty, 1));

  // Check buying power
  const buyingPower = parseFloat(account.buying_power || account.cash);
  if (decision.action === 'BUY' && price * qty > buyingPower) {
    const affordableQty = Math.floor(buyingPower / price);
    if (affordableQty <= 0) {
      broadcast_thinking(decision.symbol, 'skip', 'Skipped — insufficient buying power');
      db.updateTradeStatus(tradeId, 'skipped', null, null);
      return;
    }
  }

  try {
    const order = await alpaca.submitOrder(userId, {
      symbol:      decision.symbol,
      qty,
      side:        decision.action === 'BUY' ? 'buy' : 'sell',
      type:        'market',
      stopLoss:    decision.stopLoss,
      takeProfit:  decision.takeProfit,
    });

    db.updateTradeStatus(tradeId, 'submitted', order.id, null);
    if (sseManager) sseManager.orderUpdate({ ...order, tradeId, aiGenerated: true });

    const env = alpaca.getEnv(userId);
    const msg = `[${env.toUpperCase()}] ${decision.action} ${qty} ${decision.symbol} submitted`;
    console.log('✅', msg);
    broadcast_thinking(decision.symbol, 'executed', msg);

  } catch (e) {
    console.error('Order execution failed:', e.message);
    db.updateTradeStatus(tradeId, 'failed', null, null);
    if (sseManager) sseManager.systemAlert('error',
      `Order failed: ${decision.symbol} — ${e.message}`);
  }
}


function buildSystemPrompt(userId) {
  const env = alpaca.getEnv(userId);
  return `You are MarketPulse AI — a disciplined quantitative trader.
Account type: ${env === 'live' ? '⚠️ LIVE MONEY — be conservative' : 'Paper trading — test strategies'}.
Assets: US Equities, ETFs, Crypto (BTCUSD/ETHUSD/SOLUSD). NO options.

RULES:
- Only trade with clear edge. SKIP when uncertain.
- Regime: favour longs in BULL, cash in BEAR, avoid new positions in TRANSITION.
- RSI>70=overbought, RSI<30=oversold.
- MACD histogram crossing zero = signal (confirm with EMA trend).
- Crypto: smaller size, wider stops (2x ATR), always use gtc.
- Equities: bracket orders with 1-2x ATR stop, 2-3x risk for take profit.
- ${env === 'live' ? 'LIVE MODE: be extra conservative, confidence must be 80+ to act.' : 'Paper mode: test strategies, be moderately aggressive.'}

Respond ONLY with valid JSON:
{
  "action": "BUY"|"SELL"|"HOLD"|"SKIP",
  "qty": <integer>,
  "confidence": <0-100>,
  "reasoning": "<2-3 sentences>",
  "stopLoss": <number|null>,
  "takeProfit": <number|null>,
  "keySignals": ["signal1","signal2","signal3"],
  "assetClass": "equity"|"etf"|"crypto"
}`;
}

function buildPrompt({ symbol, price, bars, ind, account, currentPosition, winRate, news }) {
  const last5 = bars.slice(-5).map(b =>
    `  ${b.timestamp?.split('T')[0]}: O=${b.open?.toFixed(2)} H=${b.high?.toFixed(2)} L=${b.low?.toFixed(2)} C=${b.close?.toFixed(2)} V=${b.volume ? (b.volume/1e6).toFixed(1)+'M' : 'N/A'}`
  ).join('\n');

  const acctStr = account
    ? `Equity: $${parseFloat(account.equity).toFixed(2)} | Cash: $${parseFloat(account.cash).toFixed(2)} | Buying Power: $${parseFloat(account.buying_power||account.cash).toFixed(2)}`
    : 'Account: unavailable';

  const posStr = currentPosition
    ? `HOLDING: ${currentPosition.qty} @ $${parseFloat(currentPosition.avg_entry_price).toFixed(2)} | Unrealized P&L: $${parseFloat(currentPosition.unrealized_pl).toFixed(2)} (${(parseFloat(currentPosition.unrealized_plpc)*100).toFixed(2)}%)`
    : 'NO POSITION';

  const newsStr = news.length
    ? news.map(n => `  [${(n.sentiment||'neutral').toUpperCase()}] ${n.headline}`).join('\n')
    : '  No recent news';

  return `SYMBOL: ${symbol} | PRICE: $${price?.toFixed(2)}
${acctStr}
${posStr}

INDICATORS:
  RSI(14): ${ind.rsi?.toFixed(2)??'N/A'} | MACD Hist: ${ind.macd?.histogram?.toFixed(4)??'N/A'}
  EMA20: $${ind.ema20?.toFixed(2)??'N/A'} | EMA50: $${ind.ema50?.toFixed(2)??'N/A'}
  BB: $${ind.bb?.lower?.toFixed(2)??'N/A'} – $${ind.bb?.upper?.toFixed(2)??'N/A'} | %B: ${ind.bb?.pctB?.toFixed(3)??'N/A'}
  ATR: ${ind.atr?.toFixed(3)??'N/A'} | ADX: ${ind.adx?.toFixed(2)??'N/A'} | VWAP: $${ind.vwap?.toFixed(2)??'N/A'}

REGIME: ${ind.regime?.regime} (${ind.regime?.confidence}% confidence)
Signals: ${ind.regime?.signals?.join(', ')||'none'}

LAST 5 BARS:
${last5}

NEWS:
${newsStr}

AI WIN RATE on ${symbol}: ${winRate}%

Decision?`;
}

// ── Parse Claude JSON ─────────────────────────────────────
function parseDecision(text, symbol, ind, price) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found');
    const d = JSON.parse(match[0]);
    return {
      symbol,
      action:     ['BUY','SELL','HOLD','SKIP'].includes(d.action) ? d.action : 'SKIP',
      qty:        Math.max(1, parseInt(d.qty) || 1),
      confidence: Math.min(100, Math.max(0, parseInt(d.confidence) || 0)),
      reasoning:  d.reasoning || '',
      stopLoss:   d.stopLoss  || null,
      takeProfit: d.takeProfit || null,
      keySignals: Array.isArray(d.keySignals) ? d.keySignals : [],
      assetClass: d.assetClass || 'equity',
      price,
      regime:     ind.regime?.regime,
    };
  } catch {
    return { symbol, action: 'SKIP', qty: 0, confidence: 0, reasoning: 'Parse error', price };
  }
}

function broadcast_thinking(symbol, step, content) {
  if (sseManager) sseManager.aiThinking(symbol, step, content);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Public controls ───────────────────────────────────────
function setMode(userId, mode) {
  db.setUserConfig(userId, 'ai_mode', mode);
  console.log(`🤖 AI mode [User ${userId}] → ${mode.toUpperCase()}`);
}

function getMode(userId) { return db.getUserConfig(userId, 'ai_mode') || 'paused'; }

function setWatchlist(userId, symbols) {
  db.setUserConfig(userId, 'ai_watchlist', JSON.stringify(symbols));
}

function getWatchlist(userId) {
  return JSON.parse(db.getUserConfig(userId, 'ai_watchlist') || JSON.stringify(DEFAULT_WATCHLIST));
}

async function runNow(userId) {
  const mode = getMode(userId);
  setImmediate(async () => {
    try { await runUserAnalysisCycle(userId, mode); }
    catch (e) { console.error('Manual run error:', e.message); }
  });
  return { success: true, message: 'Scan started' };
}

function getStatus(userId) {
  return {
    mode:        getMode(userId),
    running:     engineRunning,
    marketOpen:  isMarketHours(),
    env:         alpaca.getEnv(userId),
    watchlist:   getWatchlist(userId),
    pending:     0, // No pending decisions in autonomous mode
  };
}

module.exports = {
  startAIEngine, reinitAI,
  setMode, getMode, getStatus,
  setWatchlist, getWatchlist,
  runNow,
};
