import { mountPositions, mergePlatformCells } from './positions.js';
import { productEarnTiers, rateHighlights } from './earn-apr.js';
import { publicBitgetRates } from './bitget.js';
const ENDPOINT = '/api/rates';
const descriptors = [
  { id: 'binance-loan-usdc', platform: 'Binance', kind: 'loan', asset: 'USDC', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'binance-loan-usdt', platform: 'Binance', kind: 'loan', asset: 'USDT', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'binance-earn-usdc', platform: 'Binance', kind: 'earn', asset: 'USDC', name: 'Flexible Earn' },
  { id: 'binance-earn-usdt', platform: 'Binance', kind: 'earn', asset: 'USDT', name: 'Flexible Earn' },
  { id: 'bitget-loan-usdc', platform: 'Bitget', kind: 'loan', asset: 'USDC', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'bitget-loan-usdt', platform: 'Bitget', kind: 'loan', asset: 'USDT', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'bitget-earn-usdc', platform: 'Bitget', kind: 'earn', asset: 'USDC', name: 'Flexible Earn' },
  { id: 'bitget-earn-usdt', platform: 'Bitget', kind: 'earn', asset: 'USDT', name: 'Flexible Earn' },
  ...['loan', 'earn'].flatMap(kind => ['USDC', 'USDT'].map(asset => ({
    id: `okx-${kind}-${asset.toLowerCase()}`, platform: 'OKX', kind, asset,
    name: kind === 'loan' ? 'Flexible Loan' : 'Flexible Earn', ...(kind === 'loan' ? { collateral: 'BTC' } : {}),
  }))),
];
const errors = {
  missing_credentials: 'Credentials not configured', invalid_data: 'Invalid platform response',
  unavailable: 'Product unavailable', ambiguous_product: 'Multiple products; confirmation needed',
  network_error: 'Platform connection failed', upstream_error: 'Platform API unavailable',
  region_restricted: 'Service region restricted by platform', rate_limited: 'Rate limited; try again later',
  clock_error: 'Request timestamp rejected', credentials_error: 'API key, signature or permissions rejected',
  service_error: 'Rate service unavailable', stale_data: 'Latest settled rate is stale',
};
const percent = value => typeof value === 'number' && Number.isFinite(value)
  ? `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 })}%` : '—';
