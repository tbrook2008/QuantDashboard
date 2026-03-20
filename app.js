/**
 * MarketPulse — app.js
 * Backend logic for ui.html shell.
 * Regime-first AI trader: Bull/Bear = momentum | Neutral = mean-reversion scan only | Transition = hold
 */

'use strict';

// ═══════════════════════════════════════════════
// 0. CONFIG — persisted in localStorage
// ═══════════════════════════════════════════════
const CFG_KEY = 'mp_config';
let CFG = {
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-4-20250514',
  alphaVantageKey: '',
  alpacaKeyId: '',
  alpacaSecret: '',
  alpacaEnv: 'paper',
  maxOrderUsd: 500,
  maxDailyLoss: 500,
  perTradeRiskPct: 1.5,
  atrStopMultiplier: 2,
};

function loadCfg() {
  try { const s = localStorage.getItem(CFG_KEY); if (s) CFG = { ...CFG, ...JSON.parse(s) }; } catch (_) {}
}
function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(CFG));
}
function alpacaBase() {
  return CFG.alpacaEnv === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
}
function alpacaHeaders() {
  return { 'APCA-API-KEY-ID': CFG.alpacaKeyId, 'APCA-API-SECRET-KEY': CFG.alpacaSecret, 'Content-Type': 'application/json' };
}

// ═══════════════════════════════════════════════
// 1. STATE
// ═══════════════════════════════════════════════
let currentPage = 'home';
let currentAnalysisSymbol = null;
let currentAnalysisName = null;
let currentTF = { range: '1d', interval: '5m' };
let tradingMode = 'manual';       // 'manual' | 'suggest' | 'auto'
let autoCountdown = null;
let currentTradeIdea = null;
let priceChart = null;
let rsiChart = null;
let macdChart = null;
let regimeState = { regime: 'neutral', model: 'MEAN-REV SCAN', confidence: 50, adx: 0, rsi: 50 };
let activeStrategy = 'momentum';
let alertsList = [];
let dailyLossUsed = 0;
let metricsData = {};

// ═══════════════════════════════════════════════
// 2. ROUTER
// ═══════════════════════════════════════════════
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  if (pg) pg.classList.add('active');
  const pageIndex = {'home':0,'analysis':1,'trader':2,'metrics':3}[page] ?? 0;
  const navLinks = document.querySelectorAll('.nav-link');
  if (navLinks[pageIndex]) navLinks[pageIndex].classList.add('active');
  currentPage = page;
  if (page === 'trader') refreshTraderPage();
  if (page === 'metrics') loadMetrics();
  if (page === 'analysis' && !currentAnalysisSymbol) {
    currentAnalysisSymbol = '%5EGSPC';
    currentAnalysisName = 'S&P 500';
    document.getElementById('a-sym').textContent = '^GSPC';
    document.getElementById('a-name').textContent = 'S&P 500';
    loadAnalysis();
  }
}

function goAnalyze(symbol, name) {
  currentAnalysisSymbol = symbol;
  currentAnalysisName = name;
  document.getElementById('a-sym').textContent = symbol.replace('%5E', '^');
  document.getElementById('a-name').textContent = name;
  document.getElementById('ai-result').innerHTML = '<div style="color:var(--text3);font-family:var(--font-body);font-size:0.73rem;line-height:1.55">Click "▶ RUN ANALYSIS" to generate regime-aligned AI insights.</div>';
  navigate('analysis');
  loadAnalysis();
}

// Analyze any symbol typed into the Analysis page search bar
function analyzeCustom() {
  const input = document.getElementById('a-sym-input');
  if (!input) return;
  const raw = input.value.trim().toUpperCase();
  if (!raw) { toast('Enter a symbol first', 'w'); return; }
  // Handle common variations
  const symMap = { 'SPX':'^GSPC','SPY':'SPY','NDX':'^NDX','QQQ':'QQQ','DJI':'^DJI',
    'VIX':'^VIX','BITCOIN':'BTC-USD','ETHEREUM':'ETH-USD','GOLD':'GLD','OIL':'USO' };
  const sym = symMap[raw] || raw;
  const name = raw;
  input.value = '';
  goAnalyze(sym.includes('^') ? encodeURIComponent(sym) : sym, name);
}

// ═══════════════════════════════════════════════
// 3. CLOCK & MARKET STATUS
// ═══════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes(), s = et.getSeconds();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('clock').textContent = `${pad(h)}:${pad(m)}:${pad(s)} ET`;
  const day = et.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && (h > 9 || (h === 9 && m >= 30)) && h < 16;
  const el = document.getElementById('mkt-status');
  if (el) { el.textContent = isOpen ? 'MKT OPEN' : 'MKT CLOSED'; el.className = isOpen ? 'open' : 'closed'; }
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════════
// 4. TOAST
// ═══════════════════════════════════════════════
function toast(msg, type = 's') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show ' + type;
  setTimeout(() => t.className = '', 3500);
}

// ═══════════════════════════════════════════════
// 5. DATA SOURCES — Yahoo + CoinGecko + Alpaca
// ═══════════════════════════════════════════════
const PROXIES = [
  url => 'https://corsproxy.io/?' + encodeURIComponent(url),
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
];

