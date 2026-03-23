// ═══════════════════════════════════════════════════════
//  MarketPulse — Charts Module
//  TradingView Lightweight Charts
// ═══════════════════════════════════════════════════════

let priceChart, priceSeries, volumeSeries;
let rsiChart, rsiSeries, rsiOBLine, rsiOSLine;
let macdChart, macdHistSeries, macdLineSeries, signalLineSeries;
let ema20Series, ema50Series, bbUpperSeries, bbLowerSeries, vwapSeries;

let currentTimeframe  = '1D';
window.currentChartSymbol = 'SPY';

const CHART_OPTS = {
  layout:      { background: { color: '#0c0d0f' }, textColor: '#4a5568' },
  grid:        { vertLines: { color: '#1c1f23' }, horzLines: { color: '#1c1f23' } },
  crosshair:   { mode: 1 },
  rightPriceScale: { borderColor: '#1c1f23' },
  timeScale:   { borderColor: '#1c1f23', timeVisible: true, secondsVisible: false },
};

const PRICE_OPTS = { ...CHART_OPTS, height: 360 };
const SUB_OPTS   = { ...CHART_OPTS, height: 90, timeScale: { visible: false } };
const VOL_OPTS   = { ...CHART_OPTS, height: 80, timeScale: { visible: false } };

// Active overlays state
const overlays = { ema20: true, ema50: true, bb: false, vwap: false };

