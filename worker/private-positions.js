import { verifyPositionsIdentity } from './access-auth.js';
import { page, style, script } from './positions-page.js';

export function decimal(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('invalid_data');
  return value;
}
function coin(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(value)) throw new Error('invalid_data');
  return value.toUpperCase();
}
const optionalDecimal = value => value == null ? null : decimal(value);
export function binanceLoans(rows) {
  return rows.map(r => ({ collateral: coin(r.collateralCoin), collateralAmount: decimal(r.collateralAmount),
    asset: coin(r.loanCoin), debt: decimal(r.totalDebt), loan: null, interest: null, ltv: optionalDecimal(r.currentLTV) }));
}
export function binanceEarn(rows, locked = false) {
  return rows.map(r => ({ asset: coin(r.asset), amount: decimal(locked ? r.amount : r.totalAmount),
    collateralAmount: locked ? null : optionalDecimal(r.collateralAmount), product: locked ? 'Locked Earn' : 'Flexible Earn' }));
}
export function bitgetLoans(rows) {
  if (!Array.isArray(rows)) throw new Error('invalid_data');
  return rows.map(r => ({ collateral: coin(r.pledgeCoin), collateralAmount: decimal(r.pledgeAmount),
    asset: coin(r.loanCoin), loan: decimal(r.loanAmount), interest: decimal(r.interestAmount), debt: null, ltv: null }));
}
export async function paginatedBinance(get, path, sizeName = 'size') {
  const all = [];
  let total;
  const seenPages = new Set();
  for (let current = 1; current <= 20; current++) {
    const data = await get(path, { current: String(current), [sizeName]: '100' });
    if (!Array.isArray(data?.rows) || data.rows.length > 100 ||
        !((typeof data.total === 'string' && /^\d+$/.test(data.total)) || typeof data.total === 'number') ||
        !Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0) throw new Error('invalid_data');
    const fingerprint = JSON.stringify(data.rows);
    if (seenPages.has(fingerprint)) return { rows: all, partial: true };
    seenPages.add(fingerprint);
    if (total === undefined) total = Number(data.total);
    if (Number(data.total) !== total) return { rows: all, partial: true };
    all.push(...data.rows);
    if (all.length >= total) return { rows: all, partial: all.length !== total };
    if (!data.rows.length) return { rows: all, partial: true };
  }
  return { rows: all, partial: true };
}
export async function bitgetGet(path, env, fetcher = fetch) {
  const timestamp = String(Date.now());
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.BITGET_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + 'GET' + path)));
  let response;
  let base = 'https://api.bitget.com';
  if (env.BITGET_RELAY_URL) {
    const relay = new URL(env.BITGET_RELAY_URL);
    if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash) throw new Error('invalid_data');
    base = relay.href.replace(/\/$/, '');
  }
  try {
    response = await fetcher(base + path, { headers: {
      ...(env.BITGET_RELAY_URL ? { 'Cf-Access-Jwt-Assertion': env.positionsJwt } : {}),
      'ACCESS-KEY': env.BITGET_API_KEY, 'ACCESS-SIGN': btoa(String.fromCharCode(...bytes)),
      'ACCESS-TIMESTAMP': timestamp, 'ACCESS-PASSPHRASE': env.BITGET_API_PASSPHRASE, locale: 'en-US',
    }, signal: AbortSignal.timeout(12000), redirect: 'manual' });
  } catch { throw new Error('network_error'); }
  if (response.status === 403) throw new Error('upstream_forbidden');
  if (response.status === 429) throw new Error('rate_limited');
  let payload;
  try { payload = await response.json(); } catch { throw new Error('upstream_error'); }
  if (!response.ok || payload?.code !== '00000') throw Object.assign(new Error('upstream_error'), {
    upstreamStatus: response.status, upstreamCode: typeof payload?.code === 'string' && /^\d{1,8}$/.test(payload.code) ? payload.code : undefined,
  });
  return payload.data;
}
export async function bitgetSavings(env, fetcher) {
  const summary = await bitgetGet('/api/v3/earn/savings/account', env, fetcher);
  const estimatedValue = decimal(summary?.usdtAmount);
  const rows = [];
  for (const periodType of ['flexible', 'fixed']) {
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ periodType, limit: '100', ...(cursor ? { cursor } : {}) });
      const data = await bitgetGet('/api/v3/earn/savings/assets?' + params, env, fetcher);
      if (!Array.isArray(data?.resultList)) throw new Error('invalid_data');
      for (const r of data.resultList) {
        if (r.status !== 'in_holding') continue;
        rows.push({ asset: coin(r.productCoin), amount: decimal(r.holdAmount), product: periodType === 'flexible' ? 'Flexible Savings' : 'Fixed Savings', collateralAmount: null });
      }
      if (data.resultList.length < 100 || !data.endId) break;
      if (typeof data.endId !== 'string' || !/^\d{1,40}$/.test(data.endId) || seen.has(data.endId)) break;
      seen.add(data.endId); cursor = data.endId;
    }
  }
  // This API filters by subscription creation time, not balance date. Older holdings
  // may be absent; the account-level estimate above is not a per-coin balance.
  return { rows, partial: true, estimatedValue, coverage: 'Subscriptions created in the past 3 months' };
}
const safeErrors = new Set(['invalid_data','network_error','upstream_error','upstream_forbidden','credentials_error','rate_limited','clock_error','region_restricted']);
export async function collectPositions(env, fetcher, binanceGet) {
  const tasks = [
    ['Binance', 'Flexible Loan', !!(env.BINANCE_API_KEY && env.BINANCE_API_SECRET), async () => {
      const result = await paginatedBinance(binanceGet, '/sapi/v2/loan/flexible/ongoing/orders', 'limit');
      return { ...result, rows: binanceLoans(result.rows) };
    }],
    ['Binance', 'Flexible Earn', !!(env.BINANCE_API_KEY && env.BINANCE_API_SECRET), async () => {
      const result = await paginatedBinance(binanceGet, '/sapi/v1/simple-earn/flexible/position');
      return { ...result, rows: binanceEarn(result.rows) };
    }],
    ['Binance', 'Locked Earn', !!(env.BINANCE_API_KEY && env.BINANCE_API_SECRET), async () => {
      const result = await paginatedBinance(binanceGet, '/sapi/v1/simple-earn/locked/position');
      return { ...result, rows: binanceEarn(result.rows, true) };
    }],
    ['Bitget', 'Flexible Loan', !!(env.BITGET_API_KEY && env.BITGET_API_SECRET && env.BITGET_API_PASSPHRASE), async () => ({
      rows: bitgetLoans(await bitgetGet('/api/v3/loan/borrow-ongoing', env, fetcher)),
    })],
    ['Bitget', 'Savings', !!(env.BITGET_API_KEY && env.BITGET_API_SECRET && env.BITGET_API_PASSPHRASE), async () => bitgetSavings(env, fetcher)],
  ];
  // Binance USER_DATA endpoints have strict per-account limits; serialize within a request.
  const sections = [];
  for (const [platform, product, configured, read] of tasks) {
    if (!configured) { sections.push({ platform, product, status: 'not_configured', rows: [] }); continue; }
    try {
      const result = await read();
      sections.push({ platform, product, status: result.partial ? 'partial' : 'ok', rows: result.rows,
        ...(result.estimatedValue !== undefined ? { estimatedValue: result.estimatedValue } : {}),
        ...(result.coverage ? { coverage: result.coverage } : {}), fetchedAt: new Date().toISOString() });
    } catch (error) {
      sections.push({ platform, product, status: 'error', error: safeErrors.has(error.message) ? error.message : 'upstream_error',
        ...(Number.isInteger(error.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
        ...(typeof error.upstreamCode === 'string' && /^\d{1,8}$/.test(error.upstreamCode) ? { upstreamCode: error.upstreamCode } : {}), rows: [] });
    }
  }
  return { requestedAt: new Date().toISOString(), sections };
}
export async function handlePrivate(request, env, fetcher, binanceGet) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
  try { await verifyPositionsIdentity(request, env, fetcher); }
  catch (error) { return json({ error: ['access_not_configured','access_unavailable'].includes(error.message) ? error.message : 'unauthorized' }, error.message === 'unauthorized' ? 401 : 503); }
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const path = new URL(request.url).pathname;
  if (path === '/private' || path === '/private/*') return new Response(null, { status: 302, headers: { ...headers, Location: '/private/' } });
  if (path === '/private/api/positions') return json(await collectPositions({ ...env, positionsJwt: request.headers.get('Cf-Access-Jwt-Assertion') }, fetcher, binanceGet));
  const resources = { '/private/': [page, 'text/html'], '/private/app.js': [script, 'text/javascript'], '/private/style.css': [style, 'text/css'] };
  if (!resources[path]) return json({ error: 'not_found' }, 404);
  const [body, type] = resources[path];
  return new Response(body, { headers: { ...headers, 'Content-Type': type + '; charset=utf-8' } });
}