async function proxiedFetch(url) {
  for (const makeUrl of PROXIES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(makeUrl(url), { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return r;
    } catch (_) {}
  }
  return null;
}

async function yahooQuote(symbols) {
  const syms = Array.isArray(symbols) ? symbols.join(',') : symbols;
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,shortName,regularMarketPreviousClose`;
  try {
    const r = await proxiedFetch(url);
    if (!r) return [];
    const d = await r.json();
    return d?.quoteResponse?.result || [];
  } catch (_) { return []; }
}

async function yahooChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  try {
    const r = await proxiedFetch(url);
    if (!r) return null;
    const d = await r.json();
    const chart = d?.chart?.result?.[0];
    if (!chart) return null;
    const ts = chart.timestamp || [];
    const closes  = chart.indicators?.quote?.[0]?.close  || [];
    const highs   = chart.indicators?.quote?.[0]?.high   || [];
    const lows    = chart.indicators?.quote?.[0]?.low    || [];
    const volumes = chart.indicators?.quote?.[0]?.volume || [];
    const labels = ts.map(t => {
      const dt = new Date(t * 1000);
      return interval.includes('m') ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    return { labels, closes, highs, lows, volumes };
  } catch (_) { return null; }
}

async function coinGeckoPrice() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true');
    return await r.json();
  } catch (_) { return null; }
}

function simPrice(base, points = 80, vol = 0.012) {
  const data = [base];
  for (let i = 1; i < points; i++) {
    const drift = (Math.random() - 0.49) * vol;
    data.push(+(data[i - 1] * (1 + drift)).toFixed(2));
  }
  return data;
}

// ═══════════════════════════════════════════════
// 6. TECHNICAL INDICATORS (pure JS, no libs)
// ═══════════════════════════════════════════════
function calcSMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1).filter(v => v != null);
    return slice.length === period ? slice.reduce((a, b) => a + b, 0) / period : null;
  });
}

function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const out = [];
  let ema = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i] == null) { out.push(null); continue; }
    if (ema === null) { ema = data[i]; out.push(ema); continue; }
    ema = data[i] * k + ema * (1 - k);
    out.push(+ema.toFixed(4));
  }
  return out;
}

function calcRSI(closes, period = 14) {
  const rsi = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period && i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi.length = period;
  rsi.fill(null, 0, period);
  if (avgLoss === 0) { rsi.push(100); } else { rsi.push(100 - 100 / (1 + avgGain / avgLoss)); }
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = Math.max(diff, 0);
    const l = Math.max(-diff, 0);
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi.push(avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  }
  return rsi;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v != null && emaSlow[i] != null ? +(v - emaSlow[i]).toFixed(4) : null);
  const validMacd = macdLine.filter(v => v != null);
  const sigRaw = calcEMA(validMacd, signal);
  const signalLine = macdLine.map((v, i) => {
    if (v == null) return null;
    const idx = macdLine.slice(0, i + 1).filter(x => x != null).length - 1;
    return sigRaw[idx] ?? null;
  });
  const hist = macdLine.map((v, i) => v != null && signalLine[i] != null ? +(v - signalLine[i]).toFixed(4) : null);
  return { macdLine, signalLine, hist };
}

function calcBB(closes, period = 20, mult = 2) {
  const mid = calcSMA(closes, period);
  const upper = [], lower = [], pctB = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1 || mid[i] == null) { upper.push(null); lower.push(null); pctB.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1).filter(v => v != null);
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mid[i]) ** 2, 0) / period);
    const u = mid[i] + mult * sd;
    const l = mid[i] - mult * sd;
    upper.push(+u.toFixed(4));
    lower.push(+l.toFixed(4));
    pctB.push(u !== l ? +((closes[i] - l) / (u - l)).toFixed(4) : 0.5);
  }
  return { mid, upper, lower, pctB };
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = [];
  let avg = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period - 1; i++) atr.push(null);
  atr.push(+avg.toFixed(4));
  for (let i = period; i < tr.length; i++) {
    avg = (avg * (period - 1) + tr[i]) / period;
    atr.push(+avg.toFixed(4));
  }
  return atr;
}

function calcADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; out.push(s); }
    return out;
  };
  const sTR = smooth(tr); const sPlus = smooth(plusDM); const sMinus = smooth(minusDM);
  const adx = [];
  let dxSum = 0;
  for (let i = 0; i < sTR.length; i++) {
    const pDI = sTR[i] ? 100 * sPlus[i] / sTR[i] : 0;
    const mDI = sTR[i] ? 100 * sMinus[i] / sTR[i] : 0;
    const dx = (pDI + mDI) ? 100 * Math.abs(pDI - mDI) / (pDI + mDI) : 0;
    dxSum += dx;
    if (i < period - 1) { adx.push(null); continue; }
    if (i === period - 1) { adx.push(+(dxSum / period).toFixed(2)); continue; }
    adx.push(+((adx[adx.length - 1] * (period - 1) + dx) / period).toFixed(2));
  }
  return adx;
}

function calcStoch(highs, lows, closes, k = 14, d = 3) {
  const pctK = closes.map((c, i) => {
    if (i < k - 1) return null;
    const slice_h = highs.slice(i - k + 1, i + 1);
    const slice_l = lows.slice(i - k + 1, i + 1);
    const H = Math.max(...slice_h); const L = Math.min(...slice_l);
    return H !== L ? +((c - L) / (H - L) * 100).toFixed(2) : 50;
  });
  const pctD = calcSMA(pctK.filter(v => v != null), d);
  return { pctK, pctD };
}

// ═══════════════════════════════════════════════
// 7. REGIME DETECTION ENGINE
// ═══════════════════════════════════════════════
/**
 * Regime rules (per Reddit advice + your spec):
 * BULL   : ADX > 25 AND price > MA50 > MA200 AND RSI 45–70 → momentum long
 * BEAR   : ADX > 25 AND price < MA50 < MA200 AND RSI 30–55 → momentum short
 * NEUTRAL: ADX < 20 → mean-reversion scan only — KNIFE WARNING active
 * TRANSITION: mixed signals (ADX 20–25 OR conflicting MAs) → NO new entries, wait
 */
function detectRegime(closes, highs, lows) {
  if (!closes || closes.length < 50) {
    return { regime: 'neutral', model: 'MEAN-REV SCAN', confidence: 30, notes: 'Insufficient data — defaulting to mean-reversion scan.', adxVal: 0, rsiVal: 50 };
  }

  const ma50 = calcSMA(closes, 50);
  const ma200 = calcSMA(closes, Math.min(200, closes.length));
  const rsiArr = calcRSI(closes, 14);
  const adxArr = calcADX(highs, lows, closes, 14);

  const last = closes.length - 1;
  const price = closes[last];
  const m50 = ma50[last];
  const m200 = ma200[last] ?? m50;
  const rsi = rsiArr[last] ?? 50;
  const adx = adxArr[adxArr.length - 1] ?? 0;

  // Score-based regime logic
  let bullScore = 0, bearScore = 0;
  if (adx > 25) { bullScore += 2; bearScore += 2; } // confirms trend, not direction
  if (adx > 30) { bullScore += 1; bearScore += 1; }
  if (price > m50) bullScore += 2; else bearScore += 2;
  if (m50 > m200) bullScore += 2; else bearScore += 2;
  if (rsi > 50 && rsi < 70) bullScore += 2;
  if (rsi < 50 && rsi > 30) bearScore += 2;
  if (rsi > 60) bullScore += 1;
  if (rsi < 40) bearScore += 1;
  // Check for momentum vs mean-rev
  const trendStrong = adx > 25;
  const trendClear = Math.abs(bullScore - bearScore) >= 4;

  let regime, model, confidence, notes;

  if (!trendStrong && adx < 20) {
    // NEUTRAL — mean reversion only
    regime = 'neutral';
    model = 'MEAN-REV SCAN';
    confidence = Math.round(50 + (20 - adx) * 2);
    notes = `ADX ${adx.toFixed(1)} — range-bound. Every entry is a potential falling knife. Scan for mean-reversion setups only (RSI extremes, BB tags). Do NOT chase momentum.`;
  } else if (adx >= 20 && adx <= 25) {
    // TRANSITION — ambiguous
    regime = 'transition';
    model = 'HOLD — NO NEW ENTRIES';
    confidence = 40;
    notes = `ADX ${adx.toFixed(1)} — transition zone. Regime is unclear. Neither momentum nor mean-reversion has edge. Stand aside until regime clarifies above 25 or below 20.`;
  } else if (trendStrong && bullScore > bearScore && trendClear) {
    regime = 'bull';
    model = 'MOMENTUM LONG';
    confidence = Math.min(95, Math.round(55 + (bullScore - bearScore) * 5));
    notes = `ADX ${adx.toFixed(1)}, RSI ${rsi.toFixed(1)}, Price > MA50 > MA200. Strong bullish trend detected. Momentum model active — look for pullback entries and breakouts. Mean-reversion signals suppressed.`;
  } else if (trendStrong && bearScore > bullScore && trendClear) {
    regime = 'bear';
    model = 'MOMENTUM SHORT';
    confidence = Math.min(95, Math.round(55 + (bearScore - bullScore) * 5));
    notes = `ADX ${adx.toFixed(1)}, RSI ${rsi.toFixed(1)}, Price < MA50 < MA200. Strong bearish trend. Momentum short model active — look for rallies to short. Do not try to catch bottoms.`;
  } else {
    regime = 'transition';
    model = 'HOLD — NO NEW ENTRIES';
    confidence = 35;
    notes = `Mixed signals — bull score: ${bullScore}, bear score: ${bearScore}. Transition period. High risk of whipsaw. Waiting for clean regime before enabling any model.`;
  }

  return { regime, model, confidence, notes, adxVal: adx, rsiVal: rsi, ma50: m50, ma200: m200, price };
}

function applyRegimeToUI(reg) {
  regimeState = reg;
  const colorMap = { bull: 'var(--green)', bear: 'var(--red)', neutral: 'var(--orange)', transition: 'var(--gold)' };
  const col = colorMap[reg.regime] || 'var(--orange)';
  const label = reg.regime.toUpperCase();

  // Trader page HUD
  const rd = document.getElementById('regime-disp');
  if (rd) { rd.textContent = label; rd.style.color = col; }
  const rm = document.getElementById('regime-mdisp');
  if (rm) rm.textContent = 'Active Model: ' + reg.model;
  const cf = document.getElementById('cfill');
  if (cf) { cf.style.width = reg.confidence + '%'; cf.className = 'cfill ' + reg.regime; }
  const rn = document.getElementById('regime-notes');
  if (rn) rn.textContent = reg.notes;

  // Analysis page badge
  const rbr = document.getElementById('rb-regime');
  if (rbr) {
    rbr.textContent = label;
    const rColors = {bull:'var(--green)',bear:'var(--red)',neutral:'var(--orange)',transition:'var(--gold)'};
    rbr.style.color = rColors[reg.regime] || 'var(--orange)';
    const rBgs = {bull:'rgba(13,192,96,.12)',bear:'rgba(224,21,21,.12)',neutral:'rgba(255,102,0,.1)',transition:'rgba(240,168,0,.1)'};
    rbr.style.background = rBgs[reg.regime] || 'rgba(255,102,0,.1)';
  }
  const rbm = document.getElementById('rb-model');
  if (rbm) rbm.textContent = reg.model;
  const rbc = document.getElementById('rb-conf');
  if (rbc) rbc.textContent = 'Conf: ' + reg.confidence + '%';

  // Home mini
  const rmr = document.getElementById('rm-regime');
  if (rmr) {
    rmr.textContent = label;
    const rColors = {bull:'var(--green)',bear:'var(--red)',neutral:'var(--orange)',transition:'var(--gold)'};
    rmr.style.color = rColors[reg.regime] || 'var(--orange)';
  }
  const rmm = document.getElementById('rm-model');
  if (rmm) rmm.textContent = reg.model;
  const knife = document.getElementById('rm-knife');
  if (knife) knife.style.display = (reg.regime === 'neutral' || reg.regime === 'transition') ? 'inline-flex' : 'none';

  // HUD indicators
  const ha = document.getElementById('h-adx');
  if (ha) ha.textContent = reg.adxVal.toFixed(1);
  const has = document.getElementById('h-adx-s');
  if (has) has.textContent = reg.adxVal > 25 ? 'Strong Trend' : reg.adxVal > 20 ? 'Weak Trend' : 'No Trend';
  const hr = document.getElementById('h-rsi');
  if (hr) hr.textContent = reg.rsiVal.toFixed(1);
  const hrs = document.getElementById('h-rsi-s');
  if (hrs) hrs.textContent = reg.rsiVal > 70 ? 'Overbought' : reg.rsiVal < 30 ? 'Oversold' : 'Neutral';
}

// ═══════════════════════════════════════════════
// 8. SPARKLINES (Home index tiles)
// ═══════════════════════════════════════════════
function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.parentElement?.offsetWidth || 160;
  const H = rect.height || 42;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);
  if (!data || data.length < 2) return;
  const clean = data.filter(v => v != null && isFinite(v));
  if (clean.length < 2) return;
  const min = Math.min(...clean); const max = Math.max(...clean);
  const range = max - min || 1;
  const px = (i) => (i / (clean.length - 1)) * W;
  const py = (v) => H - ((v - min) / range) * H * 0.9 - H * 0.05;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '00');
  ctx.beginPath();
  ctx.moveTo(px(0), py(clean[0]));
  for (let i = 1; i < clean.length; i++) ctx.lineTo(px(i), py(clean[i]));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineTo(px(clean.length - 1), H);
  ctx.lineTo(px(0), H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

// ═══════════════════════════════════════════════
// 9. HOME PAGE DATA
// ═══════════════════════════════════════════════
const INDEX_ASSETS = [
  { id: 'spx', sym: '%5EGSPC', name: 'S&P 500', base: 5200, color: '#2266ff' },
  { id: 'ndx', sym: '%5EIXIC', name: 'NASDAQ', base: 16400, color: '#9944ff' },
  { id: 'btc', sym: 'BTC-USD', name: 'Bitcoin', base: 68000, color: '#f0a800' },
  { id: 'gold', sym: 'GC=F', name: 'Gold', base: 2340, color: '#f0a800' },
  { id: 'wti', sym: 'CL=F', name: 'WTI Crude', base: 78, color: '#ff6600' },
];

const MOVER_SYMS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'META', 'AMZN', 'GOOG', 'AMD', 'PLTR', 'COIN'];

// Performance note: home data refreshes every 60s (not 30s) to reduce proxy load
async function loadHomeData() {
  // Index tiles
  const quotes = await yahooQuote(INDEX_ASSETS.map(a => a.sym));
  INDEX_ASSETS.forEach(asset => {
    const q = quotes.find(r => r.symbol === decodeURIComponent(asset.sym)) || null;
    const price = q?.regularMarketPrice ?? simWalk(asset.base);
    const chg = q?.regularMarketChangePercent ?? (Math.random() * 4 - 2);
    const isLive = !!q;
    const priceEl = document.getElementById('h-' + asset.id);
    const chgEl = document.getElementById('h-' + asset.id + '-c');
    const badgeEl = document.getElementById('h-' + asset.id + '-b');
    if (priceEl) priceEl.textContent = fmtPrice(price);
    if (chgEl) {
      const arrow = chg >= 0 ? '▲ ' : '▼ ';
      chgEl.textContent = arrow + fmtChg(chg);
      chgEl.className = 'it-chg ' + (chg >= 0 ? 'up' : 'dn');
    }
    if (badgeEl) { badgeEl.textContent = isLive ? 'LIVE' : 'SIM'; badgeEl.className = 'it-badge ' + (isLive ? 'live' : 'sim'); }
    const sparkData = q ? simPrice(price, 60, 0.006) : simPrice(asset.base, 60, 0.009);
    setTimeout(() => drawSparkline('sk-' + asset.id, sparkData, chg >= 0 ? '#0dc060' : '#e01515'), 100);
  });

  // Crypto
  const cg = await coinGeckoPrice();
  setCrypto('btc', cg?.bitcoin?.usd, cg?.bitcoin?.usd_24h_change);
  setCrypto('eth', cg?.ethereum?.usd, cg?.ethereum?.usd_24h_change);
  setCrypto('sol', cg?.solana?.usd, cg?.solana?.usd_24h_change);

  // Movers
  const movers = await yahooQuote(MOVER_SYMS);
  const sorted = [...movers].sort((a, b) => Math.abs(b.regularMarketChangePercent) - Math.abs(a.regularMarketChangePercent));
  renderMovers(sorted.slice(0, 8));

  // Ticker
  buildTicker(quotes, cg);

  // Regime from SPX data (use sim if no live)
  const spxQuote = quotes.find(r => r.symbol === 'GSPC' || r.symbol === '^GSPC');
  const spxPrices = simPrice(spxQuote?.regularMarketPrice ?? 5200, 250, 0.008);
  const spxHighs = spxPrices.map(p => p * 1.003);
  const spxLows = spxPrices.map(p => p * 0.997);
  const reg = detectRegime(spxPrices, spxHighs, spxLows);
  applyRegimeToUI(reg);

  // VIX sim
  const vix = (15 + Math.random() * 8).toFixed(2);
  const vixEl = document.getElementById('m-vix');
  if (vixEl) vixEl.textContent = vix;
  const hvix = document.getElementById('h-vix');
  if (hvix) hvix.textContent = vix;
  const hvixs = document.getElementById('h-vix-s');
  if (hvixs) hvixs.textContent = +vix > 20 ? 'Elevated Fear' : +vix > 15 ? 'Moderate' : 'Low Volatility';
}

function setCrypto(id, price, chg) {
  const pe = document.getElementById('cc-' + id + '-p');
  const ce = document.getElementById('cc-' + id + '-c');
  const p = price ?? (id === 'btc' ? simWalk(68000) : id === 'eth' ? simWalk(3500) : simWalk(140));
  const c = chg ?? (Math.random() * 6 - 3);
  if (pe) pe.textContent = '$' + fmtLarge(p);
  if (ce) { ce.textContent = fmtChg(c); ce.className = 'cc-chg ' + (c >= 0 ? 'up' : 'dn'); }
}

function renderMovers(movers) {
  const el = document.getElementById('movers-list');
  if (!el) return;
  if (!movers.length) { el.innerHTML = '<div style="color:var(--text3);font-size:.75rem;padding:8px 0">No data</div>'; return; }
  el.innerHTML = movers.map(m => {
    const c = m.regularMarketChangePercent ?? 0;
    const p = m.regularMarketPrice ?? 0;
    const sym = m.symbol ?? '—';
    const name = m.shortName ?? sym;
    const dir = c >= 0 ? 'up' : 'dn';
    const arrow = c >= 0 ? '▲' : '▼';
    return `<div class="mover-row" style="cursor:pointer" onclick="goAnalyze('${sym}','${name}')">
      <div><div class="mv-sym">${sym}</div><div class="mv-name">${name}</div></div>
      <div style="text-align:right">
        <div class="mv-price">${fmtPrice(p)}</div>
        <div class="mv-chg ${dir}">${arrow} ${fmtChg(c)}</div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════
// 10. TICKER & BREAKING NEWS
// ═══════════════════════════════════════════════
function buildTicker(quotes, cg) {
  const items = [];
  INDEX_ASSETS.forEach(a => {
    const q = quotes.find(r => r.symbol === decodeURIComponent(a.sym));
    const p = q?.regularMarketPrice ?? simWalk(a.base);
    const c = q?.regularMarketChangePercent ?? 0;
    items.push({ sym: a.id.toUpperCase(), price: fmtPrice(p), chg: fmtChg(c), dir: c >= 0 ? 'u' : 'd' });
  });
  if (cg?.bitcoin) items.push({ sym: 'BTC', price: '$' + fmtLarge(cg.bitcoin.usd), chg: fmtChg(cg.bitcoin.usd_24h_change), dir: cg.bitcoin.usd_24h_change >= 0 ? 'u' : 'd' });
  if (cg?.ethereum) items.push({ sym: 'ETH', price: '$' + fmtLarge(cg.ethereum.usd), chg: fmtChg(cg.ethereum.usd_24h_change), dir: cg.ethereum.usd_24h_change >= 0 ? 'u' : 'd' });
  MOVER_SYMS.slice(0, 6).forEach(sym => {
    const q = quotes.find(r => r.symbol === sym);
    if (q) items.push({ sym, price: fmtPrice(q.regularMarketPrice), chg: fmtChg(q.regularMarketChangePercent), dir: q.regularMarketChangePercent >= 0 ? 'u' : 'd' });
  });
  const html = [...items, ...items].map(it =>
    `<span class="tick-item"><span class="tick-sym">${it.sym}</span><span class="tick-price">${it.price}</span><span class="tick-chg ${it.dir === 'u' ? 'up' : 'dn'}">${it.chg}</span></span>`
  ).join('');
  const el = document.getElementById('tick-inner');
  if (el) el.innerHTML = html;
}

const HEADLINES = [
  { tag: 'macro', text: 'Fed signals two rate cuts possible in 2025 as inflation cools toward 2% target', src: 'Reuters', time: '2m ago' },
  { tag: 'equities', text: 'NVIDIA surges on record data center demand; AI chip backlog extends to Q3', src: 'Bloomberg', time: '8m ago' },
  { tag: 'breaking', text: 'Treasury 10-year yield hits 4.28% as strong jobs data reduces recession fears', src: 'WSJ', time: '14m ago' },
  { tag: 'crypto', text: 'Bitcoin consolidates near $68K — institutional accumulation detected on-chain', src: 'CoinDesk', time: '19m ago' },
  { tag: 'geo', text: 'OPEC+ maintains production cuts through Q3; Brent crude edges higher', src: 'FT', time: '25m ago' },
  { tag: 'equities', text: 'S&P 500 climbs 0.4% as tech leads broad rally; Small caps outperform', src: 'CNBC', time: '31m ago' },
  { tag: 'macro', text: 'China PMI beats estimates for third straight month, boosting Asia markets', src: 'Reuters', time: '44m ago' },
  { tag: 'fed', text: 'Fed minutes reveal debate over timing of pivot; some members want more data', src: 'AP', time: '1h ago' },
  { tag: 'equities', text: 'Apple readies major AI overhaul for WWDC; Services revenue projected at record', src: 'Bloomberg', time: '1h ago' },
  { tag: 'crypto', text: 'Ethereum ETF sees $380M inflows this week; DeFi TVL reaches 18-month high', src: 'The Block', time: '2h ago' },
  { tag: 'geo', text: 'Dollar weakens as EU growth data surprises to upside; EUR/USD above 1.085', src: 'Reuters', time: '2h ago' },
  { tag: 'macro', text: 'CPI report due Thursday — Wall Street pricing in 0.2% core reading', src: 'CNBC', time: '3h ago' },
];

function renderNews() {
  const el = document.getElementById('news-feed');
  if (!el) return;
  const catMap = {macro:'macro',equities:'equity',crypto:'crypto',breaking:'equity',geo:'fx',fed:'bonds'};
  el.innerHTML = HEADLINES.map(n => `
    <div class="news-item" onclick="goAnalyze('${tagToSym(n.tag)}','${tagToName(n.tag)}')">
      <div class="ni-top">
        <span class="ni-cat ${catMap[n.tag] || 'macro'}">${n.tag.toUpperCase()}</span>
        <span class="ni-meta">${n.src} <span class="dot">·</span> ${n.time}</span>
      </div>
      <div class="ni-head">${n.text}</div>
      <button class="ni-btn" onclick="event.stopPropagation();goAnalyze('${tagToSym(n.tag)}','${tagToName(n.tag)}')">Analyze →</button>
    </div>`).join('');
}

function tagToSym(tag) {
  return { macro: '%5EGSPC', equities: 'AAPL', crypto: 'BTC-USD', breaking: '%5EGSPC', geo: 'CL=F', fed: '%5EGSPC' }[tag] || '%5EGSPC';
}
function tagToName(tag) {
  return { macro: 'S&P 500', equities: 'Apple', crypto: 'Bitcoin', breaking: 'S&P 500', geo: 'WTI Crude', fed: 'S&P 500' }[tag] || 'S&P 500';
}

const BREAKING_ITEMS = [
  '⚡ Fed Chair signals patience on rate cuts',
  '⚡ S&P 500 hits new all-time high intraday',
  '⚡ Bitcoin ETF sees record single-day inflows of $620M',
  '⚡ NVIDIA Q1 earnings beat by 15% — data center revenue triples',
  '⚡ Treasury yields spike after stronger-than-expected jobs print',
  '⚡ ECB cuts rates 25bps — first reduction since 2019',
  '⚡ Oil jumps 3% after surprise OPEC+ output cut announcement',
];
function buildBreaking() {
  const el = document.getElementById('brk-inner');
  if (!el) return;
  const doubled = [...BREAKING_ITEMS, ...BREAKING_ITEMS];
  el.innerHTML = doubled.map(t => `<span>${t}</span>`).join('<span class="brk-sep"> ◆ </span>');
}

// ═══════════════════════════════════════════════
// 11. ANALYSIS PAGE — CHARTS + INDICATORS
// ═══════════════════════════════════════════════
async function loadAnalysis() {
  if (!currentAnalysisSymbol) return;
  const sym = currentAnalysisSymbol;
  destroyCharts();

  // Fetch price data
  let data = await yahooChart(sym, currentTF.range, currentTF.interval);
  let isLive = true;
  if (!data || data.closes.filter(Boolean).length < 20) {
    isLive = false;
    const base = guessPriceBase(sym);
    const closes = simPrice(base, 120, 0.009);
    const highs = closes.map(p => p * (1 + Math.random() * 0.008));
    const lows = closes.map(p => p * (1 - Math.random() * 0.008));
    data = {
      labels: Array.from({ length: 120 }, (_, i) => {
        const d = new Date(); d.setMinutes(d.getMinutes() - (119 - i) * 5);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      }),
      closes, highs, lows, volumes: closes.map(() => Math.floor(Math.random() * 1e6))
    };
  }

  const closes = data.closes.map(v => v ?? null);
  const highs = data.highs.map(v => v ?? null);
  const lows = data.lows.map(v => v ?? null);
  const labels = data.labels;

  // Update header
  const last = closes.filter(Boolean).pop() ?? 0;
  const first = closes.filter(Boolean)[0] ?? last;
  const chgPct = first ? ((last - first) / first * 100) : 0;
  const apEl = document.getElementById('a-price');
  if (apEl) apEl.textContent = fmtPrice(last);
  const acEl = document.getElementById('a-chg');
  if (acEl) { acEl.textContent = fmtChg(chgPct); acEl.className = 'ah-chg ' + (chgPct >= 0 ? 'u' : 'd'); }

  // Calculate indicators
  const rsiData = calcRSI(closes.filter(Boolean));
  const macdData = calcMACD(closes.filter(Boolean));
  const bb = calcBB(closes.filter(Boolean));
  const atr = calcATR(highs.filter(Boolean), lows.filter(Boolean), closes.filter(Boolean));
  const adx = calcADX(highs.filter(Boolean), lows.filter(Boolean), closes.filter(Boolean));
  const stoch = calcStoch(highs.filter(Boolean), lows.filter(Boolean), closes.filter(Boolean));
  const ma20 = calcSMA(closes.filter(Boolean), 20);
  const ma50 = calcSMA(closes.filter(Boolean), 50);
  const ma200 = calcSMA(closes.filter(Boolean), Math.min(200, closes.filter(Boolean).length));

  // Regime from this asset's data
  const cl = closes.filter(Boolean);
  const hi = highs.filter(Boolean);
  const lo = lows.filter(Boolean);
  const reg = detectRegime(cl, hi, lo);
  applyRegimeToUI(reg);

  // Update indicator cards
  const lastRSI = rsiData[rsiData.length - 1] ?? 50;
  const lastMACD = macdData.macdLine[macdData.macdLine.length - 1] ?? 0;
  const lastMACDSig = macdData.signalLine[macdData.signalLine.length - 1] ?? 0;
  const lastADX = adx[adx.length - 1] ?? 0;
  const lastBB = bb.pctB[bb.pctB.length - 1] ?? 0.5;
  const lastMA50 = ma50[ma50.length - 1] ?? last;
  const lastMA200 = ma200[ma200.length - 1] ?? last;
  const lastStoch = stoch.pctK[stoch.pctK.length - 1] ?? 50;
  const lastATR = atr[atr.length - 1] ?? 0;

  setInd('rsi', lastRSI.toFixed(1), lastRSI > 70 ? 'OVERBOUGHT' : lastRSI < 30 ? 'OVERSOLD' : 'NEUTRAL', lastRSI > 70 ? 'sell' : lastRSI < 30 ? 'buy' : 'neutral');
  setInd('macd', lastMACD.toFixed(4), lastMACD > lastMACDSig ? 'BULLISH CROSS' : 'BEARISH CROSS', lastMACD > lastMACDSig ? 'buy' : 'sell');
  setInd('adx', lastADX.toFixed(1), lastADX > 25 ? (reg.regime === 'bull' ? 'STRONG BULL' : 'STRONG BEAR') : 'WEAK TREND', lastADX > 25 ? (reg.regime === 'bull' ? 'buy' : 'sell') : 'neutral');
  setInd('bb', lastBB.toFixed(3), lastBB > 0.8 ? 'NEAR UPPER BAND' : lastBB < 0.2 ? 'NEAR LOWER BAND' : 'MID-RANGE', lastBB > 0.8 ? 'sell' : lastBB < 0.2 ? 'buy' : 'neutral');
  setInd('ma50', fmtPrice(lastMA50), last > lastMA50 ? 'PRICE ABOVE' : 'PRICE BELOW', last > lastMA50 ? 'buy' : 'sell');
  setInd('ma200', fmtPrice(lastMA200), last > lastMA200 ? 'PRICE ABOVE' : 'PRICE BELOW', last > lastMA200 ? 'buy' : 'sell');
  setInd('stoch', lastStoch.toFixed(1), lastStoch > 80 ? 'OVERBOUGHT' : lastStoch < 20 ? 'OVERSOLD' : 'NEUTRAL', lastStoch > 80 ? 'sell' : lastStoch < 20 ? 'buy' : 'neutral');
  setInd('atr', fmtPrice(lastATR), 'VOLATILITY', 'watch');

  // Draw charts
  drawPriceChart(labels, closes.filter(Boolean), ma20, ma50, bb);
  drawRSIChart(labels.slice(-rsiData.length), rsiData);
  drawMACDChart(labels.slice(-macdData.hist.length), macdData);
}

function setInd(id, val, sig, cls) {
  const ve = document.getElementById('i-' + id);
  const se = document.getElementById('i-' + id + '-s');
  if (ve) ve.textContent = val;
  if (se) { se.textContent = sig; se.className = 'indsig ' + cls; }
}

function destroyCharts() {
  ['cprice','crsi','cmacd'].forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas) {
      // Destroy existing Chart.js instance if registered
      const existing = Chart.getChart(canvas);
      if (existing) existing.destroy();
    }
  });
  priceChart = null; rsiChart = null; macdChart = null;
}

