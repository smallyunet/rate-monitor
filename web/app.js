const ENDPOINT = 'https://rate-monitor-api.smallyu.workers.dev/api/rates';
const descriptors = [
  { id: 'binance-loan-usdc', platform: 'Binance', kind: 'loan', asset: 'USDC', name: 'Flexible Loan', collateral: 'BTC' },
  { id: 'binance-earn-usdc', platform: 'Binance', kind: 'earn', asset: 'USDC', name: 'Simple Earn · Flexible' },
  { id: 'binance-earn-usdt', platform: 'Binance', kind: 'earn', asset: 'USDT', name: 'Simple Earn · Flexible' },
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
function detail(parent, text) { parent.append(el('div', '', text)); }
function render(products) {
  const rows = document.querySelector('#rows');
  rows.replaceChildren();
  document.querySelector('#config').hidden = !products.some(p => p.status === 'not_configured');
  for (const p of products) {
    const row = el('tr');
    const product = el('td', 'product', p.name);
    if (p.kind === 'loan') product.append(el('div', 'secondary', 'BTC collateral'));
    const apr = el('td');
    apr.append(el('div', 'apr', p.status === 'ok' ? percent(p.apr) : '—'));
    apr.append(el('div', 'secondary', p.kind === 'loan' ? 'Published reference' : 'Base real-time APR'));
    const info = el('td', 'details');
    if (p.status !== 'ok') detail(info, errors[p.error] || 'Fetching…');
    else if (p.kind === 'loan') {
      detail(info, `Current raw rate: ${p.rawRate} (time unit unverified)`);
      detail(info, `APR record: ${time(p.rateTime)}`);
      if (!p.rateTime) detail(info, 'No APR reference in the past hour');
      detail(info, `BTC collateral: ${p.collateralEligible ? 'supported' : 'eligibility not returned'}`);
      if (p.initialLtv != null) detail(info, `Initial LTV: ${percent(p.initialLtv)} · Liquidation LTV: ${percent(p.liquidationLtv)}`);
    } else {
      if (p.tiers?.length) {
        detail(info, 'Additional tier APR (within each eligible range):');
        for (const tier of p.tiers) detail(info, `${tier.range}: +${percent(tier.bonusApr)}`);
      } else detail(info, 'No additional tier bonus');
      detail(info, p.soldOut === true ? 'Sold out' : p.canPurchase === true ? 'Available to subscribe' : p.canPurchase === false ? 'Subscriptions unavailable' : 'Subscription status unknown');
    }
    const status = el('td');
    status.append(el('div', p.status === 'error' ? 'error' : '',
      p.status === 'ok' ? 'Fetched' : p.status === 'error' ? 'Failed' : p.status === 'not_configured' ? 'Not configured' : 'Fetching…'));
    status.append(el('div', 'secondary', p.fetchedAt ? time(p.fetchedAt) : 'No valid data'));
    row.append(el('td', '', p.platform), product, el('td', '', p.asset), apr, info, status);
    rows.append(row);
  }
}
async function refresh() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#rates').setAttribute('aria-busy', 'true');
  document.querySelector('#status').textContent = 'Fetching Binance rates…';
  document.querySelector('#updated').textContent = 'Request in progress';
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
      ? 'Connected · Binance credentials not configured'
      : `${ok} / ${products.length} products fetched${ok < products.length ? ' · Some data unavailable' : ''}`;
    document.querySelector('#updated').textContent = `Requested: ${time(data.requestedAt)}`;
  } catch {
    render(descriptors.map(p => ({ ...p, status: 'error', apr: null, error: 'service_error' })));
    document.querySelector('#status').textContent = 'Connection failed · Try again later';
    document.querySelector('#updated').textContent = `Attempted: ${time(new Date().toISOString())}`;
  } finally {
    button.disabled = false;
    document.querySelector('#rates').setAttribute('aria-busy', 'false');
  }
}
document.querySelector('#refresh').addEventListener('click', refresh);
refresh();
