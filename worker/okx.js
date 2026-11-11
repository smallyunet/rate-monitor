// Anonymous, fixed OKX market endpoints. Never receive exchange credentials.
export const OKX_PRODUCTS = ['loan', 'earn'].flatMap(kind => ['USDC', 'USDT'].map(asset => ({
  id: `okx-${kind}-${asset.toLowerCase()}`, platform: 'OKX', kind, asset,
  name: kind === 'loan' ? 'Flexible Loan' : 'Flexible Earn', ...(kind === 'loan' ? { collateral: 'BTC' } : {}),
})));
const decimal = value => {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') throw new Error('invalid_data');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('invalid_data');
  return n;
};
function exact(rows, key, asset) {
  if (!Array.isArray(rows)) throw new Error('invalid_data');
  const matches = rows.filter(r => r?.[key] === asset);
  if (!matches.length) throw new Error('unavailable');
  if (matches.length !== 1) throw new Error('ambiguous_product');
  return matches[0];
}
export function normalizeOKXLoan(data, asset) {
  const row = exact(data?.loanableCoinList, 'symbol', asset);
  if (!Array.isArray(data?.collateralList)) throw new Error('invalid_data');
  // The loan website renders lastHourRate as an annual decimal, despite its name.
  return { apr: decimal(row.lastHourRate), aprSource: 'last_hour',
    rateNote: 'Last hour APR', collateralEligible: data.collateralList.some(r => r?.symbol === 'BTC'),
    initialLtv: null, liquidationLtv: null };
}
export function normalizeOKXEarn(data, asset, now = Date.now()) {
  const row = exact(data, 'ccy', asset);
  // Use lendingRate, never borrowing rate, 24h averages or next-hour estimates.
  const timestamp = decimal(row.ts);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now + 60000) throw new Error('invalid_data');
  if (now - timestamp > 2 * 3600000) throw new Error('stale_data');
  return { apr: decimal(row.lendingRate), aprSource: 'last_settled_hour', tiers: [],
    rateAt: new Date(timestamp).toISOString(), serviceFeeRate: .15,
    rateNote: 'Last hour · before fees · no bonuses' };
}
const currencyIds = { USDT: 7, USDC: 283 };
export function normalizeOKXBonus(data, asset) {
  if (!Array.isArray(data)) throw new Error('invalid_data');
  if (!data.length) return null;
  const row = exact(data, 'currencySymbol', asset);
  if (row.currencyId !== currencyIds[asset]) throw new Error('invalid_data');
  const limit = decimal(row.bonusLimit), days = decimal(row.boostDay);
  const match = /^(\d+(?:\.\d+)?)%$/.exec(row.bonusRate);
  if (!match || limit <= 0 || !Number.isSafeInteger(days) || days <= 0) throw new Error('invalid_data');
  // This is the advertised total bonus tier, not an addition to lendingRate.
  return { limit, apr: decimal(match[1]) / 100, days, eligibility: 'unknown' };
}
async function get(path, fetcher) {
  let response;
  try { response = await fetcher('https://www.okx.com' + path, {
    credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(12000),
  }); } catch { throw new Error('network_error'); }
  const fail = kind => Object.assign(new Error(kind), { upstreamStatus: response.status });
  if (response.status === 451) throw fail('region_restricted');
  if ([418, 429].includes(response.status)) throw fail('rate_limited');
  let body;
  try { body = await response.json(); } catch { throw fail('upstream_error'); }
  if (!response.ok || ![0, '0'].includes(body?.code)) throw fail('upstream_error');
  return body.data;
}
export async function collectOKX(fetcher = fetch) {
  // Share the two loan quotes; isolate each Earn currency and product failure.
  const loan = get('/priapi/v1/multi-collateral/loans/outer/loan-data', fetcher);
  const safe = new Set(['invalid_data', 'unavailable', 'ambiguous_product', 'stale_data', 'network_error', 'region_restricted', 'rate_limited']);
  return Promise.all(OKX_PRODUCTS.map(async product => {
    try {
      const value = product.kind === 'loan' ? normalizeOKXLoan(await loan, product.asset)
        : normalizeOKXEarn(await get(`/api/v5/finance/savings/lending-rate-history?ccy=${product.asset}&limit=1`, fetcher), product.asset);
      if (product.kind === 'earn') {
        try {
          value.bonus = normalizeOKXBonus(await get(`/priapi/v2/financial/earn/compensation-config?currencyId=${currencyIds[product.asset]}`, fetcher), product.asset);
          value.bonusStatus = value.bonus ? 'ok' : 'unavailable';
          if (value.bonus) value.rateNote = 'Bonus eligibility required · market APR before fees';
        } catch (error) {
          // A failed reward lookup must not hide a valid market quote or imply no reward.
          value.bonusStatus = 'error';
          value.bonusError = safe.has(error.message) ? error.message : 'upstream_error';
        }
      }
      return { ...product, ...value, status: 'ok', fetchedAt: new Date().toISOString() };
    } catch (error) {
      return { ...product, status: 'error', apr: null, error: safe.has(error.message) ? error.message : 'upstream_error',
        ...(Number.isInteger(error.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}) };
    }
  }));
}
