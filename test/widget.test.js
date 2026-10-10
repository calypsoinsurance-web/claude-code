'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./helpers');

test('widget config keeps the partner tracking identifiers exactly as supplied', () => {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'fetch-widget.json'), 'utf8'));
  assert.deepEqual(c.invoke.metaData, { c: 'firstconnect', p: 'firstconnect', utm_medium: 'partnership', utm_source: 'firstconnect', utm_campaign: 'firstconnect_FC16191_widget', a: 'FC16191' });
  assert.equal(c.sdkUrl, 'https://salesfunnelquotesdk.fetchpet.com/fetchQuoteWidget/1.0.0/sdk.js');
});

test('widget page is off by default; enabling is a private setting; config exposes no CRM data', async () => {
  const t = await start();
  let cfg = (await t.call('GET', '/api/public/config', undefined, { noCookie: true })).body;
  assert.equal(cfg.widget.enabled, false); assert.equal(cfg.widget.capture, false);
  await t.login();
  assert.equal((await t.call('PUT', '/api/settings', { public_widget_enabled: 'true' })).status, 200);
  cfg = (await t.call('GET', '/api/public/config', undefined, { noCookie: true })).body;
  assert.equal(cfg.widget.enabled, true); assert.equal(cfg.widget.invoke.metaData.a, 'FC16191');
  await t.close();
});

test('widget events: ignored unless capture is on; stored raw, bounded, validated, and never counted as quotes', async () => {
  const t = await start();
  const vid = 'w'.repeat(24);
  const post = (b) => t.call('POST', '/api/public/widget-event', b, { noCookie: true });
  assert.equal((await post({ visitor_id: vid, event: 'complete', payload: { x: 1 } })).status, 204);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM widget_events').get().n, 0);
  t.setSetting('widget_capture_enabled', 'true');
  assert.equal((await post({ visitor_id: vid, event: 'bogus' })).status, 400);
  assert.equal((await post({ visitor_id: 'short', event: 'complete' })).status, 400);
  assert.equal((await post({ visitor_id: vid, event: 'complete', payload: { anything: 'as received' } })).status, 204);
  assert.equal((await post({ visitor_id: vid, event: 'complete', payload: 'x'.repeat(9000) })).status, 204);
  const rows = t.db.prepare('SELECT * FROM widget_events ORDER BY id').all();
  assert.equal(rows.length, 2); assert.match(rows[0].payload_json, /as received/); assert.match(rows[1].payload_json, /truncated/);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM quotes').get().n, 0);
  await t.login();
  assert.equal((await t.call('GET', '/api/widget-events')).body.rows.length, 2);
  assert.equal((await t.call('GET', '/api/widget-events', undefined, { noCookie: true })).status, 401);
  await t.close();
});

test('quote pages allow only Fetch\'s widget host; CRM pages keep the strict policy', async () => {
  const t = await start();
  const q = await t.call('GET', '/q/', undefined, { noCookie: true });
  assert.equal(q.status, 200);
  const csp = q.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/salesfunnelquotesdk\.fetchpet\.com/); assert.match(csp, /frame-src https:\/\/salesfunnelquotesdk\.fetchpet\.com/);
  assert.match(q.body, /sdk\.js/); assert.match(q.body, /id="quoteForm"/);
  const crm = await t.call('GET', '/app/', undefined, { noCookie: true });
  assert.ok(!/fetchpet/.test(crm.headers.get('content-security-policy')));
  assert.equal((await t.call('GET', '/q/lead.html', undefined, { noCookie: true })).status, 200);
  await t.close();
});
