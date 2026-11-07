export const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>My Positions · Rate Monitor</title><link rel="stylesheet" href="/private/style.css"><script type="module" src="/private/app.js"></script></head><body><main><header><h1>My Positions</h1><nav><a href="https://smallyunet.github.io/rate-monitor/">Rates</a><button id="refresh">Refresh</button><a href="/cdn-cgi/access/logout">Sign out</a></nav></header><div id="status" role="status">Loading…</div><div id="sections"></div><p class="note">Collateral and Earn may overlap. Balances are not added together.</p></main></body></html>`;
export const style = `*{box-sizing:border-box}body{font:14px system-ui,sans-serif;color:#252b32;background:#fff;margin:0}main{max-width:1100px;padding:28px 20px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:20px}nav{display:flex;gap:16px;align-items:center}a{color:#2469d8;text-decoration:none}button{font:inherit;padding:7px 12px;border:1px solid #d1d9e2;border-radius:4px;background:#f7f8fa;cursor:pointer}button:disabled{opacity:.6}#status,.note{color:#68717d;font-size:13px;margin:12px 0}section{margin:24px 0}h2{font-size:15px;margin:0 0 10px;display:flex;gap:8px;align-items:center}.badge{font-size:12px;font-weight:400;color:#68717d}table{width:100%;border-collapse:collapse}th,td{padding:11px 12px;text-align:left;border-bottom:1px solid #dde2e8;font-variant-numeric:tabular-nums}th{background:#f6f7f9;font-size:12px;color:#68717d}small{display:block;color:#68717d;font-size:12px;margin-top:4px}.empty{padding:12px;background:#f6f7f9;color:#68717d}.error{color:#a2332c}@media(max-width:600px){main{padding:16px 12px}h1{font-size:17px}nav{gap:10px;font-size:12px}th,td{padding:9px 5px;font-size:12px}section{margin:20px 0}.table-wrap{overflow-x:auto}header{flex-wrap:wrap}}`;
export const script = `
const sections = document.querySelector('#sections');
const status = document.querySelector('#status');
const refresh = document.querySelector('#refresh');
let data;
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const quantity = (value, coin) => value == null ? '—' : esc(value) + ' ' + esc(coin);
function age(value) { const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value))/1000)); return seconds < 60 ? seconds+'s ago' : seconds < 3600 ? Math.floor(seconds/60)+'m ago' : Math.floor(seconds/3600)+'h ago'; }
function render() {
  sections.innerHTML = data.sections.map(s => {
    const isLoan = s.product.includes('Loan');
    const state = s.status === 'ok' ? (s.rows.length ? '' : 'No positions') : s.status === 'partial' ? 'Partial results' : s.status === 'not_configured' ? 'API key not configured' : 'Unavailable · ' + (s.error || 'request failed');
    const rows = s.rows.map(r => isLoan ? '<tr><td>'+quantity(r.collateralAmount,r.collateral)+'</td><td>'+quantity(r.debt ?? r.loan,r.asset)+(r.debt == null ? '<small>Loan amount</small>' : '<small>Includes interest</small>')+'</td><td>'+quantity(r.interest,r.asset)+'</td></tr>' : '<tr><td>'+esc(r.asset)+'</td><td>'+esc(r.amount)+'</td><td>'+quantity(r.collateralAmount,r.asset)+'</td></tr>').join('');
    return '<section><h2>'+esc(s.platform)+' · '+esc(s.product)+' <span class="badge" data-time="'+esc(s.fetchedAt || '')+'">'+(s.fetchedAt ? age(s.fetchedAt) : '')+'</span></h2>'+(state ? '<div class="empty '+(s.status === 'error' ? 'error' : '')+'">'+esc(state)+'</div>' : '')+(rows ? '<div class="table-wrap"><table><thead><tr>'+(isLoan ? '<th>Collateral</th><th>Debt / Loan</th><th>Interest</th>' : '<th>Asset</th><th>Balance</th><th>Used as collateral</th>')+'</tr></thead><tbody>'+rows+'</tbody></table></div>' : '')+'</section>';
  }).join('');
}
async function load() {
  refresh.disabled = true; status.textContent = 'Loading…';
  try {
    const response = await fetch('/private/api/positions', { cache:'no-store', redirect:'error' });
    if (response.status === 401) throw new Error('Session expired. Reload to sign in.');
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Unable to load positions. Reload to sign in.');
    data = await response.json(); render(); status.textContent = data.sections.filter(s=>s.status==='ok').length+' / '+data.sections.length;
  } catch (error) { status.textContent = error.message; if(data) status.textContent += ' Previous values retained.'; }
  finally { refresh.disabled = false; }
}
refresh.addEventListener('click',load);
setInterval(()=>document.querySelectorAll('[data-time]').forEach(el=>{if(el.dataset.time) el.textContent=age(el.dataset.time);}),1000);
// Remove account values when navigating away, including pages stored in the back/forward cache.
window.addEventListener('pagehide',()=>{data=null;sections.replaceChildren();});
window.addEventListener('pageshow',event=>{if(event.persisted)load();});
load();
`;
