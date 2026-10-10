// Tiny DOM + fetch helpers. Text is always inserted with textContent / text nodes, so data can never inject markup.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export async function api(path, { method = 'GET', body, raw, headers } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'crm', ...(headers || {}) }, credentials: 'same-origin' };
  if (raw) opts.body = raw; else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) { window.dispatchEvent(new Event('signed-out')); throw new Error('Please sign in again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const announce = (msg) => { const l = document.getElementById('live'); if (l) l.textContent = msg; };

export function money(n, currency) {
  if (n == null) return 'N/A';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n); } catch { return String(n); }
}
export const cents = (c, cur) => (c == null ? 'N/A' : money(c / 100, cur));
export const int = (n) => (n == null ? 'N/A' : new Intl.NumberFormat().format(n));
export const pct = (n) => (n == null ? 'N/A' : `${n.toFixed(2)}%`);

// A calc result {value, reason} -> element. Missing values show "N/A" with the reason, never 0.
export function metric(res, fmt) {
  if (!res || res.value == null) return h('span', { class: 'na', title: (res && res.reason) || 'Not available' }, 'N/A', res && res.reason ? h('span', { class: 'sr-only' }, ` (${res.reason})`) : null);
  return document.createTextNode(fmt(res.value));
}

export function stat(label, valueNode, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, valueNode), sub ? h('div', { class: 'sub' }, sub) : null);
}

export function table(caption, headers, rows, { empty = 'Nothing to show yet.' } = {}) {
  if (!rows.length) return h('div', { class: 'card empty' }, empty);
  return h('div', { class: 'table-wrap', role: 'region', 'aria-label': caption, tabindex: '0' },
    h('table', null, h('caption', null, caption),
      h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col', class: x.num ? 'num' : null }, x.label || x)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h(headers[i].header ? 'th' : 'td', { class: headers[i].num ? 'num' : null, scope: headers[i].header ? 'row' : null }, c)))))));
}

export function field(label, input, hint) {
  const id = `f${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('label', { for: id }, label, input, hint ? h('span', { class: 'muted' }, hint) : null);
}

export function banner(kind, ...kids) { return h('div', { class: `banner ${kind || ''}`, role: kind === 'error' ? 'alert' : null }, kids); }

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
export const fmtTs = (s) => (s ? new Date(s).toLocaleString() : '—');

// DOM replaceChildren() turns null/false into the text "null"/"false". Skip empty children instead.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function replaceChildren(...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false));
};
