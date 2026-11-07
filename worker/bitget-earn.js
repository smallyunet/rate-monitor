import { bitgetGet } from './private-positions.js';
const products = ['USDC', 'USDT'].map(asset => ({ id: `bitget-earn-${asset.toLowerCase()}`, platform: 'Bitget', kind: 'earn', asset, name: 'Flexible Earn' }));
function number(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') throw new Error('invalid_data');
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('invalid_data');
  return result;
}
export function normalizeBitgetEarn(data, asset) {
  if (!Array.isArray(data)) throw new Error('invalid_data');
  // Do not substitute fixed-term, beginner or VIP-only promotional yields.
  const eligible = data.filter(r => r.coin === asset && r.periodType === 'flexible' && r.productLevel === 'normal' && ['in_progress', 'sold_out', 'paused'].includes(r.status));
  const active = eligible.filter(r => r.status === 'in_progress');
  const candidates = active.length ? active : eligible;
  if (!candidates.length) throw new Error('unavailable');
  const offers = [];
  const seen = new Map();
  for (const product of candidates) {
    if (typeof product.productId !== 'string' || !product.productId || !Array.isArray(product.apyList) || !product.apyList.length) throw new Error('invalid_data');
    // Despite its field name, currentApy is a percentage annual interest rate:
    // 6.00 = 6% APR. Each band is a total marginal rate, not an additive bonus.
    const rateTiers = product.apyList.map(t => ({ from: number(t.minStepVal), to: number(t.maxStepVal), apr: number(t.currentApy) / 100 })).sort((a,b) => a.from-b.from);
    let cursor = 0;
    for (const tier of rateTiers) {
      if (tier.from !== cursor || tier.to <= tier.from) throw new Error('invalid_data');
      cursor = tier.to;
    }
    const offer = { apr: rateTiers[0].apr, rateTiers, productId: product.productId,
      canPurchase: product.status === 'in_progress', soldOut: product.status === 'sold_out' };
    const existing = seen.get(offer.productId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(offer)) throw new Error('ambiguous_product');
      continue;
    }
    seen.set(offer.productId, offer); offers.push(offer);
  }
  // Choose one complete offer by its highest tier APR; preserve API order on ties.
  const peak = offer => Math.max(...offer.rateTiers.map(tier => tier.apr));
  const selected = offers.reduce((best, offer) => peak(offer) > peak(best) ? offer : best);
  return { ...selected, aprSource: 'realtime', offers };

}
export async function collectBitgetEarn(env, fetcher = fetch) {
  const configured = env.BITGET_API_KEY && env.BITGET_API_SECRET && env.BITGET_API_PASSPHRASE;
  if (!configured) return products.map(p => ({ ...p, status: 'not_configured', apr: null, error: 'missing_credentials' }));
  const result = [];
  for (const product of products) {
    try {
      const data = await bitgetGet(`/api/v3/earn/savings/product?coin=${product.asset}&filter=available`, env, fetcher);
      result.push({ ...product, ...normalizeBitgetEarn(data, product.asset), status: 'ok', fetchedAt: new Date().toISOString() });
    } catch (error) {
      const safe = ['invalid_data','unavailable','ambiguous_product','network_error','upstream_error','upstream_forbidden','rate_limited'];
      result.push({ ...product, status: 'error', apr: null, error: safe.includes(error.message) ? error.message : 'upstream_error',
        ...(Number.isInteger(error.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
        ...(typeof error.upstreamCode === 'string' && /^\d{1,8}$/.test(error.upstreamCode) ? { upstreamCode: Number(error.upstreamCode) } : {}) });
    }
  }
  return result;
}