const time = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '—';
function relativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function setUpdatedTime(node, value) {
  node.dataset.updatedAt = value || '';
  node.title = time(value);
  node.textContent = relativeTime(value);
}
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
function logoLabel(name) {
  const label = el('span', 'logo-label');
  if (!['OKX', 'Binance', 'Bitget', 'BTC', 'USDC', 'USDT'].includes(name)) { label.textContent = name; return label; }
  const icon = el('img', 'logo');
  icon.src = `./icons/${name === 'Binance' ? 'binance' : name.toLowerCase()}.svg`;
  icon.alt = '';
  icon.width = 18;
  icon.height = 18;
  label.append(icon, document.createTextNode(name));
  return label;
}
const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 8 });
function tierLabel(tier, asset) {
  if (tier.to === Infinity) return tier.from === 0 ? 'All amounts' : `Above ${number(tier.from)} ${asset}`;
  return tier.from === 0 ? `First ${number(tier.to)} ${asset}` : `${number(tier.from)}–${number(tier.to)} ${asset}`;
}
function renderEarn(p, apr, highlight) {
  let tiers;
  if (p.status === 'ok') {
    try { tiers = productEarnTiers(p); }
    catch { apr.textContent = 'Tiers unavailable'; apr.classList.add('error'); }
  }
  if (tiers) {
    apr.replaceChildren();
    for (const [index, tier] of tiers.entries()) {
      const line = el('div', 'apr-tier');
      const value = el('span', 'rate-value');
      value.append(el('strong', '', percent(tier.apr)));
      if (highlight && index === 0) value.append(rateBadge('max'));
      line.append(el('span', 'secondary', `${tierLabel(tier, p.asset)}:`), value);
      apr.append(line);
    }
    if (p.platform === 'OKX' && p.bonusStatus === 'ok') {
      apr.append(el('div', 'secondary', `Bonus · ${p.bonus.days} days · eligibility required`));
    } else if (p.platform === 'OKX' && p.bonusStatus === 'error') {
      apr.append(el('div', 'secondary error', 'Bonus tiers unavailable'));
    }
  }
}
function rateBadge(label) {
  const badge = el('span', 'rate-badge', label);
  badge.title = label === 'min' ? 'Lowest APR in the Loan list' : 'Highest first-tier APR in the Earn list';
  return badge;
}
function render(products) {
  const highlights = rateHighlights(products);
  const bodies = { loan: document.querySelector('#loan-rows'), earn: document.querySelector('#earn-rows') };
  Object.values(bodies).forEach(body => body.replaceChildren());
  document.querySelector('#config').hidden = !products.some(p => p.platform === 'Binance' && p.status === 'not_configured');
  for (const p of products) {
    const row = el('tr', `rate-row ${p.kind}-row`);
    row.dataset.platform = p.platform;
    const platform = el('td');
    platform.append(logoLabel(p.platform));
    const product = el('td', 'product', p.name);
    const assets = el('td', 'assets');
    const pair = el('div', 'asset-pair');
    if (p.kind === 'loan') {
      pair.append(logoLabel(p.collateral), el('span', 'arrow', '→'));
      pair.title = 'Collateral → Borrowed asset';
    }
    pair.append(logoLabel(p.asset));
    assets.append(pair);
    const apr = el('td', p.kind === 'loan' ? 'apr' : 'tier-aprs', p.status === 'ok' && p.kind === 'loan' ? percent(p.apr) : '—');
    if (p.kind === 'earn') {
      renderEarn(p, apr, highlights.max.has(p.id));
    }
    if (p.kind === 'loan' && highlights.min.has(p.id)) {
      const value = el('span', 'rate-value', apr.textContent);
      value.append(rateBadge('min')); apr.replaceChildren(value);
    }
    const updated = el('td', 'updated');
    if (p.status === 'ok') {
      const age = el('span');
      setUpdatedTime(age, p.fetchedAt);
      updated.append(age);
      updated.title = time(p.fetchedAt);
      if (p.rateAt) updated.title += ` · Rate settled: ${time(p.rateAt)}`;
      if (p.kind === 'loan' && p.collateralEligible === false) updated.append(el('div', 'error', 'BTC unavailable'));
      if (p.kind === 'earn' && p.soldOut === true) updated.append(el('div', 'error', 'Sold out'));
      else if (p.kind === 'earn' && p.canPurchase === false) updated.append(el('div', 'error', 'Unavailable'));
    } else {
      updated.textContent = p.status === 'error' ? 'Error' : p.status === 'not_configured' ? 'No API key' : 'Loading…';
      updated.classList.toggle('error', p.status === 'error');
      const codes = [p.upstreamStatus, p.upstreamCode].filter(Number.isFinite);
      if (codes.length) updated.append(el('div', 'secondary', codes.join(' / ')));
      updated.title = errors[p.error] || 'Fetching rates';
    }
    row.append(platform, product, assets, apr, updated);
    row.setAttribute('role', 'row');
    const labels = ['Platform', 'Product', 'Assets', p.kind === 'loan' ? 'APR' : 'Tier APR', 'Updated'];
    Array.from(row.children).forEach((cell, index) => {
      cell.dataset.label = labels[index];
      cell.setAttribute('role', 'cell');
      const value = el('div', 'cell-value');
      value.append(...cell.childNodes);
      cell.append(value);
    });
    bodies[p.kind].append(row);
  }
  Object.values(bodies).forEach(mergePlatformCells);
  positionsView.setRates(products);
  for (const kind of ['loan', 'earn']) {
    const list = products.filter(p => p.kind === kind);
    document.querySelector(`[data-rate-status="${kind}"]`).textContent = list.some(p => p.status === 'loading')
      ? 'Loading…' : `${list.filter(p => p.status === 'ok').length} / ${list.length}`;
  }
}
async function refresh() {
  document.querySelector('#rates').setAttribute('aria-busy', 'true');
  for (const node of document.querySelectorAll('[data-rates-updated]')) {
    node.textContent = ''; delete node.dataset.updatedAt; node.removeAttribute('title');
  }
  // Clear old quotes so a failed refresh cannot appear to be current.
  render(descriptors.map(p => ({ ...p, status: 'loading', apr: null })));
  try {
    const response = await fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(65000) });
    if (!response.ok) throw new Error('service_error');
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('service_error');
    let products = descriptors.map(d => {
      const p = data.products.find(p => p.id === d.id);
      return p ? { ...p, ...d } : { ...d, status: 'error', apr: null, error: 'invalid_data' };
    });
    if (products.some(p => p.platform === 'Bitget' && p.kind === 'loan' && p.status === 'error')) {
      const fallback = await publicBitgetRates();
      products = products.map(p => p.platform === 'Bitget' && p.kind === 'loan' && p.status === 'error'
        ? fallback.find(item => item.id === p.id) || p : p);
    }
    render(products);
    document.querySelectorAll('[data-rates-updated]').forEach(node => setUpdatedTime(node, data.requestedAt));
  } catch {
    render(descriptors.map(p => ({ ...p, status: 'error', apr: null, error: 'service_error' })));
    document.querySelectorAll('[data-rate-status]').forEach(node => { node.textContent = 'Connection failed'; });
  } finally {
    document.querySelector('#rates').setAttribute('aria-busy', 'false');
  }
}

// Advance the age labels locally; this does not fetch or refresh platform rates.
setInterval(() => {
  for (const node of document.querySelectorAll('[data-updated-at]')) {
    const label = relativeTime(node.dataset.updatedAt);
    if (node.textContent !== label) node.textContent = label;
  }
}, 1000);
const positionsView = mountPositions({ el, logoLabel });
const refreshButton = document.querySelector('#refresh');
async function refreshAll() {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  refreshButton.textContent = 'Refreshing…';
  refreshButton.setAttribute('aria-busy', 'true');
  try { await Promise.allSettled([refresh(), positionsView.refresh()]); }
  finally {
    refreshButton.disabled = false;
    refreshButton.textContent = 'Refresh';
    refreshButton.setAttribute('aria-busy', 'false');
  }
}
refreshButton.addEventListener('click', refreshAll);
refreshAll();
