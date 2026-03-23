// ═══════════════════════════════════════════════════════
//  MarketPulse — AI Trading Engine
//  Three modes: approval | autonomous | paused
//  Autonomous: market-hours aware, continuous scan,
//  confidence-gated real execution via Alpaca.
// ═══════════════════════════════════════════════════════
const Anthropic  = require('@anthropic-ai/sdk');
const cron       = require('node-cron');
const db         = require('../db');
const indicators = require('../indicators');
const alpaca     = require('../alpaca/client');
const keys       = require('../keys');
const { getQuoteCache }    = require('../alpaca/stream');
const { getHistoricalBars } = require('../market/stream');

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

// ── Pending approvals queue (approval mode) ───────────────
const pendingDecisions = new Map();
function getPendingDecisions() { return [...pendingDecisions.values()]; }

// ── Anthropic client ──────────────────────────────────────
function getAIClient() {
  const k = keys.getKeys();
  if (!k.anthropicKey) return null;
  if (!anthropic) anthropic = new Anthropic({ apiKey: k.anthropicKey });
  return anthropic;
}

function reinitAI() {
  anthropic = null; // force rebuild on next call
  console.log('🤖 Anthropic client reset — will reinit on next analysis');
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
  sseManager   = sse;
  currentMode  = db.getConfig('ai_mode') || 'approval';

  // Clear any existing schedulers
  if (cronJob)        { cronJob.stop(); cronJob = null; }
  if (autonomousPoll) { clearInterval(autonomousPoll); autonomousPoll = null; }

  const intervalMin = parseInt(db.getConfig('ai_interval') || '5');

  if (currentMode === 'paused') {
    console.log('🤖 AI engine: PAUSED');
    return;
  }

  if (currentMode === 'autonomous') {
    // Autonomous: scan every N minutes, but ONLY during market hours (+ always for crypto)
    console.log(`🤖 AI engine: AUTONOMOUS — scanning every ${intervalMin} min`);
    autonomousPoll = setInterval(async () => {
      if (engineRunning) return;
      engineRunning = true;
      try {
        await runAnalysisCycle();
      } catch (e) {
        console.error('Autonomous cycle error:', e.message);
        if (sseManager) sseManager.systemAlert('error', `AI error: ${e.message}`);
      } finally {
        engineRunning = false;
      }
    }, intervalMin * 60 * 1000);

    // Run immediately on start
    setTimeout(async () => {
      if (!engineRunning) {
        engineRunning = true;
        try { await runAnalysisCycle(); } finally { engineRunning = false; }
      }
    }, 3000);

  } else {
    // Approval mode: cron schedule
    const cronExpr = intervalMin === 1 ? '* * * * *' : `*/${intervalMin} * * * *`;
    console.log(`🤖 AI engine: APPROVAL — scanning every ${intervalMin} min`);
    cronJob = cron.schedule(cronExpr, async () => {
      if (engineRunning) return;
      engineRunning = true;
      try { await runAnalysisCycle(); }
      catch (e) { console.error('Approval cycle error:', e.message); }
      finally { engineRunning = false; }
    });
  }
}

// ── Main Analysis Cycle ───────────────────────────────────
async function runAnalysisCycle() {
  const client = getAIClient();
  if (!client) {
    if (sseManager) sseManager.systemAlert('warning',
      'AI engine paused — add Anthropic API key in Settings to activate');
    return;
  }

  // Check daily loss limit before running
  const account = await alpaca.getAccount();
  if (account) {
    const equity    = parseFloat(account.equity);
    const lastClose = parseFloat(account.last_equity || account.equity);
    if (lastClose > 0) {
      const dayLossPct = (equity - lastClose) / lastClose;
      const maxLoss    = parseFloat(db.getConfig('max_daily_loss') || '0.02');
      if (dayLossPct < -maxLoss) {
        const msg = `🛑 Daily loss limit reached (${(dayLossPct*100).toFixed(2)}%) — AI paused for today`;
        console.warn(msg);
        if (sseManager) sseManager.systemAlert('warning', msg);
        return;
      }
    }
  }

  const positions = await alpaca.getPositions();
  const watchlist = JSON.parse(db.getConfig('ai_watchlist') || JSON.stringify(DEFAULT_WATCHLIST));

  // In autonomous mode, only trade equity/ETF symbols during market hours
  // Crypto trades 24/7
  const toAnalyze = watchlist.filter(sym => {
    if (isCryptoSymbol(sym)) return true; // crypto always
    return isMarketHours();               // equities only during hours
  });

  if (toAnalyze.length === 0) {
    if (sseManager) sseManager.broadcast('ai_status', { message: 'Market closed — monitoring crypto only' });
    // Still analyze crypto
    const crypto = watchlist.filter(isCryptoSymbol);
    for (const sym of crypto) {
      try { await analyzeSymbol(sym, account, positions, client); await sleep(2000); } catch {}
    }
    return;
  }

  if (sseManager) sseManager.broadcast('ai_status', {
    message: `Scanning ${toAnalyze.length} symbols...`,
    mode: currentMode,
    marketOpen: isMarketHours(),
  });

  for (const symbol of toAnalyze) {
    try {
      await analyzeSymbol(symbol, account, positions, client);
      await sleep(1500);
    } catch (e) {
      console.error(`Analysis error ${symbol}:`, e.message);
    }
  }

  // Equity snapshot after full cycle
  if (account) {
    db.snapshotEquity({
      equity:    parseFloat(account.equity),
      cash:      parseFloat(account.cash),
      pnl_day:   parseFloat(account.equity) - parseFloat(account.last_equity || account.equity),
      pnl_total: 0,
    });
    if (sseManager) sseManager.accountUpdate(account);
  }
}

