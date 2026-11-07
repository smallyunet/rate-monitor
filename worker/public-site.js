// The build embeds only public web files. Account responses are never bundled.
export function servePublicSite(request, assets = typeof SITE_ASSETS === 'undefined' ? {} : SITE_ASSETS) {
  const path = new URL(request.url).pathname;
  const resource = assets[path === '/' ? '/index.html' : path];
  if (!resource) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
  return new Response(request.method === 'HEAD' ? null : resource.body, { headers: {
    'Content-Type': resource.type + '; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://api.bitget.com; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  } });
}