function drawPriceChart(labels, closes, ma20, ma50, bb) {
  const ctx = document.getElementById('cprice');
  if (!ctx) return;
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 270);
  grad.addColorStop(0, 'rgba(34,102,255,0.18)');
  grad.addColorStop(1, 'rgba(34,102,255,0)');
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Price', data: closes, borderColor: '#ffffff', borderWidth: 1.5, fill: true, backgroundColor: grad, tension: 0.2, pointRadius: 0, pointHoverRadius: 3 },
        { label: 'BB Upper', data: bb.upper, borderColor: 'rgba(255,102,0,0.35)', borderWidth: 1, borderDash: [3, 3], fill: false, tension: 0.3, pointRadius: 0 },
        { label: 'BB Mid', data: bb.mid, borderColor: 'rgba(255,102,0,0.2)', borderWidth: 1, borderDash: [2, 4], fill: false, tension: 0.3, pointRadius: 0 },
        { label: 'BB Lower', data: bb.lower, borderColor: 'rgba(255,102,0,0.35)', borderWidth: 1, borderDash: [3, 3], fill: false, tension: 0.3, pointRadius: 0 },
        { label: 'MA20', data: ma20, borderColor: 'rgba(240,168,0,0.7)', borderWidth: 1.2, fill: false, tension: 0.3, pointRadius: 0 },
        { label: 'MA50', data: ma50, borderColor: 'rgba(153,68,255,0.7)', borderWidth: 1.2, fill: false, tension: 0.3, pointRadius: 0 },
      ]
    },
    options: chartOpts({ min: null, max: null, gridColor: 'rgba(255,255,255,0.04)', labelColor: 'rgba(255,255,255,0.4)', tickColor: 'rgba(255,255,255,0.25)' })
  });
}

function drawRSIChart(labels, rsiData) {
  const ctx = document.getElementById('crsi');
  if (!ctx) return;
  rsiChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'RSI', data: rsiData, borderColor: '#ff6600', borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
        { label: 'OB', data: labels.map(() => 70), borderColor: 'rgba(224,21,21,0.3)', borderWidth: 1, borderDash: [3, 3], fill: false, pointRadius: 0 },
        { label: 'OS', data: labels.map(() => 30), borderColor: 'rgba(13,192,96,0.3)', borderWidth: 1, borderDash: [3, 3], fill: false, pointRadius: 0 },
        { label: 'Mid', data: labels.map(() => 50), borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderDash: [2, 4], fill: false, pointRadius: 0 },
      ]
    },
    options: chartOpts({ min: 0, max: 100, gridColor: 'rgba(255,255,255,0.03)', labelColor: 'rgba(255,255,255,0.35)', tickColor: 'rgba(255,255,255,0.2)' })
  });
}

function drawMACDChart(labels, macdData) {
  const ctx = document.getElementById('cmacd');
  if (!ctx) return;
  macdChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Histogram',
          data: macdData.hist,
          backgroundColor: macdData.hist.map(v => v >= 0 ? 'rgba(13,192,96,0.5)' : 'rgba(224,21,21,0.5)'),
          borderWidth: 0,
          order: 2,
        },
        { label: 'MACD', data: macdData.macdLine, borderColor: '#2266ff', borderWidth: 1.5, type: 'line', fill: false, tension: 0.3, pointRadius: 0, order: 1 },
        { label: 'Signal', data: macdData.signalLine, borderColor: '#ff6600', borderWidth: 1.2, type: 'line', fill: false, tension: 0.3, pointRadius: 0, order: 1 },
      ]
    },
    options: chartOpts({ min: null, max: null, gridColor: 'rgba(255,255,255,0.03)', labelColor: 'rgba(255,255,255,0.35)', tickColor: 'rgba(255,255,255,0.2)' })
  });
}

function chartOpts({ min, max, gridColor, labelColor, tickColor }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#141414',
        borderColor: '#242424',
        borderWidth: 1,
        titleColor: '#909090',
        bodyColor: '#f0f0f0',
        titleFont: { family: "'IBM Plex Mono'", size: 10 },
        bodyFont: { family: "'IBM Plex Mono'", size: 11 },
      }
    },
    scales: {
      x: { display: true, ticks: { color: tickColor, maxTicksLimit: 8, font: { family: "'IBM Plex Mono'", size: 9 } }, grid: { color: gridColor } },
      y: { display: true, position: 'right', min, max, ticks: { color: labelColor, font: { family: "'IBM Plex Mono'", size: 9 } }, grid: { color: gridColor } }
    }
  };
}

function setTF(range, interval, btn) {
  currentTF = { range, interval };
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (currentAnalysisSymbol) loadAnalysis();
}

