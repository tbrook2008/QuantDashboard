document.addEventListener('DOMContentLoaded', () => {
    // Logout Handler
    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('mp_token');
        window.location.href = '/login';
    });

    const chartInstance = LightweightCharts.createChart(document.getElementById('tv-chart'), {
        width: document.getElementById('tv-chart').clientWidth,
        height: document.getElementById('tv-chart').clientHeight,
        layout: {
            background: { type: 'solid', color: '#ffffff' },
            textColor: '#333',
        },
        grid: {
            vertLines: { color: '#f0f3fa' },
            horzLines: { color: '#f0f3fa' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: '#cccccc',
        },
        timeScale: {
            borderColor: '#cccccc',
            timeVisible: true,
        },
    });

    const mainSeries = chartInstance.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    const emaSeries = chartInstance.addLineSeries({
        color: '#2962FF', lineWidth: 2,
    });

    // Resize handler
    window.addEventListener('resize', () => {
        chartInstance.resize(document.getElementById('tv-chart').clientWidth, document.getElementById('tv-chart').clientHeight);
    });

    let activeTimeframe = '1D';
    
    document.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeTimeframe = e.target.getAttribute('data-tf');
        });
    });

    const analyzeBtn = document.getElementById('analyze-btn');
    const symbolInput = document.getElementById('symbol-input');
    const commentaryBox = document.getElementById('ai-commentary');

    async function loadChart() {
        const symbol = symbolInput.value.trim().toUpperCase();
        if (!symbol) return;

        analyzeBtn.textContent = 'Analyzing...';
        analyzeBtn.disabled = true;
        commentaryBox.innerHTML = '<span style="color:var(--text-tertiary)">Synthesizing technical arrays...</span>';

        try {
            const data = await window.api.get(`/charts/data/${symbol}?timeframe=${activeTimeframe}`);
            
            if (data.bars && data.bars.length > 0) {
                // Filter out any duplicates or non-sequential times expected by TV
                const uniqueBars = data.bars.filter((v, i, a) => a.findIndex(t => (t.time === v.time)) === i).sort((a,b) => a.time - b.time);
                mainSeries.setData(uniqueBars);
                
                // Map indicators
                if (data.indicators.ema20) {
                    const emaData = data.indicators.ema20.map((val, i) => {
                        return val !== null ? { time: uniqueBars[i].time, value: val } : null;
                    }).filter(Boolean);
                    emaSeries.setData(emaData);
                }

                chartInstance.timeScale().fitContent();

                // Format AI Commentary
                if (data.commentary) {
                    commentaryBox.innerHTML = `<span style="font-weight:600; color:var(--text-primary)">[ ${symbol} • ${activeTimeframe} ]</span><br/>${data.commentary}`;
                }

            } else {
                commentaryBox.innerHTML = `<span style="color:var(--accent-red)">Error: No bars returned for ${symbol}. Verify market data keys.</span>`;
            }
        } catch (err) {
            console.error(err);
            commentaryBox.innerHTML = `<span style="color:var(--accent-red)">Error: ${err.message}</span>`;
        } finally {
            analyzeBtn.textContent = 'Load & Analyze';
            analyzeBtn.disabled = false;
        }
    }

    analyzeBtn.addEventListener('click', loadChart);
    symbolInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadChart();
    });

    // Auto load SPY on init
    loadChart();
});
