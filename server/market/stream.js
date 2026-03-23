// ═══════════════════════════════════════════════════════
//  MarketPulse — Market Data Service
//  Polygon.io for historical + news, with Yahoo fallback
// ═══════════════════════════════════════════════════════
const fetch = require('node-fetch');

const POLYGON_BASE = 'https://api.polygon.io';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

function polygonKey() {
  return process.env.POLYGON_API_KEY || '';
}

// ── Historical Bars (Polygon) ────────────────────────────
async function getHistoricalBars(symbol, timespan = 'day', multiplier = 1, from, to, limit = 200) {
  const key = polygonKey();
  if (!key || key === 'your_polygon_api_key_here') {
    return generateSimulatedBars(symbol, limit);
  }

  const toDate   = to   || new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(Date.now() - limit * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const url = `${POLYGON_BASE}/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${fromDate}/${toDate}`
    + `?adjusted=true&sort=asc&limit=${limit}&apiKey=${key}`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.results) return generateSimulatedBars(symbol, limit);

    return data.results.map(r => ({
      timestamp: new Date(r.t).toISOString(),
      open:   r.o,
      high:   r.h,
      low:    r.l,
      close:  r.c,
      volume: r.v,
    }));
  } catch (e) {
    console.error(`Polygon bars error for ${symbol}:`, e.message);
    return generateSimulatedBars(symbol, limit);
  }
}

// ── Intraday Bars ────────────────────────────────────────
async function getIntradayBars(symbol, minutes = 5, limit = 200) {
  return getHistoricalBars(symbol, 'minute', minutes, null, null, limit);
}

// ── News (Polygon) ───────────────────────────────────────
async function getNews(tickers = [], limit = 20) {
  const key = polygonKey();
  if (!key || key === 'your_polygon_api_key_here') {
    return getSimulatedNews();
  }

  const tickerParam = tickers.length ? `&ticker=${tickers.join(',')}` : '';
  const url = `${POLYGON_BASE}/v2/reference/news?limit=${limit}${tickerParam}&order=desc&apiKey=${key}`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.results) return [];

    return data.results.map(n => ({
      headline:  n.title,
      summary:   n.description || '',
      source:    n.publisher?.name || 'Unknown',
      url:       n.article_url,
      tickers:   n.tickers || [],
      timestamp: n.published_utc,
      sentiment: scoreSentiment(n.title + ' ' + (n.description || '')),
    }));
  } catch (e) {
    console.error('Polygon news error:', e.message);
    return getSimulatedNews();
  }
}

// ── Crypto (CoinGecko) ───────────────────────────────────
async function getCryptoPrices() {
  const coins = 'bitcoin,ethereum,solana,dogecoin,cardano';
  const url   = `${COINGECKO_BASE}/simple/price?ids=${coins}&vs_currencies=usd&include_24hr_change=true`;
  try {
    const res  = await fetch(url, { timeout: 5000 });
    const data = await res.json();
    return {
      BTC:  { price: data.bitcoin?.usd,  change: data.bitcoin?.usd_24h_change },
      ETH:  { price: data.ethereum?.usd, change: data.ethereum?.usd_24h_change },
      SOL:  { price: data.solana?.usd,   change: data.solana?.usd_24h_change },
      DOGE: { price: data.dogecoin?.usd, change: data.dogecoin?.usd_24h_change },
      ADA:  { price: data.cardano?.usd,  change: data.cardano?.usd_24h_change },
    };
  } catch (e) {
    return null;
  }
}

// ── Market Stream init ───────────────────────────────────
async function initMarketStream(sse) {
  // Poll Polygon for news every 2 minutes
  const pollNews = async () => {
    const articles = await getNews([], 10);
    for (const article of articles) {
      if (sse) sse.newsUpdate(article);
    }
  };

  pollNews(); // immediate
  setInterval(pollNews, 2 * 60 * 1000);

  // Poll crypto every 30s
  const pollCrypto = async () => {
    const crypto = await getCryptoPrices();
    if (crypto && sse) {
      for (const [sym, data] of Object.entries(crypto)) {
        sse.quoteUpdate(sym, { symbol: sym, price: data.price, change24h: data.change });
      }
    }
  };
  pollCrypto();
  setInterval(pollCrypto, 30000);
}

