'use strict';
// Applies config/decisions.json to the database in DB_PATH. Safe to re-run. Does NOT enable reminders or the public form.
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('../src/config');
const { openDb, setSetting } = require('../src/db');

const file = path.join(__dirname, '..', 'config', 'decisions.json');
const { settings } = JSON.parse(fs.readFileSync(file, 'utf8'));
const db = openDb(cfg.dbPath);
for (const [k, v] of Object.entries(settings)) setSetting(db, k, v);
console.log(`Applied ${Object.keys(settings).length} decisions to ${cfg.dbPath}.`);
console.log('Reminders remain OFF until email (SMTP) is configured and you enable them in Settings.');
