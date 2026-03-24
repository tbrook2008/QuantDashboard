const { generateResponse } = require('./llm');
const { getNews } = require('../data/polygon');
const { getYahooAggs, getYahooQuote } = require('../data/yahoo');
const { calculateEMA, calculateRSI } = require('../indicators');
const { submitOrder } = require('../data/alpaca');
const { getKey } = require('../keys');

let engineState = 'PAUSED'; // PAUSED, APPROVAL, AUTO
let scanInterval = null;
const LOGS = [];

function emitLog(msg) {
    const entry = { time: new Date().toISOString(), msg };
    LOGS.unshift(entry);
    if (LOGS.length > 50) LOGS.pop();
    console.log(`[AI Engine] ${msg}`);
}

function getWatchlist() {
    const wl = getKey('WATCHLIST');
    if (wl) return JSON.parse(wl);
    return ['SPY', 'QQQ', 'BTC']; 
}

function getStatus() {
    return { state: engineState, logs: LOGS, watchlist: getWatchlist() };
}

function setEngineState(newState) {
    if (['PAUSED', 'APPROVAL', 'AUTO'].includes(newState)) {
        engineState = newState;
        emitLog(`Engine mode shifted to ${newState}`);
        if (newState === 'PAUSED') stopEngine();
        else startEngine();
    }
}

function startEngine() {
    if (scanInterval) clearInterval(scanInterval);
    emitLog('Initializing dynamic market scan interval...');
    // Scan runs every 90s to avoid API rate limits
    scanInterval = setInterval(runDecisionLoop, 90000); 
    runDecisionLoop(); 
}

function stopEngine() {
    if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
    }
    emitLog('Scan sequence halted. AI thread suspended.');
}

async function fetchContext(symbol) {
    const aggs = await getYahooAggs(symbol, '60m', '1mo').catch(()=>[]);
    
    let price = 0, rsi = 0, ema = 0;
    if (aggs && aggs.length > 14) {
        const closes = aggs.map(b => b.close);
        price = closes[closes.length - 1];
        const rsiArr = calculateRSI(closes, 14);
        rsi = rsiArr[rsiArr.length-1];
        const emaArr = calculateEMA(closes, 20);
        ema = emaArr[emaArr.length-1];
    } else {
        // Fallback if no robust bars
        const q = await getYahooQuote(symbol);
        if (q) price = q.price;
    }
    
    // Continue routing news hits through Polygon
    const news = await getNews(symbol).catch(()=>[]);
    const newsSum = news.slice(0, 3).map(n => n.title).join(' | ');

    return { symbol, price, rsi, ema, newsSum };
}

async function runDecisionLoop() {
    if (engineState === 'PAUSED') return;
    
    const wl = getWatchlist();
    emitLog(`Initializing parallel evaluation stack for [${wl.join(', ')}]...`);
    
    for (const symbol of wl) {
        // Strict throttle to prevent overloading backend or hitting strict HTTP rate caps
        await new Promise(r => setTimeout(r, 8000));
        try {
            const ctx = await fetchContext(symbol);
            if (!ctx.price) continue;

            const prompt = `You are an elite quantitative AI trader evaluating ${ctx.symbol} in a high-frequency context. 
Data Snapshot -> Price: $${ctx.price} | RSI(14): ${ctx.rsi.toFixed(1)} | EMA(20): ${ctx.ema.toFixed(1)}
Recent News Context: ${ctx.newsSum}.

Based strictly on mean-reversion and momentum frameworks, you MUST output ONLY valid JSON in this exact structure with no markdown tags or backticks:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": <integer 0-100>,
  "strategy": "mean-reversion" | "momentum" | "news-catalyst",
  "reasoning": "1 concise sentence explanation"
}`;

            const rawResponse = await generateResponse(prompt, 'pro');
            const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
            const decision = JSON.parse(cleanJson);
            
            if (decision.action !== 'HOLD' && decision.confidence > 75) {
                emitLog(`🚨 ${decision.strategy.toUpperCase()} SIGNAL: ${decision.action} ${symbol} (Conf: ${decision.confidence}%) -> ${decision.reasoning}`);
                
                if (engineState === 'AUTO') {
                    const side = decision.action.toLowerCase();
                    await submitOrder(symbol, 1, side);
                    emitLog(`✅ EXECUTION: Sent ${side.toUpperCase()} 1 ${symbol} @ Market via Alpaca Bridge`);
                } else if (engineState === 'APPROVAL') {
                    emitLog(`⏳ ACTION REQUIRED: User approval needed to ${decision.action} ${symbol}`);
                }
            } else {
                 emitLog(`Analyzed ${symbol}: HOLD (Conf: ${decision.confidence}%)`);
            }
        } catch (err) {
            emitLog(`Data Error analyzing ${symbol}: Parse failure or Rate Limit.`);
        }
    }
    emitLog('Evaluation matrix sequence complete. Standing by for next interval.');
}

module.exports = {
    getStatus, setEngineState
};
