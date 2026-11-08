import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPositionsIdentity } from '../worker/access-auth.js';
import { handle } from '../worker/index.js';
import { decimal, binanceLoans, binanceEarn, bitgetLoans, bitgetSavings, paginatedBinance, collectPositions, bitgetGet } from '../worker/private-positions.js';
const env={ACCESS_TEAM_DOMAIN:'https://positions-test.cloudflareaccess.com',ACCESS_AUD:'positions',POSITIONS_EMAIL:'owner@example.com'};
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test'};
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
async function token(changes={}){const parts=[b64({alg:'RS256',kid:'test'}),b64({iss:env.ACCESS_TEAM_DOMAIN,aud:['positions'],email:'owner@example.com',exp:Date.now()/1000+300,...changes})];const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(parts.join('.')));return parts.join('.')+'.'+Buffer.from(signed).toString('base64url');}
const request=t=>new Request('https://example.com/private/api/positions',{headers:t?{'Cf-Access-Jwt-Assertion':t}: {}});
const certs=async url=>{assert.equal(url,env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
test('private identity requires a valid signature, issuer, audience, owner and lifetime',async()=>{
 assert.deepEqual(await verifyPositionsIdentity(request(await token()),env,certs),{email:'owner@example.com'});
 for(const changes of [{iss:'https://other.cloudflareaccess.com'},{aud:['public']},{email:'someone@example.com'},{exp:0},{nbf:Date.now()/1000+600}]) await assert.rejects(verifyPositionsIdentity(request(await token(changes)),env,certs),/unauthorized/);
 const good=await token();const parts=good.split('.');parts[2]=b64('forged');await assert.rejects(verifyPositionsIdentity(request(parts.join('.')),env,certs),/unauthorized/);
});
test('unauthenticated private requests never contact exchanges and cannot enable CORS',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('must not fetch');};
 for(const path of ['/private','/private/','/private/app.js','/private/api/positions']){
 const res=await handle(new Request('https://example.com'+path,{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.com',Origin:'https://smallyunet.github.io'}}),env,fetcher);
 assert.equal(res.status,401);assert.equal(res.headers.get('Access-Control-Allow-Origin'),null);assert.match(res.headers.get('Cache-Control'),/private, no-store/);
 }
 assert.equal(calls,0);
 assert.equal((await handle(request(),{},fetcher)).status,503);
});
test('balance adapters preserve decimal precision and do not turn missing debt into zero',()=>{
 assert.equal(decimal('123456789.123456789123456789'),'123456789.123456789123456789');
 assert.throws(()=>decimal(undefined));assert.throws(()=>decimal('-1'));
 assert.equal(binanceLoans([{collateralCoin:'BTC',collateralAmount:'1.000000001',loanCoin:'USDC',totalDebt:'123.45'}])[0].debt,'123.45');
 assert.equal(binanceEarn([{asset:'USDT',totalAmount:'123',collateralAmount:'12'}])[0].collateralAmount,'12');
 assert.equal(bitgetLoans([{pledgeCoin:'BTC',pledgeAmount:'1',loanCoin:'USDT',loanAmount:'123',interestAmount:'0.12'}])[0].debt,null);

});
test('pagination requests every page and reports inconsistent totals as partial',async()=>{
 let calls=0;const result=await paginatedBinance(async()=>({rows:++calls===1?Array(100).fill({}):[{}],total:101}),'/fixed');assert.equal(result.rows.length,101);assert.equal(result.partial,false);
 await assert.rejects(paginatedBinance(async()=>({rows:[],total:null}),'/fixed'),/invalid_data/);
 calls=0;assert.equal((await paginatedBinance(async()=>({rows:[{}],total:++calls===1?2:3}),'/fixed')).partial,true);
});
test('per-section upstream errors remain unavailable, not empty success',async()=>{
 const data=await collectPositions({BINANCE_API_KEY:'test',BINANCE_API_SECRET:'test'},()=>{},async()=>{throw Error('private upstream body never shown');});
 assert.equal(data.sections[0].status,'error');assert.equal(data.sections[0].error,'upstream_error');assert.equal(data.sections[3].status,'not_configured');assert(!JSON.stringify(data).includes('private upstream body'));
});
test('Bitget signed GET uses a base64 HMAC and refuses redirects',async()=>{
 const vars={BITGET_API_KEY:'key',BITGET_API_SECRET:'secret',BITGET_API_PASSPHRASE:'pass'};
 await bitgetGet('/api/v3/earn/savings/account',vars,async(url,options)=>{
  assert.equal(url,'https://api.bitget.com/api/v3/earn/savings/account');assert.equal(options.redirect,'manual');assert.equal(options.headers['ACCESS-PASSPHRASE'],'pass');assert.match(options.headers['ACCESS-SIGN'],/^[A-Za-z0-9+/]+=$/);
  return Response.json({code:'00000',data:[]});
 });
});

test('server relay checks identity before credentials and never forwards JWT to Bitget',async()=>{
 const {relay}=await import('../server/relay.js');
 let calls=0; const denied=await relay(new Request('https://relay/api/v3/earn/savings/account'),env,()=>{calls++;throw Error();});
 assert.equal(denied.status,401);assert.equal(calls,0);
 const jwt=await token();
 const response=await relay(new Request('https://relay/api/v3/earn/savings/account',{headers:{'Cf-Access-Jwt-Assertion':jwt,'ACCESS-KEY':'key','ACCESS-SIGN':'signature','ACCESS-TIMESTAMP':String(Date.now()),'ACCESS-PASSPHRASE':'pass'}}),env,async(url,options)=>{
  if(url.endsWith('/certs'))return certs(url);
  assert.equal(url,'https://api.bitget.com/api/v3/earn/savings/account');assert.equal(options.headers['Cf-Access-Jwt-Assertion'],undefined);assert.equal(options.redirect,'manual');
  return Response.json({code:'00000',data:[]});
 });
 assert.equal(response.status,200);
 assert.equal((await relay(new Request('https://relay/api/v2/spot/trade/orders'),env)).status,404);
});
test('Worker relay signs the original Bitget path and sends auth only to configured relay',async()=>{
 await bitgetGet('/api/v3/earn/savings/account',{BITGET_API_KEY:'key',BITGET_API_SECRET:'secret',BITGET_API_PASSPHRASE:'pass',BITGET_RELAY_URL:'https://relay.example/bridge',positionsJwt:'jwt'},async(url,options)=>{
  assert.equal(url,'https://relay.example/bridge/api/v3/earn/savings/account');assert.equal(options.headers['Cf-Access-Jwt-Assertion'],'jwt');
  return Response.json({code:'00000',data:[]});
 });
});

test('Savings separates complete estimated value from recent per-coin holdings',async()=>{
 const data=await bitgetSavings({BITGET_API_KEY:'key',BITGET_API_SECRET:'secret',BITGET_API_PASSPHRASE:'pass'},async url=>{
  if(url.endsWith('/account'))return Response.json({code:'00000',data:{usdtAmount:'123.456'}});
  const period=new URL(url).searchParams.get('periodType');
  return Response.json({code:'00000',data:{resultList:period==='flexible'?[{productCoin:'USDC',holdAmount:'100.0001',status:'in_holding'}]:[]}});
 });
 assert.equal(data.estimatedValue,'123.456');assert.equal(data.rows[0].asset,'USDC');assert.equal(data.rows[0].amount,'100.0001');assert.equal(data.partial,true);assert.match(data.coverage,/3 months/);
});

test('authenticated login landing returns to the public rates page without requesting balances',async()=>{
 const jwt=await token();
 for(const path of ['/private/','/private','/private/*']){
  const response=await handle(new Request('https://example.com'+path,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env,certs);
  assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'/#positions');assert.match(response.headers.get('Cache-Control'),/private, no-store/);
 }
});

test('Savings account estimate is a summary, never an additional holding', async () => {
 const { visiblePositions, positionSummary } = await import('../web/positions.js');
 const holding = {asset:'USDT',amount:'1000.00000000',product:'Flexible Savings'};
 const section = {status:'partial',estimatedValue:'1000.00000000',rows:[holding]};
 assert.deepEqual(visiblePositions(section),[holding]);
 assert.equal(positionSummary(section),'1000.00000000');
 // Older subscriptions can be absent from the detail endpoint, while the total remains valid.
 assert.deepEqual(visiblePositions({...section,rows:[]}),[]);
 assert.equal(positionSummary({...section,rows:[]}),'1000.00000000');
 for (const status of ['error','not_configured']) {
  assert.deepEqual(visiblePositions({...section,status}),[]);
  assert.equal(positionSummary({...section,status}),null);
 }
 assert.deepEqual(visiblePositions({...section,rows:[{asset:'USDT',amount:'0'}]}),[]);
 assert.equal(positionSummary({...section,estimatedValue:'0'}),null);
 const tiny={asset:'USDT',amount:'0.00000000000000000001'};
 assert.deepEqual(visiblePositions({...section,rows:[tiny]}),[tiny]);
});

 test('position groups keep loans separate from all Earn and Savings sections', async () => {
  const { positionKind } = await import('../web/positions.js');
  for (const platform of ['Binance', 'Bitget']) {
   assert.equal(positionKind({platform, product:'Flexible Loan'}), 'loan');
   for (const product of ['Flexible Earn','Locked Earn','Savings']) assert.equal(positionKind({platform,product}), 'earn');
  }
 });

test('Bitget risk percentages preserve units and missing risk never hides loan balances', () => {
 const raw = {pledgeCoin:'BTC',pledgeAmount:'1',loanCoin:'USDC',loanAmount:'800',interestAmount:'0.4',pledgeRate:'62.37',supRate:'85',forceRate:'91'};
 const row = bitgetLoans([raw])[0];
 assert.equal(row.currentLtvPercent,'62.37'); assert.equal(row.marginCallLtvPercent,'85'); assert.equal(row.liquidationLtvPercent,'91');
 for (const value of [undefined,null,'','NaN','-1','85%']) {
  const missing = bitgetLoans([{...raw,pledgeRate:value}])[0];
  assert.equal(missing.currentLtvPercent,null); assert.equal(missing.loan,'800');
 }
});
test('loan risk computes percentage-point gap and respects call and liquidation boundaries', async () => {
 const { loanRisk } = await import('../web/positions.js');
 const row = {currentLtvPercent:'60',marginCallLtvPercent:'85',liquidationLtvPercent:'90'};
 assert.deepEqual(loanRisk(row),{current:60,call:85,liquidation:90,gap:30,state:'normal'});
 assert.equal(loanRisk({...row,currentLtvPercent:'85'}).state,'warning');
 assert.equal(loanRisk({...row,currentLtvPercent:'90'}).state,'danger');
 assert.equal(loanRisk({...row,currentLtvPercent:'95'}).gap,-5);
 assert.equal(loanRisk({...row,currentLtvPercent:'0'}).gap,90);
 for (const value of [undefined,null,'','NaN','-1']) assert.equal(loanRisk({...row,currentLtvPercent:value}).gap,null);
 assert.equal(loanRisk({...row,liquidationLtvPercent:'0'}).gap,null);
 assert.equal(loanRisk({...row,liquidationLtvPercent:'101'}).state,'unknown');
 assert.equal(loanRisk({...row,marginCallLtvPercent:null}).state,'unknown');
 assert.equal(loanRisk({...row,marginCallLtvPercent:'95'}).call,null);
});
