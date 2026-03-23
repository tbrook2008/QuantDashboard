// ═══════════════════════════════════════════════════════
//  MarketPulse — App Bootstrap
// ═══════════════════════════════════════════════════════

let configData   = {};
let selectedEnv  = 'paper';
let currentPage  = 'home';

document.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('token')) {
    document.getElementById('login-overlay').style.display = 'flex';
  } else {
    initApp();
  }
});

async function initApp() {
  document.getElementById('login-overlay').style.display = 'none';
  updateClock(); setInterval(updateClock, 1000);
  SSE.connect();

  await loadConfigState();
  initHome();
  checkMarketStatus();
  setInterval(checkMarketStatus, 60000);
  setTimeout(initCharts, 150);
}

// ── Clock ─────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'America/New_York'
  }) + ' ET';
}

// ── Market Status ─────────────────────────────────────────
async function checkMarketStatus() {
  try {
    const clock = await API.getClock();
    const el    = document.getElementById('market-status');
    if (!el) return;
    if (clock?.is_open) {
      el.textContent = 'OPEN'; el.style.color = 'var(--green)';
    } else {
      el.textContent = 'CLOSED'; el.style.color = 'var(--text3)';
    }
  } catch {}
}

// ── Page Router ───────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const pg  = document.getElementById(`pg-${page}`);
  const nav = document.querySelector(`[data-page="${page}"]`);
  if (pg)  pg.classList.add('active');
  if (nav) nav.classList.add('active');
  currentPage = page;
  if (page === 'charts')    { if (!priceChart) initCharts(); }
  if (page === 'trader')    initTrader();
  if (page === 'portfolio') initPortfolio();
}

// ── Config ────────────────────────────────────────────────
async function loadConfigState() {
  try {
    configData = await API.getConfig();
    selectedEnv = configData.alpaca_env || 'paper';
    updateEnvPill(selectedEnv);
    updateModePill(configData.ai_mode || 'approval');
    renderKeyStatus();

    // Show setup notice if no keys
    if (!configData.has_alpaca_key && !configData.has_anthropic_key) {
      const notice = document.getElementById('setup-notice');
      if (notice) notice.style.display = 'flex';
    }

    // Update acct-env badge
    const envEl = document.getElementById('acct-env');
    if (envEl) {
      envEl.textContent = selectedEnv.toUpperCase();
      envEl.style.color = selectedEnv === 'live' ? 'var(--red)' : 'var(--amber)';
    }
  } catch (e) { console.warn('loadConfigState:', e.message); }
}

function openConfig() {
  document.getElementById('modal').classList.add('open');
  // Pre-fill env buttons
  selectEnv(selectedEnv, document.getElementById(`env-${selectedEnv}-btn`));
  // Pre-fill fields
  document.getElementById('cfg-llm-provider').value = configData.llm_provider || 'anthropic';
  if (typeof toggleProviderFields === 'function') toggleProviderFields();
  renderKeyStatus();
}
function closeConfig() { document.getElementById('modal').classList.remove('open'); }

