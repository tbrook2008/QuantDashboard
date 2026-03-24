// ═══════════════════════════════════════════════════════
//  MarketPulse — Portfolio Page Module
// ═══════════════════════════════════════════════════════

let equityChart;
let orderSide = 'buy';
let ordersTab = 'all';

// ── Init ─────────────────────────────────────────────────
async function initPortfolio() {
  initEquityChart();
  await loadPortfolio();
}

async function loadPortfolio() {
  await Promise.all([
    loadAccount(),
    loadPositions(),
    loadOrders(),
    loadEquityCurve(),
  ]);
}

// ── Account ───────────────────────────────────────────────
async function loadAccount() {
  try {
    const { account, demo } = await API.getAccount();

    if (demo || !account) {
      renderAccountSummary(null);
      return;
    }

    renderAccountSummary(account);
  } catch (e) {
    if (e.message.includes('Alpaca not configured') && !window.alpacaToasted) {
      toast('Connect your Alpaca API keys in Settings to view Portfolio!', 'error', 6000);
      window.alpacaToasted = true;
    }
  }
}

function renderAccountSummary(account) {
  if (!account) {
    document.getElementById('acct-equity').textContent = '–';
    document.getElementById('acct-cash').textContent   = '–';
    document.getElementById('acct-day-pnl').textContent = 'Connect Alpaca';
    document.getElementById('acct-bp').textContent     = '–';
    document.getElementById('acct-dt').textContent     = '–';
    return;
  }

  const equity  = parseFloat(account.equity);
  const cash    = parseFloat(account.cash);
  const dayPnl  = equity - parseFloat(account.last_equity || equity);
  const dayPct  = account.last_equity ? (dayPnl / parseFloat(account.last_equity) * 100) : 0;
  const bp      = parseFloat(account.buying_power);

  document.getElementById('acct-equity').textContent   = fmtDollar(equity);
  document.getElementById('acct-cash').textContent     = fmtDollar(cash);
  const dpEl = document.getElementById('acct-day-pnl');
  dpEl.textContent = `${fmtDollar(dayPnl)} (${fmtPct(dayPct)})`;
  dpEl.className   = `as-val ${dayPnl >= 0 ? 'green' : 'red'}`;
  document.getElementById('acct-bp').textContent       = fmtDollar(bp);
  document.getElementById('acct-dt').textContent       = `${account.daytrade_count || 0} / 3`;
}

