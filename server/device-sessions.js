import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { verifyPositionsIdentity } from '../worker/access-auth.js';

const DAY = 86400000;
const COOKIE = '__Host-rate-monitor-device';
const digest = token => createHash('sha256').update(token).digest('hex');
const cookie = (token, seconds) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
function tokenFrom(request) {
  const values = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export async function createDeviceSessions({ file, owner, now = Date.now, verifyAccess = verifyPositionsIdentity }) {
  let records;
  try { records = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; records = {}; }
  if (!records || Array.isArray(records) || typeof records !== 'object') throw Error('Invalid device session store');
  let queue = Promise.resolve();
  const transaction = operation => {
    const result = queue.then(async () => {
      const next = structuredClone(records);
      for (const [key, value] of Object.entries(next)) {
        if (!(value.idleUntil > now() && value.absoluteUntil > now())) delete next[key];
      }
      const value = await operation(next);
      await writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
      records = next;
      return value;
    });
    queue = result.catch(() => {});
    return result;
  };
  return async (request, env, handler) => {
    const path = new URL(request.url).pathname;
    if (!['/private/remember', '/device/api/positions', '/device/logout'].includes(path)) return handler(request, env);
    const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
    const json = (error, status) => Response.json({ error }, { status, headers });
    if (request.method === 'POST' && request.headers.get('origin') !== env.PUBLIC_ORIGIN) return json('origin_not_allowed', 403);
    if (path === '/private/remember') {
      let identity;
      try { identity = await verifyAccess(request, env); }
      catch { return json('unauthorized', 401); }
      if (!owner || identity.email !== owner) return json('unauthorized', 401);
      if (request.method === 'GET') return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Remember this device</title><h1>Remember this device?</h1><p>Stay signed in on this browser. Expires after 90 days without use, or one year after login. Sign out revokes this device.</p><form method="post"><button>Remember this device</button></form><p><a href="/#positions">Continue without remembering</a></p></html>`, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
      if (request.method !== 'POST') return json('method_not_allowed', 405);
      const token = randomBytes(32).toString('hex');
      await transaction(next => {
        const previous = tokenFrom(request);
        if (previous) delete next[digest(previous)];
        if (Object.keys(next).length >= 100) throw Error('Device limit reached');
        next[digest(token)] = { email: owner, idleUntil: now() + 90 * DAY, absoluteUntil: now() + 365 * DAY };
      });
      return new Response(null, { status: 303, headers: { ...headers, Location: '/#positions', 'Set-Cookie': cookie(token, 90 * 86400) } });
    }
    if (path === '/device/logout') {
      if (request.method !== 'POST') return json('method_not_allowed', 405);
      const token = tokenFrom(request);
      await transaction(next => { if (token) delete next[digest(token)]; });
      return new Response(null, { status: 204, headers: { ...headers, 'Set-Cookie': cookie('', 0) } });
    }
    if (request.method !== 'GET') return json('method_not_allowed', 405);
    const token = tokenFrom(request);
    const session = token && Object.hasOwn(records, digest(token)) ? await transaction(next => {
      const entry = token && next[digest(token)];
      if (!owner || !entry || entry.email !== owner) return null;
      entry.idleUntil = Math.min(now() + 90 * DAY, entry.absoluteUntil);
      return entry;
    }) : null;
    // Fall back to a fresh Access identity for browsers that did not opt in.
    const response = await handler(request, session ? { ...env, verifyDeviceIdentity: async () => ({ email: owner }) } : env);
    if (session) response.headers.set('Set-Cookie', cookie(token, Math.floor((session.idleUntil - now()) / 1000)));
    return response;
  };
}