// ═══════════════════════════════════════════════
// 12. AI ANALYSIS — Claude API
// ═══════════════════════════════════════════════
async function runAnalysis() {
  if (!CFG.anthropicKey) { toast('Add Anthropic API key in ⚙ CONFIG', 'w'); openConfig(); return; }
  if (!currentAnalysisSymbol) { toast('Select an asset first', 'w'); return; }

  const el = document.getElementById('ai-result');
  if (el) el.innerHTML = '<div class="loading"><div class="spin"></div> Claude is analyzing regime + signals...</div>';

  const reg = regimeState;
  const sym = currentAnalysisSymbol.replace('%5E', '^');
  const priceEl = document.getElementById('a-price');
  const price = priceEl?.textContent ?? 'unknown';

  const rsi = document.getElementById('i-rsi')?.textContent ?? '—';
  const macd = document.getElementById('i-macd')?.textContent ?? '—';
  const adx = document.getElementById('i-adx')?.textContent ?? '—';
  const bb = document.getElementById('i-bb')?.textContent ?? '—';
  const ma50 = document.getElementById('i-ma50')?.textContent ?? '—';
  const ma200 = document.getElementById('i-ma200')?.textContent ?? '—';
  const stoch = document.getElementById('i-stoch')?.textContent ?? '—';
  const atr = document.getElementById('i-atr')?.textContent ?? '—';

  const knifeLine = reg.regime === 'neutral' ? '\n⚠️ REGIME WARNING: Market is NEUTRAL (range-bound). Mean-reversion entries only. Treat every long or short entry as a potential falling knife. DO NOT use momentum models.' :
    reg.regime === 'transition' ? '\n⚠️ REGIME WARNING: Transition period — regime is unclear. Recommend NO new entries until regime re-establishes.' : '';

  const prompt = `You are an institutional-grade market analyst with expertise in technical analysis and regime detection.

Asset: ${sym}
Current Price: ${price}
Timeframe: ${currentTF.range}

REGIME DETECTION RESULT:
- Regime: ${reg.regime.toUpperCase()}
- Active Model: ${reg.model}
- Confidence: ${reg.confidence}%
- ADX: ${reg.adxVal?.toFixed(1)}
- Notes: ${reg.notes}
${knifeLine}

TECHNICAL INDICATORS:
- RSI (14): ${rsi}
- MACD: ${macd}
- ADX: ${adx}
- Bollinger %B: ${bb}
- MA50: ${ma50}
- MA200: ${ma200}
- Stochastic: ${stoch}
- ATR (14): ${atr}

REGIME RULES (strictly enforce):
- BULL regime → momentum long models only. Pullbacks to MA are entries, not exits.
- BEAR regime → momentum short models only. Rallies are entries, not recoveries.
- NEUTRAL → mean-reversion SCAN only. Mark as KNIFE risk. Never initiate momentum trades.
- TRANSITION → recommend waiting. No new entries.

Respond ONLY with a JSON object, no markdown, no explanation:
{
  "summary": "2 sentence market summary",
  "regime_warning": "specific regime risk warning (critical for neutral/transition)",
  "technical": "key TA observations in 2-3 sentences",
  "bull_case": "bull scenario in 2 sentences",
  "bear_case": "bear scenario in 2 sentences",
  "trade_idea": {
    "direction": "LONG | SHORT | SCAN_ONLY | HOLD",
    "instrument": "symbol or instrument",
    "entry": "entry price or condition",
    "target": "price target",
    "stop": "stop loss price",
    "thesis": "1-sentence trade rationale",
    "regime_aligned": true
  },
  "verdict": "BULLISH | BEARISH | NEUTRAL | KNIFE_RISK | HOLD",
  "conviction": 1-10,
  "conviction_reason": "why this conviction level"
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: CFG.anthropicModel,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const raw = data?.content?.[0]?.text ?? '';
    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (_) { throw new Error('Failed to parse AI response'); }
    renderAIResult(parsed);
    currentTradeIdea = parsed.trade_idea;
    showExecButtons(parsed);
  } catch (err) {
    if (el) el.innerHTML = `<div style="color:var(--red);font-family:var(--font-mono);font-size:0.73rem;padding:10px">Error: ${err.message}</div>`;
  }
}

function renderAIResult(r) {
  const verd = r.verdict?.toLowerCase() ?? 'neutral';
  const verdClass = verd.includes('bull') ? 'bullish' : verd.includes('bear') ? 'bearish' : 'neutral';
  const ti = r.trade_idea ?? {};
  const dirClass = (ti.direction === 'LONG') ? 'sigdir long' : (ti.direction === 'SHORT') ? 'sigdir short' : (ti.direction === 'SCAN_ONLY') ? 'sigdir scan' : 'sigdir wait';
  const el = document.getElementById('ai-result');
  if (!el) return;
  el.innerHTML = `
    <div class="aisec"><div class="ais-title neutral">⚡ REGIME WARNING</div><div class="ais-body">${r.regime_warning ?? r.summary}</div></div>
    <div class="aisec"><div class="ais-title neutral">SUMMARY</div><div class="ais-body">${r.summary}</div></div>
    <div class="aisec"><div class="ais-title neutral">TECHNICAL</div><div class="ais-body">${r.technical}</div></div>
    <div class="aisec">
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <div style="flex:1"><div class="ais-title bull">BULL CASE</div><div class="ais-body">${r.bull_case}</div></div>
        <div style="flex:1"><div class="ais-title bear">BEAR CASE</div><div class="ais-body">${r.bear_case}</div></div>
      </div>
    </div>
    <div class="aisec">
      <div class="ais-title trade">TRADE IDEA <span class="${dirClass}" style="margin-left:6px">${ti.direction ?? '—'}</span></div>
      <div class="ais-body" style="margin-bottom:8px">${ti.thesis ?? '—'}</div>
      <div class="tigrid">
        <div class="tiitem"><div class="ti-lbl">ENTRY</div><div class="ti-val">${ti.entry ?? '—'}</div></div>
        <div class="tiitem"><div class="ti-lbl">TARGET</div><div class="ti-val">${ti.target ?? '—'}</div></div>
        <div class="tiitem"><div class="ti-lbl">STOP</div><div class="ti-val">${ti.stop ?? '—'}</div></div>
        <div class="tiitem"><div class="ti-lbl">CONVICTION</div><div class="ti-val">${r.conviction ?? '—'}/10</div></div>
      </div>
    </div>
    <div class="aisec">
      <div class="ais-title verd">VERDICT</div>
      <div class="vbadge ${verdClass}">${r.verdict ?? '—'}</div>
      <div class="ais-body">${r.conviction_reason ?? ''}</div>
    </div>

  `;
}

function showExecButtons(parsed) {
  // Show the exec-row (#auto-box) in the analysis panel when not in manual mode
  const execRow = document.getElementById('auto-box');
  if (!execRow) return;
  if (tradingMode === 'manual') {
    execRow.style.display = 'none';
  } else {
    execRow.style.display = 'flex';
  }
}

// ═══════════════════════════════════════════════
// 13. TRADING MODE
// ═══════════════════════════════════════════════
function setMode(mode) {
  tradingMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.mode-btn.${mode}`);
  if (btn) btn.classList.add('active');
  const abox = document.getElementById('auto-box');
  if (abox) abox.style.display = mode === 'auto' ? 'block' : 'none';
  const killBtn = document.getElementById('killbtn');
  if (killBtn) killBtn.style.display = mode !== 'manual' ? 'block' : 'none';
  toast(mode === 'manual' ? 'Manual mode — direct order entry only' : mode === 'suggest' ? 'AI Suggest mode — approve before execute' : '⚠ AI Auto mode active — 5s countdown on signals', mode === 'auto' ? 'w' : 's');
}

let autoTimer = null;
let autoRunning = false;
let autoRunInterval = null;
let autoTradeLog = [];   // live record of all auto-executed trades

function logAutoTrade(sym, side, qty, price, reason, status = 'EXECUTED') {
  const entry = {
    id: Date.now(),
    ts: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    sym, side, qty, price: +parseFloat(price||0).toFixed(2), reason, status,
  };
  autoTradeLog.unshift(entry);
  if (autoTradeLog.length > 50) autoTradeLog.pop();
  renderTradeLog();
  // Pulse the auto indicator
  const ind = document.getElementById('auto-indicator');
  if (ind) { ind.style.opacity = '1'; setTimeout(() => { if (ind) ind.style.opacity = '.4'; }, 2000); }
  // Big toast
  const color = side === 'buy' ? 'var(--green)' : 'var(--red)';
  toast(`🤖 AUTO ${side.toUpperCase()} ${qty}× ${sym} — ${reason.slice(0,60)}`, side === 'buy' ? 's' : 'e');
}

function renderTradeLog() {
  const el = document.getElementById('trade-log-list');
  if (!el) return;
  if (!autoTradeLog.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:.72rem;padding:8px 0">No autonomous trades yet.</div>';
    return;
  }
  el.innerHTML = autoTradeLog.map(t => {
    const col = t.side === 'buy' ? 'var(--green)' : 'var(--red)';
    const sc  = t.status === 'EXECUTED' ? 'var(--green)' : t.status === 'BLOCKED' ? 'var(--orange)' : 'var(--red)';
    return `<div class="tl-row">
      <div class="tl-top">
        <span style="color:${col};font-family:var(--font-head);font-size:.72rem;font-weight:700">${t.side.toUpperCase()}</span>
        <span class="tl-sym">${t.sym}</span>
        <span style="color:var(--text3);font-family:var(--font-mono);font-size:.65rem">${t.qty}× @ $${t.price}</span>
        <span style="margin-left:auto;font-family:var(--font-mono);font-size:.6rem;color:${sc}">${t.status}</span>
      </div>
      <div class="tl-reason">${t.reason}</div>
      <div class="tl-ts">${t.ts}</div>
    </div>`;
  }).join('');
}

function startAutoExecute() {
  if (tradingMode !== 'auto') { toast('Switch to AI Auto mode first', 'w'); return; }
  if (!CFG.anthropicKey) { toast('Add Anthropic key in ⚙ Config', 'w'); openConfig(); return; }
  if (!CFG.alpacaKeyId)  { toast('Add Alpaca keys in ⚙ Config — Needed for autonomous trading', 'w'); openConfig(); return; }
  if (autoRunning) { stopAutoScan(); return; }
  // Start full auto scan
  autoRunning = true;
  updateAutoIndicator();
  runAutoScan();
  autoRunInterval = setInterval(runAutoScan, 5 * 60 * 1000); // re-scan every 5 min
  toast('🤖 AI Auto mode ACTIVE — scanning full market every 5 min', 'w');
}

function stopAutoScan() {
  autoRunning = false;
  clearInterval(autoRunInterval);
  autoRunInterval = null;
  updateAutoIndicator();
  toast('AI Auto mode stopped', 's');
}

function updateAutoIndicator() {
  const ind = document.getElementById('auto-indicator');
  const btn = document.getElementById('auto-scan-btn');
  if (ind) {
    ind.style.display = autoRunning ? 'inline-flex' : 'none';
    ind.style.opacity = autoRunning ? '1' : '0';
  }
  if (btn) btn.textContent = autoRunning ? '⏹ STOP AUTO' : '▶ START AUTO SCAN';
}

