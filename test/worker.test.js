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
test('Loan never guesses raw rate unit and selects latest non-future published reference', () => {
  const result=normalizeLoan({rows:[{loanCoin:'USDC',flexibleInterestRate:'0.00000491'}]}, {rows:[
    {coin:'USDC',annualizedInterestRate:'.03',time:1000},
    {coin:'USDC',annualizedInterestRate:'.04',time:2000},
    {coin:'USDC',annualizedInterestRate:'.99',time:4000},
    {coin:'BTC',annualizedInterestRate:'.88',time:2500},
  ]}, {rows:[{collateralCoin:'BTC',initialLTV:'.65',liquidationLTV:'.83'}]}, 3000);
  assert.equal(result.rawRate,.00000491); assert.equal(result.apr,.04);
  assert.equal(result.aprSource,'latest_published'); assert.equal(result.rateTime,new Date(2000).toISOString());
  assert.equal(result.collateralEligible,true);
  const absent=normalizeLoan({rows:[{loanCoin:'USDC',flexibleInterestRate:'0'}]}, {rows:[]}, {rows:[]});
  assert.equal(absent.apr,null);assert.equal(absent.rawRate,0);assert.equal(absent.collateralEligible,false);
});
test('unconfigured service performs no network calls and returns no invented rates', async () => {
  const response=await handle(new Request('https://test/api/rates',{headers:{Origin:'https://smallyunet.github.io'}}),{},()=>{throw new Error('network must not run');});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://smallyunet.github.io');
  const data=await response.json();assert.equal(data.products.length,3);
  for(const p of data.products){assert.equal(p.status,'not_configured');assert.equal(p.apr,null);}
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
    assert.equal(u.origin,'https://api.binance.com');assert.equal(options.headers['X-MBX-APIKEY'],'private-key');
    assert.equal(u.searchParams.get('signature').length,64);
    if(u.searchParams.get('asset')==='USDT')return Response.json({rows:[{asset:'USDT',latestAnnualPercentageRate:'0',tierAnnualPercentageRate:{}}]});
    return Response.json({code:-2015,msg:'private-key private-secret account information'},{status:401});
  });
  assert.equal(products.find(p=>p.asset==='USDT').apr,0);
  assert.equal(products.filter(p=>p.status==='error').length,2);
  assert.equal(JSON.stringify(products).includes('private-'),false);
  assert.equal(calls.length,3);
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
    assert.equal(calls, 3);
    assert.ok(data.products.every(p => p.error === 'credentials_error'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
