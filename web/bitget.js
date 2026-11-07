// Public CORS-enabled market data fallback when the Worker egress is rejected.
// This module never accepts or sends credentials.
function rate(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') throw new Error('invalid_data');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('invalid_data');
  return number;
}
export async function publicBitgetRates(fetcher = fetch) {
  const products = ['USDC', 'USDT'].map(asset => ({ id: `bitget-loan-${asset.toLowerCase()}`, platform: 'Bitget',
    kind: 'loan', asset, collateral: 'BTC', name: 'Flexible Loan' }));
  const failure = (product, error) => ({ ...product, status: 'error', apr: null, error: error.message,
    ...(Number.isInteger(error.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}) });
  try {
    let response;
    try {
      response = await fetcher('https://api.bitget.com/api/v3/loan/coins', {
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000),
      });
    } catch { throw new Error('network_error'); }
    const fail = kind => Object.assign(new Error(kind), { upstreamStatus: response.status });
    if (response.status === 451) throw fail('region_restricted');
    if ([418, 429].includes(response.status)) throw fail('rate_limited');
    let payload;
    try { payload = await response.json(); } catch { throw fail('upstream_error'); }
    if (!response.ok || payload?.code !== '00000') throw fail('upstream_error');
    const data = payload.data;
    if (!Array.isArray(data?.loanInfos) || !Array.isArray(data?.pledgeInfos)) throw new Error('invalid_data');
    const btc = data.pledgeInfos.find(row => row?.coin === 'BTC');
    const fetchedAt = new Date().toISOString();
    return products.map(product => {
      try {
        const matches = data.loanInfos.filter(row => row?.coin === product.asset);
        if (!matches.length) throw new Error('unavailable');
        if (matches.length !== 1) throw new Error('ambiguous_product');
        return { ...product, apr: rate(matches[0].rateFlexible), aprSource: 'realtime', status: 'ok', fetchedAt,
          collateralEligible: !!btc, initialLtv: btc ? rate(btc.initRate) : null,
          liquidationLtv: btc ? rate(btc.forceRate) : null };
      } catch (error) { return failure(product, error); }
    });
  } catch (error) { return products.map(product => failure(product, error)); }
}