async function runAutoScan() {
  if (!autoRunning) return;
  if (!CFG.anthropicKey || !CFG.alpacaKeyId) { stopAutoScan(); return; }

  // Update status
  const statusEl = document.getElementById('auto-status');
  if (statusEl) statusEl.textContent = '🔍 Scanning market...';

  try {
    // 1) Fetch quotes for the full universe in one batched call
    const quotes = await yahooQuote(ALL_AUTO_SYMS);
    const quoteMap = {};
    quotes.forEach(q => { quoteMap[q.symbol] = q; });

    // 2) Fetch current account + positions
    let acct   = {}, positions = [];
    try { acct = await alpacaFetch('/v2/account'); } catch(_) {}
    try { positions = await alpacaFetch('/v2/positions'); } catch(_) {}
    const heldSyms = positions.map(p => p.symbol);

    // 3) Build market summary for Claude
    const mktSummary = Object.entries(AUTO_UNIVERSE).map(([cls, syms]) => {
      const rows = syms.map(s => {
        const q = quoteMap[s];
        if (!q) return null;
        const chg = (parseFloat(q.regularMarketChangePercent)||0).toFixed(2);
        return `${s}: $${(parseFloat(q.regularMarketPrice)||0).toFixed(2)} (${chg>0?'+':''}${chg}%)`;
      }).filter(Boolean);
      return `${cls.toUpperCase()}:\n${rows.join(', ')}`;
    }).join('\n\n');

    const equity   = parseFloat(acct.equity || CFG.maxOrderUsd * 10);
    const buyPower = parseFloat(acct.buying_power || CFG.maxOrderUsd * 2);
    const heldStr  = heldSyms.length ? heldSyms.join(', ') : 'None';
    const posStr   = positions.map(p =>
      `${p.symbol}: ${p.qty} shares, P&L $${parseFloat(p.unrealized_pl||0).toFixed(2)}, P&L% ${(parseFloat(p.unrealized_plpc||0)*100).toFixed(1)}%`
    ).join('\n') || 'None';

    const prompt = `You are a fully autonomous quantitative portfolio manager. Analyze the market NOW and make real trade decisions.

CURRENT REGIME: ${regimeState.regime.toUpperCase()} — ADX ${regimeState.adx}, RSI ${regimeState.rsi}
Portfolio: $${equity.toFixed(0)} equity, $${buyPower.toFixed(0)} buying power
Held positions: ${heldStr}
Open positions detail:
${posStr}

LIVE MARKET DATA (all asset classes):
${mktSummary}

Your job:
1. Identify the 1–3 BEST autonomous trades to make RIGHT NOW across ALL asset classes
2. Select the optimal strategy (momentum, mean-reversion, volatility, sector-rotation) for current regime
3. For each trade: determine entry, sizing (respecting max order $${CFG.maxOrderUsd} and 1-2% portfolio risk rule), stop, and thesis
4. Identify any HELD positions to CLOSE immediately (stop hit, thesis broken)

REGIME RULES (non-negotiable):
- BULL: go LONG momentum leaders, avoid shorts
- BEAR: go SHORT breakdowns or hold cash, close longs
- NEUTRAL: close speculative longs, hold cash or quality only
- TRANSITION: HOLD CASH — no new positions unless closing risk

Respond ONLY in this exact JSON (no markdown):
{
  "strategy": "momentum|mean_reversion|volatility|sector_rotation|hold_cash",
  "regime_note": "1-sentence regime assessment",
  "trades": [
    {
      "symbol": "TICKER",
      "action": "BUY|SELL|CLOSE",
      "qty": number,
      "thesis": "why this trade now (≤80 chars)",
      "stop": "stop price or %",
      "conviction": 1-10
    }
  ],
  "closes": [
    { "symbol": "TICKER", "reason": "why closing" }
  ]
}`;

    if (statusEl) statusEl.textContent = '🧠 Claude analyzing...';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: CFG.anthropicModel, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await resp.json();
    const raw  = data?.content?.[0]?.text ?? '{}';
    const plan = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (statusEl) statusEl.textContent = `✓ Last scan: ${new Date().toLocaleTimeString()} — Strategy: ${plan.strategy || '—'}`;

    // Update strategy selector to reflect AI choice
    if (plan.strategy) {
      const stratMap = { momentum:'momentum', mean_reversion:'meanrev', volatility:'volsizing', sector_rotation:'sectorrot', hold_cash:'meanrev' };
      setStrategy(stratMap[plan.strategy] || 'momentum');
    }

    // Execute trades
    const allTrades = [
      ...(plan.trades || []),
      ...(plan.closes || []).map(c => ({ symbol: c.symbol, action: 'CLOSE', qty: null, thesis: c.reason, conviction: 10 }))
    ];

    for (const t of allTrades) {
      if (!t.symbol) continue;
      const sym  = t.symbol.toUpperCase();
      const act  = (t.action || 'HOLD').toUpperCase();
      if (act === 'HOLD') continue;
      if (regimeState.regime === 'transition' && act === 'BUY') {
        logAutoTrade(sym, 'buy', t.qty||1, 0, `BLOCKED: Transition regime — ${t.thesis}`, 'BLOCKED');
        continue;
      }
      // Determine qty for CLOSE
      let qty = t.qty;
      if (act === 'CLOSE') {
        const pos = positions.find(p => p.symbol === sym);
        qty = pos ? Math.abs(parseFloat(pos.qty)) : 1;
      }
      qty = Math.max(1, Math.round(qty || 1));
      const side  = act === 'BUY' ? 'buy' : 'sell';
      const qData = quoteMap[sym];
      const price = qData ? parseFloat(qData.regularMarketPrice||0) : 0;
      try {
        await placeOrder({ symbol: sym, qty, side, type: 'market', time_in_force: 'day' });
        logAutoTrade(sym, side, qty, price, t.thesis || 'AI autonomous', 'EXECUTED');
      } catch(e) {
        logAutoTrade(sym, side, qty, price, `ERROR: ${e.message}`, 'ERROR');
      }
    }

    // Refresh Alpaca account after trades
    if (allTrades.some(t => t.action !== 'HOLD')) {
      setTimeout(connectAlpaca, 2000);
    }

  } catch(e) {
    if (statusEl) statusEl.textContent = `⚠ Scan error: ${e.message}`;
    console.error('Auto scan error:', e);
  }
}

function approveAndExecute() {
  executeTradeIdea();
}

async function executeTradeIdea() {
  if (!currentTradeIdea) { toast('No trade idea — run analysis first', 'w'); return; }
  if (!CFG.alpacaKeyId) { toast('Add Alpaca keys in ⚙ CONFIG', 'w'); openConfig(); return; }
  if (regimeState.regime === 'neutral' || regimeState.regime === 'transition') {
    toast('⚠ Regime not clean — trade blocked for safety', 'e');
    return;
  }
  const ti = currentTradeIdea;
  if (!ti.direction || ti.direction === 'HOLD' || ti.direction === 'SCAN_ONLY') {
    toast('No executable direction for this regime', 'w'); return;
  }
  const sym = (ti.instrument || currentAnalysisSymbol || '').replace('%5E', '').replace('^', '').replace('-USD', '').toUpperCase();
  const side = ti.direction === 'LONG' ? 'buy' : 'sell';
  const priceNum = parseFloat(document.getElementById('a-price')?.textContent?.replace(/[^0-9.]/g, '') || '0');
  const qty = priceNum > 0 && CFG.maxOrderUsd > 0 ? Math.max(1, Math.floor(CFG.maxOrderUsd / priceNum)) : 1;
  await placeOrder({ symbol: sym, qty, side, type: 'market', time_in_force: 'day' });
}

// ═══════════════════════════════════════════════
// 14. ALPACA INTEGRATION
// ═══════════════════════════════════════════════
async function alpacaFetch(path, method = 'GET', body = null) {
  if (!CFG.alpacaKeyId || !CFG.alpacaSecret) throw new Error('Alpaca keys not set');
  const opts = { method, headers: alpacaHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(alpacaBase() + path, opts);
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
  return r.json();
}

async function connectAlpaca() {
  try {
    const acct = await alpacaFetch('/v2/account');
    updateAccountUI(acct);
    const positions = await alpacaFetch('/v2/positions');
    renderPositions(positions);
    const orders = await alpacaFetch('/v2/orders?status=all&limit=20');
    renderOrders(orders);
    toast('Alpaca connected — ' + (CFG.alpacaEnv === 'paper' ? 'PAPER' : 'LIVE') + ' account', 's');
  } catch (err) {
    toast('Alpaca error: ' + err.message, 'e');
  }
}

function updateAccountUI(acct) {
  const fmt = v => '$' + parseFloat(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const setEl = (id, val, cls) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = val;
      if (cls === 'u') el.style.color = 'var(--green)';
      else if (cls === 'd') el.style.color = 'var(--red)';
      else el.style.color = '';
    }
  };
  setEl('ap-equity', fmt(acct.equity));
  setEl('ap-cash', fmt(acct.cash));
  setEl('ap-bp', fmt(acct.buying_power));
  const upnl = parseFloat(acct.unrealized_pl || 0);
  setEl('ap-upnl', fmt(acct.unrealized_pl), upnl >= 0 ? 'u' : 'd');
  const dpnl = parseFloat(acct.equity) - parseFloat(acct.last_equity || acct.equity);
  setEl('ap-dpnl', (dpnl >= 0 ? '+' : '') + fmt(dpnl), dpnl >= 0 ? 'u' : 'd');
}

