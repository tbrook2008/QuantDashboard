// ═══════════════════════════════════════════════════════
//  MarketPulse — AI Trader Page Module
// ═══════════════════════════════════════════════════════

let pendingMap = {};
let decisionLog = [];
let currentWatchlist = [];

// ── Init ─────────────────────────────────────────────────
async function initTrader() {
  await loadAIStatus();
  await loadAIStats();
  await loadDecisionLog();
  renderWatchlist();

  // Sync scan interval dropdown with saved config
  try {
    const cfg = await API.getConfig();
    const sel = document.getElementById('scan-interval');
    if (sel && cfg.ai_interval) {
      sel.value = String(cfg.ai_interval);
    }
    // Sync risk controls
    if (cfg.max_position_size) {
      const el = document.getElementById('rf-max-pos');
      if (el) el.value = (parseFloat(cfg.max_position_size) * 100).toFixed(0);
    }
    if (cfg.max_daily_loss) {
      const el = document.getElementById('rf-max-loss');
      if (el) el.value = (parseFloat(cfg.max_daily_loss) * 100).toFixed(0);
    }
    if (cfg.min_confidence) {
      const el = document.getElementById('rf-min-conf');
      if (el) el.value = cfg.min_confidence;
    }
  } catch {}
}

// ── AI Status ─────────────────────────────────────────────
async function loadAIStatus() {
  try {
    const { mode, watchlist, pending, stats } = await API.getAIStatus();

    // Update mode UI
    updateAIModeBadge(mode);
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    // Watchlist
    currentWatchlist = watchlist || [];
    renderWatchlist();



  } catch (e) {
    console.error('loadAIStatus error:', e.message);
  }
}

// ── AI Stats ─────────────────────────────────────────────
async function loadAIStats() {
  try {
    const { stats } = await API.getAIStats();
    if (!stats) return;

    const winRate = stats.total > 0
      ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
      : '–';

    document.getElementById('ts-winrate').textContent = stats.total > 0 ? `${winRate}%` : '–';
    document.getElementById('ts-pnl').textContent     = stats.total_pnl != null ? fmtDollar(stats.total_pnl) : '–';
    document.getElementById('ts-trades').textContent  = stats.total || 0;
    document.getElementById('ts-best').textContent    = stats.best_trade != null ? fmtDollar(stats.best_trade) : '–';
    document.getElementById('ts-worst').textContent   = stats.worst_trade != null ? fmtDollar(stats.worst_trade) : '–';

    const pnlEl = document.getElementById('ts-pnl');
    if (stats.total_pnl != null) {
      pnlEl.className = `tstat-val ${stats.total_pnl >= 0 ? 'green' : 'red'}`;
    }
  } catch {}
}

// ── Decision Log ──────────────────────────────────────────
async function loadDecisionLog() {
  try {
    const { trades } = await API.getAITrades(50);
    decisionLog = trades || [];
    renderDecisionLog();
  } catch {}
}

function renderDecisionLog() {
  const container = document.getElementById('ai-decision-log');
  if (!container) return;

  if (!decisionLog.length) {
    container.innerHTML = '<div class="empty-state">No AI decisions yet — AI is scanning</div>';
    return;
  }

  container.innerHTML = decisionLog.slice(0, 30).map(t => `
    <div class="log-entry">
      <span class="log-time">${fmtTime(t.timestamp)}</span>
      <span class="log-sym ${t.action === 'BUY' ? 'green' : t.action === 'SELL' ? 'red' : ''}">${t.symbol}</span>
      <span class="log-action ${t.action}">${t.action}</span>
      <span class="log-conf">${t.confidence}%</span>
      <span class="log-reason">${t.reasoning || '–'}</span>
    </div>
  `).join('');
}

function appendToDecisionLog(decision) {
  decisionLog.unshift({
    timestamp: new Date().toISOString(),
    symbol:    decision.symbol,
    action:    decision.action,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    status:    'pending',
  });
  renderDecisionLog();
}



// ── AI Thinking Stream ────────────────────────────────────
function updateAIThinking(data) {
  // Update chart sidebar thinking panel if on charts page
  const thinkingEl = document.getElementById('ai-thinking-log');
  if (!thinkingEl) return;
  const step = document.createElement('div');
  step.className = 'ai-thinking-step';
  step.textContent = `${data.symbol}: ${data.content}`;
  thinkingEl.appendChild(step);
  // Keep last 5
  while (thinkingEl.children.length > 5) thinkingEl.firstChild.remove();
}

// ── Actions ───────────────────────────────────────────────


async function setAIMode(mode, btn) {
  try {
    await API.setAIMode(mode);
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    updateAIModeBadge(mode);
    toast(`AI mode: ${mode.toUpperCase()}`, 'info');
  } catch (e) {
    toast(`Failed to set mode: ${e.message}`, 'error');
  }
}

async function setScanInterval(val) {
  try {
    await API.saveConfig({ ai_interval: val });
    toast(`✅ Scan interval updated: every ${val} min`, 'success');
  } catch (e) {
    toast(`Failed to save interval: ${e.message}`, 'error');
  }
}

async function runAINow() {
  try {
    toast('🤖 AI scan triggered...', 'info');
    await API.runAIEngine();
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

async function saveRiskControls() {
  const maxPos  = parseFloat(document.getElementById('rf-max-pos').value) / 100;
  const maxLoss = parseFloat(document.getElementById('rf-max-loss').value) / 100;
  const minConf = parseInt(document.getElementById('rf-min-conf').value);
  try {
    await API.saveConfig({ max_position_size: maxPos, max_daily_loss: maxLoss, min_confidence: minConf });
    toast('Risk controls saved', 'success');
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  }
}

// ── Watchlist ──────────────────────────────────────────────
function renderWatchlist() {
  const container = document.getElementById('ai-watchlist-display');
  if (!container) return;
  container.innerHTML = currentWatchlist.map(sym => `
    <div class="wl-chip" title="Remove ${sym}">
      ${sym}
      <span class="remove" onclick="removeFromWatchlist('${sym}')">✕</span>
    </div>
  `).join('');
}

async function addToWatchlist() {
  const input = document.getElementById('watchlist-input');
  const sym   = input.value.toUpperCase().trim();
  if (!sym || currentWatchlist.includes(sym)) { input.value = ''; return; }
  currentWatchlist.push(sym);
  input.value = '';
  renderWatchlist();
  try {
    await API.setAIWatchlist(currentWatchlist);
    toast(`${sym} added to AI watchlist`, 'success');
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

async function removeFromWatchlist(sym) {
  currentWatchlist = currentWatchlist.filter(s => s !== sym);
  renderWatchlist();
  try {
    await API.setAIWatchlist(currentWatchlist);
    toast(`${sym} removed`, 'info');
  } catch {}
}

// Enter key for watchlist input
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('watchlist-input');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addToWatchlist(); });
});
