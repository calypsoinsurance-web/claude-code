'use strict';
// File parsing and value normalisation for imports. The uploaded file is parsed in memory and never written to disk.
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const cfg = require('./config');

class ImportFileError extends Error { constructor(m) { super(m); this.status = 400; } }

function sniffType(buf, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (ext === 'xlsx') { if (!isZip) throw new ImportFileError('This file is named .xlsx but is not an Excel workbook.'); return 'xlsx'; }
  if (ext === 'csv') { if (isZip || buf.includes(0)) throw new ImportFileError('This file is named .csv but does not look like plain text.'); return 'csv'; }
  throw new ImportFileError('Only .csv and .xlsx files are accepted. (Old .xls files: re-save as .xlsx or .csv.)');
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.result !== undefined) return cellText(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.error) return '';
  }
  return String(v);
}

async function parseUpload(buf, filename) {
  if (!buf || !buf.length) throw new ImportFileError('The file is empty.');
  if (buf.length > cfg.maxUploadBytes) throw new ImportFileError('The file is too large.');
  const type = sniffType(buf, filename);
  let matrix;
  if (type === 'csv') {
    try {
      matrix = parse(buf, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
    } catch (e) { throw new ImportFileError(`Could not read the CSV: ${e.message}`); }
  } else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { throw new ImportFileError('Could not read the Excel file.'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new ImportFileError('The workbook has no sheets.');
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let i = 1; i <= ws.columnCount; i += 1) vals.push(cellText(row.getCell(i).value).trim());
      matrix.push(vals);
    });
  }
  if (matrix.length < 2) throw new ImportFileError('The file needs a header row and at least one data row.');
  const headers = matrix[0].map((h) => String(h).trim());
  if (headers.some((h) => !h)) throw new ImportFileError('Every column needs a header name in the first row.');
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new ImportFileError('Two columns have the same header name. Rename one and try again.');
  const dataRows = matrix.slice(1);
  if (dataRows.length > cfg.maxImportRows) throw new ImportFileError(`Too many rows (limit ${cfg.maxImportRows}).`);
  const rows = dataRows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? '' : String(r[i]).trim()])));
  return { headers, rows, type };
}

// ---- value parsing: explicit formats only, no guessing -------------------------------------------
function parseDate(raw, fmt) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let y, m, d;
  let mt;
  if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/))) { [, y, m, d] = mt; }
  else if (fmt === 'mdy' && (mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/))) { [, m, d, y] = mt; }
  else if (fmt === 'dmy' && (mt = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s.*)?$/))) { [, d, m, y] = mt; }
  else return undefined; // present but unreadable
  y = Number(y); m = Number(m); d = Number(d);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Returns integer minor units (scale 100 for cents, 1e6 for micros) or undefined when unreadable, null when blank.
function parseMoney(raw, scale) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$€£\s,]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const v = Math.round(Number(s) * scale);
  return neg ? -v : v;
}
function parseIntStrict(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/,/g, '');
  if (!s) return null;
  if (!/^\d+$/.test(s)) return undefined;
  return Number(s);
}

module.exports = { parseUpload, parseDate, parseMoney, parseIntStrict, ImportFileError };
