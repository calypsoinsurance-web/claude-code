import { h, api, announce } from './lib.js';
import { dashboard } from './pages/dashboard.js';
import { customers, customerDetail } from './pages/customers.js';
import { advertising } from './pages/advertising.js';
import { imports } from './pages/imports.js';
import { followups } from './pages/followups.js';
import { settings } from './pages/settings.js';

const root = document.getElementById('root');
const INTRO = {
  dashboard: 'Your numbers at a glance. Pick a date range; anything that cannot be calculated yet says N/A and tells you why.',
  customers: 'Everyone who has asked for a quote or bought a policy, with their pets, quotes, policies and follow-ups.',
  advertising: 'What you spent and what it produced, by platform and campaign. Numbers come from the reports you import.',
  imports: 'Bring in reports from Fetch, your ad platforms and your commission statements. Nothing is saved until you press Commit.',
  followups: 'Who to contact and when. Due and overdue items are listed first; reminders go to your email.',
  settings: 'The decisions that shape your reports, plus reminders, the quote page, backups and integration status.',
};
const NAV = [['dashboard', 'Dashboard'], ['customers', 'Customers'], ['advertising', 'Advertising'], ['imports', 'Imports'], ['followups', 'Follow-ups'], ['settings', 'Settings']];
let isDemo = false;

function loginView() {
  const err = h('div', { role: 'alert', class: 'muted' });
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', id: 'em' });
  const pw = h('input', { type: 'password', required: true, autocomplete: 'current-password', id: 'pw' });
  const form = h('form', { class: 'card login', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('/login', { method: 'POST', body: { email: email.value, password: pw.value } }); start(); } catch (x) { err.textContent = x.message; }
  } }, h('h1', null, 'Calypso Insurance'), h('p', { class: 'muted' }, 'Private pet insurance CRM. Sign in to continue.'),
  h('label', { for: 'em' }, 'Email', email), h('label', { for: 'pw' }, 'Password', pw), err, h('p', null, h('button', { type: 'submit' }, 'Sign in')));
  root.replaceChildren(h('main', { id: 'main' }, form));
}

async function render() {
  const [page, arg] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const nav = h('nav', { 'aria-label': 'Main' }, h('ul', null, NAV.map(([k, label]) => h('li', null, h('a', { href: `#/${k}`, 'aria-current': page === k || (page === 'customer' && k === 'customers') ? 'page' : null }, label)))));
  const main = h('main', { id: 'main', tabindex: '-1' }, h('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(
    h('header', { class: 'top' }, h('span', { class: 'brand' }, 'Calypso Insurance', h('small', null, 'Pet CRM')), nav, h('span', { class: 'spacer' }), h('button', { class: 'secondary', onclick: async () => { await api('/logout', { method: 'POST' }); loginView(); } }, 'Sign out')),
    isDemo ? h('div', { class: 'banner demo', role: 'note' }, 'DEMO DATA — every record in this database is synthetic. Not real customers, spend or commissions.') : null,
    main);
  try {
    const view = { dashboard, customers, advertising, imports, followups, settings }[page] || (page === 'customer' ? (el) => customerDetail(el, arg) : dashboard);
    await view(main, { isDemo });
    const h1 = main.querySelector('h1'); if (h1 && INTRO[page] && !main.querySelector('.lede')) h1.after(h('p', { class: 'lede' }, INTRO[page]));
    document.title = `${(NAV.find(([k]) => k === page) || ['', 'Customer'])[1]} · Calypso CRM`;
    announce(`${document.title} loaded`);
  } catch (e) {
    main.replaceChildren(h('div', { class: 'banner error', role: 'alert' }, e.message));
  }
}

async function start() {
  const me = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ authenticated: false }));
  if (!me.authenticated) return loginView();
  try { isDemo = (await api('/settings')).isDemo; } catch { isDemo = false; }
  render();
}
window.addEventListener('hashchange', () => render().then(() => document.getElementById('main')?.focus()));
window.addEventListener('signed-out', loginView);
start();
