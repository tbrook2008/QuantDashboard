// ═══════════════════════════════════════════════════════
//  MarketPulse — Home Page Module
// ═══════════════════════════════════════════════════════

const INDEX_TILES = [
  { sym: 'SPY',    name: 'S&P 500 ETF' },
  { sym: 'QQQ',    name: 'NASDAQ ETF' },
  { sym: 'IWM',    name: 'Russell 2000' },
  { sym: 'GLD',    name: 'Gold ETF' },
  { sym: 'BTCUSD', name: 'Bitcoin' },
  { sym: 'ETHUSD', name: 'Ethereum' },
];

const SECTORS = [
  { name: 'Technology',  sym: 'XLK',  base: 0.8 },
  { name: 'Health',      sym: 'XLV',  base: 0.3 },
  { name: 'Financials',  sym: 'XLF',  base: -0.2 },
  { name: 'Energy',      sym: 'XLE',  base: -0.6 },
  { name: 'Consumer',    sym: 'XLY',  base: 0.5 },
  { name: 'Industrial',  sym: 'XLI',  base: 0.1 },
  { name: 'Utilities',   sym: 'XLU',  base: -0.4 },
  { name: 'Materials',   sym: 'XLB',  base: 0.2 },
];

const MOVERS_DATA = { gainers: [], losers: [] };
let moversTab = 'gainers';

// ── Init ─────────────────────────────────────────────────
function initHome() {
  buildIndexTiles();
  buildSectorHeatmap();
  loadNews();
  loadCrypto();
  loadMacro();
  buildTicker();

  // Refresh every 30s
  setInterval(loadNews,   30000);
  setInterval(loadCrypto, 30000);
  setInterval(buildMoversList, 15000);
}

// ── Index Tiles ───────────────────────────────────────────
function buildIndexTiles() {
  const grid = document.getElementById('index-tiles');
  grid.innerHTML = INDEX_TILES.map(({ sym, name }) => `
    <div class="index-tile" id="tile-${sym}" onclick="selectSymbol('${sym}')">
      <div class="it-top">
        <span class="it-sym">${sym}</span>
      </div>
      <div class="it-name">${name}</div>
      <div class="it-price" id="tp-${sym}">–</div>
      <div class="it-chg" id="tc-${sym}">–</div>
      <div class="it-spark" id="spark-${sym}"></div>
    </div>
  `).join('');

  // Load sparklines
  INDEX_TILES.forEach(({ sym }) => loadSparkline(sym));
}

async function loadSparkline(sym) {
  try {
    const { bars } = await API.getBars(sym, '1D', 30);
    if (!bars || bars.length < 2) return;

    const closes = bars.map(b => b.close);
    const last   = closes[closes.length - 1];
    const first  = closes[0];
    const chgPct = ((last - first) / first * 100);
    const isUp   = chgPct >= 0;

    // Update price + change
    document.getElementById(`tp-${sym}`).textContent = `$${fmt(last)}`;
    const chgEl = document.getElementById(`tc-${sym}`);
    chgEl.textContent = fmtPct(chgPct);
    chgEl.className   = `it-chg ${isUp ? 'up' : 'dn'}`;

    // Color tile
    const tile = document.getElementById(`tile-${sym}`);
    tile.classList.toggle('up', isUp);
    tile.classList.toggle('dn', !isUp);

    // Draw sparkline canvas
    const container = document.getElementById(`spark-${sym}`);
    container.innerHTML = '';
    const canvas  = document.createElement('canvas');
    container.appendChild(canvas);
    drawSparkline(canvas, closes, isUp);

    // Update movers data
    const entry = { sym, name: sym, price: last, chgPct };
    if (isUp) MOVERS_DATA.gainers.push(entry);
    else       MOVERS_DATA.losers.push(entry);

  } catch (e) { /* fail silently for sparklines */ }
}

function drawSparkline(canvas, data, up) {
  const W = canvas.offsetWidth || 180;
  const H = 38;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const x = (i) => (i / (data.length - 1)) * W;
  const y = (v)  => H - ((v - min) / range) * H * 0.85 - H * 0.05;

  const color = up ? '#00d67a' : '#e8192c';
  const grd   = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, up ? 'rgba(0,214,122,.3)' : 'rgba(232,25,44,.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');

  // Fill
  ctx.beginPath();
  ctx.moveTo(x(0), H);
  data.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(x(data.length - 1), H);
  ctx.closePath();
  ctx.fillStyle = grd;
  ctx.fill();

  // Line
  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.stroke();
}

// ── Sector Heatmap ────────────────────────────────────────
function buildSectorHeatmap() {
  const hm = document.getElementById('sector-heatmap');
  // Simulated sector changes for display
  const changes = SECTORS.map(s => ({
    ...s,
    chg: s.base + (Math.random() - 0.5) * 0.5,
  }));
  renderHeatmap(changes);
}

function renderHeatmap(sectors) {
  const hm = document.getElementById('sector-heatmap');
  hm.innerHTML = sectors.map(s => {
    const isUp   = s.chg >= 0;
    const intensity = Math.min(Math.abs(s.chg) / 2, 1);
    const color  = isUp
      ? `rgba(0,214,122,${0.15 + intensity * 0.4})`
      : `rgba(232,25,44,${0.12 + intensity * 0.35})`;
    return `
      <div class="sector-cell" style="background:${color}" onclick="selectSymbol('${s.sym}')">
        <div class="sc-name">${s.name}</div>
        <div class="sc-val ${isUp ? 'up' : 'dn'}">${fmtPct(s.chg)}</div>
      </div>
    `;
  }).join('');
}