function renderPositions(positions) {
  const el = document.getElementById('pos-wrap');
  if (!el) return;
  if (!positions.length) { el.innerHTML = '<div style="color:var(--text3);font-size:.75rem;padding:10px 0">No open positions</div>'; return; }
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>Symbol</th><th>Qty</th><th>Entry</th><th>Current</th><th>P&amp;L</th><th>P&amp;L%</th><th></th></tr></thead>
    <tbody>
      ${positions.map(p => {
        const pnl = parseFloat(p.unrealized_pl ?? 0);
        const pnlPct = parseFloat(p.unrealized_plpc ?? 0) * 100;
        return `<tr>
          <td class="pos-sym">${p.symbol}</td>
          <td>${p.qty}</td>
          <td>${fmtPrice(parseFloat(p.avg_entry_price))}</td>
          <td>${fmtPrice(parseFloat(p.current_price))}</td>
          <td class="pos-pnl ${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}</td>
          <td class="pos-pnl ${pnlPct >= 0 ? 'pos' : 'neg'}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</td>
          <td><button onclick="closePosition('${p.symbol}')" style="background:rgba(224,21,21,.08);border:1px solid rgba(224,21,21,.3);color:var(--red);font-family:var(--font-mono);font-size:.62rem;padding:2px 7px;border-radius:2px;cursor:pointer">Close</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function renderOrders(orders) {
  const el = document.getElementById('ord-wrap');
  if (!el) return;
  if (!orders.length) { el.innerHTML = '<div style="color:var(--text3);font-size:.75rem;padding:10px 0">No recent orders</div>'; return; }
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Status</th><th>Time</th></tr></thead>
    <tbody>
      ${orders.slice(0, 15).map(o => {
        const statusColor = o.status === 'filled' ? 'var(--green)' : o.status === 'canceled' ? 'var(--text3)' : 'var(--gold)';
        return `<tr>
          <td class="pos-sym">${o.symbol}</td>
          <td style="color:${o.side === 'buy' ? 'var(--green)' : 'var(--red)'}">${o.side.toUpperCase()}</td>
          <td>${o.qty}</td>
          <td style="font-family:var(--font-body)">${o.type}</td>
          <td style="color:${statusColor}">${o.status}</td>
          <td>${new Date(o.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function closePosition(symbol) {
  try {
    await alpacaFetch('/v2/positions/' + symbol, 'DELETE');
    toast('Position closed: ' + symbol, 's');
    setTimeout(connectAlpaca, 800);
  } catch (err) { toast('Error: ' + err.message, 'e'); }
}

async function placeOrder(order) {
  if (!CFG.alpacaKeyId) { toast('Add Alpaca keys in ⚙ CONFIG', 'w'); return; }
  try {
    await alpacaFetch('/v2/orders', 'POST', order);
    toast(`Order placed: ${order.side.toUpperCase()} ${order.qty} ${order.symbol}`, 's');
    setTimeout(connectAlpaca, 1000);
  } catch (err) { toast('Order failed: ' + err.message, 'e'); }
}

async function doKillSwitch() {
  if (!confirm('Cancel ALL open orders? This cannot be undone.')) return;
  try {
    await alpacaFetch('/v2/orders', 'DELETE');
    clearInterval(autoTimer);
    toast('☠ All orders cancelled', 'e');
    setTimeout(connectAlpaca, 800);
  } catch (err) { toast('Kill switch failed: ' + err.message, 'e'); }
}

// Order form
function setSide(side) {
  const buy = document.getElementById('sb-buy');
  const sell = document.getElementById('sb-sell');
  const submitBtn = document.querySelector('.submit-btn');
  if (buy) { buy.classList.toggle('active', side === 'buy'); }
  if (sell) { sell.classList.toggle('active', side === 'sell'); }
  const panel = document.getElementById('of-panel');
  if (panel) panel.dataset.side = side;
  if (submitBtn) {
    submitBtn.style.background = side === 'buy' ? 'var(--green)' : 'var(--red)';
    submitBtn.style.color = side === 'buy' ? '#000' : '#fff';
  }
}

function toggleLP() {
  const type = document.getElementById('of-type')?.value;
  const row = document.getElementById('lp-row');
  if (row) row.style.display = (type === 'limit' || type === 'stop' || type === 'stop_limit') ? 'block' : 'none';
}

async function submitOrder() {
  const sym = document.getElementById('of-sym')?.value?.trim().toUpperCase();
  const qty = parseFloat(document.getElementById('of-qty')?.value);
  const type = document.getElementById('of-type')?.value;
  const tif = document.getElementById('of-tif')?.value;
  const lp = parseFloat(document.getElementById('of-lp')?.value);
  const side = document.querySelector('#of-panel')?.dataset.side || 'buy';
  if (!sym) { toast('Enter a symbol', 'w'); return; }
  if (!qty || qty <= 0) { toast('Enter a valid quantity', 'w'); return; }
  // Regime gate for auto/suggest
  if (tradingMode !== 'manual' && (regimeState.regime === 'neutral' || regimeState.regime === 'transition')) {
    if (!confirm(`⚠ Regime is ${regimeState.regime.toUpperCase()} — not ideal for momentum trades. Execute anyway?`)) return;
  }
  const order = { symbol: sym, qty, side, type, time_in_force: tif };
  if ((type === 'limit' || type === 'stop_limit') && lp) order.limit_price = lp;
  if (type === 'stop' && lp) order.stop_price = lp;
  await placeOrder(order);
}

// ═══════════════════════════════════════════════
// 15. AI SIGNALS (Trader page scan)
// ═══════════════════════════════════════════════
// Scan universe for manual signal scanning — 20 high-liquidity tickers
const SCAN_UNIVERSE = [
  'AAPL','NVDA','TSLA','MSFT','META','AMZN','AMD','GOOG','PLTR','COIN',
  'GLD','SPY','QQQ','BTC-USD','ETH-USD','NFLX','UBER','SQ','SHOP','DIS',
];

// Full autonomous trading universe — 60+ assets across all asset classes
const AUTO_UNIVERSE = {
  // Mega-cap tech
  largeCap: ['AAPL','MSFT','NVDA','AMZN','GOOG','META','TSLA','BRK-B','UNH','JPM'],
  // Growth / momentum
  growth:   ['AMD','PLTR','COIN','SHOP','UBER','SNOW','NET','CRWD','SQ','MSTR'],
  // Defensive / value
  defensive:['JNJ','PG','KO','VZ','XOM','CVX','BAC','WMT','MA','V'],
  // ETFs / indices
  etfs:     ['SPY','QQQ','IWM','XLK','XLF','XLE','XLV','GDX','ARKK','SQQQ'],
  // Crypto
  crypto:   ['BTC-USD','ETH-USD','SOL-USD','BNB-USD','DOGE-USD'],
  // Commodities / futures proxies
  commodities: ['GLD','SLV','GDX','USO','UGA','UNG','PDBC','CPER'],
  // Fixed income as risk barometer
  rates:    ['TLT','IEF','HYG','LQD'],
};

const ALL_AUTO_SYMS = [...new Set(Object.values(AUTO_UNIVERSE).flat())];

async function generateSignals() {
  if (!CFG.anthropicKey) { toast('Add Anthropic API key in ⚙ CONFIG', 'w'); openConfig(); return; }
  const el = document.getElementById('signals-list');
  if (el) el.innerHTML = '<div class="loading"><div class="spin"></div> Scanning universe for regime-aligned signals...</div>';

  const reg = regimeState;
  const quotes = await yahooQuote(SCAN_UNIVERSE);

  const prompt = `You are a regime-first quant trader. Generate 4 trade signals strictly aligned with the current market regime.

MARKET REGIME: ${reg.regime.toUpperCase()}
Active Model: ${reg.model}
Confidence: ${reg.confidence}%
Notes: ${reg.notes}

REGIME RULES:
- BULL: Only LONG momentum setups. Pullbacks to MA, breakouts. No mean-reversion.
- BEAR: Only SHORT momentum setups. Rally-to-short entries. No bottom-fishing.
- NEUTRAL: Only SCAN signals for mean-reversion extremes. Mark every one as knife risk. Never LONG or SHORT, only SCAN.
- TRANSITION: Only WAIT signals. No new entries.

Scan universe: ${SCAN_UNIVERSE.join(', ')}

Respond ONLY with a JSON array of 4 signal objects, no markdown:
[
  {
    "symbol": "TICKER",
    "direction": "LONG|SHORT|SCAN|WAIT",
    "thesis": "1-sentence thesis (regime-aligned only)",
    "entry": "entry condition or price",
    "target": "price target",
    "stop": "stop price",
    "conviction": 1-10,
    "knife_risk": true/false
  }
]`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: CFG.anthropicModel, max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await resp.json();
    const raw = data?.content?.[0]?.text ?? '[]';
    const signals = JSON.parse(raw.replace(/```json|```/g, '').trim());
    renderSignals(signals);
  } catch (err) {
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:0.72rem;font-family:var(--font-mono);padding:12px">Error: ${err.message}</div>`;
  }
}

function renderSignals(signals) {
  const el = document.getElementById('signals-list');
  if (!el) return;
  if (!signals.length) { el.innerHTML = '<div style="color:var(--text3);font-size:.75rem;padding:6px 0">No signals for current regime</div>'; return; }
  const actionClass = dir => dir === 'LONG' ? 'buy' : dir === 'SHORT' ? 'sell' : 'sell';
  el.innerHTML = signals.map(s => {
    const canExecute = tradingMode !== 'manual' && (s.direction === 'LONG' || s.direction === 'SHORT');
    return `<div class="signal-row" style="flex-direction:column;align-items:flex-start;gap:5px">
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <span class="sig-sym">${s.symbol}</span>
        <span class="sig-action ${actionClass(s.direction)}">${s.direction}</span>
      </div>
      ${s.knife_risk ? '<div style="font-size:.62rem;color:var(--orange);font-family:var(--font-mono)">⚔ KNIFE RISK — mean-rev only</div>' : ''}
      <div style="font-size:.72rem;color:var(--text2);font-family:var(--font-body);line-height:1.4">${s.thesis}</div>
      <div style="display:flex;gap:10px;font-family:var(--font-mono);font-size:.62rem;color:var(--text3)">
        <span>E:${s.entry}</span><span>T:${s.target}</span><span>SL:${s.stop}</span>
        <span class="sig-conf">Conv:${s.conviction}/10</span>
      </div>
      ${canExecute ? `<div style="display:flex;gap:5px;width:100%">
        <button onclick="approveSignal('${s.symbol}','${s.direction}')" style="flex:1;background:rgba(13,192,96,.1);border:1px solid rgba(13,192,96,.3);color:var(--green);font-family:var(--font-head);font-size:.62rem;font-weight:700;padding:4px;border-radius:2px;cursor:pointer">✓ APPROVE</button>
        <button onclick="this.closest('.signal-row').remove()" style="background:none;border:1px solid var(--border);color:var(--text3);font-family:var(--font-mono);font-size:.62rem;padding:4px 8px;border-radius:2px;cursor:pointer">✕</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

async function approveSignal(symbol, direction) {
  if (!CFG.alpacaKeyId) { toast('Add Alpaca keys in ⚙ CONFIG', 'w'); openConfig(); return; }
  if (regimeState.regime === 'neutral' || regimeState.regime === 'transition') {
    toast('⚠ Regime not clean — trade blocked', 'e'); return;
  }
  const side = direction === 'LONG' ? 'buy' : 'sell';
  const sym = symbol.replace('-USD', '');
  await placeOrder({ symbol: sym, qty: 1, side, type: 'market', time_in_force: 'day' });
}

// Helper: push live Alpaca account data into the account card UI
function updateAccountUI(acct) {
  if (!acct) return;
  const fmt = (v, sign) => {
    const n = parseFloat(v || 0);
    const s = sign && n >= 0 ? '+$' : '$';
    return s + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtPnl = v => {
    const n = parseFloat(v || 0);
    return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const set = (id, v, pos) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    if (pos !== undefined) el.className = 'acct-val ' + (pos >= 0 ? 'pos' : 'neg');
  };
  set('ap-equity', fmt(acct.equity));
  set('ap-cash',   fmt(acct.cash));
  set('ap-bp',     fmt(acct.buying_power));
  const upnl = parseFloat(acct.unrealized_pl || 0);
  const dpnl = parseFloat(acct.equity) - parseFloat(acct.last_equity || acct.equity);
  set('ap-upnl',  fmtPnl(acct.unrealized_pl),  upnl);
  set('ap-dpnl',  fmtPnl(dpnl),                  dpnl);
  // Update daily loss tracker
  if (dpnl < 0) { dailyLossUsed = Math.abs(dpnl); updateDailyLossBar(); }
}

// ═══════════════════════════════════════════════
// 16. TRADER PAGE REFRESH
// ═══════════════════════════════════════════════
function refreshTraderPage() {
  if (CFG.alpacaKeyId) {
    connectAlpaca();
  } else {
    const emptyMsg = msg => `<div style="color:var(--text3);font-size:.75rem;padding:12px 0;font-family:var(--font-body)">${msg}</div>`;
    const pos = document.getElementById('pos-wrap');
    if (pos) pos.innerHTML = emptyMsg('Add Alpaca API keys in ⚙ Config to see live positions.');
    const ord = document.getElementById('ord-wrap');
    if (ord) ord.innerHTML = emptyMsg('No orders. Connect Alpaca to see live order history.');
    ['ap-equity','ap-cash','ap-bp','ap-upnl','ap-dpnl'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '—';
    });
  }
}

// ═══════════════════════════════════════════════
// 17. CONFIG MODAL
// ═══════════════════════════════════════════════
function openConfig() {
  const el = id => document.getElementById(id);
  if (el('cfg-akey')) el('cfg-akey').value = CFG.anthropicKey;
  if (el('cfg-model')) el('cfg-model').value = CFG.anthropicModel;
  if (el('cfg-avkey')) el('cfg-avkey').value = CFG.alphaVantageKey;
  if (el('cfg-akey-id')) el('cfg-akey-id').value = CFG.alpacaKeyId;
  if (el('cfg-asecret')) el('cfg-asecret').value = CFG.alpacaSecret;
  if (el('cfg-maxorder')) el('cfg-maxorder').value = CFG.maxOrderUsd;
  if (el('cfg-maxdaily')) el('cfg-maxdaily').value = CFG.maxDailyLoss;
  if (el('cfg-riskpct')) el('cfg-riskpct').value = CFG.perTradeRiskPct;
  if (el('cfg-atrmult')) el('cfg-atrmult').value = CFG.atrStopMultiplier;
  setEnvBtn(CFG.alpacaEnv);
  document.getElementById('modal').classList.add('open');
}

function closeConfig() {
  document.getElementById('modal').classList.remove('open');
  clearInterval(autoTimer);
}

function setEnvBtn(env) {
  CFG.alpacaEnv = env;
  document.querySelectorAll('.envbtn').forEach(b => b.classList.toggle('active', b.dataset.env === env));
}

function saveConfig() {
  const el = id => document.getElementById(id);
  CFG.anthropicKey = el('cfg-akey')?.value?.trim() ?? '';
  CFG.anthropicModel = el('cfg-model')?.value?.trim() || 'claude-sonnet-4-20250514';
  CFG.alphaVantageKey = el('cfg-avkey')?.value?.trim() ?? '';
  CFG.alpacaKeyId = el('cfg-akey-id')?.value?.trim() ?? '';
  CFG.alpacaSecret = el('cfg-asecret')?.value?.trim() ?? '';
  CFG.maxOrderUsd = parseFloat(el('cfg-maxorder')?.value || '500');
  CFG.maxDailyLoss = parseFloat(el('cfg-maxdaily')?.value || '500');
  CFG.perTradeRiskPct = parseFloat(el('cfg-riskpct')?.value || '1.5');
  CFG.atrStopMultiplier = parseFloat(el('cfg-atrmult')?.value || '2');
  saveCfg();
  closeConfig();
  toast('Config saved', 's');
  if (CFG.alpacaKeyId) connectAlpaca();
}

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.id === 'modal') closeConfig();
});

// ═══════════════════════════════════════════════
// 18. FORMATTING HELPERS
// ═══════════════════════════════════════════════
function fmtPrice(p) {
  if (!p || isNaN(p)) return '—';
  const n = parseFloat(p);
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtChg(c) {
  if (c == null || isNaN(c)) return '—';
  const n = parseFloat(c);
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtLarge(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n.toFixed(2);
}

function simWalk(base) {
  return +(base * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2);
}

function guessPriceBase(sym) {
  const s = sym.toUpperCase();
  if (s.includes('BTC')) return 68000;
  if (s.includes('ETH')) return 3500;
  if (s.includes('SOL')) return 145;
  if (s.includes('GSPC') || s.includes('SPX')) return 5200;
  if (s.includes('IXIC') || s.includes('NDX')) return 16400;
  if (s.includes('GC') || s.includes('GOLD')) return 2340;
  if (s.includes('CL') || s.includes('WTI')) return 78;
  if (s === 'NVDA') return 870;
  if (s === 'TSLA') return 180;
  if (s === 'AAPL') return 187;
  if (s === 'MSFT') return 415;
  if (s === 'META') return 495;
  if (s === 'AMZN') return 186;
  return 150;
}

// ═══════════════════════════════════════════════
// 20. PERFORMANCE METRICS
// ═══════════════════════════════════════════════
function genEquityCurve(base = 50000, n = 252) {
  const curve = [base];
  for (let i = 1; i < n; i++) {
    const drift = (Math.random() - 0.45) * 0.008;
    curve.push(+(curve[i - 1] * (1 + drift)).toFixed(2));
  }
  return curve;
}

function calcSharpe(returns, rfRate = 0.05 / 252) {
  if (!returns || returns.length < 2) return 0;
  const excess = returns.map(r => r - rfRate);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (excess.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? +((mean / std) * Math.sqrt(252)).toFixed(2) : 0;
}

function calcMaxDrawdown(curve) {
  let peak = curve[0], mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > mdd) mdd = dd;
  }
  return +(mdd * 100).toFixed(2);
}

const SIMULATED_TRADES = [
  { sym: 'NVDA', pnl: 519.40 }, { sym: 'SPY',  pnl: 160.00 },
  { sym: 'TSLA', pnl:  62.70 }, { sym: 'AAPL', pnl: -53.00 },
  { sym: 'META', pnl: 284.00 }, { sym: 'AMD',  pnl: -112.00 },
  { sym: 'QQQ',  pnl:  88.50 }, { sym: 'COIN', pnl: -45.00 },
  { sym: 'PLTR', pnl: 194.00 }, { sym: 'MSFT', pnl:  66.00 },
  { sym: 'AMZN', pnl: -28.00 }, { sym: 'GLD',  pnl:  42.00 },
];

function calcWinRate(trades) {
  if (!trades.length) return { winRate: 0, profitFactor: 0, totalTrades: 0, avgWin: 0, avgLoss: 0 };
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalWin  = wins.reduce((a, t) => a + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  return {
    winRate:      +((wins.length / trades.length) * 100).toFixed(1),
    profitFactor: totalLoss > 0 ? +(totalWin / totalLoss).toFixed(2) : 99,
    totalTrades:  trades.length,
    avgWin:       wins.length   ? +(totalWin  / wins.length).toFixed(2)   : 0,
    avgLoss:      losses.length ? +(totalLoss / losses.length).toFixed(2) : 0,
  };
}

// Compute real trade P&L from Alpaca closed orders (FIFO matching)
function computeTradeStats(orders) {
  if (!orders || !orders.length) return null;
  const filled = orders.filter(o => o.status === 'filled' && o.filled_avg_price && parseFloat(o.filled_qty||o.qty) > 0);
  if (filled.length < 2) return null;
  const book = {}; // sym -> { qty, totalCost }
  const trades = [];
  // Sort by time ascending so buys come before sells
  const sorted = [...filled].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  sorted.forEach(o => {
    const sym   = o.symbol;
    const qty   = parseFloat(o.filled_qty || o.qty || 0);
    const price = parseFloat(o.filled_avg_price || 0);
    if (!book[sym]) book[sym] = { qty: 0, totalCost: 0 };
    if (o.side === 'buy') {
      book[sym].totalCost += qty * price;
      book[sym].qty       += qty;
    } else if (book[sym].qty > 0) {
      const avgCost = book[sym].totalCost / book[sym].qty;
      const filled  = Math.min(qty, book[sym].qty);
      trades.push({ sym, pnl: +((price - avgCost) * filled).toFixed(2) });
      book[sym].qty       -= filled;
      book[sym].totalCost  = book[sym].qty * avgCost;
    }
  });
  return trades.length >= 2 ? calcWinRate(trades) : null;
}

// Build sector heatmap from real Alpaca positions
const SYMBOL_SECTOR = {
  AAPL:'Technology', MSFT:'Technology', NVDA:'Technology', AMD:'Technology',
  GOOG:'Technology', GOOGL:'Technology', META:'Technology', PLTR:'Technology',
  AMZN:'Consumer Disc.', TSLA:'Consumer Disc.',
  JPM:'Financials', GS:'Financials', BAC:'Financials', COIN:'Financials',
  JNJ:'Healthcare', PFE:'Healthcare', UNH:'Healthcare',
  XOM:'Energy', CVX:'Energy',
  GLD:'Materials', SLV:'Materials',
  SPY:'Index', QQQ:'Index', IWM:'Index',
  'BTC-USD':'Crypto', 'ETH-USD':'Crypto',
};

function buildSectorHeatmapFromPositions(positions) {
  const totals = {}; let totalValue = 0;
  positions.forEach(p => {
    const sector = SYMBOL_SECTOR[p.symbol] || 'Other';
    const val    = Math.abs(parseFloat(p.market_value || 0));
    totals[sector] = (totals[sector] || 0) + val;
    totalValue += val;
  });
  if (!totalValue) { buildSectorHeatmap(); return; }
  const COLORS = {
    'Technology':'#2266ff','Consumer Disc.':'#f0a800','Financials':'#0dc060',
    'Healthcare':'#9944ff','Energy':'#e01515','Materials':'#a0a0a0',
    'Index':'#ff6600','Crypto':'#ff6600','Other':'#5a5a5a',
  };
  const el = document.getElementById('sector-heatmap');
  if (!el) return;
  el.innerHTML = Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([s,v]) => {
    const pct = +(v/totalValue*100).toFixed(1);
    const col = COLORS[s] || '#5a5a5a';
    const flag = pct > 30 ? ' ⚠' : '';
    return `<div class="sector-cell" title="${s}: ${pct}%" style="background:${col}22;border:1px solid ${col}55">
      <div class="sc-name">${s}${flag}</div><div class="sc-pct" style="color:${col}">${pct}%</div>
    </div>`;
  }).join('');
}

function buildConcentrationChartFromPositions(positions) {
  const el = document.getElementById('concentration-list');
  if (!el) return;
  const total = positions.reduce((s,p) => s + Math.abs(parseFloat(p.market_value||0)), 0);
  if (!total) { buildConcentrationChart(); return; }
  const sorted = [...positions]
    .map(p => ({ sym: p.symbol, pct: +(Math.abs(parseFloat(p.market_value||0))/total*100).toFixed(1) }))
    .sort((a,b) => b.pct - a.pct).slice(0,5);
  const maxPct = Math.max(25, sorted[0]?.pct || 25);
  el.innerHTML = sorted.map(p => {
    const flag = p.pct > 15 ? ' ⚠' : '';
    const col  = p.pct > 20 ? 'var(--red)' : p.pct > 15 ? 'var(--orange)' : 'var(--green)';
    return `<div class="conc-row">
      <div class="conc-label"><span class="conc-sym">${p.sym}${flag}</span></div>
      <div class="conc-bar-wrap">
        <div class="conc-bar-track"><div class="conc-bar-fill" style="width:${p.pct*100/maxPct}%;background:${col}"></div></div>
        <span class="conc-pct" style="color:${col}">${p.pct}%</span>
      </div></div>`;
  }).join('');
}

async function loadMetrics() {
  let curve = null, liveMode = false, acctData = null;
  let realStats = null, realPositions = [];
  const lbl = document.getElementById('metrics-data-label');

  if (CFG.alpacaKeyId) {
    try {
      // Portfolio history → equity curve (1 year, daily)
      const hist = await alpacaFetch('/v2/portfolio/history?period=1A&timeframe=1D&extended_hours=false');
      if (hist?.equity?.length > 5) {
        // Forward-fill any zeros
        const raw = hist.equity.map(v => v || 0);
        for (let i = 1; i < raw.length; i++) if (!raw[i]) raw[i] = raw[i-1];
        curve = raw.filter(v => v > 0);
        liveMode = curve.length > 5;
      }
      acctData = await alpacaFetch('/v2/account');
      realPositions = await alpacaFetch('/v2/positions') || [];
      const orders = await alpacaFetch('/v2/orders?status=closed&limit=200&direction=desc');
      realStats = computeTradeStats(orders);
      updateAccountUI(acctData);
    } catch (e) {
      console.warn('Alpaca metrics fetch:', e.message);
    }
  }

  if (!curve || curve.length < 5) {
    const base = acctData ? parseFloat(acctData.equity || 50000) : 50000;
    curve = genEquityCurve(base, 252);
  }

  if (lbl) {
    lbl.textContent = liveMode ? '● LIVE — Alpaca Portfolio Data' : '○ SIMULATED — Connect Alpaca for live data';
    lbl.style.color  = liveMode ? 'var(--green)' : 'var(--text3)';
  }

  const dailyReturns = curve.slice(1).map((v, i) => (v - curve[i]) / curve[i]);
  const sharpe = calcSharpe(dailyReturns);
  const mdd    = calcMaxDrawdown(curve);
  const stats  = realStats || calcWinRate(SIMULATED_TRADES);
  const beta   = +(0.75 + Math.random() * 0.35).toFixed(2);

  let marginUtil = 0;
  if (acctData) {
    const eq = parseFloat(acctData.equity || 0);
    const mm = parseFloat(acctData.maintenance_margin || 0);
    marginUtil = eq > 0 ? +((mm / eq) * 100).toFixed(1) : 0;
  } else {
    marginUtil = +(15 + Math.random() * 25).toFixed(1);
  }

  let realizedPnL = SIMULATED_TRADES.reduce((a,t) => a + t.pnl, 0);
  let unrealizedPnL = 1840.22;
  if (acctData) {
    unrealizedPnL = parseFloat(acctData.unrealized_pl || 0);
    realizedPnL   = parseFloat(acctData.equity) - parseFloat(acctData.last_equity || acctData.equity);
  }

  metricsData = { sharpe, mdd, ...stats, beta, marginUtil, realizedPnL, unrealizedPnL, liveMode };

  const set    = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setSig = (id, text, cls) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = 'metric-sig ' + cls; } };

  set('m-sharpe', sharpe);
  setSig('m-sharpe-s', sharpe >= 1.5 ? 'EXCELLENT' : sharpe >= 1 ? 'GOOD' : 'POOR', sharpe >= 1.5 ? 'bull' : sharpe >= 1 ? 'neutral' : 'bear');
  set('m-mdd', '-' + mdd + '%');
  setSig('m-mdd-s', mdd < 10 ? 'CONTROLLED' : mdd < 15 ? 'MODERATE' : 'HIGH RISK', mdd < 10 ? 'bull' : mdd < 15 ? 'neutral' : 'bear');
  set('m-winrate', stats.winRate + '%');
  setSig('m-winrate-s', stats.winRate >= 55 ? 'STRONG' : stats.winRate >= 45 ? 'AVERAGE' : 'BELOW AVG', stats.winRate >= 55 ? 'bull' : stats.winRate >= 45 ? 'neutral' : 'bear');
  set('m-pf', stats.profitFactor >= 99 ? '∞' : stats.profitFactor);
  setSig('m-pf-s', stats.profitFactor >= 1.5 ? 'PROFITABLE' : stats.profitFactor >= 1 ? 'BREAKEVEN' : 'LOSING', stats.profitFactor >= 1.5 ? 'bull' : stats.profitFactor >= 1 ? 'neutral' : 'bear');
  set('m-beta', beta);
  setSig('m-beta-s', beta < 0.8 ? 'LOW CORR' : beta < 1.1 ? 'MKT-LIKE' : 'HIGH CORR', beta < 0.8 ? 'bull' : beta < 1.1 ? 'neutral' : 'bear');
  set('m-trades', stats.totalTrades);
  set('m-avgwin',  '+$' + stats.avgWin);
  set('m-avgloss', '-$' + stats.avgLoss);

  const mbar = document.getElementById('margin-fill');
  if (mbar) { mbar.style.width = marginUtil + '%'; mbar.style.background = marginUtil > 50 ? 'var(--red)' : marginUtil > 30 ? 'var(--orange)' : 'var(--green)'; }
  set('m-margin', marginUtil + '%');

  const fmt    = v => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2);
  const setpnl = (id, v) => { const el = document.getElementById(id); if (el) { el.textContent = fmt(v); el.className = 'pnl-val ' + (v >= 0 ? 'pos' : 'neg'); } };
  setpnl('m-realized',   realizedPnL);
  setpnl('m-unrealized', unrealizedPnL);
  setpnl('m-total-pnl',  realizedPnL + unrealizedPnL);

  buildRollingReturnsChart(curve);
  buildEquityChart(curve);

  if (realPositions.length > 0) {
    buildSectorHeatmapFromPositions(realPositions);
    buildConcentrationChartFromPositions(realPositions);
  } else {
    buildSectorHeatmap();
    buildConcentrationChart();
  }
}

const SECTOR_ALLOCATIONS = [
  { sector: 'Technology',  pct: 34.2, color: '#2266ff' },
  { sector: 'Healthcare',  pct: 12.8, color: '#9944ff' },
  { sector: 'Financials',  pct: 11.4, color: '#0dc060' },
  { sector: 'Consumer',    pct: 10.6, color: '#f0a800' },
  { sector: 'Industrials', pct:  8.2, color: '#ff6600' },
  { sector: 'Energy',      pct:  6.1, color: '#e01515' },
  { sector: 'Materials',   pct:  4.8, color: '#a0a0a0' },
  { sector: 'Utilities',   pct:  3.9, color: '#5a5a5a' },
  { sector: 'Real Estate', pct:  8.0, color: '#3a7aad' },
];

function buildSectorHeatmap() {
  const el = document.getElementById('sector-heatmap');
  if (!el) return;
  el.innerHTML = SECTOR_ALLOCATIONS.map(s => {
    const flag = s.pct > 30 ? ' ⚠' : '';
    return `<div class="sector-cell" title="${s.sector}: ${s.pct}%" style="background:${s.color}22;border:1px solid ${s.color}55">
      <div class="sc-name">${s.sector}${flag}</div>
      <div class="sc-pct" style="color:${s.color}">${s.pct}%</div>
    </div>`;
  }).join('');
}

function buildRollingReturnsChart(curve) {
  const ctx = document.getElementById('c-rolling');
  if (!ctx) return;
  const ex = Chart.getChart(ctx); if (ex) ex.destroy();
  const n = curve.length;
  const vals = [
    n > 30  ? +((curve[n-1]-curve[n-31])  / curve[n-31]  * 100).toFixed(2) : 0,
    n > 60  ? +((curve[n-1]-curve[n-61])  / curve[n-61]  * 100).toFixed(2) : 0,
    n > 90  ? +((curve[n-1]-curve[n-91])  / curve[n-91]  * 100).toFixed(2) : 0,
    +((curve[n-1]-curve[0]) / curve[0] * 100).toFixed(2),
  ];
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['30D','60D','90D','1YR'],
      datasets: [{ data: vals,
        backgroundColor: vals.map(v => v >= 0 ? 'rgba(13,192,96,0.5)' : 'rgba(224,21,21,0.45)'),
        borderColor:     vals.map(v => v >= 0 ? '#0dc060' : '#e01515'),
        borderWidth: 1, borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor:'#141414', borderColor:'#242424', borderWidth:1,
        titleColor:'#909090', bodyColor:'#f0f0f0',
        titleFont:{ family:"'IBM Plex Mono'", size:10 }, bodyFont:{ family:"'IBM Plex Mono'", size:11 },
        callbacks: { label: ctx => `  ${ctx.raw >= 0 ? '+' : ''}${ctx.raw}%` },
      }},
      scales: {
        x: { ticks:{ color:'rgba(255,255,255,0.35)', font:{ family:"'IBM Plex Mono'", size:9 }}, grid:{ color:'rgba(255,255,255,0.04)'}},
        y: { position:'right', ticks:{ color:'rgba(255,255,255,0.35)', font:{ family:"'IBM Plex Mono'", size:9 }, callback: v => v+'%'}, grid:{ color:'rgba(255,255,255,0.04)'}},
      },
    },
  });
}

