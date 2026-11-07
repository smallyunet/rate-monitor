import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import worker, { handle, normalizeEarn, normalizeLoan, rate, signature, collectBinance } from '../worker/index.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
test('HMAC matches standard SHA256 signing', async () => {
  const query = 'asset=USDC&timestamp=1234';
  assert.equal(await signature(query, 'test-secret'), createHmac('sha256', 'test-secret').update(query).digest('hex'));
});
test('missing values remain unavailable and actual zero is preserved', () => {
  for (const value of [null, undefined, '', ' ', 'NaN', Infinity, -1, {}, []]) assert.throws(() => rate(value));
  assert.equal(rate('0'), 0);
});
test('Earn keeps base APR separate from tier bonuses and filters the exact asset', () => {
  const result = normalizeEarn({ rows: [{asset:'BTC'}, {asset:'USDC',latestAnnualPercentageRate:'0.025',tierAnnualPercentageRate:{'0-500USDC':'0.04'},canPurchase:false,isSoldOut:true}] }, 'USDC');
  assert.equal(result.apr, .025);
  assert.deepEqual(result.tiers, [{range:'0-500USDC',bonusApr:.04}]);
  assert.equal(result.soldOut, true);
  assert.throws(() => normalizeEarn({rows:[]}, 'USDC'), /unavailable/);
  assert.throws(() => normalizeEarn({rows:[{asset:'USDC'},{asset:'USDC'}]}, 'USDC'), /ambiguous_product/);
});
test('Loan uses current annual decimal quotes for the exact borrow asset, without history', () => {
  const quote = { rows: [
    { loanCoin: 'USDC', flexibleInterestRate: '0.05368216' },
    { loanCoin: 'USDT', flexibleInterestRate: '0.05847405' },
  ] };
  const collateral = { rows: [{ collateralCoin: 'BTC', initialLTV: '.78', liquidationLTV: '.91' }] };
  const usdc = normalizeLoan(quote, collateral, 'USDC');
  assert.equal(usdc.apr, .05368216);
  assert.equal(usdc.aprSource, 'realtime');
  assert.equal(usdc.collateralEligible, true);
  assert.equal(normalizeLoan(quote, collateral, 'USDT').apr, .05847405);
  assert.throws(() => normalizeLoan(quote, collateral, 'ETH'), /unavailable/);
  const zero = normalizeLoan({ rows: [{ loanCoin: 'USDC', flexibleInterestRate: '0' }] }, { rows: [] });
  assert.equal(zero.apr, 0);
  assert.equal(zero.collateralEligible, false);
  assert.throws(() => normalizeLoan({ rows: [{ loanCoin: 'USDC' }] }, collateral), /invalid_data/);
});
test('unconfigured Binance does not block public Bitget data', async () => {
  const response=await handle(new Request('https://test/api/rates',{headers:{Origin:'https://smallyunet.github.io'}}),{},()=>Response.json({ code: '00000', data: { loanInfos: [{ coin: 'USDC', rateFlexible: '.0372' }, { coin: 'USDT', rateFlexible: '.062' }], pledgeInfos: [{ coin: 'BTC', initRate: '.65', forceRate: '.91' }] } }));
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://smallyunet.github.io');
  const data=await response.json();assert.equal(data.products.length,12);
  for(const p of data.products.filter(p => p.platform === 'Binance')){assert.equal(p.status,'not_configured');assert.equal(p.apr,null);}
  assert.ok(data.products.filter(p => p.platform === 'Bitget' && p.kind === 'loan').every(p => p.status === 'ok' && p.apr > 0));
});
test('router restricts methods, paths and browser origins',async()=>{
  for(const [url,options,expected] of [
    ['https://test/api/rates',{method:'POST'},405],
    ['https://test/sapi/v1/account',{},404],
    ['https://test/api/rates',{headers:{Origin:'https://evil.example'}},403],
  ]){const r=await handle(new Request(url,options),{});assert.equal(r.status,expected);}
  assert.equal((await handle(new Request('https://test/api/rates',{method:'OPTIONS',headers:{Origin:'https://smallyunet.github.io'}}),{})).status,204);
});
test('partial failures stay isolated, signed calls only use allowlisted read endpoints, errors redact secrets',async()=>{
  const calls=[];
  const products=await collectBinance({BINANCE_API_KEY:'private-key',BINANCE_API_SECRET:'private-secret'},async(url,options)=>{
    const u=new URL(url);calls.push(u);
    assert.equal(u.origin,'https://api-gcp.binance.com');assert.equal(options.headers['X-MBX-APIKEY'],'private-key');
    assert.equal(u.searchParams.get('signature').length,64);
    if(u.searchParams.get('asset')==='USDT')return Response.json({rows:[{asset:'USDT',latestAnnualPercentageRate:'0',tierAnnualPercentageRate:{}}]});
    return Response.json({code:-2015,msg:'private-key private-secret account information'},{status:401});
  });
  assert.equal(products.find(p=>p.id==='binance-earn-usdt').apr,0);
  assert.equal(products.filter(p=>p.status==='error').length,3);
  for (const p of products.filter(p => p.status === 'error')) {
    assert.equal(p.upstreamStatus, 401);
    assert.equal(p.upstreamCode, -2015);
  }
  assert.equal(JSON.stringify(products).includes('private-'),false);
  assert.equal(calls.length,4);
});
test('HTML region restrictions preserve the HTTP status instead of becoming unknown upstream errors', async () => {
  const products = await collectBinance({ BINANCE_API_KEY: 'test-key', BINANCE_API_SECRET: 'test-secret' },
    async () => new Response('<html>Restricted</html>', { status: 451 }));
  assert.ok(products.every(p => p.error === 'region_restricted' && p.upstreamStatus === 451));
});
test('Cloudflare entry point ignores ExecutionContext and calls the real fetch implementation', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ code: -2015 }, { status: 401 });
  };
  try {
    const response = await worker.fetch(new Request('https://test/api/rates'),
      { BINANCE_API_KEY: 'test-key', BINANCE_API_SECRET: 'test-secret' },
      { waitUntil() {}, passThroughOnException() {} });
    const data = await response.json();
    assert.equal(calls, 8);
    assert.ok(data.products.filter(p => p.platform === 'Binance').every(p => p.error === 'credentials_error'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('connectivity probes use fixed public endpoints without credentials', async () => {
  const calls = [];
  const response = await handle(new Request('https://test/health?check=binance'),
    { BINANCE_API_KEY: 'test-key', BINANCE_API_SECRET: 'test-secret' }, async (url, options) => {
      calls.push(url);
      assert.equal(options.headers, undefined);
      assert.equal(new URL(url).search, '');
      return Response.json({}, { status: url.includes('api-gcp') ? 200 : 403 });
    });
  assert.equal(calls.length, 2);
  assert.deepEqual((await response.json()).connectivity, [
    { host: 'api.binance.com', status: 403 }, { host: 'api-gcp.binance.com', status: 200 },
  ]);
});

test('both live loans and both Earn products succeed with one shared collateral query and no history requests', async () => {
  const calls = [];
  const products = await collectBinance({ BINANCE_API_KEY: 'test-key', BINANCE_API_SECRET: 'test-secret' }, async url => {
    const u = new URL(url); calls.push(u.pathname);
    if (u.pathname.endsWith('/loanable/data')) return Response.json({ rows: [{ loanCoin: u.searchParams.get('loanCoin'), flexibleInterestRate: '.05' }] });
    if (u.pathname.endsWith('/collateral/data')) return Response.json({ rows: [{ collateralCoin: 'BTC', initialLTV: '.78', liquidationLTV: '.91' }] });
    if (u.pathname.endsWith('/flexible/list')) return Response.json({ rows: [{ asset: u.searchParams.get('asset'), latestAnnualPercentageRate: '.02' }] });
    throw new Error('Unexpected endpoint');
  });
  assert.equal(products.length, 4);
  assert.ok(products.every(p => p.status === 'ok' && p.apr !== null));
  assert.equal(products.filter(p => p.kind === 'loan').length, 2);
  assert.equal(calls.filter(path => path.endsWith('/collateral/data')).length, 1);
  assert.ok(calls.every(path => !path.includes('History')));
});
