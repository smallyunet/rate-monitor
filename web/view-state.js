export const PLATFORM_STORAGE_KEY = 'rate-monitor.platform';
export const PLATFORMS = ['Binance', 'Bitget', 'OKX'];
const normalizePlatforms = values => Array.isArray(values) && values.every(value => PLATFORMS.includes(value))
  ? PLATFORMS.filter(platform => values.includes(platform)) : [...PLATFORMS];
export function readPlatform(storage) {
  try {
    const value = storage.getItem(PLATFORM_STORAGE_KEY);
    // Preserve choices saved by the previous single-select control.
    if (PLATFORMS.includes(value)) return [value];
    if (!value || value === 'all') return [...PLATFORMS];
    return normalizePlatforms(JSON.parse(value));
  } catch { return [...PLATFORMS]; }
}
export function savePlatform(storage, value) {
  try { storage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(normalizePlatforms(value))); }
  catch { /* The filter still works when browser storage is unavailable. */ }
}
export function filterPlatform(items, platform) {
  return items.filter(item => platform.includes(item.platform));
}
export function relativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Keep existing tables and scroll containers mounted while updating their contents.
// Stable row keys prevent values from being compared with a different product.
export function updateContent(target, source, { animate = true } = {}) {
  const previous = Array.from(target.childNodes);
  const used = new Set();
  for (const [index, next] of Array.from(source.childNodes).entries()) {
    const key = next.nodeType === 1 ? next.getAttribute('data-key') : null;
    const current = key === null ? previous[index] : previous.find(node => node.nodeType === 1 && node.getAttribute('data-key') === key);
    const compatible = current && !used.has(current) && current.nodeType === next.nodeType && current.nodeName === next.nodeName
      && (current.nodeType !== 1 || current.getAttribute('data-key') === key);
    if (!compatible) {
      target.insertBefore(next, target.childNodes[index] || null);
      continue;
    }
    used.add(current);
    if (current !== target.childNodes[index]) target.insertBefore(current, target.childNodes[index] || null);
    if (next.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      continue;
    }
    const changed = current.hasAttribute('data-live-value') && current.textContent !== next.textContent;
    for (const attr of Array.from(current.attributes)) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    for (const attr of Array.from(next.attributes)) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    updateContent(current, next, { animate });
    if (animate && changed && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.animate?.([{ backgroundColor: '#665321', color: '#ffe397' }, { backgroundColor: 'transparent' }], { duration: 1100, easing: 'ease-out' });
    }
  }
  for (const node of previous) if (!used.has(node)) node.remove();
}
