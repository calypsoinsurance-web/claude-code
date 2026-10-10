'use strict';
// CSV export with spreadsheet formula-injection protection: cells starting with = + - @ (or tab/CR) get a leading apostrophe.
function cell(v) {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return `﻿${[headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n')}\r\n`;
}
module.exports = { toCsv, cell };
