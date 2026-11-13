const keyCache = new Map();
function decodePart(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function verifyPositionsIdentity(request, env, fetcher = fetch) {
  if (new URL(request.url).pathname === '/device/api/positions' && typeof env.verifyDeviceIdentity === 'function') return env.verifyDeviceIdentity(request);
  const issuer = String(env.ACCESS_TEAM_DOMAIN || '').replace(/\/$/, '');
  const audience = env.ACCESS_AUD;
  const owner = String(env.POSITIONS_EMAIL || '').trim().toLowerCase();
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !audience || !owner) {
    throw new Error('access_not_configured');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16000) throw new Error('unauthorized');
  let header, payload, parts;
  try {
    parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
  } catch { throw new Error('unauthorized'); }
  const now = Date.now() / 1000;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit ||
      payload.iss !== issuer || !Array.isArray(payload.aud) || !payload.aud.includes(audience) ||
      !Number.isFinite(payload.exp) || payload.exp <= now ||
      (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now + 30)) ||
      (payload.iat !== undefined && (!Number.isFinite(payload.iat) || payload.iat > now + 30)) ||
      typeof payload.email !== 'string' || payload.email.toLowerCase() !== owner) throw new Error('unauthorized');
  let cached = keyCache.get(issuer);
  if (!cached || cached.expires < Date.now() || !cached.keys.some(key => key.kid === header.kid)) {
    try {
      const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.keys)) throw new Error();
      cached = { keys: data.keys, expires: Date.now() + 300000 };
      keyCache.set(issuer, cached);
    } catch { throw new Error('access_unavailable'); }
  }
  try {
    const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'));
    if (!jwk) throw new Error();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) throw new Error();
  } catch { throw new Error('unauthorized'); }
  return { email: payload.email };
}
