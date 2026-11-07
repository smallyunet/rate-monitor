import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servePublicSite } from '../worker/public-site.js';
import { handle } from '../worker/index.js';
import { readFile } from 'node:fs/promises';

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
