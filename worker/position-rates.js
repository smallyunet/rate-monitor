import { earnTiers } from '../web/earn-apr.js';
const rate = value => ['string','number'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function weightedApr(tiers, amount) {
  if (!Number.isFinite(amount) || amount <= 0 || !Array.isArray(tiers) || !tiers.length) return null;
  let covered = 0, annual = 0;
  for (const tier of tiers) {
    if (tier.from !== covered || !(tier.to > tier.from) || !Number.isFinite(tier.apr) || tier.apr < 0) return null;
    const portion = Math.max(0, Math.min(amount, tier.to) - tier.from);
    annual += portion * tier.apr;
    covered = tier.to;
    if (covered >= amount) return Number.isFinite(annual) ? annual / amount : null;
  }
  return null;
}
export function binancePositionRate(row, locked = false) {
  if (locked) return { positionRate: rate(row.APY), positionRateLabel: 'APY' };
  const base = rate(row.latestAnnualPercentageRate);
  let apr = null;
  try {
    if (base !== null && row.tierAnnualPercentageRate && typeof row.tierAnnualPercentageRate === 'object' && !Array.isArray(row.tierAnnualPercentageRate)) {
      const tiers = earnTiers(base, Object.entries(row.tierAnnualPercentageRate).map(([range, value]) => ({range, bonusApr: rate(value)})), row.asset);
      const free = rate(row.totalAmount), collateral = rate(row.collateralAmount);
      if (free !== null && collateral !== null && free + collateral > 0) {
        const freeApr = free === 0 ? base : weightedApr(tiers, free);
        if (freeApr !== null) apr = (free * freeApr + collateral * base) / (free + collateral);
      }
    }
  } catch {}
  return { positionRate: apr, positionRateLabel: 'APR' };
}
export function bitgetPositionRate(row) {
  let apr = null;
  if (Array.isArray(row.apy)) {
    const tiers = row.apy.map(t => ({from:rate(t.minApy),to:rate(t.maxApy),apr:rate(t.currentApy)}));
    if (tiers.every(t=>t.from !== null && t.to !== null && t.apr !== null)) {
      tiers.sort((a,b)=>a.from-b.from);
      apr = weightedApr(tiers.map(t=>({...t,apr:t.apr / 100})), rate(row.holdAmount));
    }
  }
  return { positionRate: apr, positionRateLabel: 'APR' };
}
export function bitgetLoanApr(row) {
  const hourlyPercent = rate(row.hourInterestRate);
  const annual = hourlyPercent === null ? null : hourlyPercent * 24 * 365 / 100;
  return Number.isFinite(annual) ? annual : null;
}