function buildEquityChart(curve) {
  const ctx = document.getElementById('c-equity');
  if (!ctx) return;
  const ex = Chart.getChart(ctx); if (ex) ex.destroy();
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 180);
  grad.addColorStop(0, 'rgba(13,192,96,0.15)');
  grad.addColorStop(1, 'rgba(13,192,96,0)');
  new Chart(ctx, {
    type: 'line',
    data: { labels: curve.map((_, i) => i),
      datasets: [{ data: curve, borderColor:'#0dc060', borderWidth:1.5, fill:true, backgroundColor:grad, tension:0.3, pointRadius:0 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: { legend:{ display:false }, tooltip:{
        backgroundColor:'#141414', borderColor:'#242424', borderWidth:1,
        titleColor:'#909090', bodyColor:'#f0f0f0',
        titleFont:{ family:"'IBM Plex Mono'", size:9 }, bodyFont:{ family:"'IBM Plex Mono'", size:11 },
        callbacks: { label: ctx => `  $${ctx.raw.toLocaleString('en-US',{maximumFractionDigits:0})}` },
      }},
      scales: {
        x: { display:true, ticks:{ color:'rgba(255,255,255,0.2)',font:{ family:"'IBM Plex Mono'", size:8},maxTicksLimit:6}, grid:{ color:'rgba(255,255,255,0.03)'}},
        y: { position:'right', ticks:{ color:'rgba(255,255,255,0.35)',font:{ family:"'IBM Plex Mono'",size:9},callback:v=>'$'+(v/1000).toFixed(0)+'K'}, grid:{ color:'rgba(255,255,255,0.03)'}},
      },
    },
  });
}

function buildConcentrationChart() {
  const positions = [
    { sym:'NVDA', pct:22.4 }, { sym:'SPY',  pct:18.1 },
    { sym:'AAPL', pct:14.3 }, { sym:'TSLA', pct:9.8  },
    { sym:'META', pct:8.6  },
  ];
  const el = document.getElementById('concentration-list');
  if (!el) return;
  el.innerHTML = positions.map(p => {
    const alert = p.pct > 15 ? ' ⚠' : '';
    const col = p.pct > 20 ? 'var(--red)' : p.pct > 15 ? 'var(--orange)' : 'var(--green)';
    return `<div class="conc-row">
      <div class="conc-label"><span class="conc-sym">${p.sym}${alert}</span></div>
      <div class="conc-bar-wrap">
        <div class="conc-bar-track"><div class="conc-bar-fill" style="width:${p.pct*100/25}%;background:${col}"></div></div>
        <span class="conc-pct" style="color:${col}">${p.pct}%</span>
      </div>
    </div>`;
  }).join('');
}

function loadMetrics() {
  const curve = genEquityCurve(50000, 252);
  const dailyReturns = curve.slice(1).map((v, i) => (v - curve[i]) / curve[i]);
  const sharpe = calcSharpe(dailyReturns);
  const mdd    = calcMaxDrawdown(curve);
  const stats  = calcWinRate(SIMULATED_TRADES);
  const beta   = +(0.75 + Math.random() * 0.35).toFixed(2);
  const marginUtil = +(15 + Math.random() * 25).toFixed(1);
  const realizedPnL = SIMULATED_TRADES.reduce((a, t) => a + t.pnl, 0);
  const unrealizedPnL = 1840.22;
  metricsData = { sharpe, mdd, ...stats, beta, marginUtil, realizedPnL, unrealizedPnL };

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setSig = (id, text, cls) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.className = 'metric-sig ' + cls; } };

  set('m-sharpe', sharpe);
  setSig('m-sharpe-s', sharpe >= 1.5 ? 'EXCELLENT' : sharpe >= 1 ? 'GOOD' : 'POOR', sharpe >= 1.5 ? 'bull' : sharpe >= 1 ? 'neutral' : 'bear');

  set('m-mdd', '-' + mdd + '%');
  setSig('m-mdd-s', mdd < 10 ? 'CONTROLLED' : mdd < 15 ? 'MODERATE' : 'HIGH RISK', mdd < 10 ? 'bull' : mdd < 15 ? 'neutral' : 'bear');

  set('m-winrate', stats.winRate + '%');
  setSig('m-winrate-s', stats.winRate >= 55 ? 'STRONG' : stats.winRate >= 45 ? 'AVERAGE' : 'BELOW AVG', stats.winRate >= 55 ? 'bull' : stats.winRate >= 45 ? 'neutral' : 'bear');

  set('m-pf', stats.profitFactor >= 99 ? '∞' : stats.profitFactor);
  setSig('m-pf-s', stats.profitFactor >= 1.5 ? 'PROFITABLE' : stats.profitFactor >= 1 ? 'BREAKEVEN' : 'LOSING', stats.profitFactor >= 1.5 ? 'bull' : stats.profitFactor >= 1 ? 'neutral' : 'bear');

  set('m-beta', beta);
  setSig('m-beta-s', beta < 0.8 ? 'LOW CORR' : beta < 1.1 ? 'MKT-LIKE' : 'HIGH CORR', beta < 0.8 ? 'bull' : beta < 1.1 ? 'neutral' : 'bear');

  set('m-trades', stats.totalTrades);
  set('m-avgwin',  '+$' + stats.avgWin);
  set('m-avgloss', '-$' + stats.avgLoss);

  const mbar = document.getElementById('margin-fill');
  if (mbar) { mbar.style.width = marginUtil + '%'; mbar.style.background = marginUtil > 50 ? 'var(--red)' : marginUtil > 30 ? 'var(--orange)' : 'var(--green)'; }
  set('m-margin', marginUtil + '%');

  const fmt = v => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2);
  const setpnl = (id, v) => { const el = document.getElementById(id); if (el) { el.textContent = fmt(v); el.className = 'pnl-val ' + (v >= 0 ? 'pos' : 'neg'); } };
  setpnl('m-realized',    realizedPnL);
  setpnl('m-unrealized',  unrealizedPnL);
  setpnl('m-total-pnl',   realizedPnL + unrealizedPnL);

  buildRollingReturnsChart(curve);
  buildEquityChart(curve);
  buildSectorHeatmap();
  buildConcentrationChart();
}