// ── News ──────────────────────────────────────────────────
async function loadNews() {
  try {
    const { articles } = await API.getNews([], 12);
    const feed = document.getElementById('news-feed');
    if (!articles || !articles.length) return;

    feed.innerHTML = articles.map(a => `
      <div class="news-item" onclick="window.open('${a.url || '#'}','_blank')">
        <div class="ni-top">
          <span class="ni-cat ${a.sentiment}">${a.sentiment?.toUpperCase() || 'NEWS'}</span>
          <span class="ni-head">${a.headline}</span>
        </div>
        <div class="ni-meta">${a.source || ''} · ${fmtTime(a.timestamp)}</div>
      </div>
    `).join('');

    // Update breaking banner
    const headlines = articles.slice(0, 5).map(a => a.headline).join(' &nbsp;│&nbsp; ');
    const inner = null; if (!inner) return;
    if (inner) inner.innerHTML = `${headlines} &nbsp;│&nbsp; ${headlines}`;

  } catch (e) { /* fail silently */ }
}

function prependNewsItem(article) {
  const feed = document.getElementById('news-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'news-item';
  div.innerHTML = `
    <div class="ni-top">
      <span class="ni-cat ${article.sentiment}">${(article.sentiment || 'news').toUpperCase()}</span>
      <span class="ni-head">${article.headline}</span>
    </div>
    <div class="ni-meta">${article.source || ''} · Just now</div>
  `;
  feed.prepend(div);
  // Keep max 12
  while (feed.children.length > 12) feed.lastChild.remove();
}

// ── Crypto ────────────────────────────────────────────────
async function loadCrypto() {
  try {
    const { prices } = await API.getCrypto();
    if (!prices) return;
    const strip = document.getElementById('crypto-list');
    strip.innerHTML = Object.entries(prices).map(([sym, data]) => `
      <div class="cc-cell" onclick="selectSymbol('${sym}')">
        <div class="cc-sym">${sym}</div>
        <div class="cc-price">$${fmt(data.price, 2)}</div>
        <div class="cc-chg ${data.change >= 0 ? 'up' : 'dn'}">${fmtPct(data.change)}</div>
      </div>
    `).join('');
  } catch {}
}

// ── Macro Watch ───────────────────────────────────────────
function loadMacro() {
  // These would come from a Polygon or FRED API in production
  // For now, display simulated realistic values
  const macro = {
    'm-10y': '4.38%', 'm-2y': '4.82%', 'm-dxy': '104.2',
    'm-gold': '$' + fmt(2389), 'm-wti': '$' + fmt(83.4), 'm-vix': '14.8',
  };
  for (const [id, val] of Object.entries(macro)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

// ── Ticker Bar ────────────────────────────────────────────
function buildTicker() {
  const TICK_SYMS = [
  'SPY','QQQ','IWM','TLT','GLD',           // ETFs
  'AAPL','MSFT','NVDA','TSLA','AMZN',      // Equities
  'META','AMD','GOOGL','JPM','V',           // More equities
  'BTCUSD','ETHUSD','SOLUSD',              // Crypto
];
  const inner = document.getElementById('tick-inner');
  const items = TICK_SYMS.map(sym => `
    <span class="tick-item" id="tick-${sym}" onclick="selectSymbol('${sym}')">
      <span class="tick-sym">${sym}</span>
      <span class="tick-price" id="tprice-${sym}">–</span>
      <span class="tick-chg up" id="tchg-${sym}">–</span>
    </span>
    <span class="tick-sep">│</span>
  `).join('');
  // Double for seamless loop
  inner.innerHTML = items + items;
}

// ── Movers ────────────────────────────────────────────────
function setMoversTab(tab, btn) {
  moversTab = tab;
  document.querySelectorAll('.panel-head .tgl').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  buildMoversList();
}

function buildMoversList() {
  const list = document.getElementById('movers-list');
  const data = moversTab === 'gainers'
    ? [...MOVERS_DATA.gainers].sort((a, b) => b.chgPct - a.chgPct)
    : [...MOVERS_DATA.losers].sort((a, b) => a.chgPct - b.chgPct);

  if (!data.length) {
    list.innerHTML = '<div class="empty-state">Loading movers...</div>';
    return;
  }

  list.innerHTML = data.slice(0, 6).map(m => `
    <div class="mover-row" onclick="selectSymbol('${m.sym}')">
      <div>
        <div class="mv-sym">${m.sym}</div>
      </div>
      <div class="mv-price">$${fmt(m.price)}</div>
      <div class="mv-chg ${m.chgPct >= 0 ? 'up' : 'dn'}">${fmtPct(m.chgPct)}</div>
    </div>
  `).join('');
}

// ── Regime Widget ─────────────────────────────────────────
function updateRegimeWidget(regime) {
  const display = document.getElementById('regime-value');
  const fill    = document.getElementById('regime-bar');
  const pct     = document.getElementById('regime-conf');
  const signals = document.getElementById('regime-signals');

  if (!display) return;
  display.textContent  = regime.regime;
  display.className    = `regime-display ${regime.regime}`;
  fill.style.width     = `${regime.confidence || 0}%`;
  fill.style.background = regime.regime === 'BULL' ? 'var(--green)' : regime.regime === 'BEAR' ? 'var(--red)' : 'var(--gold)';
  pct.textContent      = `${regime.confidence || 0}%`;
  if (signals && regime.signals) signals.textContent = regime.signals.join(' · ');
}
