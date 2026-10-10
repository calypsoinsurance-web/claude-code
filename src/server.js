'use strict';
const cfg = require('./config');
const { openDb, getSetting } = require('./db');
const { createApp } = require('./app');
const { createFetchAdapter } = require('./integrations/fetch');
const reminders = require('./reminders');

const db = openDb(cfg.dbPath);
const adapter = createFetchAdapter(cfg);
const transport = reminders.makeTransport(cfg);
const app = createApp({ db, adapter, transport, cfg });
reminders.startScheduler(db, transport, cfg);

if (!cfg.adminEmail || !cfg.adminPasswordHash) console.warn('WARNING: ADMIN_EMAIL / ADMIN_PASSWORD_HASH not set. Nobody can sign in. See README.');
if (cfg.isProduction && !cfg.publicBaseUrl.startsWith('https://')) console.warn('WARNING: PUBLIC_BASE_URL should be an https:// address in production.');
app.listen(cfg.port, () => {
  console.log(`CRM running on http://localhost:${cfg.port}/app/  (database: ${cfg.dbPath})${getSetting(db, 'is_demo') === 'true' ? '  ** DEMO DATA **' : ''}`);
});
