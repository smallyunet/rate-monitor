import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { PLATFORMS, PLATFORM_STORAGE_KEY, readPlatform, savePlatform, filterPlatform, updateContent } from '../web/view-state.js';

test('platform preference survives reload and tolerates invalid or blocked storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(readPlatform(storage), PLATFORMS);
  savePlatform(storage, ['Binance', 'OKX']);
  assert.deepEqual(JSON.parse(values.get(PLATFORM_STORAGE_KEY)), ['Binance', 'OKX']);
  assert.deepEqual(readPlatform(storage), ['Binance', 'OKX']);
  values.set(PLATFORM_STORAGE_KEY, 'OKX');
  assert.deepEqual(readPlatform(storage), ['OKX']);
  values.set(PLATFORM_STORAGE_KEY, 'all');
  assert.deepEqual(readPlatform(storage), PLATFORMS);
  savePlatform(storage, []);
  assert.deepEqual(readPlatform(storage), []);
  savePlatform(storage, ['OKX', 'OKX', 'Binance']);
  assert.deepEqual(readPlatform(storage), ['Binance', 'OKX']);
  values.set(PLATFORM_STORAGE_KEY, '<invalid>');
  assert.deepEqual(readPlatform(storage), PLATFORMS);
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.deepEqual(readPlatform(blocked), PLATFORMS);
  assert.doesNotThrow(() => savePlatform(blocked, ['Bitget']));
  const items = [{ platform: 'Binance' }, { platform: 'OKX' }];
  assert.deepEqual(filterPlatform(items, ['OKX']), [items[1]]);
  assert.deepEqual(filterPlatform(items, PLATFORMS), items);
  assert.deepEqual(filterPlatform(items, []), []);
});

test('in-place updates retain keyed rows, scroll containers and only highlight changed values', t => {
  const { document } = parseHTML('<html></html>');
  const content = html => { const node = document.createElement('div'); node.innerHTML = html; return node; };
  const target = content('<div class="table-wrap"><table><tbody><tr data-key="a"><td data-live-value>1%</td></tr><tr data-key="b"><td data-live-value>2%</td></tr></tbody></table></div>');
  const wrap = target.firstChild;
  wrap.scrollLeft = 95;
  const a = target.querySelector('[data-key="a"]'), b = target.querySelector('[data-key="b"]');
  const animations = [];
  a.firstChild.animate = () => animations.push('a');
  b.firstChild.animate = () => animations.push('b');
  updateContent(target, content('<div class="table-wrap"><table><tbody><tr data-key="b"><td data-live-value>2%</td></tr><tr data-key="a"><td data-live-value>3%</td></tr></tbody></table></div>'));
  assert.equal(target.firstChild, wrap);
  assert.equal(wrap.scrollLeft, 95);
  assert.equal(target.querySelector('tr'), b);
  assert.equal(target.querySelector('[data-key="a"]'), a);
  assert.equal(a.textContent, '3%');
  assert.deepEqual(animations, ['a']);
  const originalMatchMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  t.after(() => originalMatchMedia ? Object.defineProperty(globalThis, 'matchMedia', originalMatchMedia) : delete globalThis.matchMedia);
  updateContent(target, content('<div class="table-wrap"><table><tbody><tr data-key="b"><td data-live-value>2%</td></tr><tr data-key="a"><td data-live-value>5%</td></tr></tbody></table></div>'));
  assert.equal(a.textContent, '5%');
  assert.deepEqual(animations, ['a'], 'reduced motion updates data without animation');
  updateContent(target, content('<p>Unavailable</p>'));
  assert.equal(target.textContent, 'Unavailable');
  assert.equal(target.querySelector('table'), null);
});

