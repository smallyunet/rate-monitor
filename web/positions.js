import { productEarnTiers } from './earn-apr.js';
import { PLATFORMS, filterPlatform, updateContent, relativeTime } from './view-state.js';
// Check decimal strings without converting tiny balances to floating-point zero.
const positiveAmount = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
export function visiblePositions(section) {
  if (!['ok', 'partial'].includes(section.status)) return [];
  const records = section.rows.filter(row => ['amount', 'collateralAmount', 'debt', 'loan', 'interest'].some(key => positiveAmount(row[key])));
  return records;
}

// Account estimates describe the same holdings; never turn them into another position.
export function positionSummary(section) {
  return ['ok', 'partial'].includes(section.status) && positiveAmount(section.estimatedValue)
    ? section.estimatedValue : null;
}

export function positionKind(section) {
  return section.product === 'Flexible Loan' ? 'loan' : 'earn';
}

// All values use percentage points, as returned by Bitget (77.97 means 77.97%).
export function loanRisk(row) {
  const read = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
  const current = read(row.currentLtvPercent);
  const rawLiquidation = read(row.liquidationLtvPercent);
  const liquidation = rawLiquidation > 0 && rawLiquidation <= 100 ? rawLiquidation : null;
  const rawCall = read(row.marginCallLtvPercent);
  const call = rawCall > 0 && rawCall <= 100 && (liquidation === null || rawCall < liquidation) ? rawCall : null;
  const gap = current !== null && liquidation !== null ? liquidation - current : null;
  return { current, liquidation, call, gap,
    state: gap === null ? 'unknown' : gap <= 0 ? 'danger' : call === null ? 'unknown' : current >= call ? 'warning' : 'normal' };
}

export function earnProfitLines(row) {
  if (typeof row.interestAsset !== 'string' || !/^[A-Z0-9._-]{1,32}$/.test(row.interestAsset)) return [];
  return [['Earned: ', row.totalProfit]]
    .filter(([, value]) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))
    .map(([label, value]) => ({ label, value, asset: row.interestAsset }));
}

export function positionRate(row, section, rates) {
  if (Number.isFinite(row.positionRate) && row.positionRate >= 0) return { value: row.positionRate, label: row.positionRateLabel === 'APY' ? 'APY' : 'APR' };
  if (section.platform === 'OKX' && section.product === 'Flexible Earn') {
    const quotes = rates.filter(p => p.platform === 'OKX' && p.kind === 'earn' && p.asset === row.asset && p.status === 'ok');
    const amount = number(row.amount);
    if (quotes.length !== 1 || amount === null || amount <= 0 || !['ok', 'unavailable'].includes(quotes[0].bonusStatus)) return null;
    try {
      let annual = 0;
      for (const tier of productEarnTiers(quotes[0])) annual += Math.max(0, Math.min(amount, tier.to) - tier.from) * tier.apr;
      const value = annual / amount;
      if (!Number.isFinite(value)) return null;
      return { value, label: 'APR', estimated: true, assumesBonusEligibility: quotes[0].bonusStatus === 'ok' };
    } catch { return null; }
  }
  if (section.platform === 'Binance' && section.product === 'Flexible Loan') {
    const matches = rates.filter(p => p.status === 'ok' && p.kind === 'loan' && p.platform === section.platform && p.asset === row.asset && p.collateral === row.collateral && Number.isFinite(p.apr) && p.apr >= 0);
    if (matches.length === 1) return { value: matches[0].apr, label: 'APR' };
  }
  return null;
}

// Merge adjacent platform cells on desktop. Repeated cells remain available for mobile cards.
export function mergePlatformCells(body) {
  const rows = Array.from(body.children);
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && rows[end].dataset.platform === rows[start].dataset.platform) end++;
    const first = rows[start].children[0];
    first.rowSpan = end - start;
    first.setAttribute('aria-rowspan', String(end - start));
    first.classList.add('platform-group');
    rows[start].classList.add('platform-group-start');
    for (let i = start + 1; i < end; i++) rows[i].children[0].classList.add('platform-repeat');
    start = end;
  }
}

