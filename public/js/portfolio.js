document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('mp_token');
        window.location.href = '/login';
    });

    const accountStats = document.getElementById('account-stats');
    const positionsTable = document.querySelector('#positions-table tbody');
    const ordersList = document.getElementById('orders-list');

    try {
        // Parallel fetch for portfolio UI
        const [account, portfolio] = await Promise.all([
            window.api.get('/portfolio/account'),
            window.api.get('/portfolio/positions')
        ]);

        // Render Top Stat Cards
        const pnlNum = parseFloat(account.day_pnl);
        const pnlClass = pnlNum >= 0 ? 'stat-up' : 'stat-down';
        const pnlSign = pnlNum >= 0 ? '+' : '';

        accountStats.innerHTML = `
            <div class="card stat-card"><div class="stat-label">Total Equity</div><div class="stat-value">$${parseFloat(account.equity).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>
            <div class="card stat-card"><div class="stat-label">Today's P&L</div><div class="stat-value ${pnlClass}">${pnlSign}$${pnlNum.toFixed(2)} (${account.day_pnl_pct}%)</div></div>
            <div class="card stat-card"><div class="stat-label">Cash Balance</div><div class="stat-value">$${parseFloat(account.cash).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>
            <div class="card stat-card"><div class="stat-label">Buying Power</div><div class="stat-value">$${parseFloat(account.buying_power).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>
        `;

        // Render Positions
        if (portfolio.positions && portfolio.positions.length > 0) {
            positionsTable.innerHTML = portfolio.positions.map(p => {
                const uPnl = parseFloat(p.unrealized_pl);
                const dPnl = parseFloat(p.unrealized_intraday_pl);
                return `
                <tr>
                    <td style="font-weight:700">${p.symbol}</td>
                    <td>${p.qty}</td>
                    <td>$${parseFloat(p.avg_entry_price).toFixed(2)}</td>
                    <td>$${parseFloat(p.current_price).toFixed(2)}</td>
                    <td class="${dPnl >= 0 ? 'stat-up' : 'stat-down'}">${dPnl >= 0 ? '+' : ''}$${dPnl.toFixed(2)}</td>
                    <td class="${uPnl >= 0 ? 'stat-up' : 'stat-down'}">${uPnl >= 0 ? '+' : ''}$${uPnl.toFixed(2)} (${(parseFloat(p.unrealized_plpc)*100).toFixed(2)}%)</td>
                </tr>
            `}).join('');
        } else {
            positionsTable.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-secondary);">No active positions detected in Alpaca environment.</td></tr>`;
        }

        // Render Orders
        if (portfolio.orders && portfolio.orders.length > 0) {
            ordersList.innerHTML = portfolio.orders.slice(0, 10).map(o => `
                <div style="padding: 1rem 0; border-bottom: 1px solid var(--border-color);">
                    <div style="display:flex; justify-content: space-between; margin-bottom: 0.25rem;">
                        <strong>${o.symbol}</strong>
                        <span style="font-size: 0.75rem; background: var(--border-color); padding: 0.15rem 0.5rem; border-radius: 4px; font-weight:600;">${o.status.toUpperCase()}</span>
                    </div>
                    <div style="font-family: var(--mono-font); font-size: 0.85rem; color: var(--text-secondary);">
                        <span class="${o.side === 'buy' ? 'side-buy' : 'side-sell'}">${o.side.toUpperCase()}</span> ${o.qty !== null ? o.qty : ''} @ ${o.type} ${o.limit_price ? '$'+o.limit_price : ''}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">
                        ${new Date(o.submitted_at).toLocaleString()}
                    </div>
                </div>
            `).join('');
        } else {
            ordersList.innerHTML = `<p style="color: var(--text-secondary); font-size: 0.9rem;">No recent orders located.</p>`;
        }

    } catch (err) {
        console.error(err);
        accountStats.innerHTML = `<div class="error-msg" style="display:block; grid-column: span 4; font-weight:600;">Data Bridge Failure: Verify your encrypted Alpaca secure keys via initialization.</div>`;
    }
});
