import { earnTiers, effectiveApr } from './earn-apr.js';
const amounts = new Map();
const ENDPOINT = 'https://rate-monitor-api.smallyu.workers.dev/api/rates';
const descriptors = [
  { id: 'binance-loan-usdc', platform: 'Binance', kind: 'loan', asset: 'USDC', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'binance-loan-usdt', platform: 'Binance', kind: 'loan', asset: 'USDT', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'binance-earn-usdc', platform: 'Binance', kind: 'earn', asset: 'USDC', name: 'Flexible Earn' },
  { id: 'binance-earn-usdt', platform: 'Binance', kind: 'earn', asset: 'USDT', name: 'Flexible Earn' },
  { id: 'bitget-loan-usdc', platform: 'Bitget', kind: 'loan', asset: 'USDC', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'bitget-loan-usdt', platform: 'Bitget', kind: 'loan', asset: 'USDT', name: 'Flexible Loan', collateral: 'BTC' },
];
const errors = {
  missing_credentials: 'Credentials not configured', invalid_data: 'Invalid platform response',
  unavailable: 'Product unavailable', ambiguous_product: 'Multiple products; confirmation needed',
  network_error: 'Platform connection failed', upstream_error: 'Platform API unavailable',
  region_restricted: 'Service region restricted by platform', rate_limited: 'Rate limited; try again later',
  clock_error: 'Request timestamp rejected', credentials_error: 'API key, signature or permissions rejected',
  service_error: 'Rate service unavailable',
};
const percent = value => typeof value === 'number' && Number.isFinite(value)
  ? `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 })}%` : '—';
const time = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : '—';
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
function logoLabel(name) {
  const label = el('span', 'logo-label');
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
function renderEarn(p, apr, effective) {
  let tiers;
  if (p.status === 'ok') {
    try { tiers = earnTiers(p.apr, p.tiers, p.asset); }
    catch { apr.textContent = 'Tiers unavailable'; apr.classList.add('error'); }
  }
  if (tiers) {
    apr.replaceChildren();
    for (const tier of tiers) {
      const line = el('div', 'apr-tier');
      line.append(el('span', 'secondary', tierLabel(tier, p.asset)), el('strong', '', percent(tier.apr)));
      apr.append(line);
    }
  }
  const result = el('output', 'apr effective-result', '—');
  result.setAttribute('aria-label', `${p.asset} effective APR`);
  result.setAttribute('aria-live', 'polite');
  const input = el('input', 'amount');
  input.id = `${p.id}-amount`;
  input.type = 'number'; input.min = '0'; input.step = 'any'; input.inputMode = 'decimal';
  input.placeholder = `Amount (${p.asset})`;
  input.setAttribute('aria-label', `${p.asset} deposit amount`);
  result.setAttribute('for', input.id);
  input.value = amounts.get(p.id) || '';
  const update = () => {
    amounts.set(p.id, input.value);
    const value = input.value === '' ? NaN : Number(input.value);
    const invalid = input.validity.badInput || (input.value !== '' && (!Number.isFinite(value) || value <= 0));
    input.setAttribute('aria-invalid', String(invalid));
    result.textContent = invalid ? 'Invalid amount' : tiers ? percent(effectiveApr(tiers, value)) : '—';
  };
  input.addEventListener('input', update);
  update();
  effective.replaceChildren(result, input);
}
function render(products) {
  const rows = document.querySelector('#rows');
  rows.replaceChildren();
  document.querySelector('#config').hidden = !products.some(p => p.status === 'not_configured');
  for (const p of products) {
    const row = el('tr');
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
    const effective = el('td', 'effective', '—');
    if (p.kind === 'earn') renderEarn(p, apr, effective);
    const updated = el('td', 'updated');
    if (p.status === 'ok') {
      updated.textContent = time(p.fetchedAt).replace(/^\d{4}-\d{2}-\d{2} /, '');
      updated.title = time(p.fetchedAt);
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
    row.append(platform, product, assets, apr, effective, updated);
    row.setAttribute('role', 'row');
    const labels = ['Platform', 'Product', 'Assets', 'Tier APR', 'Effective APR', 'Updated'];
    Array.from(row.children).forEach((cell, index) => {
      cell.dataset.label = labels[index];
      cell.setAttribute('role', 'cell');
      const value = el('div', 'cell-value');
      value.append(...cell.childNodes);
      cell.append(value);
    });
    rows.append(row);
  }
}
async function refresh() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#rates').setAttribute('aria-busy', 'true');
  document.querySelector('#status').textContent = 'Loading…';
  document.querySelector('#updated').textContent = '';
  // Clear old quotes so a failed refresh cannot appear to be current.
  render(descriptors.map(p => ({ ...p, status: 'loading', apr: null })));
  try {
    const response = await fetch(ENDPOINT, { cache: 'no-store', signal: AbortSignal.timeout(65000) });
    if (!response.ok) throw new Error('service_error');
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('service_error');
    const products = descriptors.map(d => {
      const p = data.products.find(p => p.id === d.id);
      return p ? { ...p, ...d } : { ...d, status: 'error', apr: null, error: 'invalid_data' };
    });
    render(products);
    const ok = products.filter(p => p.status === 'ok').length;
    document.querySelector('#status').textContent = products.every(p => p.status === 'not_configured')
      ? 'API key required'
      : `${ok} / ${products.length}`;
    document.querySelector('#updated').textContent = time(data.requestedAt);
  } catch {
    render(descriptors.map(p => ({ ...p, status: 'error', apr: null, error: 'service_error' })));
    document.querySelector('#status').textContent = 'Connection failed';
    document.querySelector('#updated').textContent = time(new Date().toISOString());
  } finally {
    button.disabled = false;
    document.querySelector('#rates').setAttribute('aria-busy', 'false');
  }
}
document.querySelector('#refresh').addEventListener('click', refresh);
refresh();