// ── Analyze a single symbol ───────────────────────────────
async function analyzeSymbol(symbol, account, positions, client) {
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
  const recentTrades    = db.getRecentTrades(20).filter(t => t.symbol === symbol && t.pnl !== null);
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
    const response = await client.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 800,
      system:     buildSystemPrompt(),
      messages:   [{ role: 'user', content: prompt }],
    });
    decision = parseDecision(response.content[0]?.text || '', symbol, ind, price);
  } catch (e) {
    console.error(`Claude API error ${symbol}:`, e.message);
    broadcast_thinking(symbol, 'error', `API error: ${e.message}`);
    return;
  }

  broadcast_thinking(symbol, 'decision',
    `→ ${decision.action} (${decision.confidence}% confidence)`);

  // Log to DB
  const row = db.insertTrade({
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
    approved_by: currentMode === 'autonomous' ? 'AI_AUTO' : 'pending',
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
  const minConf = parseInt(db.getConfig('min_confidence') || '70');
  if (decision.confidence < minConf) {
    db.updateTradeStatus(tradeId, 'skipped', null, null);
    broadcast_thinking(symbol, 'skip',
      `Skipped — confidence ${decision.confidence}% below threshold ${minConf}%`);
    return;
  }

  // Route based on mode
  if (currentMode === 'autonomous') {
    await executeDecision(decision, tradeId, account);
  } else {
    // Approval mode — surface to user
    pendingDecisions.set(tradeId, { ...decision, id: tradeId, timestamp: new Date().toISOString() });
    if (sseManager) sseManager.broadcast('pending_decision', { decision: { ...decision, id: tradeId } });
  }
}

// ── Real Order Execution ──────────────────────────────────
async function executeDecision(decision, tradeId, account) {
  if (!account) {
    console.error('Cannot execute — no account data (Alpaca key missing?)');
    db.updateTradeStatus(tradeId, 'failed', null, null);
    if (sseManager) sseManager.systemAlert('error',
      'Execution failed — add Alpaca API key in Settings');
    return;
  }

  // Risk: position sizing
  const equity    = parseFloat(account.equity);
  const maxPct    = parseFloat(db.getConfig('max_position_size') || '0.05');
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
    const order = await alpaca.submitOrder({
      symbol:      decision.symbol,
      qty,
      side:        decision.action === 'BUY' ? 'buy' : 'sell',
      type:        'market',
      stopLoss:    decision.stopLoss,
      takeProfit:  decision.takeProfit,
    });

    db.updateTradeStatus(tradeId, 'submitted', order.id, null);
    if (sseManager) sseManager.orderUpdate({ ...order, tradeId, aiGenerated: true });

    const env = alpaca.getEnv();
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

// ── Approve / Reject (approval mode) ─────────────────────
async function approveDecision(tradeId) {
  const decision = pendingDecisions.get(tradeId);
  if (!decision) return { error: 'Decision not found or expired' };
  pendingDecisions.delete(tradeId);

  const account = await alpaca.getAccount();
  await executeDecision(decision, tradeId, account);
  return { success: true };
}

function rejectDecision(tradeId) {
  pendingDecisions.delete(tradeId);
  db.updateTradeStatus(tradeId, 'rejected', null, null);
  return { success: true };
}

// ── Prompt Builder ────────────────────────────────────────
function buildSystemPrompt() {
  const env = alpaca.getEnv();
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
function setMode(mode) {
  currentMode = mode;
  db.setConfig('ai_mode', mode);
  if (sseManager) sseManager.broadcast('ai_mode_change', { mode });
  startAIEngine(sseManager); // restart scheduler with new mode
  console.log(`🤖 AI mode → ${mode.toUpperCase()}`);
}

function getMode() { return currentMode; }

function setWatchlist(symbols) {
  db.setConfig('ai_watchlist', JSON.stringify(symbols));
}

function getWatchlist() {
  return JSON.parse(db.getConfig('ai_watchlist') || JSON.stringify(DEFAULT_WATCHLIST));
}

async function runNow() {
  if (engineRunning) return { error: 'Engine already running' };
  setImmediate(async () => {
    engineRunning = true;
    try { await runAnalysisCycle(); }
    catch (e) { console.error('Manual run error:', e.message); }
    finally { engineRunning = false; }
  });
  return { success: true, message: 'Scan started' };
}

function getStatus() {
  return {
    mode:        currentMode,
    running:     engineRunning,
    marketOpen:  isMarketHours(),
    env:         alpaca.getEnv(),
    watchlist:   getWatchlist(),
    pending:     getPendingDecisions().length,
  };
}

module.exports = {
  startAIEngine, reinitAI,
  setMode, getMode, getStatus,
  setWatchlist, getWatchlist,
  getPendingDecisions, approveDecision, rejectDecision,
  runNow,
};
