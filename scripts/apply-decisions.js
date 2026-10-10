'use strict';
// Usage: npm run apply-decisions            (fills only settings that are still empty)
//        npm run apply-decisions -- --overwrite
const cfg = require('../src/config');
const { openDb } = require('../src/db');
const { applyDecisions } = require('../src/decisions');

const db = openDb(cfg.dbPath);
const applied = applyDecisions(db, { overwrite: process.argv.includes('--overwrite') });
console.log(`Applied ${applied.length} decision(s) to ${cfg.dbPath}${applied.length ? `: ${applied.join(', ')}` : ' (nothing new to apply)'}.`);
console.log('Reminders and the public pages remain OFF until you enable them in Settings.');
