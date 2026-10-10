'use strict';
// All configuration comes from environment variables (see .env.example). No secrets live in source.
const fs = require('node:fs');
const path = require('node:path');

// Minimal .env loader so beginners do not need extra tooling. Real environment variables win.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = process.env;
module.exports = {
  port: Number(env.PORT || 3000),
  isProduction: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'crm.sqlite'),
  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPasswordHash: env.ADMIN_PASSWORD_HASH || '',
  sessionDays: Number(env.SESSION_DAYS || 7),
  publicBaseUrl: env.PUBLIC_BASE_URL || '',
  // Origins (your own website) allowed to call the public tracking and quote endpoints from a browser.
  publicAllowedOrigins: (env.PUBLIC_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Off by default: tracking cookies/storage may need a privacy notice or consent. Turn on only after you decide.
  trackingEnabled: env.TRACKING_ENABLED === 'true',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  },
  // The live Fetch adapter stays disabled until documentation and access are confirmed (see docs/VALIDATION_REPORT.md).
  fetchLiveEnabled: env.FETCH_LIVE_ENABLED === 'true',
  reminderTickSeconds: Number(env.REMINDER_TICK_SECONDS || 300),
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  maxImportRows: Number(env.MAX_IMPORT_ROWS || 50000),
};
