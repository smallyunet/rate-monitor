// Fixed read-only endpoint; exchange credentials never reach public handlers.
const balancePath = '/api/v5/finance/savings/balance';
export async function okxSavingsGet(env, fetcher = fetch) {
  const timestamp = new Date().toISOString();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.OKX_API_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + 'GET' + balancePath)));
  let response;
  try {
    response = await fetcher('https://www.okx.com' + balancePath, {
      method: 'GET', credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { 'OK-ACCESS-KEY': env.OKX_API_KEY, 'OK-ACCESS-SIGN': btoa(String.fromCharCode(...signature)),
        'OK-ACCESS-TIMESTAMP': timestamp, 'OK-ACCESS-PASSPHRASE': env.OKX_API_PASSPHRASE },
    });
  } catch { throw new Error('network_error'); }
  const fail = (kind, code) => Object.assign(new Error(kind), { upstreamStatus: response.status,
    upstreamCode: typeof code === 'string' && /^\d{1,8}$/.test(code) ? code : undefined });
  if (response.status === 451) throw fail('region_restricted');
  if (response.status === 429) throw fail('rate_limited');
  let payload;
  try { payload = await response.json(); } catch { throw fail('upstream_error'); }
  if (!response.ok || payload?.code !== '0') {
    if (['50102', '50112'].includes(payload?.code)) throw fail('clock_error', payload.code);
    if (['50101', '50103', '50104', '50105', '50106', '50107', '50108', '50109', '50110', '50111', '50113', '50114', '50119', '50120'].includes(payload?.code)) throw fail('credentials_error', payload.code);
    throw fail(response.status === 403 ? 'upstream_forbidden' : 'upstream_error', payload?.code);
  }
  return payload.data;
}
export function normalizeOKXPositions(data) {
  if (!Array.isArray(data)) throw new Error('invalid_data');
  const seen = new Set();
  const decimal = value => {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('invalid_data');
    return value;
  };
  const optional = value => {
    try { return decimal(value); } catch { return null; }
  };
  return data.map(row => {
    if (typeof row?.ccy !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(row.ccy)) throw new Error('invalid_data');
    const asset = row.ccy.toUpperCase();
    if (seen.has(asset)) throw new Error('invalid_data');
    seen.add(asset);
    return { asset, amount: decimal(row.amt), product: 'Flexible Earn', collateralAmount: null,
      lendingAmount: optional(row.loanAmt), pendingAmount: optional(row.pendingAmt),
      interestAsset: asset, totalProfit: optional(row.earnings),
      // rate is the user's minimum lending rate, not earned APR or bonus eligibility.
      positionRate: null, positionRateLabel: 'APR' };
  });
}