// ── Positions ─────────────────────────────────────────────
async function loadPositions() {
  try {
    const { positions } = await API.getPositions();
    const body   = document.getElementById('positions-body');
    const noPosEl = document.getElementById('no-positions');
    const tableEl = document.getElementById('positions-table');

    if (!positions || !positions.length) {
      body.innerHTML = '';
      noPosEl.style.display = 'block';
      tableEl.style.display = 'none';
      return;
    }

    noPosEl.style.display  = 'none';
    tableEl.style.display  = 'table';

    body.innerHTML = positions.map(p => {
      const side    = parseInt(p.qty) > 0 ? 'long' : 'short';
      const pnl     = parseFloat(p.unrealized_pl);
      const pnlPct  = parseFloat(p.unrealized_plpc) * 100;
      const current = parseFloat(p.current_price);
      const avg     = parseFloat(p.avg_entry_price);

      return `
        <tr>
          <td><span class="td-sym">${p.symbol}</span></td>
          <td><span class="td-side ${side}">${side.toUpperCase()}</span></td>
          <td>${Math.abs(p.qty)}</td>
          <td>$${fmt(avg)}</td>
          <td>$${fmt(current)}</td>
          <td class="${pnl >= 0 ? 'green' : 'red'}">${fmtDollar(pnl)}</td>
          <td class="${pnlPct >= 0 ? 'green' : 'red'}">${fmtPct(pnlPct)}</td>
          <td>
            <button class="close-pos-btn" onclick="closePosition('${p.symbol}')">Close</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    // console.error('loadPositions error:', e.message);
  }
}

async function closePosition(symbol) {
  if (!confirm(`Close ${symbol} position?`)) return;
  try {
    await API.closePosition(symbol);
    toast(`${symbol} position closed`, 'success');
    setTimeout(loadPositions, 1500);
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error');
  }
}

async function closeAllPositions() {
  if (!confirm('Close ALL open positions? This cannot be undone.')) return;
  try {
    await API.closeAllPositions();
    toast('All positions closed', 'success');
    setTimeout(loadPositions, 2000);
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error');
  }
}

// ── Orders ────────────────────────────────────────────────
async function loadOrders() {
  try {
    const { orders } = await API.getOrders(ordersTab, 50);
    const body = document.getElementById('orders-body');
    if (!orders || !orders.length) {
      body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:20px">No orders</td></tr>`;
      return;
    }

    body.innerHTML = orders.map(o => {
      const filledPrice = parseFloat(o.filled_avg_price) || parseFloat(o.limit_price) || 0;
      const statusClass = { filled: 'filled', cancelled: 'cancelled', pending_new: 'pending', new: 'pending' }[o.status] || '';
      return `
        <tr>
          <td>${fmtTime(o.created_at)}</td>
          <td><span class="td-sym">${o.symbol}</span></td>
          <td class="${o.side === 'buy' ? 'green' : 'red'}">${o.side?.toUpperCase()}</td>
          <td>${o.qty}</td>
          <td style="text-transform:capitalize">${o.type}</td>
          <td>${filledPrice > 0 ? `$${fmt(filledPrice)}` : '–'}</td>
          <td><span class="td-status ${statusClass}">${o.status}</span></td>
          <td>
            ${['new','pending_new','accepted'].includes(o.status)
              ? `<button class="close-pos-btn" onclick="cancelOrder('${o.id}')">Cancel</button>`
              : ''}
          </td>
        </tr>
      `;
    }).join('');

  } catch {}
}

function setOrderTab(tab, btn) {
  ordersTab = tab;
  document.querySelectorAll('.panel-head .tgl').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadOrders();
}

async function cancelOrder(id) {
  try {
    await API.cancelOrder(id);
    toast('Order cancelled', 'info');
    setTimeout(loadOrders, 1000);
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error');
  }
}

// ── Equity Chart ──────────────────────────────────────────
function initEquityChart() {
  const LWC = window.LightweightCharts;
  if (!LWC) return;
  const container = document.getElementById('equity-chart');
  if (!container) return;

  equityChart = LWC.createChart(container, {
    layout: { background: { color: '#0c0d0f' }, textColor: '#4a5568' },
    grid:   { vertLines: { color: '#1c1f23' }, horzLines: { color: '#1c1f23' } },
    rightPriceScale: { borderColor: '#1c1f23' },
    timeScale: { borderColor: '#1c1f23', timeVisible: true },
    height: 200,
  });

  equityChart.addAreaSeries({
    lineColor: '#2d8cf0',
    topColor:  'rgba(45,140,240,0.3)',
    bottomColor: 'rgba(45,140,240,0)',
    lineWidth: 2,
  });
}

async function loadEquityCurve() {
  try {
    const { history, snapshots } = await API.getPortfolioHistory('1M');
    const LWC = window.LightweightCharts;
    if (!LWC || !equityChart) return;

    let data = [];

    // Prefer Alpaca portfolio history
    if (history?.equity && history.timestamp) {
      data = history.timestamp.map((ts, i) => ({
        time:  Math.floor(ts),
        value: history.equity[i],
      })).filter(d => d.value > 0);
    }

    // Fall back to our snapshots
    if (!data.length && snapshots?.length) {
      data = snapshots.map(s => ({
        time:  Math.floor(new Date(s.timestamp).getTime() / 1000),
        value: s.equity,
      }));
    }

    if (data.length) {
      const series = equityChart.series()[0];
      if (series) series.setData(data);
    }

  } catch {}
}

function setEquityPeriod(period, btn) {
  document.querySelectorAll('.panel-head .tgl').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadEquityCurve(period);
}

// ── Manual Order Form ─────────────────────────────────────
function setOrderSide(side, btn) {
  orderSide = side;
  document.querySelectorAll('.ob-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const submitBtn = document.getElementById('submit-order-btn');
  if (submitBtn) {
    submitBtn.style.background = side === 'buy' ? 'var(--green)' : 'var(--red)';
    submitBtn.style.color      = side === 'buy' ? '#000' : '#fff';
    submitBtn.textContent      = `${side.toUpperCase()} Order`;
  }
}

function toggleLimitField(type) {
  document.getElementById('of-limit-row').style.display = type === 'limit' ? 'flex' : 'none';
}

async function submitManualOrder() {
  const symbol = document.getElementById('of-symbol').value.toUpperCase().trim();
  const qty    = parseInt(document.getElementById('of-qty').value);
  const type   = document.getElementById('of-type').value;
  const limit  = parseFloat(document.getElementById('of-limit').value) || null;
  const sl     = parseFloat(document.getElementById('of-sl').value) || null;
  const tp     = parseFloat(document.getElementById('of-tp').value) || null;

  if (!symbol || !qty || qty <= 0) {
    toast('Symbol and quantity required', 'error'); return;
  }

  const confirmMsg = `${orderSide.toUpperCase()} ${qty} shares of ${symbol}${type === 'limit' ? ` @ $${limit}` : ' at market'}. Confirm?`;
  if (!confirm(confirmMsg)) return;

  try {
    const { order } = await API.submitOrder({
      symbol, qty, side: orderSide, type,
      limitPrice: limit, stopLoss: sl, takeProfit: tp,
    });
    toast(`✅ Order submitted: ${orderSide.toUpperCase()} ${qty} ${symbol}`, 'success');
    // Clear form
    document.getElementById('of-symbol').value = '';
    document.getElementById('of-qty').value    = '';
    setTimeout(loadPortfolio, 2000);
  } catch (e) {
    toast(`Order failed: ${e.message}`, 'error');
  }
}

// ── Kill Switch ────────────────────────────────────────────
async function triggerKillSwitch() {
  if (!confirm('⚠️ EMERGENCY KILL SWITCH\n\nThis will:\n• Cancel ALL open orders\n• Close ALL open positions\n\nAre you absolutely sure?')) return;
  if (!confirm('Second confirmation: Close everything NOW?')) return;

  try {
    const result = await API.killSwitch();
    toast('🚨 Kill switch activated — all positions closed!', 'error', 8000);
    setTimeout(loadPortfolio, 2000);
  } catch (e) {
    toast(`Kill switch error: ${e.message}`, 'error');
  }
}
