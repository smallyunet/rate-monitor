import { mountPositions, mergePlatformCells } from './positions.js';
import { productEarnTiers, rateHighlights } from './earn-apr.js';
import { publicBitgetRates } from './bitget.js';
import { PLATFORMS, readPlatform, savePlatform, filterPlatform, updateContent, relativeTime } from './view-state.js';
const ENDPOINT = '/api/rates';
const platformFilter = document.querySelector('#platform-filter');
const platformOptions = [...document.querySelectorAll('input[name="platform"]')];
const allPlatforms = document.querySelector('#platform-all');
let platform = [...PLATFORMS];
try { platform = readPlatform(localStorage); } catch { /* Storage may be disabled. */ }
function syncPlatformFilter() {
  for (const option of platformOptions) option.checked = platform.includes(option.value);
  allPlatforms.checked = platform.length === PLATFORMS.length;
  allPlatforms.indeterminate = platform.length > 0 && !allPlatforms.checked;
  const label = allPlatforms.checked ? 'All platforms' : platform.length ? platform.join(' + ') : 'No platforms';
  document.querySelector('#platform-label').textContent = label;
  document.querySelector('#platform-empty').hidden = platform.length > 0;
}
syncPlatformFilter();
let latestProducts = [], ratesRefreshing = false;
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
function render(allProducts, { animate = true } = {}) {
  latestProducts = allProducts;
  const products = filterPlatform(allProducts, platform);
  const highlights = rateHighlights(products);
  const bodies = { loan: el('tbody'), earn: el('tbody') };
  document.querySelector('#config').hidden = !products.some(p => p.platform === 'Binance' && p.status === 'not_configured');
  for (const p of products) {
    const row = el('tr', `rate-row ${p.kind}-row`);
    row.dataset.key = p.id;
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
    apr.setAttribute('data-live-value', '');
    apr.classList.toggle('loading-value', p.status === 'loading');
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
  for (const [kind, body] of Object.entries(bodies)) {
    mergePlatformCells(body);
    updateContent(document.querySelector(`#${kind}-rows`), body, { animate });
  }
  for (const kind of ['loan', 'earn']) {
    const list = products.filter(p => p.kind === kind);
    document.querySelector(`[data-rate-status="${kind}"]`).textContent = ratesRefreshing
      ? latestProducts.some(p => p.status === 'loading') ? 'Loading…' : 'Refreshing…'
      : `${list.filter(p => p.status === 'ok').length} / ${list.length}`;
  }
}
async function refresh() {
  ratesRefreshing = true;
  document.querySelector('#rates').setAttribute('aria-busy', 'true');
  // Retain the last view while fetching; failures below replace old values explicitly.
  render(latestProducts.length ? latestProducts : descriptors.map(p => ({ ...p, status: 'loading', apr: null })), { animate: false });
  try {
    const response = await fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(65000) });
    if (!response.ok) throw new Error('service_error');
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('service_error');
    let products = descriptors.map(d => {
      const p = data.products.find(p => p.id === d.id);
      return p ? { ...p, ...d } : { ...d, status: 'error', apr: null, error: 'invalid_data' };
    });
    // Publish available results before waiting on the slower public fallback.
    render(products);
    positionsView.setRates(products);
    document.querySelectorAll('[data-rates-updated]').forEach(node => setUpdatedTime(node, data.requestedAt));
    if (products.some(p => p.platform === 'Bitget' && p.kind === 'loan' && p.status === 'error')) {
      const fallback = await publicBitgetRates();
      products = products.map(p => p.platform === 'Bitget' && p.kind === 'loan' && p.status === 'error'
        ? fallback.find(item => item.id === p.id) || p : p);
      render(products);
      positionsView.setRates(products);
    }
    return products.every(p => p.status === 'ok');
  } catch {
    render(descriptors.map(p => ({ ...p, status: 'error', apr: null, error: 'service_error' })));
    positionsView.setRates(latestProducts);
    for (const node of document.querySelectorAll('[data-rates-updated]')) {
      node.textContent = ''; delete node.dataset.updatedAt; node.removeAttribute('title');
    }
    return false;
  } finally {
    ratesRefreshing = false;
    render(latestProducts, { animate: false });
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
const positionsView = mountPositions({ el, logoLabel, platform });
platformFilter.addEventListener('change', event => {
  platform = event.target === allPlatforms ? allPlatforms.checked ? [...PLATFORMS] : []
    : platformOptions.filter(option => option.checked).map(option => option.value);
  syncPlatformFilter();
  try { savePlatform(localStorage, platform); } catch { /* Keep in-memory selection. */ }
  render(latestProducts, { animate: false });
  positionsView.setPlatform(platform);
});
document.addEventListener('click', event => {
  if (!platformFilter.contains(event.target)) platformFilter.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && platformFilter.open) {
    platformFilter.open = false;
    platformFilter.querySelector('summary').focus();
  }
});
const refreshButton = document.querySelector('#refresh');
const refreshLabel = refreshButton.querySelector('.refresh-label');
let feedbackTimer;
async function refreshAll() {
  if (refreshButton.disabled) return;
  clearTimeout(feedbackTimer);
  refreshButton.disabled = true;
  refreshLabel.textContent = 'Refreshing…';
  refreshButton.dataset.state = 'loading';
  refreshButton.setAttribute('aria-busy', 'true');
  const started = Date.now();
  try {
    const results = await Promise.allSettled([refresh(), positionsView.refresh()]);
    // Keep very fast responses from producing a distracting spinner flash.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 450 - (Date.now() - started))));
    const partial = results.some(result => result.status === 'rejected' || result.value === false);
    refreshButton.dataset.state = partial ? 'partial' : 'done';
    refreshLabel.textContent = partial ? 'Partial update' : 'Updated';
    document.querySelector('#refresh-status').textContent = partial ? 'Refresh finished. Some data is unavailable; check the panels.' : 'Rates and positions updated.';
  }
  finally {
    refreshButton.disabled = false;
    refreshButton.setAttribute('aria-busy', 'false');
    feedbackTimer = setTimeout(() => { refreshLabel.textContent = 'Refresh'; delete refreshButton.dataset.state; }, 2200);
  }
}
refreshButton.addEventListener('click', refreshAll);
refreshAll();
