import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBitget, normalizeBitgetLoan, handle } from '../worker/index.js';
const fixture = () => ({ loanInfos: [
  { coin: 'USDT', rateFlexible: '.062', rate7D: '.065', rate30D: '.07' },
  { coin: 'USDC', rateFlexible: '.0372', rate7D: '.039', rate30D: '.041' },
], pledgeInfos: [{ coin: 'BTC', initRate: '.65', forceRate: '.91' }] });
test('Bitget uses the live flexible annual decimal and checks BTC collateral', () => {
  assert.equal(normalizeBitgetLoan(fixture(), 'USDT').apr, .062);
  assert.equal(normalizeBitgetLoan(fixture(), 'USDC').apr, .0372);
  assert.equal(normalizeBitgetLoan(fixture(), 'USDC').collateralEligible, true);
  const data = fixture(); data.pledgeInfos = [];
  assert.equal(normalizeBitgetLoan(data, 'USDC').collateralEligible, false);
  assert.equal(normalizeBitgetLoan(data, 'USDC').initialLtv, null);
});
test('Bitget missing rates are unavailable, never replaced by fixed rates or zero', () => {
  const data = fixture(); delete data.loanInfos[0].rateFlexible;
  assert.throws(() => normalizeBitgetLoan(data, 'USDT'), /invalid_data/);
  data.loanInfos[0].rateFlexible = '0';
  assert.equal(normalizeBitgetLoan(data, 'USDT').apr, 0);
  assert.throws(() => normalizeBitgetLoan(data, 'ETH'), /unavailable/);
  data.loanInfos.push(data.loanInfos[0]);
  assert.throws(() => normalizeBitgetLoan(data, 'USDT'), /ambiguous_product/);
  assert.throws(() => normalizeBitgetLoan({}, 'USDT'), /invalid_data/);
});
test('one anonymous Bitget request serves both products and isolates malformed assets', async () => {
  let calls = 0;
  const data = fixture(); delete data.loanInfos[0].rateFlexible;
  const products = await collectBitget(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.bitget.com/api/v3/loan/coins');
    assert.equal(options.headers, undefined);
    return Response.json({ code: '00000', data });
  });
  assert.equal(calls, 1);
  assert.equal(products.find(p => p.asset === 'USDT').status, 'error');
  assert.equal(products.find(p => p.asset === 'USDC').apr, .0372);
});
test('Bitget errors expose only safe status codes', async () => {
  for (const [fetcher, kind] of [
    [async () => Response.json({ code: '40037', msg: 'private upstream information' }, { status: 400 }), 'upstream_error'],
    [async () => new Response('<html>blocked</html>', { status: 451 }), 'region_restricted'],
    [async () => new Response('', { status: 429 }), 'rate_limited'],
    [async () => { throw new Error('private network details'); }, 'network_error'],
  ]) {
    const products = await collectBitget(fetcher);
    assert.ok(products.every(p => p.error === kind && p.apr === null));
    assert.ok(!JSON.stringify(products).includes('private'));
  }
});
test('Bitget failure leaves all Binance products usable and never receives Binance secrets', async () => {
  const response = await handle(new Request('https://test/api/rates'),
    { BINANCE_API_KEY: 'private-key', BINANCE_API_SECRET: 'private-secret' }, async (url, options) => {
      const u = new URL(url);
      if (u.hostname === 'api.bitget.com') {
        assert.equal(options.headers, undefined);
        return Response.json({ code: '40037' }, { status: 400 });
      }
      assert.equal(options.headers['X-MBX-APIKEY'], 'private-key');
      if (u.pathname.endsWith('/loanable/data')) return Response.json({ rows: [{ loanCoin: u.searchParams.get('loanCoin'), flexibleInterestRate: '.05' }] });
      if (u.pathname.endsWith('/collateral/data')) return Response.json({ rows: [{ collateralCoin: 'BTC', initialLTV: '.78', liquidationLTV: '.91' }] });
      return Response.json({ rows: [{ asset: u.searchParams.get('asset'), latestAnnualPercentageRate: '.02' }] });
    });
  const { products } = await response.json();
  assert.equal(products.length, 6);
  assert.ok(products.filter(p => p.platform === 'Binance').every(p => p.status === 'ok'));
  assert.ok(products.filter(p => p.platform === 'Bitget').every(p => p.status === 'error' && p.upstreamCode === 40037));
});