test('dashboard refresh retains data until completion, filters every panel and clears failed private data', async t => {
  const { window, document } = parseHTML(await readFile('web/index.html', 'utf8'));
  const filter = document.querySelector('#platform-filter');
  const options = [...document.querySelectorAll('input[name="platform"]')];
  const selectPlatforms = platforms => {
    for (const option of options) option.checked = platforms.includes(option.value);
    options[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const stored = new Map([[PLATFORM_STORAGE_KEY, 'OKX']]);
  const globals = ['window', 'document', 'localStorage'];
  const original = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const [key, value] of Object.entries({ window, document, localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  t.after(() => globals.forEach((key, i) => original[i] ? Object.defineProperty(globalThis, key, original[i]) : delete globalThis[key]));
  t.mock.method(globalThis, 'setInterval', () => 0);
  const pending = [], calls = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    calls.push({ url, options });
    return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const waitFor = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'UI should settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const products = apr => ['Binance', 'Bitget', 'OKX'].flatMap(platform => ['loan', 'earn'].flatMap(kind => ['USDC', 'USDT'].map(asset => ({
    id: `${platform.toLowerCase()}-${kind}-${asset.toLowerCase()}`, platform, kind, asset, status: 'ok', apr, tiers: [],
    bonusStatus: 'unavailable', fetchedAt: new Date().toISOString(),
  }))));
  const sections = amount => ['Binance', 'Bitget', 'OKX'].map(platform => ({ platform, product: 'Flexible Earn', status: 'ok',
    fetchedAt: new Date().toISOString(), rows: [{ asset: 'USDC', amount: String(platform === 'OKX' ? amount : 999), positionRate: .05 }] }));
  const resolveRates = data => pending.splice(pending.findIndex(p => p.url === '/api/rates'), 1)[0].resolve(Response.json({ products: data, requestedAt: new Date().toISOString() }));
  const resolvePositions = data => pending.splice(pending.findIndex(p => ['/device/api/positions', '/private/api/positions'].includes(p.url)), 1)[0].resolve(Response.json({ sections: data }));
  await import(`../web/app.js?dashboard-test=${Date.now()}`);
  const button = document.querySelector('#refresh');
  assert.deepEqual(options.filter(n => n.checked).map(n => n.value), ['OKX']);
  assert.equal(document.querySelectorAll('#loan-rows tr').length, 2);
  resolveRates(products(.03)); resolvePositions(sections(100));
  await waitFor(() => !button.disabled);
  assert.equal(button.dataset.state, 'done');
  assert.match(document.querySelector('#portfolio-content').textContent, /100\.00/);
  assert.doesNotMatch(document.querySelector('#portfolio-content').textContent, /999/);
  const row = document.querySelector('#loan-rows tr');
  const wrap = document.querySelector('[data-positions-content="earn"] .table-wrap');
  wrap.scrollLeft = 80;
  button.click();
  assert.equal(button.disabled, true);
  assert.match(row.textContent, /3\.00%/);
  assert.match(document.querySelector('[data-positions-content="earn"]').textContent, /100 USDC/);
  assert.equal(document.querySelector('[data-position-status="earn"]').textContent, 'Refreshing…');
  button.click();
  assert.equal(pending.length, 2, 'duplicate refresh is ignored');
  resolveRates(products(.04));
  await settle();
  assert.equal(document.querySelector('#loan-rows tr'), row);
  assert.match(row.textContent, /4\.00%/);
  assert.equal(document.querySelector('[data-position-status="earn"]').textContent, 'Refreshing…', 'rate completion cannot finish pending positions');
  resolvePositions(sections(150));
  await waitFor(() => !button.disabled);
  assert.equal(document.querySelector('[data-positions-content="earn"] .table-wrap'), wrap);
  assert.equal(wrap.scrollLeft, 80);
  const callCount = calls.length;
  selectPlatforms(['Binance']);
  assert.equal(calls.length, callCount);
  assert.deepEqual(JSON.parse(stored.get(PLATFORM_STORAGE_KEY)), ['Binance']);
  assert.ok(Array.from(document.querySelectorAll('[data-platform]')).every(node => node.dataset.platform === 'Binance'));
  assert.match(document.querySelector('#portfolio-content').textContent, /999\.00/);
  assert.match(document.querySelector('#portfolio-summary .status-badge').textContent, /Binance/);
  selectPlatforms(['Binance', 'OKX']);
  assert.equal(calls.length, callCount);
  assert.equal(document.querySelectorAll('#loan-rows tr').length, 4);
  assert.ok(Array.from(document.querySelectorAll('[data-platform]')).every(node => ['Binance', 'OKX'].includes(node.dataset.platform)));
  assert.match(document.querySelector('#portfolio-content').textContent, /1,149\.00/);
  assert.equal(document.querySelector('#platform-all').indeterminate, true);
  assert.equal(document.querySelector('#platform-label').textContent, 'Binance + OKX');
  assert.deepEqual(JSON.parse(stored.get(PLATFORM_STORAGE_KEY)), ['Binance', 'OKX']);
  filter.open = true;
  document.querySelector('summary').focus = () => {};
  const escape = new window.Event('keydown', { bubbles: true }); escape.key = 'Escape';
  document.dispatchEvent(escape);
  assert.equal(filter.open, false);
  selectPlatforms([]);
  assert.equal(document.querySelector('#platform-empty').hidden, false);
  assert.equal(document.querySelector('#loan-rows').childElementCount, 0);
  assert.equal(document.querySelector('#portfolio-summary').hidden, true);
  assert.deepEqual(JSON.parse(stored.get(PLATFORM_STORAGE_KEY)), []);
  const all = document.querySelector('#platform-all');
  all.checked = true; all.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('#platform-empty').hidden, true);
  assert.equal(document.querySelectorAll('#loan-rows tr').length, 6);
  assert.ok(options.every(option => option.checked));
  button.click();
  const partial = products(.05).map(p => p.platform === 'Bitget' && p.kind === 'loan' ? { ...p, status: 'error' } : p);
  resolveRates(partial);
  await waitFor(() => pending.some(p => p.url.startsWith('https://api.bitget.com/')));
  assert.match(document.querySelector('#loan-rows tr').textContent, /5\.00%/, 'available platforms publish before fallback finishes');
  selectPlatforms(['OKX']);
  resolvePositions(sections(200));
  pending.splice(pending.findIndex(p => p.url.startsWith('https://api.bitget.com/')), 1)[0].resolve(Response.json({ code: '00000', data: {
    loanInfos: [{ coin: 'USDC', rateFlexible: '.06' }, { coin: 'USDT', rateFlexible: '.06' }],
    pledgeInfos: [{ coin: 'BTC', initRate: '.7', forceRate: '.9' }],
  } }));
  await waitFor(() => !button.disabled);
  assert.equal(button.dataset.state, 'done');
  assert.ok(Array.from(document.querySelectorAll('[data-platform]')).every(node => node.dataset.platform === 'OKX'), 'in-flight results respect the latest filter');
  selectPlatforms(PLATFORMS);
  assert.match(document.querySelector('#loan-rows tr[data-platform="Bitget"]').textContent, /6\.00%/);
  button.click();
  pending.splice(pending.findIndex(p => p.url === '/api/rates'), 1)[0].reject(Error('offline'));
  pending.splice(pending.findIndex(p => ['/device/api/positions', '/private/api/positions'].includes(p.url)), 1)[0].reject(Error('offline'));
  await waitFor(() => !button.disabled);
  assert.equal(button.dataset.state, 'partial');
  assert.doesNotMatch(document.querySelector('#loan-rows').textContent, /[56]\.00%/);
  assert.match(document.querySelector('#loan-rows').textContent, /Error/);
  assert.equal(document.querySelector('#portfolio-summary').hidden, true);
  assert.equal(document.querySelector('[data-positions-content="earn"]').textContent, '');
  assert.equal(document.querySelector('[data-position-status="earn"]').textContent, 'Positions unavailable');
  button.click(); resolveRates(products(.03)); resolvePositions(sections(100));
  await waitFor(() => !button.disabled);
  button.click(); resolveRates(products(.03));
  pending.splice(pending.findIndex(p => ['/device/api/positions', '/private/api/positions'].includes(p.url)), 1)[0].resolve(new Response('', { status: 401 }));
  await waitFor(() => pending.some(p => p.url === '/private/api/positions'));
  pending.splice(pending.findIndex(p => p.url === '/private/api/positions'), 1)[0].resolve(new Response('', { status: 401 }));
  await waitFor(() => !button.disabled);
  assert.equal(document.querySelector('#portfolio-summary').hidden, true, 'expired login removes account data');
  assert.equal(document.querySelector('[data-positions-content="earn"]').textContent, '');
  assert.equal(document.querySelector('#sign-in').hidden, false);
  window.dispatchEvent(new window.Event('pagehide'));
});
