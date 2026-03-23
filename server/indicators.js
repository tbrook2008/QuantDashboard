// ═══════════════════════════════════════════════════════
//  MarketPulse — Technical Indicators
//  All indicators take arrays of OHLCV bars
// ═══════════════════════════════════════════════════════

/** Simple Moving Average */
function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential Moving Average */
function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

/** Full EMA series */
function emaSeries(closes, period) {
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

/** RSI */
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses += Math.abs(changes[i]);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/** MACD */
function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);

  // Align: slow EMA is shorter, align from end
  const diff = fastEma.length - slowEma.length;
  const macdLine = slowEma.map((s, i) => fastEma[i + diff] - s);

  const k = 2 / (signal + 1);
  let signalVal = macdLine.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
  for (let i = signal; i < macdLine.length; i++) {
    signalVal = macdLine[i] * k + signalVal * (1 - k);
  }

  const macdVal  = macdLine[macdLine.length - 1];
  const histogram = macdVal - signalVal;
  return { macd: macdVal, signal: signalVal, histogram };
}

/** Bollinger Bands */
function bollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, c) => sum + Math.pow(c - middle, 2), 0) / period;
  const sd = Math.sqrt(variance);
  const upper = middle + stdDev * sd;
  const lower = middle - stdDev * sd;
  const pctB = (closes[closes.length - 1] - lower) / (upper - lower);
  const bandwidth = (upper - lower) / middle;
  return { upper, middle, lower, pctB, bandwidth };
}

/** ATR — Average True Range */
function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

/** ADX — Average Directional Index */
function adx(bars, period = 14) {
  if (bars.length < period * 2) return null;
  const dmPlus = [], dmMinus = [], trs = [];

  for (let i = 1; i < bars.length; i++) {
    const upMove   = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothDMp = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothDMm = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr = [];
  const calcDI = (dm, tr) => tr === 0 ? 0 : (dm / tr) * 100;

  for (let i = period; i < trs.length; i++) {
    smoothTR  = smoothTR  - smoothTR / period  + trs[i];
    smoothDMp = smoothDMp - smoothDMp / period + dmPlus[i];
    smoothDMm = smoothDMm - smoothDMm / period + dmMinus[i];
    const diPlus  = calcDI(smoothDMp, smoothTR);
    const diMinus = calcDI(smoothDMm, smoothTR);
    const diff = Math.abs(diPlus - diMinus);
    const sum  = diPlus + diMinus;
    dxArr.push(sum === 0 ? 0 : (diff / sum) * 100);
  }

  const adxVal = dxArr.slice(-period).reduce((a, b) => a + b, 0) / period;
  return adxVal;
}

/** Stochastic Oscillator */
function stochastic(bars, kPeriod = 14, dPeriod = 3) {
  if (bars.length < kPeriod) return null;
  const slice = bars.slice(-kPeriod);
  const high  = Math.max(...slice.map(b => b.high));
  const low   = Math.min(...slice.map(b => b.low));
  const close = bars[bars.length - 1].close;
  const k = high === low ? 50 : ((close - low) / (high - low)) * 100;
  return { k, d: k }; // simplified; full implementation would smooth %D over dPeriod
}

/** VWAP (intraday) */
function vwap(bars) {
  if (!bars || bars.length === 0) return null;
  let cumTPV = 0, cumVol = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumTPV += tp * bar.volume;
    cumVol += bar.volume;
  }
  return cumVol === 0 ? null : cumTPV / cumVol;
}

/** Market Regime Detection */
function detectRegime(bars) {
  if (bars.length < 50) return { regime: 'NEUTRAL', confidence: 0, notes: 'Insufficient data' };

  const closes = bars.map(b => b.close);
  const rsiVal   = rsi(closes, 14);
  const adxVal   = adx(bars, 14);
  const ema20    = ema(closes, 20);
  const ema50    = ema(closes, 50);
  const macdData = macd(closes);

  let score = 0; // positive = bullish, negative = bearish
  const signals = [];

  // EMA trend
  if (ema20 && ema50) {
    if (ema20 > ema50) { score += 2; signals.push('EMA20 > EMA50 (bullish)'); }
    else               { score -= 2; signals.push('EMA20 < EMA50 (bearish)'); }
  }

  // RSI
  if (rsiVal !== null) {
    if (rsiVal > 55)      { score += 1; signals.push('RSI bullish'); }
    else if (rsiVal < 45) { score -= 1; signals.push('RSI bearish'); }
  }

  // MACD
  if (macdData) {
    if (macdData.histogram > 0) { score += 1; signals.push('MACD bullish'); }
    else                        { score -= 1; signals.push('MACD bearish'); }
  }

  // ADX (trend strength)
  const trending = adxVal && adxVal > 25;

  let regime;
  if (!trending) {
    regime = 'NEUTRAL';
  } else if (score >= 3) {
    regime = 'BULL';
  } else if (score <= -3) {
    regime = 'BEAR';
  } else {
    regime = 'TRANSITION';
  }

  const confidence = Math.min(100, Math.round(Math.abs(score) / 4 * 100));

  return {
    regime,
    confidence,
    score,
    trending,
    signals,
    rsi: rsiVal,
    adx: adxVal,
    ema20,
    ema50,
    macd: macdData,
  };
}

/** Compute full indicator snapshot for a symbol */
function computeAll(bars) {
  if (!bars || bars.length < 20) return null;
  const closes = bars.map(b => b.close);

  return {
    rsi:       rsi(closes, 14),
    macd:      macd(closes),
    bb:        bollingerBands(closes, 20, 2),
    atr:       atr(bars, 14),
    adx:       adx(bars, 14),
    stoch:     stochastic(bars),
    vwap:      vwap(bars),
    ema20:     ema(closes, 20),
    ema50:     ema(closes, 50),
    ema200:    ema(closes, 200),
    sma20:     sma(closes, 20),
    regime:    detectRegime(bars),
    price:     closes[closes.length - 1],
    priceChange: closes.length > 1
      ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100)
      : 0,
  };
}

module.exports = {
  sma, ema, emaSeries, rsi, macd, bollingerBands, atr, adx, stochastic, vwap,
  detectRegime, computeAll,
};
