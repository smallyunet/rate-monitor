function sumDecimal(values) {
  if (values.some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v) || v.length > 256)) throw new Error('invalid_balance');
  const scale = Math.max(0, ...values.map(v => (v.split('.')[1] || '').length));
  const total = values.reduce((sum, value) => { const [whole, fraction = ''] = value.split('.'); return sum + BigInt(whole + fraction.padEnd(scale, '0')); }, 0n);
  if (!scale) return total.toString();
  const digits = total.toString().padStart(scale + 1, '0');
  return (digits.slice(0, -scale) + '.' + digits.slice(-scale)).replace(/\.?0+$/, '') || '0';
}
export function accountEarnAmounts(sections) {
  const result = new Map();
  const section = sections.find(s => s.platform === 'Binance' && s.product === 'Flexible Earn');
  // Only a complete successful snapshot can establish an actual balance, including zero.
  if (section?.status !== 'ok' || !Array.isArray(section.rows)) return result;
  for (const asset of ['USDC', 'USDT']) {
    try { result.set('binance-earn-' + asset.toLowerCase(), sumDecimal(section.rows.filter(r => r.asset === asset).map(r => r.amount))); }
    catch { /* Retain the tier default if this asset cannot be calculated. */ }
  }
  return result;
}
export function selectEarnAmount(id, manual, account, tierDefault) {
  if (manual.has(id)) return { value: manual.get(id), source: 'Custom amount' };
  if (account.has(id)) return { value: account.get(id), source: 'Your balance' };
  return { value: tierDefault === null ? '' : String(tierDefault), source: 'Tier default' };
}