let pendingEnv = 'paper';
function selectEnv(env, btn) {
  pendingEnv = env;
  document.querySelectorAll('.env-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const warn = document.getElementById('live-warning');
  if (warn) warn.style.display = env === 'live' ? 'block' : 'none';
}

async function saveConfig() {
  const alpacaKey    = document.getElementById('cfg-alpaca-key').value.trim();
  const alpacaSecret = document.getElementById('cfg-alpaca-secret').value.trim();
  const anthropicKey = document.getElementById('cfg-anthropic-key').value.trim();
  const geminiKey    = document.getElementById('cfg-gemini-key').value.trim();
  const polygonKey   = document.getElementById('cfg-polygon-key').value.trim();
  const llmProvider  = document.getElementById('cfg-llm-provider').value;
  const env          = pendingEnv;

  // Require explicit live confirmation
  let liveConfirmed = false;
  if (env === 'live') {
    liveConfirmed = confirm(
      '⚠️ LIVE TRADING WARNING\n\n' +
      'You are switching to LIVE MONEY trading.\n' +
      'Any AI trades will use real funds.\n\n' +
      'Ensure you have:\n' +
      '• Tested your strategy on paper first\n' +
      '• Set appropriate risk controls\n' +
      '• Entered your LIVE API keys (not paper keys)\n\n' +
      'Are you sure you want to enable live trading?'
    );
    if (!liveConfirmed) return;
    if (!confirm('Final confirmation: enable LIVE trading with real money?')) return;
  }

  try {
    const data = await API.saveKeys({
      alpacaKey, alpacaSecret, alpacaEnv: env,
      anthropicKey, geminiKey, polygonKey, llmProvider, liveConfirmed
    });

    selectedEnv = env;
    updateEnvPill(env);

    const envEl = document.getElementById('acct-env');
    if (envEl) {
      envEl.textContent = env.toUpperCase();
      envEl.style.color = env === 'live' ? 'var(--red)' : 'var(--amber)';
    }

    toast(env === 'live' ? '⚠️ LIVE trading activated' : '✅ Keys saved — paper trading active', env === 'live' ? 'warning' : 'success', 5000);
    closeConfig();
    loadConfigState();
  } catch (e) {
    toast(`Failed: ${e.message}`, 'error');
  }
}

function renderKeyStatus() {
  const el = document.getElementById('key-status-list');
  if (!el || !configData) return;
  const aiActive = (configData.llm_provider === 'gemini') ? configData.has_gemini_key : configData.has_anthropic_key;
  const aiName   = (configData.llm_provider === 'gemini') ? 'Gemini' : 'Anthropic';
  const items = [
    { name: 'Alpaca',    ok: configData.has_alpaca_key,    detail: configData.has_alpaca_key ? `${configData.alpaca_env?.toUpperCase()} mode` : 'Not configured' },
    { name: `AI (${aiName})`, ok: aiActive,                detail: aiActive ? 'AI trading active' : 'Not configured' },
    { name: 'Polygon',   ok: configData.has_polygon_key,   detail: configData.has_polygon_key ? 'Live data' : 'Simulated data' },
  ];
  el.innerHTML = items.map(i => `
    <div class="ks-row">
      <span class="ks-name">${i.name}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:.68rem;color:var(--text3)">${i.detail}</span>
        <span class="ks-badge ${i.ok ? 'ok' : 'bad'}">${i.ok ? 'Connected' : 'Missing'}</span>
      </div>
    </div>
  `).join('');
}

// ── Env pill + quick switcher ──────────────────────────────
function updateEnvPill(env) {
  const pill = document.getElementById('env-pill');
  if (!pill) return;
  pill.textContent = env.toUpperCase();
  pill.className   = `env-pill ${env}`;
}

function openEnvSwitcher() {
  openConfig();
}

// ── Mode pill ─────────────────────────────────────────────
function updateModePill(mode) {
  const pill = document.getElementById('mode-pill');
  if (pill) {
    pill.textContent = mode === 'autonomous' ? 'AUTO' : mode === 'approval' ? 'APPROVAL' : 'PAUSED';
    pill.className   = `mode-pill ${mode}`;
  }
  
  const stopBtn = document.getElementById('nav-stop-ai');
  if (stopBtn) {
    if (mode === 'paused') {
      stopBtn.classList.add('stopped');
      stopBtn.innerHTML = '▶ Resume AI';
    } else {
      stopBtn.classList.remove('stopped');
      stopBtn.innerHTML = '⏹ Stop AI';
    }
  }
}

// ── Global AI Stop ────────────────────────────────────────
async function toggleGlobalAIStop() {
  const isStopped = document.getElementById('nav-stop-ai').classList.contains('stopped');
  const targetMode = isStopped ? 'autonomous' : 'paused';
  try {
    await API.setAIMode(targetMode);
    toast(targetMode === 'paused' ? '🛑 AI Trading Stopped' : '⚡ AI Trading Resumed', 'info');
    updateModePill(targetMode);
  } catch (e) {
    toast(`Failed to toggle AI: ${e.message}`, 'error');
  }
}

// ── Kill switch ───────────────────────────────────────────
async function triggerKillSwitch() {
  if (!confirm('⚠️ KILL SWITCH\n\nThis will cancel ALL orders and close ALL positions immediately.\nIt will also pause the AI generator.\n\nContinue?')) return;
  if (!confirm('Are you absolutely sure?')) return;
  try {
    await API.setAIMode('paused');
    updateModePill('paused');
    await API.killSwitch();
    toast('🚨 Kill switch activated — AI paused and positions closing', 'error', 8000);
    setTimeout(loadPortfolio, 2000);
  } catch (e) {
    toast(`Kill switch error: ${e.message}`, 'error');
  }
}

// ── API helpers ───────────────────────────────────────────
// These are called from trader.js and portfolio.js
function updateAIModeBadge(mode) {
  updateModePill(mode);
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

function updateAIThinking(data) {
  const el = document.getElementById('ai-thinking-log');
  if (!el) return;
  const step = document.createElement('div');
  step.className = 'ai-step';
  step.textContent = `${data.symbol}: ${data.content}`;
  el.appendChild(step);
  while (el.children.length > 5) el.firstChild.remove();
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 4000) {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '1') showPage('home');
  if (e.key === '2') showPage('charts');
  if (e.key === '3') showPage('trader');
  if (e.key === '4') showPage('portfolio');
  if (e.key === 'Escape') closeConfig();
});

document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeConfig();
});
