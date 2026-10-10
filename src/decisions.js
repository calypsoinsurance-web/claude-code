'use strict';
// Applies config/decisions.json. By default only fills settings that are still EMPTY, so it never overwrites
// something the owner changed later in Settings. Pass { overwrite: true } to force.
const fs = require('node:fs');
const path = require('node:path');
const { getSetting, setSetting } = require('./db');

function applyDecisions(db, { overwrite = false } = {}) {
  const file = path.join(__dirname, '..', 'config', 'decisions.json');
  const { settings } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const applied = [];
  for (const [k, v] of Object.entries(settings)) {
    const cur = getSetting(db, k);
    if (overwrite || cur === null || cur === '') { setSetting(db, k, v); applied.push(k); }
  }
  return applied;
}
module.exports = { applyDecisions };