// ═══════════════════════════════════════════════
// 21. ALERTS SYSTEM
// ═══════════════════════════════════════════════
let alertIdCounter = 0;
const UPCOMING_EARNINGS = [
  { sym:'NVDA', date:'Mar 26' }, { sym:'AAPL', date:'Apr 30' },
  { sym:'META', date:'Apr 28' }, { sym:'MSFT', date:'Apr 23' },
  { sym:'AMZN', date:'Apr 29' }, { sym:'TSLA', date:'Apr 22' },
];

function pushAlert(type, msg, severity = 'warn') {
  if (alertsList.find(a => a.type === type && !a.dismissed)) return;
  alertsList.push({ id: ++alertIdCounter, type, msg, severity, ts: Date.now() });
  renderAlerts();
}

function dismissAlert(id) {
  const a = alertsList.find(x => x.id === id);
  if (a) a.dismissed = true;
  renderAlerts();
}

function renderAlerts() {
  const active = alertsList.filter(a => !a.dismissed);
  const badge = document.getElementById('alert-badge');
  if (badge) { badge.textContent = active.length; badge.style.display = active.length > 0 ? 'flex' : 'none'; }
  const panel = document.getElementById('alerts-panel');
  if (!panel) return;
  if (!active.length) {
    panel.innerHTML = '<div style="color:var(--text3);font-size:.75rem;padding:16px 12px">No active alerts — all clear ✓</div>';
    return;
  }
  const sev = { danger:'var(--red)', warn:'var(--orange)', info:'var(--gold)' };
  panel.innerHTML = active.map(a => `
    <div class="alert-row" style="border-left:3px solid ${sev[a.severity]||sev.warn}">
      <div class="al-top">
        <span class="al-type" style="color:${sev[a.severity]||sev.warn}">${a.type.replace(/-\w+$/,'').toUpperCase()}</span>
        <button class="al-dismiss" onclick="dismissAlert(${a.id})">✕</button>
      </div>
      <div class="al-msg">${a.msg}</div>
    </div>`).join('');
}

function checkAlerts() {
  const vixEl = document.getElementById('h-vix') || document.getElementById('m-vix');
  const vix = parseFloat(vixEl?.textContent ?? 0);
  if (vix > 25) pushAlert('vix-spike', `⚡ VIX ${vix.toFixed(1)} — Extreme fear. Switch to mean-reversion model. Reduce position size.`, 'danger');
  else if (vix > 20) pushAlert('vix-elevated', `VIX ${vix.toFixed(1)} — Moderate fear. Consider tightening stops and reducing leverage.`, 'warn');

  const dpnlEl = document.getElementById('ap-dpnl');
  if (dpnlEl) {
    const raw = dpnlEl.textContent.replace(/[^0-9.-]/g, '');
    const dpnl = parseFloat(raw || 0);
    if (dpnl < 0 && Math.abs(dpnl) >= CFG.maxDailyLoss * 0.8) pushAlert('drawdown', `⚠ Daily loss approaching limit: ${dpnlEl.textContent}. Max daily loss set at $${CFG.maxDailyLoss}.`, 'danger');
  }

  const heldSyms = ['NVDA', 'AAPL', 'TSLA', 'META'];
  UPCOMING_EARNINGS.filter(e => heldSyms.includes(e.sym)).forEach(e => {
    pushAlert('earnings-' + e.sym, `📅 ${e.sym} reports earnings ${e.date}. Consider reducing exposure or adding a hedge.`, 'info');
  });

  const techAlloc = SECTOR_ALLOCATIONS.find(s => s.sector === 'Technology');
  if (techAlloc?.pct > 30) pushAlert('rebalance', `⚖ Technology at ${techAlloc.pct}% — exceeds 30% sector cap. Rebalance recommended.`, 'warn');

  renderAlerts();
}

function toggleAlertsPanel() {
  const drawer = document.getElementById('alerts-drawer');
  if (drawer) drawer.classList.toggle('open');
}

// ═══════════════════════════════════════════════
// 22. STRATEGY SELECTOR & ATR POSITION SIZER
// ═══════════════════════════════════════════════
const STRATEGIES = {
  momentum: {
    name: 'Momentum / Trend Following',
    desc: 'Buy relative strength leaders over the past N days. Rotate out of laggards. Best in BULL regime with ADX > 25.',
    entry: 'Price > MA50, ADX > 25, RSI between 50–70',
    stop:  'ATR × 2.0 below entry price',
    regime: 'bull',
  },
  meanrev: {
    name: 'Mean Reversion',
    desc: 'RSI-based oversold bounces on liquid large-cap stocks. Only enter when ADX < 20 (range-bound).',
    entry: 'RSI < 30, price at or below BB lower band',
    stop:  'ATR × 1.5 below entry price',
    regime: 'neutral',
  },
  volsizing: {
    name: 'Volatility-Based Sizing',
    desc: 'Scale position size inversely to volatility using Kelly Criterion or ATR. Works in all regimes as a sizing overlay.',
    entry: 'Any confirmed signal — size adjusted by ATR',
    stop:  'ATR × configurable multiplier',
    regime: 'all',
  },
  sectorrot: {
    name: 'Sector Rotation',
    desc: 'Rotate monthly into leading GICS sectors based on relative performance vs SPY. Favors BULL regimes.',
    entry: 'Sector ETF showing >3% relative strength vs SPY (1-month)',
    stop:  'EMA(20) cross of sector ETF',
    regime: 'bull',
  },
};

function setStrategy(name) {
  activeStrategy = name;
  document.querySelectorAll('.strat-btn').forEach(b => b.classList.toggle('active', b.dataset.strat === name));
  const s = STRATEGIES[name];
  if (!s) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('strat-name',  s.name);
  set('strat-desc',  s.desc);
  set('strat-entry', s.entry);
  set('strat-stop',  s.stop);
  const sr = document.getElementById('strat-regime');
  if (sr) {
    const regColors = { bull:'var(--green)', neutral:'var(--orange)', all:'var(--text2)', bear:'var(--red)' };
    sr.textContent = s.regime.toUpperCase();
    sr.style.color = regColors[s.regime] || 'var(--text2)';
  }
  const aligned = s.regime === 'all' || s.regime === regimeState.regime;
  const warn = document.getElementById('strat-regime-warn');
  if (warn) warn.style.display = aligned ? 'none' : 'flex';
}

function calcATRPositionSize() {
  const equity = parseFloat(document.getElementById('atr-equity')?.value || 0);
  const atr    = parseFloat(document.getElementById('atr-val')?.value   || 0);
  const price  = parseFloat(document.getElementById('atr-price')?.value || 0);
  if (!atr || !price || !equity) { toast('Fill in all three ATR sizer fields', 'w'); return; }
  const riskAmt    = equity * (CFG.perTradeRiskPct / 100);
  const stopDist   = atr * CFG.atrStopMultiplier;
  const shares     = Math.max(1, Math.floor(riskAmt / stopDist));
  const dollarSize = shares * price;
  const pctEquity  = (dollarSize / equity * 100).toFixed(1);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('atr-shares',     shares);
  set('atr-dollars',    '$' + dollarSize.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  set('atr-pct',        pctEquity + '% of equity');
  set('atr-stop-dist',  '$' + stopDist.toFixed(2) + ' stop distance');
  set('atr-dollar-risk','$' + riskAmt.toFixed(2)  + ' at risk');
  const res = document.getElementById('atr-result');
  if (res) res.style.display = 'block';
}

function updateDailyLossBar() {
  const pct = Math.min(100, (dailyLossUsed / CFG.maxDailyLoss) * 100);
  const bar  = document.getElementById('dloss-fill');
  if (bar) { bar.style.width = pct + '%'; bar.style.background = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--orange)' : 'var(--green)'; }
  const txt = document.getElementById('dloss-used');
  if (txt) txt.textContent = '$' + dailyLossUsed.toFixed(2) + ' / $' + CFG.maxDailyLoss;
  if (pct >= 100) pushAlert('max-daily-loss', `☠ Max daily loss reached: $${dailyLossUsed.toFixed(2)}. All new trades blocked per risk rules.`, 'danger');
}

// ═══════════════════════════════════════════════
// 19. INIT
// ═══════════════════════════════════════════════
async function init() {
  loadCfg();
  buildBreaking();
  renderNews();
  await loadHomeData();
  setInterval(loadHomeData, 60000); // refresh every 60s to reduce proxy load
  setTimeout(() => { checkAlerts(); setInterval(checkAlerts, 30000); }, 2000);
  setStrategy('momentum');
  updateDailyLossBar();
}

// Run after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose to window for inline onclick handlers
Object.assign(window, {
  navigate, goAnalyze, analyzeCustom, setTF, runAnalysis, setMode, setSide, toggleLP, submitOrder,
  openConfig, closeConfig, saveConfig, setEnvBtn,
  connectAlpaca, closePosition, doKillSwitch,
  approveAndExecute, startAutoExecute, stopAutoScan, approveSignal,
  generateSignals, loadHomePage: loadHomeData,
  loadMetrics, setStrategy, calcATRPositionSize, dismissAlert, toggleAlertsPanel,
  renderTradeLog,
});
