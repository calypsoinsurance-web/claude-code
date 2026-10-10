'use strict';
// PRIVATE routes. The whole router sits behind requireAuth (see server.js), so every handler here is authenticated.
const express = require('express');
const { tx, now, getSetting, setSetting, allSettings } = require('../db');
const reports = require('../reports');
const imports = require('../imports');
const reminders = require('../reminders');
const { integrationStatuses } = require('../integrations/registry');
const { toCsv } = require('../csv');
const crm = require('../crm');
const auth = require('../auth');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backup } = require('node:sqlite');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tzOk = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

function rangeFrom(req) {
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || today;
  if (!isDate(from) || !isDate(to)) throw bad('from and to must be YYYY-MM-DD');
  if (from > to) throw bad('"from" is after "to"');
  return { from, to };
}
const filtersFrom = (req) => ({ ...rangeFrom(req), platform: req.query.platform || null, campaign: req.query.campaign || null, ad: req.query.ad || null });

function privateRouter(db, transport, cfg) {
  const r = express.Router();
  r.use(express.json({ limit: '200kb' }));

  // ---------- settings & status ----------
  const SETTING_KEYS = new Set([...reports.DECISIONS.map((d) => d.key), 'reminder_enabled', 'reminder_email_confirmed', 'reminder_hour', 'reminder_timezone', 'public_form_enabled', 'public_widget_enabled', 'widget_capture_enabled', 'public_disclosure_text', 'deployment_note', 'backup_note', 'import_defaults_commissions']);
  r.get('/settings', (req, res) => {
    res.json({
      settings: (({ admin_password_hash, ...rest }) => rest)(allSettings(db)), decisions: reports.DECISIONS, adminEmail: cfg.adminEmail,
      env: { trackingEnabled: cfg.trackingEnabled, smtpConfigured: !!(cfg.smtp.host && cfg.smtp.from), fetchLiveEnabled: cfg.fetchLiveEnabled, publicBaseUrl: cfg.publicBaseUrl },
      isDemo: getSetting(db, 'is_demo') === 'true',
    });
  });
  r.put('/settings', (req, res) => {
    const b = req.body || {};
    const next = {};
    for (const [k, v] of Object.entries(b)) {
      if (!SETTING_KEYS.has(k)) throw bad(`Unknown setting ${k}`);
      next[k] = v === null || v === '' ? null : String(v).trim();
    }
    const val = (k, fn, msg) => { if (next[k] != null && !fn(next[k])) throw bad(msg); };
    if (next.import_defaults_commissions != null) {
      let o; try { o = JSON.parse(next.import_defaults_commissions); } catch { throw bad('Import defaults must be valid JSON'); }
      const allowed = ['filter_column', 'filter_values', 'currency', 'carrier', 'receipt_values', 'reversal_values', 'adjustment_values', 'sign_convention', 'amount_sign'];
      if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some((k) => !allowed.includes(k))) throw bad(`Import defaults may only use: ${allowed.join(', ')}`);
    }
    val('reporting_timezone', tzOk, 'Not a valid IANA time zone (e.g. America/New_York)');
    val('reminder_timezone', tzOk, 'Not a valid IANA time zone');
    val('reporting_currency', (x) => /^[A-Za-z]{3}$/.test(x), 'Currency must be a 3-letter code');
    val('attribution_lookback_days', (x) => Number.isFinite(Number(x)) && Number(x) > 0 && Number(x) <= 730, 'Lookback must be between 1 and 730 days');
    val('acquisition_observation_end', isDate, 'Use YYYY-MM-DD');
    val('reminder_hour', (x) => /^\d{1,2}$/.test(x) && Number(x) <= 23, 'Hour must be 0-23');
    for (const d of reports.DECISIONS.filter((x) => x.options)) val(d.key, (x) => d.options.includes(x), `${d.key} must be one of ${d.options.join(', ')}`);
    if (next.reporting_currency) next.reporting_currency = next.reporting_currency.toUpperCase();
    for (const k of ['reminder_enabled', 'reminder_email_confirmed', 'public_form_enabled', 'public_widget_enabled', 'widget_capture_enabled']) if (k in next && next[k] != null) next[k] = next[k] === 'true' ? 'true' : 'false';
    tx(db, () => {
      for (const [k, v] of Object.entries(next)) setSetting(db, k, v);
      const s = allSettings(db);
      if (s.reminder_enabled === 'true' && (s.reminder_email_confirmed !== 'true' || !s.reminder_timezone || s.reminder_hour == null)) throw bad('Before enabling reminders: confirm the address, choose a time zone and an hour.');
      if (s.public_form_enabled === 'true' && !(s.public_disclosure_text || '').trim()) throw bad('Add the customer disclosure/consent text before enabling the public quote form.');
    });
    res.json({ ok: true });
  });
  r.get('/widget-events', (req, res) => res.json({ rows: db.prepare('SELECT id,visitor_id,event,payload_json,page_url,created_at FROM widget_events ORDER BY id DESC LIMIT 50').all() }));
  r.get('/integrations', (req, res) => res.json({ integrations: integrationStatuses(db, req.app.locals.fetchAdapter) }));

  // ---------- change password ----------
  const changeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  r.post('/change-password', changeLimiter, (req, res) => {
    const { current, next } = req.body || {};
    const stored = getSetting(db, 'admin_password_hash') || cfg.adminPasswordHash;
    if (typeof current !== 'string' || !auth.verifyPassword(current, stored)) throw bad('Current password is wrong', 403);
    if (typeof next !== 'string' || next.length < 12 || next.length > 200) throw bad('New password must be 12 to 200 characters');
    if (next === current) throw bad('New password must be different');
    tx(db, () => {
      setSetting(db, 'admin_password_hash', auth.hashPassword(next));
      db.prepare('DELETE FROM sessions').run(); // signs out every device, including this one
    });
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  // ---------- reports ----------
  r.get('/summary', (req, res) => res.json(reports.summary(db, filtersFrom(req))));
  r.get('/acquisition', (req, res) => res.json(reports.acquisition(db, rangeFrom(req))));
  r.get('/calendar', (req, res) => { const { from, to } = rangeFrom(req); res.json({ from, to, days: reports.calendarActivity(db, from, to) }); });
  r.get('/filter-options', (req, res) => {
    res.json({
      platforms: db.prepare('SELECT DISTINCT platform FROM ad_records ORDER BY 1').all().map((x) => x.platform),
      campaigns: db.prepare("SELECT DISTINCT platform, campaign_id, campaign_name FROM ad_records WHERE campaign_id != '' ORDER BY 1,2").all(),
      ads: db.prepare("SELECT DISTINCT platform, ad_id, ad_name, campaign_id FROM ad_records WHERE ad_id != '' ORDER BY 1,2").all(),
    });
  });

  // ---------- customers ----------
  r.get('/customers', (req, res) => {
    const q = `%${String(req.query.q || '').trim().toLowerCase()}%`;
    const page = Math.max(1, Number(req.query.page) || 1); const size = 25;
    const where = ['(lower(c.name) LIKE ? OR lower(coalesce(c.email,\'\')) LIKE ? OR coalesce(c.phone,\'\') LIKE ? OR lower(coalesce(c.provider_customer_id,\'\')) LIKE ?)']; const params = [q, q, q, q];
    if (req.query.state) { where.push('c.state = ?'); params.push(String(req.query.state).toUpperCase()); }
    if (req.query.source) { where.push('c.first_source_type = ?'); params.push(String(req.query.source)); }
    if (req.query.has_policy === 'yes') where.push('EXISTS (SELECT 1 FROM policies p WHERE p.customer_id=c.id AND p.is_issued=1)');
    if (req.query.has_policy === 'no') where.push('NOT EXISTS (SELECT 1 FROM policies p WHERE p.customer_id=c.id AND p.is_issued=1)');
    const w = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM customers c WHERE ${w}`).get(...params).n;
    const rows = db.prepare(`SELECT c.id,c.name,c.email,c.phone,c.state,c.first_source_type,c.first_source_platform,c.created_at,
      (SELECT COUNT(*) FROM pets WHERE customer_id=c.id) pets, (SELECT COUNT(*) FROM quotes WHERE customer_id=c.id) quotes,
      (SELECT COUNT(*) FROM policies WHERE customer_id=c.id AND is_issued=1) policies
      FROM customers c WHERE ${w} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size);
    res.json({ total, page, size, rows });
  });
  r.get('/customers/:id', (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
    if (!c) throw bad('Customer not found', 404);
    res.json({
      customer: c,
      pets: db.prepare('SELECT * FROM pets WHERE customer_id=? ORDER BY id').all(id),
      quotes: db.prepare('SELECT id,pet_id,provider,provider_quote_id,quoted_at,quoted_date,premium_cents,payment_frequency,status,source,attribution_snapshot_json FROM quotes WHERE customer_id=? ORDER BY quoted_at DESC').all(id),
      policies: db.prepare('SELECT * FROM policies WHERE customer_id=? ORDER BY issue_date DESC').all(id),
      followups: db.prepare('SELECT * FROM followups WHERE customer_id=? ORDER BY due_date DESC').all(id),
      visits: db.prepare('SELECT id,visited_at,source_type,platform,utm_source,utm_medium,utm_campaign,utm_content,referrer FROM visits WHERE customer_id=? ORDER BY visited_at').all(id),
    });
  });
  r.post('/customers', (req, res) => {
    const b = req.body || {};
    if (!String(b.name || '').trim()) throw bad('Name is required');
    const email = crm.normEmail(b.email);
    if (email && db.prepare('SELECT 1 FROM customers WHERE email=?').get(email)) throw bad('A customer with this email already exists', 409);
    const id = crm.createCustomer(db, { name: b.name, email, phone: b.phone, state: b.state });
    if (b.notes) db.prepare('UPDATE customers SET notes=? WHERE id=?').run(String(b.notes).slice(0, 5000), id);
    res.status(201).json({ id });
  });
  r.patch('/customers/:id', (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const cur = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
    if (!cur) throw bad('Customer not found', 404);
    const email = 'email' in b ? crm.normEmail(b.email) : cur.email;
    if (email && email !== cur.email && db.prepare('SELECT 1 FROM customers WHERE email=? AND id!=?').get(email, id)) throw bad('Another customer already uses this email', 409);
    db.prepare('UPDATE customers SET name=?, email=?, phone=?, state=?, notes=?, updated_at=? WHERE id=?')
      .run(String(b.name ?? cur.name).trim() || cur.name, email, 'phone' in b ? crm.norm(b.phone) : cur.phone, 'state' in b ? crm.norm(b.state) : cur.state, 'notes' in b ? String(b.notes).slice(0, 5000) : cur.notes, now(), id);
    res.json({ ok: true });
  });
  r.post('/customers/:id/pets', (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    if (!db.prepare('SELECT 1 FROM customers WHERE id=?').get(id)) throw bad('Customer not found', 404);
    if (!String(b.name || '').trim()) throw bad('Pet name is required');
    if (b.species && !['dog', 'cat'].includes(b.species)) throw bad('Species must be dog or cat');
    const p = crm.findOrCreatePet(db, id, { name: b.name, species: b.species, breed: b.breed, age_as_recorded: b.age, age_recorded_on: b.age_recorded_on });
    res.status(201).json(p);
  });

  // ---------- follow-ups ----------
  r.get('/followups', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const tz = getSetting(db, 'reporting_timezone');
    const localToday = tz ? reports.localDate(new Date().toISOString(), tz) : today;
    const f = req.query.filter || 'open';
    let where = '1=1'; const params = [];
    if (f === 'overdue') { where = "f.status='open' AND f.due_date < ?"; params.push(localToday); }
    else if (f === 'today') { where = "f.status='open' AND f.due_date = ?"; params.push(localToday); }
    else if (f === 'upcoming') { where = "f.status='open' AND f.due_date > ?"; params.push(localToday); }
    else if (f === 'open') where = "f.status='open'";
    else if (f === 'completed') where = "f.status='completed'";
    const rows = db.prepare(`SELECT f.*, c.name customer_name, d.id delivery_id, d.status reminder_status, d.last_error reminder_error, d.attempts reminder_attempts
      FROM followups f JOIN customers c ON c.id=f.customer_id
      LEFT JOIN reminder_deliveries d ON d.followup_id=f.id AND d.due_date=f.due_date
      WHERE ${where} ORDER BY f.due_date, f.id`).all(...params);
    res.json({ today: localToday, usingReportingTimezone: !!tz, rows });
  });
  r.post('/followups', (req, res) => {
    const b = req.body || {};
    if (!isDate(b.due_date)) throw bad('due_date must be YYYY-MM-DD');
    if (!String(b.note || '').trim()) throw bad('A note is required');
    if (!db.prepare('SELECT 1 FROM customers WHERE id=?').get(Number(b.customer_id))) throw bad('Customer not found', 404);
    const t = now();
    const x = db.prepare('INSERT INTO followups(customer_id,due_date,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(Number(b.customer_id), b.due_date, String(b.note).trim().slice(0, 2000), 'open', t, t);
    res.status(201).json({ id: Number(x.lastInsertRowid) });
  });
  r.patch('/followups/:id', (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const cur = db.prepare('SELECT * FROM followups WHERE id=?').get(id);
    if (!cur) throw bad('Follow-up not found', 404);
    const due = 'due_date' in b ? b.due_date : cur.due_date;
    if (!isDate(due)) throw bad('due_date must be YYYY-MM-DD');
    const note = 'note' in b ? String(b.note).trim().slice(0, 2000) : cur.note;
    if (!note) throw bad('A note is required');
    let status = cur.status; let completed = cur.completed_at;
    if (b.status === 'completed' && cur.status !== 'completed') { status = 'completed'; completed = now(); }
    if (b.status === 'open' && cur.status !== 'open') { status = 'open'; completed = null; }
    db.prepare('UPDATE followups SET due_date=?, note=?, status=?, completed_at=?, updated_at=? WHERE id=?').run(due, note, status, completed, now(), id);
    res.json({ ok: true });
  });
  r.post('/reminders/run', wrap(async (req, res) => res.json(await reminders.runReminders(db, transport, cfg, { force: true }))));
  r.post('/reminders/test', wrap(async (req, res) => { await reminders.sendTest(transport, cfg); res.json({ ok: true, sentTo: cfg.adminEmail }); }));
  r.post('/reminders/:id/retry', wrap(async (req, res) => res.json(await reminders.retryDelivery(db, transport, cfg, Number(req.params.id)))));

  // ---------- imports ----------
  r.post('/imports/upload', express.raw({ type: '*/*', limit: cfg.maxUploadBytes }), wrap(async (req, res) => {
    const kind = String(req.query.kind || '');
    const filename = decodeURIComponent(String(req.headers['x-filename'] || ''));
    if (!filename) throw bad('Missing file name');
    res.json(await imports.stage(db, kind, filename, req.body, { headerRow: req.query.header_row ? Number(req.query.header_row) : undefined }));
  }));
  const runImport = (commit) => (req, res) => {
    const b = req.body || {};
    res.json(imports.run(db, Number(req.params.id), b.mapping || {}, b.options || {}, commit));
  };
  r.post('/imports/:id/preview', runImport(false));
  r.post('/imports/:id/commit', runImport(true));
  r.get('/imports', (req, res) => res.json({ rows: db.prepare("SELECT id,kind,filename,file_sha256,status,rows_total,rows_created,rows_updated,rows_unchanged,rows_errored,rows_review,created_at,committed_at FROM imports WHERE status != 'staged' ORDER BY id DESC LIMIT 200").all() }));
  r.get('/imports/:id', (req, res) => {
    const i = db.prepare('SELECT * FROM imports WHERE id=?').get(Number(req.params.id));
    if (!i) throw bad('Not found', 404);
    res.json({ import: i, errors: db.prepare('SELECT row_number,message FROM import_errors WHERE import_id=? ORDER BY row_number LIMIT 500').all(i.id) });
  });
  r.get('/review', (req, res) => {
    res.json({
      items: db.prepare("SELECT id,kind,import_id,row_number,reason,payload_json,created_at FROM review_items WHERE status='open' ORDER BY id").all().map((x) => ({ ...x, payload: JSON.parse(x.payload_json), payload_json: undefined })),
      unmatchedCommissions: db.prepare("SELECT id,type,amount_cents,currency,txn_date,statement_ref,statement_policy_ref FROM commission_transactions WHERE match_status='unmatched' ORDER BY txn_date DESC, id DESC").all(),
      policiesWithoutVerifiedQuote: db.prepare("SELECT id,policy_number,carrier,issue_date,customer_id FROM policies WHERE is_issued=1 AND quote_id IS NULL ORDER BY issue_date DESC LIMIT 200").all(),
    });
  });
  r.post('/review/:id/resolve', (req, res) => {
    const item = db.prepare("SELECT * FROM review_items WHERE id=? AND status='open'").get(Number(req.params.id));
    if (!item) throw bad('Review item not found', 404);
    const b = req.body || {};
    const forced = b.action === 'link' ? { customerId: Number(b.customer_id) } : b.action === 'create_new' ? { createNew: true } : null;
    if (!forced) throw bad('action must be "link" or "create_new"');
    if (forced.customerId && !db.prepare('SELECT 1 FROM customers WHERE id=?').get(forced.customerId)) throw bad('Customer not found', 404);
    const payload = JSON.parse(item.payload_json);
    const out = tx(db, () => {
      const res2 = payload.kind === 'quotes' ? imports.applyQuote(db, item.import_id, payload.values, item.row_number, forced) : imports.applyPolicy(db, item.import_id, payload.values, item.row_number, forced);
      if (res2.action === 'review') throw bad(`Still cannot be saved: ${res2.message}`, 409);
      db.prepare("UPDATE review_items SET status='resolved', resolution=?, resolved_at=? WHERE id=?").run(JSON.stringify(b), now(), item.id);
      return res2;
    });
    res.json(out);
  });
  r.post('/commissions/:id/match', (req, res) => {
    const t = db.prepare('SELECT * FROM commission_transactions WHERE id=?').get(Number(req.params.id));
    if (!t) throw bad('Not found', 404);
    const pid = Number(req.body && req.body.policy_id);
    if (!db.prepare('SELECT 1 FROM policies WHERE id=?').get(pid)) throw bad('Policy not found', 404);
    db.prepare("UPDATE commission_transactions SET policy_id=?, match_status='manual' WHERE id=?").run(pid, t.id);
    res.json({ ok: true });
  });
  r.get('/policies/search', (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    res.json({ rows: db.prepare('SELECT p.id,p.policy_number,p.carrier,c.name customer_name FROM policies p JOIN customers c ON c.id=p.customer_id WHERE p.policy_number LIKE ? OR c.name LIKE ? LIMIT 20').all(q, q) });
  });

  // ---------- advertising records ----------
  r.get('/ads/records', (req, res) => {
    const { from, to } = rangeFrom(req);
    const where = ['report_date >= ?', 'report_date <= ?']; const params = [from, to];
    if (req.query.platform) { where.push('platform=?'); params.push(req.query.platform); }
    const page = Math.max(1, Number(req.query.page) || 1);
    const total = db.prepare(`SELECT COUNT(*) n FROM ad_records WHERE ${where.join(' AND ')}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM ad_records WHERE ${where.join(' AND ')} ORDER BY report_date DESC, id DESC LIMIT 50 OFFSET ?`).all(...params, (page - 1) * 50);
    res.json({ total, page, rows });
  });

  // ---------- full database backup (download) ----------
  // POST (not GET) so it needs the CSRF header. Uses SQLite's online backup, safe while the app is running.
  r.post('/backup/download', async (req, res) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backup-'));
    const file = path.join(dir, 'crm-backup.sqlite');
    try {
      await backup(db, file);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="crm-backup-${stamp}.sqlite"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------- CSV exports ----------
  const EXPORTS = {
    customers: ['SELECT id,provider_customer_id,name,email,phone,state,first_source_type,first_source_platform,notes,created_at,updated_at FROM customers ORDER BY id'],
    pets: ['SELECT * FROM pets ORDER BY id'],
    quotes: ['SELECT id,customer_id,pet_id,provider,provider_quote_id,quoted_at,quoted_date,premium_cents,payment_frequency,status,source,attribution_snapshot_json FROM quotes ORDER BY id'],
    policies: ['SELECT * FROM policies ORDER BY id'],
    commissions: ['SELECT id,policy_id,type,amount_cents,currency,txn_date,statement_ref,statement_policy_ref,match_status FROM commission_transactions ORDER BY id'],
    followups: ['SELECT * FROM followups ORDER BY id'],
    advertising: ['SELECT * FROM ad_records ORDER BY report_date, id'],
  };
  r.get('/export/:name.csv', (req, res) => {
    const spec = EXPORTS[req.params.name];
    if (!spec) throw bad('Unknown export', 404);
    const rows = db.prepare(spec[0]).all();
    const headers = rows.length ? Object.keys(rows[0]) : db.prepare(spec[0].replace(/ORDER BY.*/, 'LIMIT 0')).columns().map((c) => c.name);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.csv"`);
    res.send(toCsv(headers, rows));
  });
  r.get('/export-summary.csv', (req, res) => {
    const s = reports.summary(db, filtersFrom(req));
    const v = (x) => (x && x.value != null ? x.value : 'N/A');
    const rows = [
      ['Period', `${s.filters.from} to ${s.filters.to}`], ['Currency', s.currency || 'not set'],
      ['Ad spend', s.calendar.advertising ? s.calendar.advertising.spend : 'N/A'], ['Impressions', s.calendar.advertising ? (s.calendar.advertising.impressions ?? 'N/A') : 'N/A'],
      ['Link clicks', s.calendar.advertising ? (s.calendar.advertising.linkClicks ?? 'N/A') : 'N/A'], ['Link CTR %', s.calendar.advertising ? v(s.calendar.advertising.ctr) : 'N/A'], ['CPC', s.calendar.advertising ? v(s.calendar.advertising.cpc) : 'N/A'],
      ['Unique quoted customers (all sources)', s.calendar.quotedCustomers], ['Issued policies (gross)', s.calendar.issuedPolicies], ['Unique buying customers', s.calendar.buyingCustomers],
      ['Cost per quoted customer (calendar basis, paid-attributed)', v(s.costs.costPerQuotedCustomer)], ['Cost per issued policy (calendar basis)', v(s.costs.costPerIssuedPolicy)], ['Cost per buying customer (calendar basis)', v(s.costs.costPerBuyingCustomer)],
      ['Original expected commission', s.calendar.commission.expectedOriginalCents / 100], ['Gross commission receipts', s.calendar.commission.grossReceiptsCents / 100], ['Reversals', s.calendar.commission.reversalsCents / 100],
      ['Other adjustments', s.calendar.commission.adjustmentsCents / 100], ['Net received commission', s.calendar.commission.netReceivedCents / 100],
    ].map(([metric, value]) => ({ metric, value }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="summary.csv"');
    res.send(toCsv(['metric', 'value'], rows));
  });

  // Errors from any private handler
  r.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File or request too large' });
    console.error('Private route error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return r;
}

module.exports = { privateRouter };
