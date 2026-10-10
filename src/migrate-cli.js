'use strict';
require('./config');
const { openDb } = require('./db');
const cfg = require('./config');
openDb(cfg.dbPath);
console.log(`Database is up to date: ${cfg.dbPath}`);
