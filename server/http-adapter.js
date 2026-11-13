// Bridge Node HTTP to the same Fetch handler used by the Worker.
export function requestHandler(handler, env) {
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Invalid PUBLIC_ORIGIN');
  return async (req, res) => {
    try {
      // Fix the origin rather than trusting Host or client-supplied proxy headers.
      const url = new URL(req.url, origin);
      if (url.origin !== origin.origin || !(['GET', 'HEAD', 'OPTIONS'].includes(req.method) || (req.method === 'POST' && ['/private/remember', '/device/logout'].includes(url.pathname)))) {
        res.writeHead(405, { 'Cache-Control': 'no-store' }); res.end(); return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const request = new Request(url, { method: req.method, headers });
      const response = await handler(request, env);
      const outgoing = Object.fromEntries(response.headers);
      if (url.pathname === '/health') outgoing['X-Release'] = env.RELEASE || 'unknown';
      res.writeHead(response.status, outgoing);
      if (req.method === 'HEAD') res.end();
      else res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      // Never log requests, signatures, upstream errors or private response data.
      res.end('{"error":"service_error"}');
    }
  };
}
