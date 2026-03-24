document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('mp_token');
        window.location.href = '/login';
    });

    const modeBtns = document.querySelectorAll('.mode-btn');
    const terminal = document.getElementById('terminal');
    const killBtn = document.getElementById('kill-btn');

    let pollInterval = null;

    function renderLogs(logs) {
        if (!logs || logs.length === 0) return;
        terminal.innerHTML = logs.map(l => {
            // Highlight action signals (BUY/SELL)
            let msg = l.msg;
            if (msg.includes('BUY')) msg = msg.replace('BUY', '<span style="color:#4ade80; font-weight:bold;">BUY</span>');
            if (msg.includes('SELL')) msg = msg.replace('SELL', '<span style="color:#f87171; font-weight:bold;">SELL</span>');
            
            return `
            <div class="log-line">
                <span class="log-time">[${new Date(l.time).toLocaleTimeString()}]</span>
                <span>${msg}</span>
            </div>
        `}).join('');
    }

    function syncUI(stateObj) {
        modeBtns.forEach(b => {
            if (b.getAttribute('data-mode') === stateObj.state) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        renderLogs(stateObj.logs);
    }

    async function fetchStatus() {
        try {
            const data = await window.api.get('/trader/status');
            syncUI(data);
        } catch (err) {
            terminal.innerHTML = `<div style="color:#ef4444">Connection lost to AI runtime. Check backend server.</div>`;
        }
    }

    // Assign Mode Change Dispatchers
    modeBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const mode = e.target.getAttribute('data-mode');
            
            modeBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            try {
                await window.api.post('/trader/mode', { mode });
                fetchStatus();
            } catch (err) {
                alert("Failed to change engine state.");
                fetchStatus();
            }
        });
    });

    // Liquidation Switch
    killBtn.addEventListener('click', async () => {
        if(confirm("Are you sure you want to stop the engine and LIQUIDATE all open positions at market price?")) {
            killBtn.textContent = 'EXECUTING...';
            try {
                await window.api.post('/trader/kill');
                alert("All orders cancelled and positions liquidated via Alpaca Bridge.");
            } catch(e) {
                alert("Error liquidating portfolio. Sign into Alpaca dashboard immediately to audit.");
            }
            killBtn.textContent = '🚨 LIQUIDATE PORTFOLIO';
            fetchStatus();
        }
    });

    // Simple robust polling for live log terminal updates
    fetchStatus();
    pollInterval = setInterval(fetchStatus, 3000);
});
