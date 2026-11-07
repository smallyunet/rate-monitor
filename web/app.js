const ENDPOINT = 'https://rate-monitor-api.smallyu.workers.dev/api/rates';
const descriptors = [
  { id:'binance-loan-usdc', kind:'loan', asset:'USDC', name:'Flexible Loan', collateral:'BTC' },
  { id:'binance-earn-usdc', kind:'earn', asset:'USDC', name:'Simple Earn · Flexible' },
  { id:'binance-earn-usdt', kind:'earn', asset:'USDT', name:'Simple Earn · Flexible' },
];
const errors = {missing_credentials:'等待配置密钥',invalid_data:'返回数据格式异常',unavailable:'产品暂不可用',ambiguous_product:'存在多个产品，待确认',network_error:'平台连接失败',upstream_error:'平台接口暂不可用',region_restricted:'平台限制当前服务地区',rate_limited:'平台请求限流，请稍后刷新',clock_error:'签名时间与平台不一致',credentials_error:'密钥、签名或权限校验失败',service_error:'利率服务暂不可用'};
const percent = value => typeof value === 'number' && Number.isFinite(value) ? (value * 100).toLocaleString('en-US',{maximumFractionDigits:4,minimumFractionDigits:2}) : '—';
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '—';
const el = (tag, cls, text) => { const node = document.createElement(tag); if(cls) node.className = cls; if(text !== undefined) node.textContent = text; return node; };
function detail(parent,text,strong=false) { parent.append(el(strong?'strong':'div','',text)); }
function render(products) {
  const cards = document.querySelector('#cards'); cards.replaceChildren();
  document.querySelector('#config').hidden = !products.some(p => p.status === 'not_configured');
  for (const p of products) {
    const card = el('article',`card ${p.kind === 'loan' ? 'loan' : ''} ${p.asset.toLowerCase()}`);
    const top = el('div','card-top'); const coin=el('div','coin'); coin.append(el('span','coin-icon',p.kind==='loan'?'↗':p.asset==='USDT'?'₮':'$'),el('span','',p.asset));
    top.append(coin,el('span','badge',p.kind==='loan'?'借款成本':'活期收益')); card.append(top,el('div','product-name',p.kind==='loan'?'Flexible Loan · BTC 抵押':p.name));
    const apr=el('div','apr',p.status==='ok'?percent(p.apr):'—'); if(p.status==='ok' && p.apr !== null) apr.append(el('small','','%'));
    card.append(apr,el('div','apr-label',p.kind==='loan'?'最新公布年化参考 · 非当前报价换算':'基础实时 APR / 年化'));
    const info=el('div','detail');
    if(p.status!=='ok') detail(info,errors[p.error] || '正在查询平台…');
    else if(p.kind==='loan') {
      detail(info,`当前原始利率：${p.rawRate}（单位待核实）`);
      detail(info,`年化记录时间：${time(p.rateTime)}`);
      if(!p.rateTime) detail(info,'最近一小时无年化记录，参考 APR 暂缺');
      detail(info,`BTC 抵押：${p.collateralEligible?'支持':'接口未返回可用资格'}`);
      if(p.initialLtv!==null) detail(info,`初始 LTV ${percent(p.initialLtv)}% · 清算 LTV ${percent(p.liquidationLtv)}%`);
    } else {
      if(p.tiers?.length) { detail(info,'额外阶梯 APR（仅适用额度内）',true); for(const tier of p.tiers) detail(info,`${tier.range}：+${percent(tier.bonusApr)}%`); }
      else detail(info,'当前无额外阶梯加息');
      detail(info,p.soldOut===true?'当前已售罄':p.canPurchase===true?'当前可申购':p.canPurchase===false?'当前不可申购':'申购状态未知');
    }
    card.append(info); const foot=el('div','card-foot'); foot.append(el('span',p.status==='error'?'state-error':'',p.status==='ok'?'● 查询成功':p.status==='error'?'● 查询失败':p.status==='not_configured'?'○ 未配置':'○ 查询中'),el('span','',p.fetchedAt?time(p.fetchedAt):'暂无有效数据'));card.append(foot);cards.append(card);
  }
  const bars = document.querySelector('#bars'); bars.replaceChildren();
  const valid = products.filter(p => p.status==='ok' && typeof p.apr==='number' && Number.isFinite(p.apr));
  if(!valid.length) {bars.append(el('span','','数据就绪后展示年化对照'));return;}
  const max=Math.max(...valid.map(p=>p.apr),0.01);
  for(const p of valid) {
    const row=el('div','bar-row'); const label=el('div','bar-label'); label.append(el('span','',`${p.asset} ${p.kind==='loan'?'Loan · 公布参考':'Earn · 基础实时'}`),el('span','',`${percent(p.apr)}%`));
    const track=el('div','bar-track'); const fill=el('div','bar-fill'); fill.style.width=`${Math.min(100,p.apr/max*100)}%`;track.append(fill);row.append(label,track);bars.append(row);
  }
}
async function refresh() {
  const button=document.querySelector('#refresh');button.disabled=true;document.body.classList.add('loading');document.querySelector('#cards').setAttribute('aria-busy','true');
  document.querySelector('#status').textContent='正在查询 Binance…';
  // Clear the previous quote so a failed refresh cannot masquerade as a live rate.
  render(descriptors.map(p=>({...p,status:'loading',apr:null})));
  try {
    const response=await fetch(ENDPOINT,{cache:'no-store',signal:AbortSignal.timeout(65000)});
    if(!response.ok) throw new Error('service_error');
    const data=await response.json();
    if(!Array.isArray(data.products)) throw new Error('service_error');
    const products=descriptors.map(d=>{const p=data.products.find(p=>p.id===d.id);return p?{...p,...d}:{...d,status:'error',apr:null,error:'invalid_data'};});
    render(products);
    const ok=products.filter(p=>p.status==='ok').length;
    document.querySelector('#status').textContent=products.every(p=>p.status==='not_configured')?'服务已连接 · 等待 Binance 密钥':`${ok} / 3 项查询成功${ok<3?' · 部分数据不可用':''}`;
    document.querySelector('#updated').textContent=`本次请求 ${time(data.requestedAt)} · 无后台采样`;
  } catch {
    render(descriptors.map(p=>({...p,status:'error',apr:null,error:'service_error'})));
    document.querySelector('#status').textContent='连接失败 · 请稍后重试';
    document.querySelector('#updated').textContent=`尝试时间 ${time(new Date().toISOString())}`;
  } finally {button.disabled=false;document.body.classList.remove('loading');document.querySelector('#cards').setAttribute('aria-busy','false');}
}
document.querySelector('#refresh').addEventListener('click',refresh);
refresh();
