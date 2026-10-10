'use strict';
const { openDb, setSetting } = require('../src/db');
const { createApp } = require('../src/app');
const { createFetchAdapter, QuoteUnavailableError } = require('../src/integrations/fetch');
const auth = require('../src/auth');

const PASSWORD = 'correct horse battery staple';
const cfg = { ...require('../src/config'), adminEmail: 'owner@example.test', adminPasswordHash: auth.hashPassword(PASSWORD), trackingEnabled: true, publicAllowedOrigins: [], isProduction: false, smtp: { host: 'x', port: 25, user: '', pass: '', from: 'crm@example.test' }, fetchLiveEnabled: false };

async function start({ adapter, transport } = {}) {
  const db = openDb(':memory:');
  const sent = [];
  const tr = transport || { sendMail: async (m) => { sent.push(m); } };
  const app = createApp({ db, adapter: adapter || createFetchAdapter(cfg), transport: tr, cfg });
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body, opts = {}) => {
    const headers = { 'X-Requested-With': 'crm', ...(opts.headers || {}) };
    if (cookie && !opts.noCookie) headers.Cookie = cookie;
    let payload;
    if (opts.raw) payload = opts.raw; else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + path, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie'); if (sc && !opts.noCookie) cookie = sc.split(';')[0];
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  };
  const login = () => call('POST', '/api/login', { email: cfg.adminEmail, password: PASSWORD });
  return { db, call, login, sent, server, base, close: () => new Promise((r) => server.close(r)), setSetting: (k, v) => setSetting(db, k, v) };
}

function csvBuf(rows) { return Buffer.from(rows.map((r) => r.join(',')).join('\n')); }

module.exports = { start, cfg, PASSWORD, csvBuf, QuoteUnavailableError };