export function mountPositions({ el, logoLabel, platform = [...PLATFORMS] }) {
  const contents = Object.fromEntries(['loan', 'earn'].map(kind => [kind, document.querySelector(`[data-positions-content="${kind}"]`)]));
  const statuses = Object.fromEntries(['loan', 'earn'].map(kind => [kind, document.querySelector(`[data-position-status="${kind}"]`)]));
  const setStatus = text => Object.values(statuses).forEach(status => { status.textContent = text; });
  const signIn = document.querySelector('#sign-in');
  const signOut = document.querySelector('#sign-out');
  let controller, generation = 0, signingOut = false, refreshing = false, latestSections = null, latestRates = [];
  const quantity = (value, coin) => value == null ? '—' : `${value} ${coin}`;
  function clear() {
    latestSections = null;
    refreshing = false;
    document.querySelector('#positions').setAttribute('aria-busy', 'false');
    document.querySelector('#portfolio-summary').hidden = true;
    document.querySelector('#portfolio-content').replaceChildren();
    Object.values(contents).forEach(content => { content.replaceChildren(); content.hidden = true; });
    signOut.hidden = true; signIn.hidden = false;
  }
  function cell(row, label, value) {
    const td = el('td'); td.dataset.label = label; td.setAttribute('role', 'cell');
    if (['Position', 'Liquidation'].includes(label)) td.setAttribute('data-live-value', '');
    const wrapper = el('div', 'cell-value');
    wrapper.append(typeof value === 'string' ? document.createTextNode(value) : value);
    td.append(wrapper); row.append(td);
  }
  function amountLine(label, value, asset, secondary = false, apr = undefined) {
    const line = el('div', secondary ? 'secondary' : '');
    if (label) line.append(document.createTextNode(label));
    const group = el('span', apr !== undefined ? 'position-rate-value' : '');
    group.append(el('span', value == null ? '' : 'position-amount', quantity(value, asset)));
    line.append(group);
    if (apr !== undefined) {
      const text = apr ? `${apr.estimated ? 'Est. APR ' : apr.label === 'APY' ? 'APY ' : ''}${(apr.value * 100).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%` : '—';
      const badge = el('span', 'rate-badge position-apr', text);
      badge.title = apr?.estimated ? 'Estimated from market tiers and total balance; before fees, assumes funds are lent. Bonus eligibility is unverified.' : apr ? `Current ${apr.label}; tiered Earn is weighted by the held amount. Collateral receives the base rate.` : 'Current position rate unavailable';
      group.append(badge);
    }
    return line;
  }
  function riskView(row) {
    const risk = loanRisk(row);
    const format = value => value === null ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
    const view = el('div', `loan-risk ${risk.state}`);
    const headline = el('div', 'risk-headline');
    headline.append(el('span', 'position-amount', `LTV ${format(risk.current)}`), el('span', 'secondary', `Liq ${format(risk.liquidation)}`));
    view.append(headline);
    if (risk.gap !== null) {
      const bar = el('progress', 'risk-progress');
      bar.max = risk.liquidation; bar.value = Math.min(risk.current, risk.liquidation);
      bar.setAttribute('aria-label', `Current LTV ${format(risk.current)}, liquidation at ${format(risk.liquidation)}`);
      view.append(bar);
    }
    const gapText = risk.gap === null ? 'Gap —' : risk.gap <= 0 ? 'At liquidation threshold' : `Gap ${risk.gap.toLocaleString('en-US', { maximumFractionDigits: 2 })} pp`;
    const foot = el('div', 'secondary risk-caption', `${gapText} · Call ${format(risk.call)}`);
    foot.title = 'Gap = liquidation LTV minus current LTV (percentage points). Call = margin-call LTV.';
    view.append(foot);
    return view;
  }
  function renderGroup(target, sections, kind, options) {
    const content = el('div');
    const labels = ['Platform', 'Product', 'Assets', 'Position', ...(kind === 'loan' ? ['Liquidation'] : []), 'Updated'];
    const table = el('table'); table.setAttribute('aria-label', `${kind === 'loan' ? 'Loan' : 'Earn'} positions`); table.setAttribute('role', 'table');
    const head = el('thead'); const heading = el('tr');
    for (const name of labels) { const th = el('th', '', name); th.scope = 'col'; th.dataset.label = name; heading.append(th); }
    head.append(heading); table.append(head);
    const body = el('tbody'); table.append(body);
    const coverage = el('div', 'note');
    const failures = el('div', 'note error');
    for (const section of sections) {
      const successful = ['ok', 'partial'].includes(section.status);
      const records = visiblePositions(section);
      if (!successful) failures.append(el('div', '', `${section.platform} ${section.product}: ${section.status === 'not_configured' ? 'API key not configured' : `Unavailable · ${section.error || 'request failed'}${section.upstreamCode ? ` (${section.upstreamCode})` : ''}`}`));
      const occurrences = new Map();
      for (const r of records) {
        const row = el('tr'); row.setAttribute('role', 'row'); row.dataset.platform = section.platform;
        const identity = JSON.stringify([section.platform, section.product, r.product, r.asset, r.collateral]);
        const occurrence = occurrences.get(identity) || 0;
        occurrences.set(identity, occurrence + 1);
        row.dataset.key = `${identity}:${occurrence}`;
        cell(row, labels[0], logoLabel(section.platform));
        cell(row, labels[1], r.product || section.product);
        const assets = el('div', 'asset-pair');
        if (r.asset) {
          if (r.collateral) assets.append(logoLabel(r.collateral), el('span', 'arrow', '→'));
          assets.append(logoLabel(r.asset));
        } else assets.textContent = '—';
        cell(row, labels[2], assets);
        const details = el('div', 'position-values');
        const apr = positionRate(r, section, latestRates);
        if (r.collateral) {
          details.append(amountLine('Collateral: ', r.collateralAmount, r.collateral));
          details.append(amountLine(`${r.debt == null ? 'Loan' : 'Debt incl. interest'}: `, r.debt ?? r.loan, r.asset, false, apr));
          if (r.interest != null) details.append(amountLine('Interest: ', r.interest, r.asset, true));
        } else {
          details.append(amountLine('', r.amount, r.asset, false, apr));
          if (apr?.estimated) details.append(el('div', 'secondary', apr.assumesBonusEligibility
            ? 'Assumes bonus eligibility is valid · before fees'
            : 'Estimated from market tiers · before fees'));
          if (section.platform === 'OKX') {
            details.append(amountLine('Lent: ', r.lendingAmount, r.asset, true));
            details.append(amountLine('Pending lending: ', r.pendingAmount, r.asset, true));
          }
          if (positiveAmount(r.collateralAmount)) details.append(amountLine('Used as collateral: ', r.collateralAmount, r.asset, true));
          for (const profit of earnProfitLines(r)) details.append(amountLine(profit.label, profit.value, profit.asset, true));
        }
        cell(row, labels[3], details);
        if (kind === 'loan') cell(row, 'Liquidation', riskView(r));
        const updated = el('span', '', relativeTime(section.fetchedAt));
        if (section.fetchedAt) { updated.dataset.updatedAt = section.fetchedAt; updated.title = new Date(section.fetchedAt).toISOString(); }
        cell(row, 'Updated', updated); body.append(row);
      }
      if (section.status === 'partial' && !(section.platform === 'Bitget' && section.product === 'Savings')) coverage.append(el('div', '', `${section.platform} ${section.product}: ${section.coverage || 'Partial results'}`));
    }
    mergePlatformCells(body);
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    content.replaceChildren();
    if (body.childElementCount) content.append(wrap);
    else if (!failures.childElementCount && !coverage.childElementCount) content.append(el('p', 'note', !sections.length ? 'No products for this platform' : sections.some(section => section.status === 'partial') ? 'No position details' : 'No positions'));
    if (failures.childElementCount) content.append(failures);
    if (coverage.childElementCount) content.append(coverage);
    updateContent(target, content, options);
    target.hidden = false;
  }
  function renderPortfolio(sections, options) {
    const summary = portfolioSummary(sections, latestRates);
    const content = el('div');
    const money = value => value === null ? '—' : `≈ $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const percent = value => value === null ? '—' : `${(value * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    const pp = value => value === null ? '—' : `${(value * 100).toFixed(2)} pp`;
    const table = el('table', 'portfolio-table'); table.setAttribute('aria-label', 'Portfolio summary');
    const body = el('tbody'); table.append(body);
    const add = (label, value, detail) => {
      const row = el('tr');
      row.dataset.key = label;
      const name = el('th', '', label); name.scope = 'row';
      const amount = el('td', 'position-amount', value);
      const note = el('td', 'secondary', detail);
      amount.setAttribute('data-live-value', ''); note.setAttribute('data-live-value', '');
      row.append(name, amount, note); body.append(row);
    };
    add('Loan collateral', summary.collateral.map(([coin, amount]) => `${amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${coin}`).join(' + ') || '—', `${money(summary.collateralUsd)} · implied by LTV`);
    add('Outstanding debt', money(summary.debt), `Weighted APR ${percent(summary.borrowingApr)}`);
    add('Stablecoin Earn', money(summary.earn), `Weighted APR ${percent(summary.earningApr)}`);
    add('APR spread', pp(summary.spread), 'Earn APR − Loan APR');
    add('Est. net APR', percent(summary.netApr), 'Annual net income / Stablecoin Earn');
    add('Est. net income', money(summary.netAnnual === null ? null : summary.netAnnual / 365) + ' / day', `${money(summary.netAnnual === null ? null : summary.netAnnual / 12)} / month · ${money(summary.netAnnual)} / year`);
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    content.replaceChildren(wrap);
    if (sections.some(section => visiblePositions(section).some(row => positionRate(row, section, latestRates)?.assumesBonusEligibility))) {
      content.append(el('div', 'note', 'OKX estimates assume bonus eligibility is valid and funds are lent; before fees.'));
    }
    updateContent(document.querySelector('#portfolio-content'), content, options);
    document.querySelector('#portfolio-summary .status-badge').textContent = `Estimated · ${platform.length === PLATFORMS.length ? 'All platforms' : platform.join(' + ')}`;
    document.querySelector('#portfolio-summary').hidden = !platform.length;
  }
  function render(allSections, options) {
    latestSections = allSections;
    const sections = filterPlatform(allSections, platform);
    renderPortfolio(sections, options);
    for (const kind of ['loan', 'earn']) {
      const group = sections.filter(section => positionKind(section) === kind);
      renderGroup(contents[kind], group, kind, options);
      const ok = group.filter(section => ['ok', 'partial'].includes(section.status)).length;
      statuses[kind].textContent = refreshing ? 'Refreshing…' : group.length ? `${ok} / ${group.length}` : 'No products';
    }
  }
  async function load() {
    if (signingOut) return;
    controller?.abort(); controller = new AbortController();
    const current = ++generation;
    refreshing = true;
    document.querySelector('#positions').setAttribute('aria-busy', 'true'); setStatus(latestSections ? 'Refreshing…' : 'Loading…');
    try {
      const response = await fetch('/private/api/positions', { cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65000)]) });
      if (current !== generation) return;
      if (response.type === 'opaqueredirect' || [0, 401, 403].includes(response.status)) { clear(); setStatus(''); return; }
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error();
      const data = await response.json();
      if (current !== generation) return;
      if (!Array.isArray(data.sections) || data.sections.some(s => !Array.isArray(s.rows))) throw new Error();
      render(data.sections);
      signIn.hidden = true; signOut.hidden = false;
      return data.sections.every(section => section.status === 'ok');
    } catch (error) {
      if (current !== generation || error.name === 'AbortError') return;
      clear(); setStatus('Positions unavailable');
      return false;
    } finally {
      if (current === generation) {
        refreshing = false;
        if (latestSections) render(latestSections, { animate: false });
        document.querySelector('#positions').setAttribute('aria-busy', 'false');
      }
    }
  }
  signOut.addEventListener('click', async () => {
    signingOut = true; ++generation; controller?.abort(); clear(); setStatus('Signing out…'); signIn.hidden = true;
    try {
      const response = await fetch('/cdn-cgi/access/logout', { cache: 'no-store', redirect: 'manual' });
      if (response.status >= 400) throw new Error();
      setStatus('');
    } catch { setStatus('Sign out failed. Reload and try again.'); }
    finally { signingOut = false; signIn.hidden = false; }
  });
  window.addEventListener('pagehide', () => { ++generation; controller?.abort(); clear(); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  return { refresh: load, setRates(products) {
    latestRates = products;
    if (latestSections) render(latestSections);
  }, setPlatform(value) {
    platform = value;
    if (latestSections) render(latestSections, { animate: false });
  } };
}


const stable = asset => ['USDC', 'USDT'].includes(asset);
const number = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
// A snapshot estimate of visible positions, not account equity or realized P&L.
export function portfolioSummary(sections, rates) {
  const collateral = new Map();
  let debt = 0, earn = 0, collateralUsd = 0, annualCost = 0, annualIncome = 0;
  let loanPriced = true, earnPriced = true, valuation = true, supported = true;
  for (const section of sections) {
    for (const row of visiblePositions(section)) {
      const apr = positionRate(row, section, rates);
      if (positionKind(section) === 'loan') {
        const amount = number(row.collateralAmount);
        if (amount !== null) collateral.set(row.collateral, (collateral.get(row.collateral) || 0) + amount);
        const principal = number(row.debt ?? row.loan);
        const interest = row.debt != null ? 0 : number(row.interest);
        if (!stable(row.asset) || principal === null || interest === null) { supported = false; valuation = false; continue; }
        const balance = principal + interest;
        debt += balance;
        if (apr?.label === 'APR') annualCost += balance * apr.value;
        else loanPriced = false;
        const ltv = number(row.currentLtvPercent);
        if (ltv > 0 && amount > 0) collateralUsd += balance / (ltv / 100);
        else valuation = false;
      } else {
        const amount = number(row.amount);
        // Collateral is already counted by the loans; do not add it to Earn principal.
        if (amount === null) { supported = false; continue; }
        if (!stable(row.asset)) { if (amount > 0) supported = false; continue; }
        earn += amount;
        if (amount === 0) continue;
        if (apr?.label === 'APR') annualIncome += amount * apr.value;
        else earnPriced = false;
      }
    }
  }
  const loanAvailable = sections.some(s => positionKind(s) === 'loan' && ['ok', 'partial'].includes(s.status));
  const earnAvailable = sections.some(s => positionKind(s) === 'earn' && ['ok', 'partial'].includes(s.status));
  const sourceFailure = sections.some(s => !['ok', 'partial'].includes(s.status));
  const borrowingApr = loanPriced && supported && debt > 0 ? annualCost / debt : null;
  const earningApr = earnPriced && supported && earn > 0 ? annualIncome / earn : null;
  const netAnnual = loanAvailable && earnAvailable && !sourceFailure && loanPriced && earnPriced && supported ? annualIncome - annualCost : null;
  return { collateral: [...collateral], collateralUsd: loanAvailable && valuation && supported ? collateralUsd : null,
    debt: loanAvailable ? debt : null, earn: earnAvailable ? earn : null, borrowingApr, earningApr, spread: earningApr !== null && borrowingApr !== null ? earningApr - borrowingApr : null,
    netAnnual, netApr: netAnnual !== null && earn > 0 ? netAnnual / earn : null,
    partial: sections.some(s => s.status !== 'ok'), supported };
}
