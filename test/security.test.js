'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const PRIVATE = ['/api/customers', '/api/customers/1', '/api/summary', '/api/acquisition', '/api/calendar', '/api/followups', '/api/imports', '/api/review', '/api/settings', '/api/integrations', '/api/ads/records', '/api/export/customers.csv', '/api/export-summary.csv', '/api/filter-options', '/api/policies/search'];

test('unauthenticated users cannot read any CRM endpoint', async () => {
  const t = await start();
  for (const p of PRIVATE) { const r = await t.call('GET', p, undefined, { noCookie: true }); assert.equal(r.status, 401, p); }
  for (const [m, p] of [['POST', '/api/customers'], ['PATCH', '/api/customers/1'], ['POST', '/api/followups'], ['PUT', '/api/settings'], ['POST', '/api/imports/upload?kind=ads'], ['POST', '/api/reminders/run']]) {
    const r = await t.call(m, p, {}, { noCookie: true }); assert.equal(r.status, 401, `${m} ${p}`);
  }
  await t.close();
});

test('wrong password is rejected; right password works; sessions end on logout', async () => {
  const t = await start();
  assert.equal((await t.call('POST', '/api/login', { email: 'owner@example.test', password: 'nope' })).status, 401);
  assert.equal((await t.call('POST', '/api/login', { email: 'someone@else.test', password: 'correct horse battery staple' })).status, 401);
  assert.equal((await t.login()).status, 200);
  assert.equal((await t.call('GET', '/api/customers')).status, 200);
  await t.call('POST', '/api/logout');
  assert.equal((await t.call('GET', '/api/customers')).status, 401);
  await t.close();
});

test('state-changing requests need the CSRF header and same origin', async () => {
  const t = await start(); await t.login();
  const r = await t.call('POST', '/api/customers', { name: 'A' }, { headers: { 'X-Requested-With': '' } });
  assert.equal(r.status, 403);
  const r2 = await t.call('POST', '/api/customers', { name: 'A' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r2.status, 403);
  await t.close();
});

test('public API exposes no CRM records and public customers cannot list or fetch others', async () => {
  const t = await start();
  t.setSetting('public_form_enabled', 'true'); t.setSetting('public_disclosure_text', 'Notice');
  for (const p of ['/api/public/customers', '/api/public/customers/1', '/api/public/quotes', '/api/public/quote/1']) {
    const r = await t.call('GET', p, undefined, { noCookie: true });
    assert.ok([401, 404, 405].includes(r.status), `${p} -> ${r.status}`);
  }
  const cfgRes = await t.call('GET', '/api/public/config', undefined, { noCookie: true });
  assert.deepEqual(Object.keys(cfgRes.body).sort(), ['disclosure', 'formEnabled', 'trackingEnabled', 'widget', 'widgetNotice']);
  await t.close();
});

test('login is disabled (not open) when no admin credentials are configured', async () => {
  const cfg = require('../src/config');
  const { openDb } = require('../src/db'); const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  const app = createApp({ db, adapter: {}, transport: null, cfg: { ...cfg, adminEmail: '', adminPasswordHash: '' } });
  const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  const r = await fetch(`http://127.0.0.1:${s.address().port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '', password: '' }) });
  assert.equal(r.status, 503);
  s.close();
});

test('security headers are present', async () => {
  const t = await start();
  const r = await t.call('GET', '/api/me');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  await t.close();
});

test('database backup download requires sign-in and the CSRF header, and yields a valid database', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const t = await start();
  assert.equal((await t.call('POST', '/api/backup/download', undefined, { noCookie: true })).status, 401);
  await t.login();
  await t.call('POST', '/api/customers', { name: 'Backup Check', email: 'bk@example.test' });
  const bad = await t.call('POST', '/api/backup/download', undefined, { headers: { 'X-Requested-With': '' } });
  assert.equal(bad.status, 403);
  const res = await fetch(`${t.base}/api/backup/download`, { method: 'POST', headers: { 'X-Requested-With': 'crm', Cookie: (await (async () => { const l = await fetch(`${t.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm' }, body: JSON.stringify({ email: 'owner@example.test', password: 'correct horse battery staple' }) }); return l.headers.get('set-cookie').split(';')[0]; })()) } });
  assert.equal(res.status, 200);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')), 'b.sqlite');
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare("SELECT name FROM customers WHERE email='bk@example.test'").get().name, 'Backup Check');
  copy.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true });
  await t.close();
});

test('password can be changed in the app: needs the current password, min length, signs everyone out, new password works', async () => {
  const t = await start(); await t.login();
  assert.equal((await t.call('POST', '/api/change-password', { current: 'wrong', next: 'a brand new long passphrase' })).status, 403);
  assert.equal((await t.call('POST', '/api/change-password', { current: 'correct horse battery staple', next: 'short' })).status, 400);
  const settings = (await t.call('GET', '/api/settings')).body.settings; assert.equal(settings.admin_password_hash, undefined);
  assert.equal((await t.call('POST', '/api/change-password', { current: 'correct horse battery staple', next: 'a brand new long passphrase' })).status, 200);
  assert.equal((await t.call('GET', '/api/customers')).status, 401); // sessions cleared
  assert.equal((await t.call('POST', '/api/login', { email: 'owner@example.test', password: 'correct horse battery staple' })).status, 401); // old one dead
  assert.equal((await t.call('POST', '/api/login', { email: 'owner@example.test', password: 'a brand new long passphrase' })).status, 200);
  assert.equal((await t.call('GET', '/api/customers')).status, 200);
  assert.equal((await t.call('POST', '/api/change-password', { current: 'a brand new long passphrase', next: 'x'.repeat(5) })).status, 400);
  assert.equal((await t.call('PUT', '/api/settings', { admin_password_hash: 'scrypt$aa$bb' })).status, 400); // not settable through Settings
  await t.close();
});
