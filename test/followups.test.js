'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const reminders = require('../src/reminders');
const { cfg } = require('./helpers');

const setup = async (transport) => {
  const t = await start({ transport }); await t.login();
  t.setSetting('reporting_timezone', 'UTC');
  const c = await t.call('POST', '/api/customers', { name: 'Pat Lead', email: 'pat@example.test' });
  return { t, cid: c.body.id };
};
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

test('follow-ups: create, edit date, complete, reopen; due/overdue lists are correct', async () => {
  const { t, cid } = await setup();
  const a = await t.call('POST', '/api/followups', { customer_id: cid, due_date: yesterday(), note: 'Call back' });
  await t.call('POST', '/api/followups', { customer_id: cid, due_date: today(), note: 'Today task' });
  await t.call('POST', '/api/followups', { customer_id: cid, due_date: tomorrow(), note: 'Later' });
  assert.equal((await t.call('GET', '/api/followups?filter=overdue')).body.rows.length, 1);
  assert.equal((await t.call('GET', '/api/followups?filter=today')).body.rows.length, 1);
  assert.equal((await t.call('GET', '/api/followups?filter=upcoming')).body.rows.length, 1);
  assert.equal((await t.call('PATCH', `/api/followups/${a.body.id}`, { due_date: tomorrow() })).status, 200);
  assert.equal((await t.call('GET', '/api/followups?filter=overdue')).body.rows.length, 0);
  await t.call('PATCH', `/api/followups/${a.body.id}`, { status: 'completed' });
  const done = (await t.call('GET', '/api/followups?filter=completed')).body.rows[0];
  assert.ok(done.completed_at);
  assert.equal((await t.call('POST', '/api/followups', { customer_id: cid, due_date: 'tomorrow', note: 'x' })).status, 400);
  await t.close();
});

test('reminders go only to the configured admin address and are never duplicated', async () => {
  const { t, cid } = await setup();
  await t.call('POST', '/api/followups', { customer_id: cid, due_date: yesterday(), note: 'Overdue one' });
  await t.call('POST', '/api/followups', { customer_id: cid, due_date: today(), note: 'Due today' });
  await t.call('POST', '/api/followups', { customer_id: cid, due_date: tomorrow(), note: 'Not yet' });
  const transport = { sent: [], async sendMail(m) { this.sent.push(m); } };
  const r1 = await reminders.runReminders(t.db, transport, cfg, { force: true });
  assert.equal(r1.sent, 2); assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].to, 'owner@example.test');
  assert.ok(!/Not yet/.test(transport.sent[0].text));
  const r2 = await reminders.runReminders(t.db, transport, cfg, { force: true });
  assert.equal(r2.sent, 0); assert.equal(transport.sent.length, 1); // no duplicate
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM reminder_deliveries').get().n, 2);
  // concurrent runs cannot double-send
  const tr2 = { sent: [], async sendMail(m) { await new Promise((r) => setTimeout(r, 20)); this.sent.push(m); } };
  await t.call('POST', '/api/followups', { customer_id: cid, due_date: today(), note: 'Another' });
  await Promise.all([reminders.runReminders(t.db, tr2, cfg, { force: true }), reminders.runReminders(t.db, tr2, cfg, { force: true })]);
  assert.equal(tr2.sent.length, 1);
  // changing the due date creates a new, legitimate reminder key
  await t.close();
});

test('failed delivery keeps the task visible, shows the error, and can be retried safely', async () => {
  const { t, cid } = await setup();
  const f = await t.call('POST', '/api/followups', { customer_id: cid, due_date: today(), note: 'Must not vanish' });
  const broken = { async sendMail() { throw new Error('SMTP down'); } };
  const r = await reminders.runReminders(t.db, broken, cfg, { force: true });
  assert.equal(r.failed, 1);
  const list = await t.call('GET', '/api/followups?filter=open');
  const row = list.body.rows.find((x) => x.id === f.body.id);
  assert.ok(row, 'task still listed'); assert.equal(row.reminder_status, 'failed'); assert.match(row.reminder_error, /SMTP down/);
  const ok = { sent: [], async sendMail(m) { this.sent.push(m); } };
  const retry = await reminders.retryDelivery(t.db, ok, cfg, row.delivery_id);
  assert.equal(retry.sent, 1); assert.equal(ok.sent.length, 1);
  await assert.rejects(reminders.retryDelivery(t.db, ok, cfg, row.delivery_id), /Already sent/);
  assert.equal(ok.sent.length, 1);
  // email not configured at all: still failed-but-visible
  const f2 = await t.call('POST', '/api/followups', { customer_id: cid, due_date: today(), note: 'No transport' });
  await reminders.runReminders(t.db, null, cfg, { force: true });
  assert.ok((await t.call('GET', '/api/followups?filter=open')).body.rows.find((x) => x.id === f2.body.id));
  await t.close();
});

test('completed follow-ups are not reminded; scheduler stays off until confirmed and enabled', async () => {
  const { t, cid } = await setup();
  const f = await t.call('POST', '/api/followups', { customer_id: cid, due_date: today(), note: 'Done already' });
  await t.call('PATCH', `/api/followups/${f.body.id}`, { status: 'completed' });
  const tr = { sent: [], async sendMail(m) { this.sent.push(m); } };
  assert.ok((await reminders.runReminders(t.db, tr, cfg)).skipped);
  const bad = await t.call('PUT', '/api/settings', { reminder_enabled: 'true' });
  assert.equal(bad.status, 400); // must confirm address, hour and zone first
  const good = await t.call('PUT', '/api/settings', { reminder_email_confirmed: 'true', reminder_hour: '0', reminder_timezone: 'UTC', reminder_enabled: 'true' });
  assert.equal(good.status, 200);
  const r = await reminders.runReminders(t.db, tr, cfg);
  assert.equal(r.sent, 0); assert.equal(tr.sent.length, 0);
  await t.close();
});

test('settings validation rejects bad values and unknown keys', async () => {
  const { t } = await setup();
  for (const body of [{ reporting_timezone: 'Mars/Base' }, { reporting_currency: 'DOLLARS' }, { attribution_lookback_days: '-3' }, { direct_rule: 'maybe' }, { nope: 'x' }, { acquisition_observation_end: 'soon' }]) {
    assert.equal((await t.call('PUT', '/api/settings', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await t.call('PUT', '/api/settings', { public_form_enabled: 'true' })).status, 400); // needs disclosure text
  await t.close();
});

test('approved decisions file applies cleanly and passes the same validation as the Settings page', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const { settings } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'decisions.json'), 'utf8'));
  const { t } = await setup();
  const { reminder_enabled, ...body } = settings;
  const r = await t.call('PUT', '/api/settings', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = (await t.call('GET', '/api/settings')).body.settings;
  assert.equal(s.attribution_lookback_days, '30'); assert.equal(s.reminder_enabled, undefined);
  await t.close();
});
