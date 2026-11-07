// Each bonus applies only to the portion of the deposit inside its bounds.
export function earnTiers(baseApr, bonuses, asset) {
  if (!Number.isFinite(baseApr) || baseApr < 0 || !Array.isArray(bonuses)) throw new Error('invalid_tiers');
  const ranges = bonuses.map(tier => {
    const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)([A-Z0-9]+)$/.exec(tier.range);
    if (!match || match[3] !== asset || !Number.isFinite(tier.bonusApr) || tier.bonusApr < 0) throw new Error('invalid_tiers');
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('invalid_tiers');
    const apr = baseApr + tier.bonusApr;
    if (!Number.isFinite(apr)) throw new Error('invalid_tiers');
    return { from, to, apr };
  }).sort((a, b) => a.from - b.from);
  const result = [];
  let cursor = 0;
  for (const tier of ranges) {
    if (tier.from < cursor) throw new Error('invalid_tiers');
    if (tier.from > cursor) result.push({ from: cursor, to: tier.from, apr: baseApr });
    result.push(tier);
    cursor = tier.to;
  }
  result.push({ from: cursor, to: Infinity, apr: baseApr });
  return result;
}
export function effectiveApr(tiers, amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  return tiers.reduce((total, tier) => {
    const covered = Math.max(0, Math.min(amount, tier.to) - tier.from);
    return total + (covered / amount) * tier.apr;
  }, 0);
}
export function defaultEarnAmount(tiers) {
  const bound = tiers.reduce((max, tier) => Number.isFinite(tier.to) ? Math.max(max, tier.to) : max, 0);
  const amount = bound * 2;
  return amount > 0 && Number.isFinite(amount) ? amount : null;
}
