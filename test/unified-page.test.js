import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountEarnAmounts, selectEarnAmount } from '../web/account-amounts.js';
import { servePublicSite } from '../worker/public-site.js';
import { handle } from '../worker/index.js';
import { readFile } from 'node:fs/promises';

test('account defaults sum actual Flexible Earn balances exactly and preserve real zero', () => {
 const values=accountEarnAmounts([{platform:'Binance',product:'Flexible Earn',status:'ok',rows:[{asset:'USDC',amount:'100.000000001'},{asset:'USDC',amount:'0.000000009'},{asset:'BTC',amount:'2'}]}]);
 assert.equal(values.get('binance-earn-usdc'),'100.00000001');assert.equal(values.get('binance-earn-usdt'),'0');
 const account=new Map([['id','123.45']]);const manual=new Map();
 assert.deepEqual(selectEarnAmount('id',manual,account,20000),{value:'123.45',source:'Your balance'});
 manual.set('id','');assert.deepEqual(selectEarnAmount('id',manual,account,20000),{value:'',source:'Custom amount'});
 assert.deepEqual(selectEarnAmount('other',manual,account,20000),{value:'20000',source:'Tier default'});
});
test('failed, partial, missing and malformed balances never become zero or estimates',()=>{
 for(const status of ['error','partial','not_configured']) assert.equal(accountEarnAmounts([{platform:'Binance',product:'Flexible Earn',status,rows:[]}]).size,0);
 assert.equal(accountEarnAmounts([]).size,0);
 const map=accountEarnAmounts([{platform:'Binance',product:'Flexible Earn',status:'ok',rows:[{asset:'USDC',amount:null}]}]);
 assert.equal(map.has('binance-earn-usdc'),false);assert.equal(map.get('binance-earn-usdt'),'0');
});
test('public assets are static, cannot embed identity or holdings, and disallow framing',async()=>{
 const response=servePublicSite(new Request('https://example.com/'),{'/index.html':{type:'text/html',body:'<h1>Rates</h1>'}});
 assert.equal(await response.text(),'<h1>Rates</h1>');assert.equal(response.headers.get('X-Frame-Options'),'DENY');
 assert.equal(servePublicSite(new Request('https://example.com/private/api/positions'),{}),null);
 let calls=0;const unauthorized=await handle(new Request('https://example.com/private/api/positions'),{},()=>{calls++;throw Error();});
 assert.equal(unauthorized.status,503);assert.equal(calls,0);
});
test('public page and browser modules parse; account data remains in a distinct section',async()=>{
 const html=await readFile('web/index.html','utf8');assert.match(html,/id="positions"/);assert.match(html,/id="rates"/);assert.match(html,/id="sign-in"/);
 for(const file of ['web/app.js','web/positions.js']) {
  // Parsing through esbuild does not launch a browser or execute module code.
  const {transform}=await import('esbuild');await transform(await readFile(file,'utf8'),{loader:'js',target:'es2022'});
 }
});
