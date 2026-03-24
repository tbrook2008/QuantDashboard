// Simplistic Technical Indicator Maths

function calculateEMA(prices, period) {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    let emaArray = [];
    
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i];
    let prevEMA = sum / period;
    
    for (let i = 0; i < period - 1; i++) emaArray.push(null);
    emaArray.push(prevEMA);

    for (let i = period; i < prices.length; i++) {
        let ema = (prices[i] * k) + (prevEMA * (1 - k));
        emaArray.push(ema);
        prevEMA = ema;
    }
    return emaArray;
}

function calculateRSI(prices, period = 14) {
    if (prices.length <= period) return [];
    let rsiArray = new Array(period).fill(null);
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    const rsFirst = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsiFirst = avgLoss === 0 ? 100 : 100 - (100 / (1 + rsFirst));
    rsiArray.push(rsiFirst);

    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        
        if (avgLoss === 0) {
            rsiArray.push(100);
        } else {
            const rs = avgGain / avgLoss;
            rsiArray.push(100 - (100 / (1 + rs)));
        }
    }
    return rsiArray;
}

module.exports = {
    calculateEMA, calculateRSI
};
