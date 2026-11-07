export function mountPositions({ el, logoLabel, onAccountChange }) {
  const content = document.querySelector('#positions-content');
  const status = document.querySelector('#positions-status');
  const refresh = document.querySelector('#positions-refresh');
  const signIn = document.querySelector('#sign-in');
  const signOut = document.querySelector('#sign-out');
  let controller, generation = 0, signingOut = false;
  const labels = ['Platform', 'Product', 'Assets', 'Position', 'Updated'];
  const quantity = (value, coin) => value == null ? '—' : `${value} ${coin}`;
  function clear(forgetManual = false) {
    content.replaceChildren(); content.hidden = true;
    refresh.hidden = true; signOut.hidden = true; signIn.hidden = false;
    onAccountChange(null, forgetManual);
  }
  function cell(row, label, value) {
    const td = el('td'); td.dataset.label = label; td.setAttribute('role', 'cell');
    const wrapper = el('div', 'cell-value');
    wrapper.append(typeof value === 'string' ? document.createTextNode(value) : value);
    td.append(wrapper); row.append(td);
  }
  function render(sections) {
    const table = el('table'); table.setAttribute('aria-label', 'My positions'); table.setAttribute('role', 'table');
    const head = el('thead'); const heading = el('tr');
    for (const name of labels) { const th = el('th', '', name); th.scope = 'col'; heading.append(th); }
    head.append(heading); table.append(head);
    const body = el('tbody'); table.append(body);
    const coverage = el('div', 'note');
    for (const section of sections) {
      const successful = ['ok', 'partial'].includes(section.status);
      const records = successful ? [...section.rows] : [];
      if (successful && section.estimatedValue !== undefined) records.unshift({ estimate: section.estimatedValue });
      if (!records.length) records.push({ empty: true });
      for (const r of records) {
        const row = el('tr'); row.setAttribute('role', 'row');
        cell(row, labels[0], logoLabel(section.platform));
        cell(row, labels[1], r.product || section.product);
        const assets = el('div', 'asset-pair');
        if (r.estimate !== undefined) assets.textContent = 'USDT equivalent';
        else if (r.asset) {
          if (r.collateral) assets.append(logoLabel(r.collateral), el('span', 'arrow', '→'));
          assets.append(logoLabel(r.asset));
        } else assets.textContent = '—';
        cell(row, labels[2], assets);
        const details = el('div', 'position-values');
        if (r.estimate !== undefined) details.append(el('div', '', `≈ ${r.estimate} USDT`), el('small', 'secondary', 'Savings value · all subscriptions'));
        else if (r.empty) {
          details.textContent = successful ? (section.status === 'partial' ? 'No rows in covered range' : 'No positions') : section.status === 'not_configured' ? 'API key not configured' : `Unavailable · ${section.error || 'request failed'}${section.upstreamCode ? ` (${section.upstreamCode})` : ''}`;
          if (!successful) details.classList.add('error');
        } else if (r.collateral) {
          details.append(el('div', '', `Collateral: ${quantity(r.collateralAmount, r.collateral)}`));
          details.append(el('div', '', `${r.debt == null ? 'Loan' : 'Debt incl. interest'}: ${quantity(r.debt ?? r.loan, r.asset)}`));
          if (r.interest != null) details.append(el('div', 'secondary', `Interest: ${quantity(r.interest, r.asset)}`));
        } else {
          details.append(el('div', '', quantity(r.amount, r.asset)));
          if (r.collateralAmount != null) details.append(el('div', 'secondary', `Used as collateral: ${quantity(r.collateralAmount, r.asset)}`));
        }
        cell(row, labels[3], details);
        const updated = el('span', '', '—');
        if (section.fetchedAt) { updated.dataset.updatedAt = section.fetchedAt; updated.title = new Date(section.fetchedAt).toISOString(); }
        cell(row, labels[4], updated); body.append(row);
      }
      if (section.status === 'partial') coverage.append(el('div', '', `${section.platform} ${section.product}: ${section.coverage || 'Partial results'}`));
    }
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    content.replaceChildren(wrap, coverage, el('p', 'note', 'Collateral and Earn may overlap. Balances are not added together.'));
    content.hidden = false;
  }
  async function load() {
    if (signingOut) return;
    controller?.abort(); controller = new AbortController();
    const current = ++generation;
    refresh.disabled = true; status.textContent = 'Loading…';
    try {
      const response = await fetch('/private/api/positions', { cache: 'no-store', redirect: 'manual', signal: controller.signal });
      if (current !== generation) return;
      if (response.type === 'opaqueredirect' || [0, 401, 403].includes(response.status)) { clear(); status.textContent = ''; return; }
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error();
      const data = await response.json();
      if (current !== generation) return;
      if (!Array.isArray(data.sections) || data.sections.some(s => !Array.isArray(s.rows))) throw new Error();
      render(data.sections);
      signIn.hidden = true; signOut.hidden = false; refresh.hidden = false;
      const ok = data.sections.filter(s => ['ok', 'partial'].includes(s.status)).length;
      status.textContent = `${ok} / ${data.sections.length}`;
      onAccountChange(data.sections);
    } catch (error) {
      if (current !== generation || error.name === 'AbortError') return;
      clear(); status.textContent = 'Positions unavailable';
    } finally { if (current === generation) refresh.disabled = false; }
  }
  refresh.addEventListener('click', load);
  signOut.addEventListener('click', async () => {
    signingOut = true; ++generation; controller?.abort(); clear(true); status.textContent = 'Signing out…'; signIn.hidden = true;
    try {
      const response = await fetch('/cdn-cgi/access/logout', { cache: 'no-store', redirect: 'manual' });
      if (response.status >= 400) throw new Error();
      status.textContent = '';
    } catch { status.textContent = 'Sign out failed. Reload and try again.'; }
    finally { signingOut = false; signIn.hidden = false; }
  });
  window.addEventListener('pagehide', () => { ++generation; controller?.abort(); clear(true); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  load();
}
