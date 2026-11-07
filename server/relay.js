import http from 'node:http';
import { verifyPositionsIdentity } from '../worker/access-auth.js';
const allowed = new Set(['/api/v3/loan/borrow-ongoing', '/api/v3/earn/savings/account', '/api/v3/earn/savings/assets']);
const credentialNames = ['ACCESS-KEY','ACCESS-SIGN','ACCESS-TIMESTAMP','ACCESS-PASSPHRASE'];
let recent = [];
export async function relay(request, env = process.env, fetcher = fetch) {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  const fail = (status, error) => new Response(JSON.stringify({error}), {status,headers});
  const url = new URL(request.url);
  if (request.method !== 'GET' || !allowed.has(url.pathname)) return fail(404,'not_found');
  if (url.pathname === '/api/v3/earn/savings/assets') {
    const params = url.searchParams;
    if (!['flexible','fixed'].includes(params.get('periodType')) || params.get('limit') !== '100' ||
        [...params.keys()].some(k => !['periodType','limit','cursor'].includes(k)) ||
        [...params.keys()].some(k => params.getAll(k).length !== 1) ||
        (params.has('cursor') && !/^\d{1,40}$/.test(params.get('cursor')))) return fail(400,'invalid_query');
  } else if (url.search) return fail(404,'not_found');
  try { await verifyPositionsIdentity(request, env, fetcher); } catch { return fail(401,'unauthorized'); }
  const now=Date.now();
  recent=recent.filter(t=>now-t<10000);
  if(recent.length>=60) return fail(429,'rate_limited');
  recent.push(now);
  const upstreamHeaders={locale:'en-US'};
  for(const name of credentialNames){
    const value=request.headers.get(name);
    if(!value || value.length>512 || /[\r\n]/.test(value)) return fail(400,'invalid_headers');
    upstreamHeaders[name]=value;
  }
  if(!/^\d{13}$/.test(upstreamHeaders['ACCESS-TIMESTAMP']) || Math.abs(now-Number(upstreamHeaders['ACCESS-TIMESTAMP']))>30000) return fail(400,'expired_request');
  try {
    const result=await fetcher('https://api.bitget.com'+url.pathname+url.search,{headers:upstreamHeaders,signal:AbortSignal.timeout(12000),redirect:'manual'});
    // Never follow a redirect carrying exchange credentials or the user's JWT.
    if(result.status>=300 && result.status<400) {await result.body?.cancel();return fail(502,'upstream_redirect');}
    if(!result.headers.get('Content-Type')?.includes('application/json')) {await result.body?.cancel();return fail(502,'upstream_error');}
    const reader=result.body?.getReader();const chunks=[];let size=0;
    if(!reader)return fail(502,'upstream_error');
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();return fail(502,'response_too_large');}chunks.push(value);}
    return new Response(new Blob(chunks),{status:result.status,headers});
  }catch{return fail(502,'upstream_error');}
}
if (process.env.RELAY_LISTEN === '1') {
  const server=http.createServer(async(req,res)=>{
    try{
      const response=await relay(new Request('http://relay'+req.url,{method:req.method,headers:req.headers}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(500,{'Cache-Control':'no-store'});res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=30;
  server.listen(8788,'0.0.0.0',()=>console.log('Rate Monitor read-only relay listening'));
}
