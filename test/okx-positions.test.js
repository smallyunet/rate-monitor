import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { okxSavingsGet, normalizeOKXPositions } from '../worker/okx-positions.js';
import { collectPositions, handlePrivate } from '../worker/private-positions.js';
import { visiblePositions, positionRate, portfolioSummary } from '../web/positions.js';
const env = { OKX_API_KEY: 'test-key', OKX_API_SECRET: 'test-secret', OKX_API_PASSPHRASE: 'test-pass' };
const fixture = () => [
  {ccy: 'USDT', amt: '500.123456789123456789', loanAmt: '400', pendingAmt: '100.123456789123456789', earnings: '0.123456789123456789', rate: '0.01'},
  {ccy: 'USDC', amt: '500', loanAmt: '500', pendingAmt: '0', earnings: '1', rate: '0.01'},
  {ccy: 'BTC', amt: '0', loanAmt: '0', pendingAmt: '0', earnings: '0', rate: '0.01'},
];
test('OKX signs only the fixed read-only balance endpoint using ISO time and base64 HMAC', async () => {
  const result = await okxSavingsGet(env, async (url, options) => {
    assert.equal(url, 'https://www.okx.com/api/v5/finance/savings/balance');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    const h = options.headers;
    assert.equal(h['OK-ACCESS-KEY'], env.OKX_API_KEY); assert.equal(h['OK-ACCESS-PASSPHRASE'], env.OKX_API_PASSPHRASE);
    assert.equal(new Date(h['OK-ACCESS-TIMESTAMP']).toISOString(), h['OK-ACCESS-TIMESTAMP']);
    assert.equal(h['OK-ACCESS-SIGN'], createHmac('sha256', env.OKX_API_SECRET).update(h['OK-ACCESS-TIMESTAMP'] + 'GET/api/v5/finance/savings/balance').digest('base64'));
    assert.equal(h['Cf-Access-Jwt-Assertion'], undefined);
    return Response.json({code: '0', data: fixture()});
  });
  assert.equal(result.length, 3);
});
test('OKX preserves balance precision and components without treating minimum rate as actual APR', () => {
  const rows = normalizeOKXPositions(fixture());
  assert.equal(rows[0].amount, '500.123456789123456789');
  assert.equal(rows[0].pendingAmount, '100.123456789123456789');
  assert.equal(rows[0].totalProfit, '0.123456789123456789');
  const section = {platform: 'OKX', product: 'Flexible Earn', status: 'ok', rows};
  assert.equal(visiblePositions(section).length, 2);
  assert.equal(positionRate(rows[0], section, [{platform:'OKX',kind:'earn',status:'ok',asset:'USDT',apr:.1}]), null);
  const summary = portfolioSummary([section], []);
  assert.equal(summary.earningApr, null);
  assert.equal(summary.netAnnual, null);
  assert.equal(summary.earn, Number(rows[0].amount) + 500);
  assert.deepEqual(normalizeOKXPositions([]), []);
  assert.throws(() => normalizeOKXPositions([...fixture(), fixture()[0]]), /invalid_data/);
  assert.throws(() => normalizeOKXPositions([{ccy:'USDT'}]), /invalid_data/);
  const missing = normalizeOKXPositions([{ccy:'USDT',amt:'1',loanAmt:'bad'}])[0];
  assert.equal(missing.lendingAmount, null); assert.equal(missing.totalProfit, null);
});
test('OKX positions distinguish missing configuration, empty holdings and sanitized failures', async () => {
  let calls = 0;
  const collect = (vars, fetcher) => collectPositions(vars, fetcher, () => {throw Error('unexpected Binance');});
  const missing = await collect({}, () => {calls++;});
  assert.equal(missing.sections.at(-1).status, 'not_configured'); assert.equal(calls, 0);
  const empty = await collect(env, async () => Response.json({code:'0',data:[]}));
  assert.equal(empty.sections.at(-1).status, 'ok'); assert.deepEqual(empty.sections.at(-1).rows, []);
  const success = await collect(env, async () => Response.json({code:'0',data:fixture()}));
  assert.equal(success.sections.at(-1).rows.length, 3);
  for (const [status, code, error] of [[401,'50113','credentials_error'], [200,'50102','clock_error'], [429,'50011','rate_limited'], [403,'50000','upstream_forbidden']]) {
    const result = await collect(env, async () => Response.json({code,msg:'secret private detail'}, {status}));
    const section = result.sections.at(-1);
    assert.equal(section.status, 'error'); assert.equal(section.error, error); assert.deepEqual(section.rows, []);
    assert.ok(!JSON.stringify(result).includes('private detail'));
  }
});
test('OKX credentials do not cause requests before private identity verification', async () => {
  let calls = 0;
  const response = await handlePrivate(new Request('https://example.com/private/api/positions'), env,
    () => {calls++; throw Error('must not fetch');}, () => {throw Error('must not fetch');});
  assert.equal(response.status, 503); assert.equal(calls, 0);
});
