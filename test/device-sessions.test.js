import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceSessions } from '../server/device-sessions.js';
import { verifyPositionsIdentity } from '../worker/access-auth.js';

test('remembered devices survive restart, renew, expire, and are revoked server-side', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rate-device-'));
  try {
    let time = Date.now();
    const file = join(directory, 'devices.json');
    const env = { PUBLIC_ORIGIN: 'https://w.dark20.xyz' };
    const options = { file, owner: 'owner@example.com', now: () => time, verifyAccess: async request => {
      if (request.headers.get('cf-access-jwt-assertion') !== 'verified-by-test') throw Error('unauthorized');
      return { email: 'owner@example.com' };
    } };
    let middleware = await createDeviceSessions(options);
    let token;
    const request = (path, method = 'GET', extra = {}) => new Request(env.PUBLIC_ORIGIN + path, { method, headers: { ...(token ? { cookie: token } : {}), ...extra } });
    const handler = async (req, runtime) => {
      try { await verifyPositionsIdentity(req, runtime); return new Response('authorized'); }
      catch { return new Response('denied', { status: 401 }); }
    };
    assert.equal((await middleware(request('/private/remember', 'POST', { origin: env.PUBLIC_ORIGIN }), env, handler)).status, 401);
    assert.equal((await middleware(request('/private/remember', 'POST', { origin: 'https://evil.example', 'cf-access-jwt-assertion': 'verified-by-test' }), env, handler)).status, 403);
    const enroll = async () => {
      const response = await middleware(request('/private/remember', 'POST', { origin: env.PUBLIC_ORIGIN, 'cf-access-jwt-assertion': 'verified-by-test' }), env, handler);
      assert.equal(response.status, 303);
      assert.match(response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
      token = response.headers.get('set-cookie').split(';')[0];
      assert.ok(!(await readFile(file, 'utf8')).includes(token.split('=')[1]));
    };
    await enroll();
    middleware = await createDeviceSessions(options);
    const access = () => middleware(request('/device/api/positions'), env, handler);
    assert.equal((await access()).status, 200);
    const savedToken = token;
    token = '__Host-rate-monitor-device=' + '0'.repeat(64);
    assert.equal((await access()).status, 401);
    token = savedToken;
    time += 89 * 86400000;
    assert.equal((await access()).status, 200);
    time += 89 * 86400000;
    assert.equal((await access()).status, 200);
    assert.equal((await middleware(request('/device/logout', 'POST'), env, handler)).status, 403);
    assert.equal((await middleware(request('/device/logout', 'POST', { origin: env.PUBLIC_ORIGIN }), env, handler)).status, 204);
    assert.equal((await access()).status, 401);
    await enroll();
    time += 91 * 86400000;
    assert.equal((await access()).status, 401);
    await enroll();
    for (let day = 0; day < 360; day += 60) { time += 60 * 86400000; assert.equal((await access()).status, 200); }
    time += 6 * 86400000;
    assert.equal((await access()).status, 401);
    await enroll();
    const changedOwner = await createDeviceSessions({ ...options, owner: 'new@example.com' });
    assert.equal((await changedOwner(request('/device/api/positions'), env, handler)).status, 401);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
