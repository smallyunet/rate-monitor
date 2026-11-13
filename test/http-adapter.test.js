import test from 'node:test';
import assert from 'node:assert/strict';
import { requestHandler } from '../server/http-adapter.js';
async function run(handler, url='/', method='GET', headers={}) {
  const result = {};
  const res={writeHead(status,headers){Object.assign(result,{status,headers});this.headersSent=true;},end(body){result.body=body?.toString();}};
  await requestHandler(handler,{PUBLIC_ORIGIN:'https://w.dark20.xyz',RELEASE:'test'})({url,method,headers},res);
  return result;
}
test('adapter fixes origin and preserves Access JWT for application validation',async()=>{
  const result=await run(request=>{
    assert.equal(request.url,'https://w.dark20.xyz/private/api/positions');
    assert.equal(request.headers.get('Cf-Access-Jwt-Assertion'),'test-jwt');
    return new Response('private',{headers:{'Cache-Control':'private, no-store'}});
  },'/private/api/positions','GET',{host:'attacker.invalid','cf-access-jwt-assertion':'test-jwt'});
  assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'private, no-store');
});
test('adapter rejects off-origin paths and write methods before the application',async()=>{
  const handler=()=>assert.fail('handler must not run');
  assert.equal((await run(handler,'//attacker.invalid/')).status,405);
  assert.equal((await run(handler,'/','POST')).status,405);
});
test('adapter supports HEAD, release health header and sanitized failures',async()=>{
  let result=await run(()=>new Response('secret'),'/health','HEAD');
  assert.equal(result.body,undefined);assert.equal(result.headers['X-Release'],'test');
  result=await run(()=>{throw new Error('secret');});
  assert.equal(result.status,500);assert.equal(result.body,'{"error":"service_error"}');
});

test('adapter permits only the two explicit session POST routes', async () => {
  for (const path of ['/private/remember', '/device/logout']) {
    const result = await run(request => {
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('origin'), 'https://w.dark20.xyz');
      return new Response(null, { status: 204 });
    }, path, 'POST', { origin: 'https://w.dark20.xyz' });
    assert.equal(result.status, 204);
  }
  assert.equal((await run(() => assert.fail('must not run'), '/device/api/positions', 'POST')).status, 405);
});
