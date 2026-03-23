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
    return [];
  }

  const toDate   = to   || new Date().toISOString().split('T')[0];
  const fromDate = from || new Date(Date.now() - limit * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const url = `${POLYGON_BASE}/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${fromDate}/${toDate}`
    + `?adjusted=true&sort=asc&limit=${limit}&apiKey=${key}`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.results) return [];

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
    return [];
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
    return [];
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
    return [];
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



module.exports = {
  getHistoricalBars, getIntradayBars, getNews, getCryptoPrices,
  initMarketStream, scoreSentiment,
};