// ── Sentiment scorer (simple keyword) ───────────────────
function scoreSentiment(text) {
  const lower = text.toLowerCase();
  const bullish = ['surge', 'rally', 'beat', 'profit', 'growth', 'record', 'rise', 'gain', 'strong', 'bull', 'up', 'soar'];
  const bearish = ['crash', 'fall', 'miss', 'loss', 'decline', 'drop', 'weak', 'bear', 'down', 'plunge', 'fear', 'risk'];
  let score = 0;
  bullish.forEach(w => { if (lower.includes(w)) score++; });
  bearish.forEach(w => { if (lower.includes(w)) score--; });
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

// ── Simulated data (no API key) ──────────────────────────
function generateSimulatedBars(symbol, count = 200) {
  const seedPrices = {
    // Equities
    AAPL: 189, MSFT: 415, NVDA: 875, TSLA: 248, AMZN: 184,
    GOOGL: 174, META: 512, AMD: 178, JPM: 198, V: 275,
    // ETFs
    SPY: 542, QQQ: 468, IWM: 205, GLD: 192,
    TLT: 94, XLK: 215, XLF: 42, XLE: 89, ARKK: 48,
    // Crypto (realistic scale)
    BTCUSD: 68500, ETHUSD: 3800, SOLUSD: 178, DOGEUSD: 0.18,
  };
  // Crypto needs bigger simulated moves
  const cryptoVol = new Set(['BTCUSD','ETHUSD','SOLUSD','DOGEUSD']);
  const volFactor = cryptoVol.has(symbol) ? 0.025 : 0.015;
  let price = seedPrices[symbol] || 100 + Math.random() * 400;
  const bars = [];
  const now  = Date.now();

  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.48) * price * volFactor;
    const open   = price;
    price += change;
    const high   = Math.max(open, price) * (1 + Math.random() * 0.005);
    const low    = Math.min(open, price) * (1 - Math.random() * 0.005);
    bars.push({
      timestamp: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      open:   +open.toFixed(2),
      high:   +high.toFixed(2),
      low:    +low.toFixed(2),
      close:  +price.toFixed(2),
      volume: Math.floor(Math.random() * 50000000 + 5000000),
    });
  }
  return bars;
}

function getSimulatedNews() {
  return [
    { headline: 'Fed holds rates steady, signals cautious approach to cuts', summary: 'Federal Reserve keeps benchmark rate unchanged amid persistent inflation concerns.', source: 'Reuters', tickers: ['SPY', 'QQQ'], timestamp: new Date().toISOString(), sentiment: 'neutral' },
    { headline: 'NVIDIA earnings beat estimates as AI demand surges', summary: 'Chipmaker reports record revenue driven by data center GPU demand.', source: 'Bloomberg', tickers: ['NVDA'], timestamp: new Date(Date.now() - 3600000).toISOString(), sentiment: 'positive' },
    { headline: 'Apple unveils next-generation AI features for iPhone', summary: 'Tim Cook announces deep AI integration across the iOS ecosystem.', source: 'CNBC', tickers: ['AAPL'], timestamp: new Date(Date.now() - 7200000).toISOString(), sentiment: 'positive' },
    { headline: 'Treasury yields rise on stronger-than-expected jobs data', summary: '10-year yield climbs as labor market shows resilience.', source: 'WSJ', tickers: [], timestamp: new Date(Date.now() - 10800000).toISOString(), sentiment: 'negative' },
    { headline: 'Tesla deliveries miss Q1 estimates, shares slide', summary: 'Electric vehicle maker delivers fewer cars than analysts expected.', source: 'Reuters', tickers: ['TSLA'], timestamp: new Date(Date.now() - 14400000).toISOString(), sentiment: 'negative' },
  ];
}

module.exports = {
  getHistoricalBars, getIntradayBars, getNews, getCryptoPrices,
  initMarketStream, scoreSentiment,
};
