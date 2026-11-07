import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPositionsIdentity } from '../worker/access-auth.js';
import { handle } from '../worker/index.js';
import { decimal, binanceLoans, binanceEarn, bitgetLoans, bitgetEarn, paginatedBinance, collectPositions, bitgetGet } from '../worker/private-positions.js';
import { script } from '../worker/positions-page.js';
import vm from 'node:vm';
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
 assert.deepEqual(bitgetEarn([{coin:'USDT',amount:'123.45'}])[0],{asset:'USDT',amount:'123.45',product:'Earn',collateralAmount:null});
});
test('pagination requests every page and reports inconsistent totals as partial',async()=>{
 let calls=0;const result=await paginatedBinance(async()=>({rows:++calls===1?Array(100).fill({}):[{}],total:101}),'/fixed');assert.equal(result.rows.length,101);assert.equal(result.partial,false);
 calls=0;assert.equal((await paginatedBinance(async()=>({rows:[{}],total:++calls===1?2:3}),'/fixed')).partial,true);
});
test('per-section upstream errors remain unavailable, not empty success',async()=>{
 const data=await collectPositions({BINANCE_API_KEY:'test',BINANCE_API_SECRET:'test'},()=>{},async()=>{throw Error('private upstream body never shown');});
 assert.equal(data.sections[0].status,'error');assert.equal(data.sections[0].error,'upstream_error');assert.equal(data.sections[3].status,'not_configured');assert(!JSON.stringify(data).includes('private upstream body'));
});
test('Bitget signed GET uses a base64 HMAC and refuses redirects',async()=>{
 const vars={BITGET_API_KEY:'key',BITGET_API_SECRET:'secret',BITGET_API_PASSPHRASE:'pass'};
 await bitgetGet('/api/v2/earn/account/assets',vars,async(url,options)=>{
  assert.equal(url,'https://api.bitget.com/api/v2/earn/account/assets');assert.equal(options.redirect,'manual');assert.equal(options.headers['ACCESS-PASSPHRASE'],'pass');assert.match(options.headers['ACCESS-SIGN'],/^[A-Za-z0-9+/]+=$/);
  return Response.json({code:'00000',data:[]});
 });
});
test('private browser script parses',()=>{new vm.Script(script);});
