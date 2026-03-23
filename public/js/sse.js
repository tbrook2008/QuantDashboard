// ═══════════════════════════════════════════════════════
//  MarketPulse — SSE Client
//  Handles real-time server push events
// ═══════════════════════════════════════════════════════

const SSE = {
  source: null,
  handlers: {},
  reconnectDelay: 3000,

  connect() {
    if (this.source) this.source.close();

    this.source = new EventSource('/sse/stream');

    this.source.onopen = () => {
      console.log('✅ SSE connected');
      // stream badge removed in new UI
    };

    this.source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.dispatch(data.type, data);
      } catch (e) {
        // ignore
      }
    };

    this.source.onerror = () => {
      // stream badge removed in new UI
      this.source.close();
      setTimeout(() => this.connect(), this.reconnectDelay);
    };
  },

  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  },

  dispatch(type, data) {
    if (this.handlers[type]) {
      this.handlers[type].forEach(h => h(data));
    }
    if (this.handlers['*']) {
      this.handlers['*'].forEach(h => h(data));
    }
  },
};

// ── Register global SSE handlers ─────────────────────────

// Quote updates → ticker bar + price displays
SSE.on('quote', (data) => {
  updateTickerItem(data.symbol, data);
  updatePriceDisplays(data.symbol, data);
});

// Bar updates → chart if viewing that symbol
SSE.on('bar', (data) => {
  if (window.currentChartSymbol === data.symbol) {
    // Charts module handles this
    if (window.onNewBar) window.onNewBar(data);
  }
});

// AI decisions
SSE.on('ai_decision', (data) => {
  appendToDecisionLog(data);
  if (data.action !== 'HOLD' && data.action !== 'SKIP') {
    toast(`🤖 AI: ${data.action} ${data.symbol} (${data.confidence}% conf)`, 'info');
  }
});

// AI thinking stream
SSE.on('ai_thinking', (data) => {
  updateAIThinking(data);
});



// Order updates
SSE.on('order_update', (data) => {
  toast(`📋 Order: ${data.side?.toUpperCase()} ${data.qty} ${data.symbol} — ${data.status}`, 'success');
  loadPortfolio(); // refresh portfolio
});

// Account updates
SSE.on('account', (data) => {
  if (data.account) renderAccountSummary(data.account);
});

// News
SSE.on('news', (data) => {
  if (data.article) prependNewsItem(data.article);
  updateBreakingBanner(data.article?.headline);
});

// Alerts
SSE.on('alert', (data) => {
  toast(data.message, data.level === 'error' ? 'error' : 'warning', 6000);
});

// Mode changes
SSE.on('ai_mode_change', (data) => {
  updateAIModeBadge(data.mode);
});

// ── Helpers ──────────────────────────────────────────────

function updateTickerItem(symbol, quote) {
  const item = document.getElementById(`tick-${symbol}`);
  if (!item) return;
  const priceEl = item.querySelector('.tick-price');
  const chgEl   = item.querySelector('.tick-chg');
  if (priceEl) priceEl.textContent = `$${fmt(quote.price)}`;
  if (chgEl && quote.change !== undefined) {
    chgEl.textContent = fmtPct(quote.change24h || quote.change || 0);
    chgEl.className   = `tick-chg ${parseFloat(quote.change24h || 0) >= 0 ? 'up' : 'dn'}`;
  }
}

function updatePriceDisplays(symbol, quote) {
  // Update hero tile if visible
  const tile = document.getElementById(`tile-${symbol}`);
  if (tile) {
    const priceEl = tile.querySelector('.it-price');
    if (priceEl) priceEl.textContent = `$${fmt(quote.price)}`;
  }

  // Update chart header if this symbol is active
  if (window.currentChartSymbol === symbol) {
    const el = document.getElementById('cs-price');
    if (el) el.textContent = `$${fmt(quote.price)}`;
  }
}

function updateBreakingBanner(headline) {
  if (!headline) return;
  const inner = document.getElementById('brk-inner'); if (!inner) return; // removed in new UI
  const span = document.createElement('span');
  span.textContent = headline;
  inner.prepend(span);
  // Keep only last 6
  while (inner.children.length > 12) inner.lastChild.remove();
}

function updateAIModeBadge(mode) {
  const badge = document.getElementById('mode-pill');
  if (!badge) return;
  badge.className = `ai-badge ${mode}`;
  badge.textContent = mode.toUpperCase();
  // Update mode buttons on trader page
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}
