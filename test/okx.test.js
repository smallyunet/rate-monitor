import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOKX, normalizeOKXLoan, normalizeOKXEarn, normalizeOKXBonus } from '../worker/okx.js';
import { productEarnTiers } from '../web/earn-apr.js';
const now = Date.now();
const loan = () => ({ collateralList: [{ symbol: 'BTC' }], loanableCoinList: [
  { symbol: 'USDC', lastHourRate: '.045' }, { symbol: 'USDT', lastHourRate: '.04' },
] });
const earn = (asset = 'USDC') => [{ ccy: asset, lendingRate: '.035', rate: '.04', ts: String(now - 3600000) }];
const bonus = (asset = 'USDC') => [{ currencySymbol: asset, currencyId: asset === 'USDC' ? 283 : 7,
  bonusLimit: 500, bonusRate: '10.00%', boostDay: 180, finalBonusRate: '0.00%' }];
test('OKX reward tiers use total APR and preserve currency, duration and unknown eligibility', () => {
  for (const asset of ['USDC', 'USDT']) {
    const reward = normalizeOKXBonus(bonus(asset), asset);
    assert.deepEqual(reward, { limit: 500, apr: .1, days: 180, eligibility: 'unknown' });
    const product = JSON.parse(JSON.stringify({ platform: 'OKX', ...normalizeOKXEarn(earn(asset), asset, now), bonus: reward, bonusStatus: 'ok' }));
    assert.deepEqual(productEarnTiers(product), [{ from: 0, to: 500, apr: .1 }, { from: 500, to: Infinity, apr: .035 }]);
  }
  assert.equal(normalizeOKXBonus([], 'USDC'), null);
  assert.throws(() => normalizeOKXBonus(bonus('USDT'), 'USDC'), /unavailable/);
  assert.throws(() => normalizeOKXBonus([...bonus(), ...bonus()], 'USDC'), /ambiguous_product/);
  for (const changes of [{bonusLimit: 0}, {bonusLimit: null}, {bonusRate: 'bad'}, {boostDay: 0}, {currencyId: 7}]) {
    assert.throws(() => normalizeOKXBonus([{...bonus()[0], ...changes}], 'USDC'), /invalid_data/);
  }
});
test('OKX fetches both fixed reward configurations and isolates reward failures', async () => {
  const urls = [];
  const result = await collectOKX(async url => {
    urls.push(url);
    if (url.includes('outer/loan-data')) return Response.json({code: 0, data: loan()});
    if (url.includes('lending-rate-history')) return Response.json({code: 0, data: earn(new URL(url).searchParams.get('ccy'))});
    if (url.endsWith('currencyId=283')) return Response.json({code: 0, data: bonus()});
    return new Response('private upstream detail', {status: 429});
  });
  assert.equal(urls.length, 5);
  assert.ok(urls.some(url => url.endsWith('currencyId=7')));
  assert.equal(result[2].bonus.apr, .1);
  assert.equal(result[3].status, 'ok');
  assert.equal(result[3].bonusStatus, 'error');
  assert.equal(result[3].bonusError, 'rate_limited');
  assert.deepEqual(productEarnTiers(result[3]), [{from: 0, to: Infinity, apr: .035}]);
  assert.ok(!JSON.stringify(result).includes('private upstream'));
});
test('OKX loan uses exact flexible product annual decimals and checks BTC, without inventing LTV', () => {
  const result = normalizeOKXLoan(loan(), 'USDC');
  assert.equal(result.apr, .045); assert.equal(result.collateralEligible, true); assert.equal(result.initialLtv, null);
  const data = loan(); data.collateralList = []; assert.equal(normalizeOKXLoan(data, 'USDT').collateralEligible, false);
  delete data.loanableCoinList[0].lastHourRate; assert.throws(() => normalizeOKXLoan(data, 'USDC'), /invalid_data/);
  data.loanableCoinList[0].lastHourRate = '0'; assert.equal(normalizeOKXLoan(data, 'USDC').apr, 0);
  data.loanableCoinList.push(data.loanableCoinList[0]); assert.throws(() => normalizeOKXLoan(data, 'USDC'), /ambiguous_product/);
  assert.throws(() => normalizeOKXLoan(loan(), 'ETH'), /unavailable/);
});
test('OKX Earn keeps settled lending APR distinct from borrowing and estimates, and marks the fee', () => {
  const result = normalizeOKXEarn(earn(), 'USDC', now);
  assert.equal(result.apr, .035); assert.equal(result.serviceFeeRate, .15);
  assert.equal(result.rateAt, new Date(now - 3600000).toISOString());
  assert.deepEqual(productEarnTiers(result), [{from:0,to:Infinity,apr:.035}]);
  assert.throws(() => normalizeOKXEarn(earn(), 'USDT', now), /unavailable/);
  for (const value of ['', null, '-1', 'abc']) { const data = earn(); data[0].lendingRate = value; assert.throws(() => normalizeOKXEarn(data, 'USDC', now), /invalid_data/); }
  const missing = earn(); delete missing[0].lendingRate; assert.throws(() => normalizeOKXEarn(missing, 'USDC', now), /invalid_data/);
  const zero = earn(); zero[0].lendingRate = '0'; assert.equal(normalizeOKXEarn(zero, 'USDC', now).apr, 0);
  const stale = earn(); stale[0].ts = String(now - 3 * 3600000); assert.throws(() => normalizeOKXEarn(stale, 'USDC', now), /stale_data/);
});
test('anonymous OKX requests share loan data, isolate failed currencies and redact upstream responses', async () => {
  const calls = [];
  const result = await collectOKX(async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.headers, undefined); assert.equal(options.redirect, 'manual');
    if (url.includes('outer/loan-data')) return Response.json({ code: 0, data: loan() });
    if (url.includes('ccy=USDC')) return Response.json({ code: '0', data: earn() });
    return new Response('sensitive upstream text', { status: 429 });
  });
  assert.equal(calls.length, 4); assert.equal(result.filter(r => r.status === 'ok').length, 3);
  assert.equal(result[3].error, 'rate_limited'); assert.equal(result[3].apr, null); assert.equal(result[3].upstreamStatus, 429);
  assert.ok(!JSON.stringify(result).includes('sensitive'));
  const blocked = await collectOKX(async () => { throw new Error('private-url'); });
  assert.ok(blocked.every(r => r.error === 'network_error' && r.apr === null));
});
