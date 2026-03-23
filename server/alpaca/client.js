// ═══════════════════════════════════════════════════════
//  MarketPulse — Alpaca Client (Real Execution)
//  Uses runtime keys — no server restart needed.
//  Supports instant live/paper switching.
// ═══════════════════════════════════════════════════════
const Alpaca = require('@alpacahq/alpaca-trade-api');
const keys   = require('../keys');

const CRYPTO_SYMBOLS = new Set([
  'BTCUSD','ETHUSD','SOLUSD','DOGEUSD','ADAUSD','AVAXUSD','LINKUSD'
]);
function isCrypto(sym) { return CRYPTO_SYMBOLS.has(sym?.toUpperCase()); }

function getClient(userId) {
  if (!userId) return null;
  const k = keys.getKeys(userId);
  if (!k.alpacaKey || !k.alpacaSecret) return null;
  return new Alpaca({
    keyId:     k.alpacaKey,
    secretKey: k.alpacaSecret,
    baseUrl:   keys.getAlpacaBaseUrl(userId),
    paper:     k.alpacaEnv !== 'live',
  });
}

async function getAccount(userId) {
  const client = getClient(userId);
  if (!client) return null;
  try { return await client.getAccount(); }
  catch (e) { console.error('Alpaca getAccount:', e.message); return null; }
}

async function getPositions(userId) {
  const client = getClient(userId);
  if (!client) return [];
  try { return await client.getPositions(); }
  catch (e) { console.error('Alpaca getPositions:', e.message); return []; }
}

async function getOrders(userId, status = 'all', limit = 50) {
  const client = getClient(userId);
  if (!client) return [];
  try { return await client.getOrders({ status, limit }); }
  catch (e) { console.error('Alpaca getOrders:', e.message); return []; }
}

async function submitOrder(userId, params) {
  const client = getClient(userId);
  if (!client) throw new Error('Alpaca not configured — add API keys in Settings');

  const crypto = isCrypto(params.symbol);
  const order = {
    symbol:        params.symbol.toUpperCase(),
    qty:           String(params.qty),
    side:          params.side.toLowerCase(),
    type:          params.type || 'market',
    time_in_force: params.tif || (crypto ? 'gtc' : 'day'),
  };

  if (order.type === 'limit' && params.limitPrice) {
    order.limit_price = String(params.limitPrice);
  }

  if (!crypto && (params.stopLoss || params.takeProfit)) {
    order.order_class = 'bracket';
    if (params.stopLoss)   order.stop_loss   = { stop_price:  String(params.stopLoss) };
    if (params.takeProfit) order.take_profit  = { limit_price: String(params.takeProfit) };
  }

  const env = keys.getKeys(userId).alpacaEnv || 'paper';
  console.log(`📋 [${env.toUpperCase()}] ${order.side.toUpperCase()} ${order.qty} ${order.symbol}`);
  const result = await client.createOrder(order);
  console.log(`✅ Order ${result.id} | ${result.status}`);
  return result;
}

async function cancelOrder(userId, orderId) {
  const client = getClient(userId);
  if (!client) throw new Error('Alpaca not configured');
  return client.cancelOrder(orderId);
}

async function cancelAllOrders(userId) {
  const client = getClient(userId);
  if (!client) throw new Error('Alpaca not configured');
  return client.cancelAllOrders();
}

async function closePosition(userId, symbol) {
  const client = getClient(userId);
  if (!client) throw new Error('Alpaca not configured');
  return client.closePosition(symbol);
}

async function closeAllPositions(userId) {
  const client = getClient(userId);
  if (!client) throw new Error('Alpaca not configured');
  return client.closeAllPositions();
}

async function getBars(userId, symbol, timeframe = '1Day', limit = 200) {
  const client = getClient(userId);
  if (!client) return [];
  try {
    const resp = await client.getBarsV2(symbol, { timeframe, limit, adjustment: 'raw' });
    const bars = [];
    for await (const bar of resp) {
      bars.push({
        timestamp: bar.Timestamp || bar.t,
        open:   bar.OpenPrice  || bar.o,
        high:   bar.HighPrice  || bar.h,
        low:    bar.LowPrice   || bar.l,
        close:  bar.ClosePrice || bar.c,
        volume: bar.Volume     || bar.v,
      });
    }
    return bars;
  } catch (e) { console.error(`Alpaca getBars ${symbol}:`, e.message); return []; }
}

async function getLatestQuote(userId, symbol) {
  const client = getClient(userId);
  if (!client) return null;
  try {
    const q = await client.getLatestQuote(symbol);
    const bid = q.BidPrice || q.bp || 0;
    const ask = q.AskPrice || q.ap || 0;
    return { symbol, bid, ask, price: (bid + ask) / 2 };
  } catch { return null; }
}

async function getPortfolioHistory(userId, period = '1M', timeframe = '1D') {
  const client = getClient(userId);
  if (!client) return null;
  try { return await client.getPortfolioHistory({ period, timeframe }); }
  catch (e) { console.error('Alpaca portfolioHistory:', e.message); return null; }
}

async function getClock(userId) {
  const client = getClient(userId);
  if (!client) return null;
  try { return await client.getClock(); }
  catch { return null; }
}

function getEnv(userId) { return keys.getKeys(userId).alpacaEnv || 'paper'; }

module.exports = {
  getClient, isCrypto, getEnv,
  getAccount, getPositions, getOrders,
  submitOrder, cancelOrder, cancelAllOrders,
  closePosition, closeAllPositions,
  getBars, getLatestQuote, getPortfolioHistory, getClock,
};
