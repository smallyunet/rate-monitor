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

export function mountPositions({ el, logoLabel }) {
  const contents = Object.fromEntries(['loan', 'earn'].map(kind => [kind, document.querySelector(`[data-positions-content="${kind}"]`)]));
  const statuses = Object.fromEntries(['loan', 'earn'].map(kind => [kind, document.querySelector(`[data-position-status="${kind}"]`)]));
  const refreshes = Array.from(document.querySelectorAll('[data-positions-refresh]'));
  const setStatus = text => Object.values(statuses).forEach(status => { status.textContent = text; });
  const setRefreshing = disabled => refreshes.forEach(button => { button.disabled = disabled; });
  const signIn = document.querySelector('#sign-in');
  const signOut = document.querySelector('#sign-out');
  let controller, generation = 0, signingOut = false;
  const labels = ['Platform', 'Product', 'Assets', 'Position', 'Updated'];
  const quantity = (value, coin) => value == null ? '—' : `${value} ${coin}`;
  function clear() {
    Object.values(contents).forEach(content => { content.replaceChildren(); content.hidden = true; });
    refreshes.forEach(button => { button.hidden = true; }); signOut.hidden = true; signIn.hidden = false;
  }
  function cell(row, label, value) {
    const td = el('td'); td.dataset.label = label; td.setAttribute('role', 'cell');
    const wrapper = el('div', 'cell-value');
    wrapper.append(typeof value === 'string' ? document.createTextNode(value) : value);
    td.append(wrapper); row.append(td);
  }
  function amountLine(label, value, asset, secondary = false) {
    const line = el('div', secondary ? 'secondary' : '');
    if (label) line.append(document.createTextNode(label));
    line.append(el('span', value == null ? '' : 'position-amount', quantity(value, asset)));
    return line;
  }
  function renderGroup(content, sections, kind) {
    const table = el('table'); table.setAttribute('aria-label', `${kind === 'loan' ? 'Loan' : 'Earn'} positions`); table.setAttribute('role', 'table');
    const head = el('thead'); const heading = el('tr');
    for (const name of labels) { const th = el('th', '', name); th.scope = 'col'; heading.append(th); }
    head.append(heading); table.append(head);
    const body = el('tbody'); table.append(body);
    const summaries = [];
    const coverage = el('div', 'note');
    const failures = el('div', 'note error');
    for (const section of sections) {
      const successful = ['ok', 'partial'].includes(section.status);
      const records = visiblePositions(section);
      const total = positionSummary(section);
      if (total !== null) {
        const summary = el('div', 'position-summary');
        summary.append(el('span', 'position-summary-label', `${section.platform} ${section.product} · Total value`),
          el('span', 'position-amount', `≈ ${total} USDT`));
        summaries.push(summary);
      }
      if (!successful) failures.append(el('div', '', `${section.platform} ${section.product}: ${section.status === 'not_configured' ? 'API key not configured' : `Unavailable · ${section.error || 'request failed'}${section.upstreamCode ? ` (${section.upstreamCode})` : ''}`}`));
      for (const r of records) {
        const row = el('tr'); row.setAttribute('role', 'row'); row.dataset.platform = section.platform;
        cell(row, labels[0], logoLabel(section.platform));
        cell(row, labels[1], r.product || section.product);
        const assets = el('div', 'asset-pair');
        if (r.asset) {
          if (r.collateral) assets.append(logoLabel(r.collateral), el('span', 'arrow', '→'));
          assets.append(logoLabel(r.asset));
        } else assets.textContent = '—';
        cell(row, labels[2], assets);
        const details = el('div', 'position-values');
        if (r.collateral) {
          details.append(amountLine('Collateral: ', r.collateralAmount, r.collateral));
          details.append(amountLine(`${r.debt == null ? 'Loan' : 'Debt incl. interest'}: `, r.debt ?? r.loan, r.asset));
          if (r.interest != null) details.append(amountLine('Interest: ', r.interest, r.asset, true));
        } else {
          details.append(amountLine('', r.amount, r.asset));
          if (r.collateralAmount != null) details.append(amountLine('Used as collateral: ', r.collateralAmount, r.asset, true));
        }
        cell(row, labels[3], details);
        const updated = el('span', '', '—');
        if (section.fetchedAt) { updated.dataset.updatedAt = section.fetchedAt; updated.title = new Date(section.fetchedAt).toISOString(); }
        cell(row, labels[4], updated); body.append(row);
      }
      if (section.status === 'partial' && (records.length || total !== null || section.estimatedValue === undefined)) coverage.append(el('div', '', `${section.platform} ${section.product}: ${section.coverage || 'Partial results'}`));
    }
    mergePlatformCells(body);
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    content.replaceChildren();
    if (body.childElementCount) content.append(wrap);
    else if (!summaries.length && !failures.childElementCount && !coverage.childElementCount) content.append(el('p', 'note', 'No positions'));
    content.append(...summaries);
    if (failures.childElementCount) content.append(failures);
    if (coverage.childElementCount) content.append(coverage);
    content.hidden = false;
  }
  function render(sections) {
    for (const kind of ['loan', 'earn']) {
      const group = sections.filter(section => positionKind(section) === kind);
      renderGroup(contents[kind], group, kind);
      const ok = group.filter(section => ['ok', 'partial'].includes(section.status)).length;
      statuses[kind].textContent = `${ok} / ${group.length}`;
    }
  }
  async function load() {
    if (signingOut) return;
    controller?.abort(); controller = new AbortController();
    const current = ++generation;
    setRefreshing(true); setStatus('Loading…');
    try {
      const response = await fetch('/private/api/positions', { cache: 'no-store', redirect: 'manual', signal: controller.signal });
      if (current !== generation) return;
      if (response.type === 'opaqueredirect' || [0, 401, 403].includes(response.status)) { clear(); setStatus(''); return; }
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error();
      const data = await response.json();
      if (current !== generation) return;
      if (!Array.isArray(data.sections) || data.sections.some(s => !Array.isArray(s.rows))) throw new Error();
      render(data.sections);
      signIn.hidden = true; signOut.hidden = false; refreshes.forEach(button => { button.hidden = false; });
    } catch (error) {
      if (current !== generation || error.name === 'AbortError') return;
      clear(); setStatus('Positions unavailable');
    } finally { if (current === generation) setRefreshing(false); }
  }
  refreshes.forEach(button => button.addEventListener('click', load));
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
  load();
}
