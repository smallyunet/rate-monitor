import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBitgetEarn, collectBitgetEarn } from '../worker/bitget-earn.js';
import { productEarnTiers } from '../web/earn-apr.js';
import { relay } from '../server/relay.js';
const product = (coin='USDT') => ({ coin, periodType:'flexible',productLevel:'normal',status:'in_progress',productId:'example',apyList:[
 {minStepVal:'0',maxStepVal:'1000',currentApy:'6.00'},
 {minStepVal:'1000',maxStepVal:'1000000',currentApy:'2.00'},
]});
test('Bitget Earn selects normal flexible products and uses total tier percentages',()=>{
 const raw=product();const value=normalizeBitgetEarn([raw,{...product(),periodType:'fixed'},{...product(),productLevel:'VIP'},{...product(),productLevel:'beginner'}],'USDT');
 assert.equal(value.apr,.06);assert.equal(value.rateTiers[1].apr,.02);
 const tiers=productEarnTiers(value);assert.deepEqual(tiers,[{from:0,to:1000,apr:.06},{from:1000,to:1000000,apr:.02}]);
 assert.throws(()=>normalizeBitgetEarn([{...raw,productLevel:'VIP'}],'USDT'),/unavailable/);
 assert.equal(normalizeBitgetEarn([raw,raw],'USDT').offers.length,1);
 const other={...product(),productId:'other',apyList:[{minStepVal:'0',maxStepVal:'300000',currentApy:'7'},{minStepVal:'300000',maxStepVal:'10000000',currentApy:'4'}]};
 const multiple=normalizeBitgetEarn([other,raw],'USDT');assert.equal(multiple.offers.length,2);assert.equal(multiple.productId,'other');assert.equal(multiple.offers[1].productId,'example');
 assert.throws(()=>normalizeBitgetEarn([raw,{...raw,apyList:other.apyList}],'USDT'),/ambiguous_product/);
});
test('Bitget chooses the complete highest-APR offer regardless of API order', () => {
 const low = product();
 const high = {...product(), productId:'high', apyList:[
  {minStepVal:'0',maxStepVal:'300',currentApy:'11'},
  {minStepVal:'300',maxStepVal:'1000000',currentApy:'1'},
 ]};
 const selected = normalizeBitgetEarn([low, high], 'USDT');
 assert.equal(selected.productId, 'high');
 assert.deepEqual(selected.rateTiers, [{from:0,to:300,apr:.11},{from:300,to:1000000,apr:.01}]);
 assert.equal(normalizeBitgetEarn([low,{...high,status:'sold_out'}], 'USDT').productId, 'example');
 assert.equal(normalizeBitgetEarn([low,{...low,productId:'tie'}], 'USDT').productId, 'example');
 const laterPeak = {...high, apyList:[{...high.apyList[0],currentApy:'1'},{...high.apyList[1],currentApy:'12'}]};
 assert.equal(normalizeBitgetEarn([low,laterPeak], 'USDT').productId, 'high');
});
test('Bitget missing, overlapping or incomplete tiers never become an invented APR',()=>{
 for(const apyList of [[],[{minStepVal:'0',maxStepVal:'100',currentApy:''}],[{minStepVal:'100',maxStepVal:'200',currentApy:'5'}],[{minStepVal:'0',maxStepVal:'100',currentApy:'5'},{minStepVal:'50',maxStepVal:'200',currentApy:'2'}]]) assert.throws(()=>normalizeBitgetEarn([{...product(),apyList}],'USDT'),/invalid_data/);
 assert.throws(()=>productEarnTiers({rateTiers:[{from:0,to:10,apr:.05},{from:20,to:30,apr:.02}]}),/invalid_tiers/);
});
test('public market rates use Bitget-only signed headers and expose no credentials',async()=>{
 const env={BITGET_API_KEY:'market-key',BITGET_API_SECRET:'market-secret',BITGET_API_PASSPHRASE:'market-pass',BITGET_RELAY_URL:'https://relay.example/bridge'};
 const result=await collectBitgetEarn(env,async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://relay.example');assert.equal(u.pathname,'/bridge/api/v3/earn/savings/product');assert.equal(u.searchParams.get('filter'),'available');assert.equal(options.headers['Cf-Access-Jwt-Assertion'],undefined);assert.equal(options.headers['ACCESS-KEY'],'market-key');
  return Response.json({code:'00000',data:[product(u.searchParams.get('coin'))]});
 });
 assert.equal(result.length,2);assert(result.every(p=>p.status==='ok'));assert(!JSON.stringify(result).includes('market-'));
 const missing=await collectBitgetEarn({},()=>{throw Error('must not fetch');});assert(missing.every(p=>p.status==='not_configured'));
});
test('relay opens only fixed public product queries while keeping all positions private',async()=>{
 const options={headers:{'ACCESS-KEY':'key','ACCESS-SIGN':'sign','ACCESS-PASSPHRASE':'pass','ACCESS-TIMESTAMP':String(Date.now())}};
 const fetcher=async(url,opts)=>{assert.equal(url,'https://api.bitget.com/api/v3/earn/savings/product?coin=USDT&filter=available');assert.equal(opts.headers['Cf-Access-Jwt-Assertion'],undefined);return Response.json({code:'00000',data:[product()]});};
 const base='https://relay.example/api/v3/earn/savings/';
 assert.equal((await relay(new Request(base+'product?coin=USDT&filter=available',options),{},fetcher)).status,200);
 assert.equal((await relay(new Request(base+'account',options),{},fetcher)).status,401);
 assert.equal((await relay(new Request(base+'product?coin=BTC&filter=available',options),{},fetcher)).status,400);
 assert.equal((await relay(new Request(base+'product?coin=USDT&filter=held',options),{},fetcher)).status,400);
 assert.equal((await relay(new Request(base+'product?coin=USDT&filter=available&userId=123',options),{},fetcher)).status,400);
});
