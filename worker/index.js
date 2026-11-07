import { collectOKX } from './okx.js';
import { collectBitgetEarn } from './bitget-earn.js';
import { servePublicSite } from './public-site.js';
import { handlePrivate } from './private-positions.js';
// Bundle with npm run build:worker before using the dashboard editor.
const PRODUCTS = [
  { id: 'binance-loan-usdc', platform: 'Binance', kind: 'loan', asset: 'USDC', collateral: 'BTC', name: 'Flexible Loan' },
  { id: 'binance-loan-usdt', platform: 'Binance', kind: 'loan', asset: 'USDT', collateral: 'BTC', name: 'Flexible Loan' },
  { id: 'binance-earn-usdc', platform: 'Binance', kind: 'earn', asset: 'USDC', name: 'Simple Earn · Flexible' },
  { id: 'binance-earn-usdt', platform: 'Binance', kind: 'earn', asset: 'USDT', name: 'Simple Earn · Flexible' },
];
// Official Binance GCP endpoint; the main host rejects this Worker's public probes with HTTP 403.
const API = 'https://api-gcp.binance.com';
const BITGET_PRODUCTS = [
  { id: 'bitget-loan-usdc', platform: 'Bitget', kind: 'loan', asset: 'USDC', collateral: 'BTC', name: 'Flexible Loan' },
  { id: 'bitget-loan-usdt', platform: 'Bitget', kind: 'loan', asset: 'USDT', collateral: 'BTC', name: 'Flexible Loan' },
];
export function rate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('invalid_data');
  if (String(value).trim() === '') throw new Error('invalid_data');
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('invalid_data');
  return result;
}
export async function signature(query, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(query));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function rows(data) {
  if (!Array.isArray(data?.rows)) throw new Error('invalid_data');
  return data.rows;
}
export function normalizeEarn(data, asset) {
  const products = rows(data).filter(row => row.asset === asset);
  if (!products.length) throw new Error('unavailable');
  if (products.length !== 1) throw new Error('ambiguous_product');
  const row = products[0];
  const tiers = Object.entries(row.tierAnnualPercentageRate || {}).map(([range, apr]) => ({ range, bonusApr: rate(apr) }));
  return { apr: rate(row.latestAnnualPercentageRate), aprSource: 'realtime', tiers, productId: row.productId,
    canPurchase: typeof row.canPurchase === 'boolean' ? row.canPurchase : null,
    soldOut: typeof row.isSoldOut === 'boolean' ? row.isSoldOut : null };
}
export function normalizeLoan(quote, collateral, asset = 'USDC') {
  const current = rows(quote).find(row => row.loanCoin === asset);
  if (!current) throw new Error('unavailable');
  // Verified against Binance's Flexible Loan market page (2026-11-07):
  // a quote near 0.05368 corresponds to the displayed annual rate near 5.368%.
  // The live field is already an annual decimal, not an hourly rate.
  const apr = rate(current.flexibleInterestRate);
  const btc = rows(collateral).find(row => row.collateralCoin === 'BTC');
  return {
    apr, aprSource: 'realtime', collateralEligible: !!btc,
    initialLtv: btc ? rate(btc.initialLTV) : null,
    liquidationLtv: btc ? rate(btc.liquidationLTV) : null,
  };
}
async function signedGet(path, params, env, fetcher) {
  const query = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  let response;
  try {
    response = await fetcher(`${API}${path}?${query}&signature=${await signature(query, env.BINANCE_API_SECRET)}`, {
      redirect: 'manual', headers: { 'X-MBX-APIKEY': env.BINANCE_API_KEY }, signal: AbortSignal.timeout(12000),
    });
  } catch { throw new Error('network_error'); }
  const failure = (kind, code) => {
    return Object.assign(new Error(kind), { upstreamStatus: response.status,
      upstreamCode: typeof code === 'number' && Number.isFinite(code) ? code : undefined });
  };
  // Region/rate-limit responses may be HTML rather than JSON.
  if (response.status === 451) throw failure('region_restricted');
  if ([418, 429].includes(response.status)) throw failure('rate_limited');
  let data;
  try { data = await response.json(); } catch { throw failure('upstream_error'); }
  if (!response.ok || (typeof data.code === 'number' && data.code < 0)) {
    // Never return upstream messages, signed URLs, credentials or account data.
    if (data.code === -1021) throw failure('clock_error', data.code);
    if ([-2014, -2015, -1022].includes(data.code)) throw failure('credentials_error', data.code);
    throw failure('upstream_error', data.code);
  }
  return data;
}
const SAFE_ERRORS = new Set(['invalid_data','unavailable','ambiguous_product','network_error','upstream_error','region_restricted','rate_limited','clock_error','credentials_error']);
function productFailure(product, error) {
  return { ...product, status: 'error', apr: null, error: SAFE_ERRORS.has(error.message) ? error.message : 'upstream_error',
    ...(Number.isInteger(error.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
    ...(Number.isFinite(error.upstreamCode) ? { upstreamCode: error.upstreamCode } : {}),
  };
}
export function normalizeBitgetLoan(data, asset) {
  if (!Array.isArray(data?.loanInfos) || !Array.isArray(data?.pledgeInfos)) throw new Error('invalid_data');
  const loans = data.loanInfos.filter(row => row?.coin === asset);
  if (!loans.length) throw new Error('unavailable');
  if (loans.length !== 1) throw new Error('ambiguous_product');
  const btc = data.pledgeInfos.find(row => row?.coin === 'BTC');
  // rateFlexible is an annual decimal (e.g. 0.062 = 6.20%). Never use fixed-term rates.
  return { apr: rate(loans[0].rateFlexible), aprSource: 'realtime', collateralEligible: !!btc,
    initialLtv: btc ? rate(btc.initRate) : null, liquidationLtv: btc ? rate(btc.forceRate) : null };
}
export async function collectBitget(fetcher = fetch) {
  try {
    let response;
    try {
      // Public market data only: no account credentials, signatures or user input.
      response = await fetcher('https://api.bitget.com/api/v3/loan/coins', { signal: AbortSignal.timeout(12000) });
    } catch { throw new Error('network_error'); }
    const failure = (kind, code) => Object.assign(new Error(kind), { upstreamStatus: response.status,
      upstreamCode: typeof code === 'string' && /^\d{1,8}$/.test(code) ? Number(code) : undefined });
    if (response.status === 451) throw failure('region_restricted');
    if ([418, 429].includes(response.status)) throw failure('rate_limited');
    let payload;
    try { payload = await response.json(); } catch { throw failure('upstream_error'); }
    if (!response.ok || payload?.code !== '00000') throw failure('upstream_error', payload?.code);
    const fetchedAt = new Date().toISOString();
    return BITGET_PRODUCTS.map(product => {
      try { return { ...product, ...normalizeBitgetLoan(payload.data, product.asset), status: 'ok', fetchedAt }; }
      catch (error) { return productFailure(product, error); }
    });
  } catch (error) { return BITGET_PRODUCTS.map(product => productFailure(product, error)); }
}
export async function collectBinance(env, fetcher = fetch) {
  if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET) return PRODUCTS.map(p => ({ ...p, status: 'not_configured', apr: null, error: 'missing_credentials' }));
  // Serialize signed calls within a refresh, including the two Earn queries.
  let tail = Promise.resolve();
  let lastStart = 0;
  const get = (path, params) => {
    const job = tail.then(async () => {
      const wait = 1100 - (Date.now() - lastStart);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastStart = Date.now();
      return signedGet(path, params, env, fetcher);
    });
    tail = job.catch(() => {});
    return job;
  };
  let collateralRequest;
  const getCollateral = () => collateralRequest ??= get('/sapi/v2/loan/flexible/collateral/data', { collateralCoin: 'BTC' });
  const tasks = PRODUCTS.map(async product => {
    try {
      let value;
      if (product.kind === 'earn') value = normalizeEarn(await get('/sapi/v1/simple-earn/flexible/list', { asset: product.asset, size: '100' }), product.asset);
      else {
        const quote = await get('/sapi/v2/loan/flexible/loanable/data', { loanCoin: product.asset });
        value = normalizeLoan(quote, await getCollateral(), product.asset);
      }
      return { ...product, ...value, status: 'ok', fetchedAt: new Date().toISOString() };
    } catch (error) {
      return productFailure(product, error);
    }
  });
  return Promise.all(tasks);
}
export async function handle(request, env, fetcher = fetch) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/private' || pathname.startsWith('/private/')) {
    return handlePrivate(request, env, fetcher, (path, params) => signedGet(path, params, env, fetcher));
  }
  const site = servePublicSite(request);
  if (site) return site;
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN || 'https://smallyunet.github.io';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
  if (origin === allowed) headers['Access-Control-Allow-Origin'] = origin;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== allowed) return json({ error: 'origin_not_allowed' }, 403);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  }
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const path = new URL(request.url).pathname;
  if (path === '/health' && new URL(request.url).searchParams.get('check') === 'binance') {
    // Fixed, unsigned public probes: never transmit API credentials for diagnostics.
    const connectivity = await Promise.all(['https://api.binance.com', API].map(async base => {
      try {
        const response = await fetcher(`${base}/api/v3/time`, { signal: AbortSignal.timeout(10000) });
        await response.body?.cancel();
        return { host: new URL(base).hostname, status: response.status };
      } catch { return { host: new URL(base).hostname, error: 'network_error' }; }
    }));
    return json({ connectivity });
  }
  if (path === '/health') return json({ service: 'rate-monitor', version: 1, configured: !!(env.BINANCE_API_KEY && env.BINANCE_API_SECRET) });
  if (path !== '/api/rates') return json({ error: 'not_found' }, 404);
  const products = (await Promise.all([collectBinance(env, fetcher), collectBitget(fetcher), collectBitgetEarn(env, fetcher), collectOKX(fetcher)])).flat();
  return json({ requestedAt: new Date().toISOString(), mode: 'on-demand', products });
}
// Cloudflare passes ExecutionContext as argument three, not a fetch implementation.
// Keep the injectable fetcher on handle() for tests, outside the runtime entry point.
export default { fetch(request, env) { return handle(request, env); } };
