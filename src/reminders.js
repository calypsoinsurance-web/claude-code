'use strict';
// Reminder emails go ONLY to ADMIN_EMAIL (the configured, owner-confirmed address). The recipient is never read
// from request data, so a bug or attack elsewhere cannot redirect reminders to someone else.
// Duplicate protection: reminder_deliveries has UNIQUE(followup_id, due_date); a row is claimed atomically
// (pending -> sending) before sending. If the process dies mid-send the row stays "sending" (uncertain) and is
// shown to the owner for a manual retry rather than being re-sent automatically (at-most-once by default).
const nodemailer = require('nodemailer');
const { now, getSetting } = require('./db');
const { localDate } = require('./reports');

const MAX_AUTO_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60 * 1000;

function makeTransport(cfg) {
  if (!cfg.smtp.host || !cfg.smtp.from) return null;
  return nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465, auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined });
}

function queueDue(db, today) {
  const due = db.prepare("SELECT id, due_date FROM followups WHERE status='open' AND due_date <= ?").all(today);
  const ins = db.prepare("INSERT OR IGNORE INTO reminder_deliveries(followup_id,due_date,status) VALUES (?,?, 'pending')");
  let n = 0;
  for (const f of due) n += ins.run(f.id, f.due_date).changes;
  return n;
}

function claim(db, opts) {
  // Atomic claim: only rows still pending (or eligible failed) flip to sending.
  const ids = db.prepare(`SELECT id FROM reminder_deliveries
    WHERE (status='pending' OR (status='failed' AND attempts < ? AND (claimed_at IS NULL OR claimed_at < ?)))
      AND followup_id IN (SELECT id FROM followups WHERE status='open')`).all(MAX_AUTO_ATTEMPTS, opts.retryFailedBefore || '0000').map((r) => r.id);
  const claimed = [];
  const upd = db.prepare("UPDATE reminder_deliveries SET status='sending', claimed_at=?, attempts=attempts+1 WHERE id=? AND (status='pending' OR status='failed')");
  for (const id of ids) if (upd.run(now(), id).changes === 1) claimed.push(id);
  return claimed;
}

async function sendClaimed(db, transport, cfg, ids) {
  if (!ids.length) return { sent: 0, failed: 0 };
  const rows = ids.map((id) => db.prepare(`SELECT d.id, d.due_date, f.note, c.name FROM reminder_deliveries d JOIN followups f ON f.id=d.followup_id JOIN customers c ON c.id=f.customer_id WHERE d.id=?`).get(id));
  const lines = rows.map((r) => `• ${r.name} — due ${r.due_date}: ${r.note.slice(0, 200)}`);
  const text = `You have ${rows.length} follow-up${rows.length === 1 ? '' : 's'} due or overdue:\n\n${lines.join('\n')}\n\nOpen your CRM${cfg.publicBaseUrl ? `: ${cfg.publicBaseUrl}/app/#/followups` : ''}\n`;
  try {
    if (!transport) throw new Error('Email is not configured (SMTP settings missing)');
    if (!cfg.adminEmail) throw new Error('ADMIN_EMAIL is not set');
    await transport.sendMail({ from: cfg.smtp.from, to: cfg.adminEmail, subject: `Follow-up reminder: ${rows.length} due`, text });
    const t = now();
    for (const r of rows) db.prepare("UPDATE reminder_deliveries SET status='sent', sent_at=?, last_error=NULL WHERE id=?").run(t, r.id);
    return { sent: rows.length, failed: 0 };
  } catch (e) {
    const msg = String(e.message || e).slice(0, 300);
    for (const r of rows) db.prepare("UPDATE reminder_deliveries SET status='failed', last_error=? WHERE id=?").run(msg, r.id);
    return { sent: 0, failed: rows.length, error: msg };
  }
}

function reminderSettings(db) {
  return {
    enabled: getSetting(db, 'reminder_enabled') === 'true',
    confirmed: getSetting(db, 'reminder_email_confirmed') === 'true',
    hour: Number(getSetting(db, 'reminder_hour')),
    tz: getSetting(db, 'reminder_timezone'),
  };
}

// Called by the scheduler tick (and by the manual "run now" button with force=true).
async function runReminders(db, transport, cfg, { force = false, at = new Date() } = {}) {
  const s = reminderSettings(db);
  if (!force) {
    if (!s.enabled || !s.confirmed || !s.tz || Number.isNaN(s.hour)) return { skipped: 'Reminders are not enabled' };
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: s.tz, hour: '2-digit', hour12: false }).format(at));
    if (localHour < s.hour) return { skipped: 'Before the scheduled hour' };
  } else if (!s.tz && !getSetting(db, 'reporting_timezone')) {
    return { skipped: 'Set a time zone first' };
  }
  const tz = s.tz || getSetting(db, 'reporting_timezone');
  const today = localDate(at.toISOString(), tz);
  const queued = queueDue(db, today);
  const ids = claim(db, { retryFailedBefore: new Date(at.getTime() - RETRY_AFTER_MS).toISOString() });
  const r = await sendClaimed(db, transport, cfg, ids);
  return { queued, ...r };
}

// Manual retry for a failed (or uncertain "sending") delivery. Explicit user action.
async function retryDelivery(db, transport, cfg, deliveryId) {
  const row = db.prepare('SELECT * FROM reminder_deliveries WHERE id = ?').get(deliveryId);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  if (row.status === 'sent') throw Object.assign(new Error('Already sent'), { status: 409 });
  db.prepare("UPDATE reminder_deliveries SET status='pending' WHERE id=? AND status IN ('failed','sending')").run(deliveryId);
  const upd = db.prepare("UPDATE reminder_deliveries SET status='sending', claimed_at=?, attempts=attempts+1 WHERE id=? AND status='pending'").run(now(), deliveryId);
  if (upd.changes !== 1) throw Object.assign(new Error('Could not claim this reminder'), { status: 409 });
  return sendClaimed(db, transport, cfg, [deliveryId]);
}

async function sendTest(transport, cfg) {
  if (!transport) throw Object.assign(new Error('Email is not configured (SMTP settings missing)'), { status: 400 });
  await transport.sendMail({ from: cfg.smtp.from, to: cfg.adminEmail, subject: 'CRM test reminder', text: 'This is a test message from your CRM. Reminders will be sent to this address only.' });
}

function startScheduler(db, transport, cfg) {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { await runReminders(db, transport, cfg); } catch (e) { console.error('Reminder tick failed:', e.message); } finally { running = false; }
  };
  const h = setInterval(tick, cfg.reminderTickSeconds * 1000);
  h.unref();
  return () => clearInterval(h);
}

module.exports = { makeTransport, runReminders, retryDelivery, sendTest, startScheduler, queueDue, claim, sendClaimed, reminderSettings };