function initCharts() {
  const LWC = window.LightweightCharts;
  if (!LWC) { console.error('Lightweight Charts not loaded'); return; }

  // ── Price Chart ───────────────────────────────────────
  priceChart  = LWC.createChart(document.getElementById('chart-price'), PRICE_OPTS);
  priceSeries = priceChart.addCandlestickSeries({
    upColor: '#00d67a', downColor: '#e8192c',
    borderUpColor: '#00d67a', borderDownColor: '#e8192c',
    wickUpColor: '#00d67a', wickDownColor: '#e8192c',
  });

  // Overlay series
  ema20Series = priceChart.addLineSeries({ color: '#2d8cf0', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ema50Series = priceChart.addLineSeries({ color: '#f0a800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  bbUpperSeries = priceChart.addLineSeries({ color: 'rgba(155,89,182,0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
  bbLowerSeries = priceChart.addLineSeries({ color: 'rgba(155,89,182,0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 });
  vwapSeries  = priceChart.addLineSeries({ color: '#ff6b00', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

  // ── Volume ────────────────────────────────────────────
  const volChart = LWC.createChart(document.getElementById('chart-volume'), VOL_OPTS);
  volumeSeries   = volChart.addHistogramSeries({
    color: '#1c2635',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });
  volChart.priceScale('').applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });

  // ── RSI ───────────────────────────────────────────────
  rsiChart  = LWC.createChart(document.getElementById('chart-rsi'), SUB_OPTS);
  rsiSeries = rsiChart.addLineSeries({ color: '#9b59b6', lineWidth: 1.5 });
  rsiOBLine = rsiChart.addLineSeries({ color: 'rgba(232,25,44,.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  rsiOSLine = rsiChart.addLineSeries({ color: 'rgba(0,214,122,.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
  rsiChart.priceScale('right').applyOptions({ minimum: 0, maximum: 100 });

  // ── MACD ──────────────────────────────────────────────
  macdChart      = LWC.createChart(document.getElementById('chart-macd'), SUB_OPTS);
  macdHistSeries = macdChart.addHistogramSeries({ color: '#2d8cf0', priceLineVisible: false });
  macdLineSeries = macdChart.addLineSeries({ color: '#2d8cf0', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
  signalLineSeries = macdChart.addLineSeries({ color: '#e8192c', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });

  // Sync crosshairs across all charts
  syncCharts([priceChart, volChart, rsiChart, macdChart]);

  // Load initial symbol
  loadChartData(window.currentChartSymbol, currentTimeframe);

  // Symbol search
  setupSymbolSearch();
}

async function loadChartData(symbol, timeframe) {
  window.currentChartSymbol = symbol;
  currentTimeframe = timeframe;

  try {
    const { bars } = await API.getBars(symbol, timeframe, 300);
    if (!bars || bars.length === 0) { toast(`No data for ${symbol}`, 'error'); return; }

    // Update header
    document.getElementById('cs-sym').textContent  = symbol;
    const lastBar = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    document.getElementById('cs-price').textContent = `$${fmt(lastBar.close)}`;
    const chgPct = prevBar ? ((lastBar.close - prevBar.close) / prevBar.close * 100) : 0;
    const chgEl  = document.getElementById('cs-chg');
    chgEl.textContent = fmtPct(chgPct);
    chgEl.className   = `cs-chg ${chgPct >= 0 ? 'up' : 'dn'}`;

    // Format for lightweight charts (requires unix timestamps)
    const toTs = (ts) => Math.floor(new Date(ts).getTime() / 1000);

    const candles = bars.map(b => ({
      time:  toTs(b.timestamp),
      open:  b.open, high: b.high, low: b.low, close: b.close,
    }));
    const volumes = bars.map(b => ({
      time:  toTs(b.timestamp),
      value: b.volume,
      color: b.close >= b.open ? 'rgba(0,214,122,0.3)' : 'rgba(232,25,44,0.25)',
    }));

    priceSeries.setData(candles);
    volumeSeries.setData(volumes);

    // Compute and render indicators
    await renderIndicatorOverlays(bars, toTs);
    await loadAndRenderSubchartIndicators(symbol, timeframe, bars, toTs);

    // Update indicator panel
    try {
      const { indicators } = await API.getIndicators(symbol, timeframe);
      if (indicators) renderIndicatorPanel(indicators);
    } catch {}

  } catch (e) {
    console.error('Chart load error:', e);
    toast(`Failed to load ${symbol}`, 'error');
  }
}

async function renderIndicatorOverlays(bars, toTs) {
  const closes = bars.map(b => b.close);

  // EMA 20
  if (overlays.ema20) {
    const ema20 = computeEMASeries(closes, 20);
    const offset = bars.length - ema20.length;
    ema20Series.setData(ema20.map((v, i) => ({ time: toTs(bars[i + offset].timestamp), value: v })));
  } else {
    ema20Series.setData([]);
  }

  // EMA 50
  if (overlays.ema50) {
    const ema50 = computeEMASeries(closes, 50);
    const offset = bars.length - ema50.length;
    ema50Series.setData(ema50.map((v, i) => ({ time: toTs(bars[i + offset].timestamp), value: v })));
  } else {
    ema50Series.setData([]);
  }

  // Bollinger Bands
  if (overlays.bb) {
    const bbData = computeBBSeries(closes, 20);
    const offset = bars.length - bbData.length;
    bbUpperSeries.setData(bbData.map((v, i) => ({ time: toTs(bars[i + offset].timestamp), value: v.upper })));
    bbLowerSeries.setData(bbData.map((v, i) => ({ time: toTs(bars[i + offset].timestamp), value: v.lower })));
  } else {
    bbUpperSeries.setData([]);
    bbLowerSeries.setData([]);
  }

  // VWAP
  if (overlays.vwap) {
    const vwapVal = computeVWAP(bars);
    if (vwapVal) {
      vwapSeries.setData(bars.map(b => ({ time: toTs(b.timestamp), value: vwapVal })));
    }
  } else {
    vwapSeries.setData([]);
  }
}

async function loadAndRenderSubchartIndicators(symbol, timeframe, bars, toTs) {
  const closes = bars.map(b => b.close);

  // RSI
  const rsiData = computeRSISeries(closes, 14);
  const rsiOffset = bars.length - rsiData.length;
  rsiSeries.setData(rsiData.map((v, i) => ({ time: toTs(bars[i + rsiOffset].timestamp), value: v })));

  // RSI OB/OS lines
  const firstTs = toTs(bars[rsiOffset].timestamp);
  const lastTs  = toTs(bars[bars.length - 1].timestamp);
  rsiOBLine.setData([{ time: firstTs, value: 70 }, { time: lastTs, value: 70 }]);
  rsiOSLine.setData([{ time: firstTs, value: 30 }, { time: lastTs, value: 30 }]);

  // Current RSI
  const latestRSI = rsiData[rsiData.length - 1];
  const rsiEl = document.getElementById('rsi-value');
  if (rsiEl) {
    rsiEl.textContent = latestRSI?.toFixed(2) || '–';
    rsiEl.style.color = latestRSI > 70 ? '#e8192c' : latestRSI < 30 ? '#00d67a' : '#8a9bb0';
  }

  // MACD
  const macdData = computeMACDSeries(closes, 12, 26, 9);
  if (macdData.length > 0) {
    macdLineSeries.setData(macdData.map(d => ({ time: toTs(bars[d.idx].timestamp), value: d.macd })));
    signalLineSeries.setData(macdData.map(d => ({ time: toTs(bars[d.idx].timestamp), value: d.signal })));
    macdHistSeries.setData(macdData.map(d => ({
      time: toTs(bars[d.idx].timestamp),
      value: d.histogram,
      color: d.histogram >= 0 ? 'rgba(0,214,122,0.6)' : 'rgba(232,25,44,0.6)',
    })));

    const latest = macdData[macdData.length - 1];
    const macdEl = document.getElementById('macd-value');
    if (macdEl) macdEl.textContent = `${latest.macd?.toFixed(3)} / ${latest.signal?.toFixed(3)}`;
  }
}

function renderIndicatorPanel(ind) {
  const panel = document.getElementById('indicator-panel');
  if (!panel) return;

  const cards = [
    { lbl: 'RSI (14)', val: ind.rsi?.toFixed(2), sig: ind.rsi > 70 ? 'OVERBOUGHT' : ind.rsi < 30 ? 'OVERSOLD' : 'NEUTRAL', cls: ind.rsi > 70 ? 'bear' : ind.rsi < 30 ? 'bull' : 'neutral' },
    { lbl: 'MACD Hist', val: ind.macd?.histogram?.toFixed(4), sig: ind.macd?.histogram > 0 ? 'BULLISH' : 'BEARISH', cls: ind.macd?.histogram > 0 ? 'bull' : 'bear' },
    { lbl: 'BB %B', val: ind.bb?.pctB?.toFixed(3), sig: ind.bb?.pctB > 0.8 ? 'UPPER' : ind.bb?.pctB < 0.2 ? 'LOWER' : 'MID', cls: 'neutral' },
    { lbl: 'ATR (14)', val: ind.atr?.toFixed(3), sig: 'VOLATILITY', cls: 'neutral' },
    { lbl: 'ADX (14)', val: ind.adx?.toFixed(2), sig: ind.adx > 25 ? 'TRENDING' : 'RANGING', cls: ind.adx > 25 ? 'bull' : 'neutral' },
    { lbl: 'EMA 20', val: `$${fmt(ind.ema20)}`, sig: ind.price > ind.ema20 ? 'ABOVE' : 'BELOW', cls: ind.price > ind.ema20 ? 'bull' : 'bear' },
    { lbl: 'EMA 50', val: `$${fmt(ind.ema50)}`, sig: ind.ema20 > ind.ema50 ? 'GOLDEN' : 'DEATH X', cls: ind.ema20 > ind.ema50 ? 'bull' : 'bear' },
    { lbl: 'Regime', val: ind.regime?.regime, sig: `${ind.regime?.confidence}% conf`, cls: ind.regime?.regime === 'BULL' ? 'bull' : ind.regime?.regime === 'BEAR' ? 'bear' : 'neutral' },
  ];

  panel.innerHTML = cards.map(c => `
    <div class="ind-card">
      <div class="ind-lbl">${c.lbl}</div>
      <div class="ind-val">${c.val || '–'}</div>
      <div class="ind-sig ${c.cls}">${c.sig}</div>
    </div>
  `).join('');

  // Update regime widget on home page too
  if (ind.regime) updateRegimeWidget(ind.regime);
}

function toggleOverlay(name, btn) {
  overlays[name] = !overlays[name];
  btn.classList.toggle('active', overlays[name]);
  if (window.currentChartSymbol) {
    API.getBars(window.currentChartSymbol, currentTimeframe, 300).then(({ bars }) => {
      if (bars) renderIndicatorOverlays(bars, ts => Math.floor(new Date(ts).getTime() / 1000));
    });
  }
}

function setTimeframe(tf) {
  currentTimeframe = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  loadChartData(window.currentChartSymbol, tf);
}

// ── Symbol Search ─────────────────────────────────────────
const POPULAR_SYMBOLS = [
  'SPY','QQQ','AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','AMD',
  'NFLX','DIS','JPM','GS','BAC','XOM','CVX','GLD','SLV','IWM','DIA',
  'BABA','V','MA','PYPL','SHOP','ROKU','SNAP','UBER','LYFT','PLTR',
];

function setupSymbolSearch() {
  const input = document.getElementById('symbol-input');
  const suggestions = document.getElementById('symbol-suggestions');

  input.addEventListener('input', () => {
    const val = input.value.toUpperCase().trim();
    if (!val) { suggestions.classList.remove('open'); return; }
    const matches = POPULAR_SYMBOLS.filter(s => s.startsWith(val)).slice(0, 8);
    if (!matches.length) { suggestions.classList.remove('open'); return; }
    suggestions.innerHTML = matches.map(s => `<div class="sym-suggest-item" onclick="selectSymbol('${s}')">${s}</div>`).join('');
    suggestions.classList.add('open');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      selectSymbol(input.value.toUpperCase().trim());
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.symbol-search-wrap')) suggestions.classList.remove('open');
  });
}

function selectSymbol(sym) {
  if (!sym) return;
  document.getElementById('symbol-input').value = sym;
  document.getElementById('symbol-suggestions').classList.remove('open');
  loadChartData(sym, currentTimeframe);
  showPage('charts');
}

// ── AI Analysis ───────────────────────────────────────────
async function runAIAnalysis() {
  const sym = window.currentChartSymbol;
  const thinkingEl = document.getElementById('ai-thinking-log');
  const resultEl   = document.getElementById('ai-result-text');

  thinkingEl.innerHTML = '';
  resultEl.innerHTML   = '<span class="thinking-spinner"></span> Analyzing...';

  // Register for thinking updates
  const thinkHandler = (data) => {
    if (data.symbol !== sym) return;
    const step = document.createElement('div');
    step.className = 'ai-thinking-step';
    step.textContent = data.content;
    thinkingEl.appendChild(step);
  };

  SSE.on('ai_thinking', thinkHandler);

  try {
    // Fetch indicators for this symbol
    const { indicators: ind } = await API.getIndicators(sym, currentTimeframe);
    if (!ind) { resultEl.textContent = 'Could not load indicator data.'; return; }

    resultEl.innerHTML = `
      <strong>${sym} Analysis</strong><br/><br/>
      <strong>Regime:</strong> ${ind.regime?.regime} (${ind.regime?.confidence}% confidence)<br/>
      <strong>RSI:</strong> ${ind.rsi?.toFixed(2)} — ${ind.rsi > 70 ? '⚠ Overbought' : ind.rsi < 30 ? '⚠ Oversold' : 'Neutral'}<br/>
      <strong>MACD:</strong> ${ind.macd?.histogram > 0 ? '📈 Bullish momentum' : '📉 Bearish momentum'}<br/>
      <strong>EMA Trend:</strong> ${ind.ema20 > ind.ema50 ? '🟢 EMA20 > EMA50 (bullish)' : '🔴 EMA20 < EMA50 (bearish)'}<br/>
      <strong>ATR:</strong> ${ind.atr?.toFixed(3)} (implied volatility)<br/><br/>
      <em>For full AI trade recommendation, add Claude API key in Settings and use the AI Trader page.</em>
    `;
  } catch (e) {
    resultEl.textContent = 'Analysis failed. Check API keys in Settings.';
  }
}

// ── Indicator computation (client-side for overlays) ──────

function computeEMASeries(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(val);
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

function computeRSISeries(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const changes = closes.map((c, i) => i === 0 ? 0 : c - closes[i - 1]).slice(1);
  let avgGain = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss = changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  const result = [];
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function computeMACDSeries(closes, fast = 12, slow = 26, sig = 9) {
  if (closes.length < slow + sig) return [];
  const fastEMA = computeEMASeries(closes, fast);
  const slowEMA = computeEMASeries(closes, slow);
  const diff = fastEMA.length - slowEMA.length;
  const macdLine = slowEMA.map((s, i) => fastEMA[i + diff] - s);
  const k = 2 / (sig + 1);
  let signalVal = macdLine.slice(0, sig).reduce((a, b) => a + b, 0) / sig;
  const result = [];
  const startIdx = closes.length - macdLine.length + sig;
  for (let i = sig; i < macdLine.length; i++) {
    signalVal = macdLine[i] * k + signalVal * (1 - k);
    result.push({ idx: startIdx + (i - sig), macd: macdLine[i], signal: signalVal, histogram: macdLine[i] - signalVal });
  }
  return result;
}

function computeBBSeries(closes, period = 20) {
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mid   = slice.reduce((a, b) => a + b, 0) / period;
    const sd    = Math.sqrt(slice.reduce((s, c) => s + (c - mid) ** 2, 0) / period);
    result.push({ upper: mid + 2 * sd, lower: mid - 2 * sd });
  }
  return result;
}

function computeVWAP(bars) {
  let cumTPV = 0, cumVol = 0;
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumVol += b.volume;
  }
  return cumVol === 0 ? null : cumTPV / cumVol;
}

// ── Chart Sync ────────────────────────────────────────────
function syncCharts(charts) {
  charts.forEach((chart, idx) => {
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!range) return;
      charts.forEach((other, otherIdx) => {
        if (otherIdx !== idx) other.timeScale().setVisibleLogicalRange(range);
      });
    });
  });
}

// ── New bar from SSE ──────────────────────────────────────
window.onNewBar = function(data) {
  if (!priceSeries) return;
  const ts = Math.floor(new Date(data.bar.time).getTime() / 1000);
  priceSeries.update({ time: ts, open: data.bar.open, high: data.bar.high, low: data.bar.low, close: data.bar.close });
  if (volumeSeries) volumeSeries.update({ time: ts, value: data.bar.volume });
};
