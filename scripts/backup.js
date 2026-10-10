'use strict';
// Makes a consistent copy of the database using SQLite's online backup (safe while the app is running).
// Usage: npm run backup            -> data/backups/crm-YYYY-MM-DDTHH-MM-SS.sqlite
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const cfg = require('../src/config');

(async () => {
  if (!fs.existsSync(cfg.dbPath)) { console.error(`No database at ${cfg.dbPath}`); process.exit(1); }
  const dir = path.join(path.dirname(cfg.dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `crm-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`);
  const db = new DatabaseSync(cfg.dbPath, { readOnly: true });
  await backup(db, out);
  db.close();
  fs.chmodSync(out, 0o600);
  console.log(`Backup written: ${out}\nCopy it somewhere OFF this computer/server (it contains customer data).`);
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
