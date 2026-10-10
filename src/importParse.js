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

const nonEmpty = (row) => row.filter((c) => String(c ?? '').trim() !== '').length;

// Statements often have a title block above the table and total lines below it. We find the header row
// (the first row that is nearly as wide as the widest row in the first 50), unless the user names it.
function detectHeaderRow(matrix) {
  const widths = matrix.slice(0, 50).map(nonEmpty);
  const max = Math.max(...widths);
  const need = Math.max(2, Math.ceil(max * 0.6));
  const idx = widths.findIndex((w) => w >= need);
  return idx < 0 ? 0 : idx;
}

const NUM_RE = /-?\(?\$?\s*\d[\d,]*(?:\.\d+)?\)?/g;
function numbersIn(cells) {
  const out = [];
  for (const c of cells) {
    for (const m of String(c ?? '').match(NUM_RE) || []) {
      const v = parseMoney(m, 100);
      if (typeof v === 'number') out.push(v);
    }
  }
  return out;
}

async function parseUpload(buf, filename, { headerRow, kind } = {}) {
  if (!buf || !buf.length) throw new ImportFileError('The file is empty.');
  if (buf.length > cfg.maxUploadBytes) throw new ImportFileError('The file is too large.');
  const type = sniffType(buf, filename);
  let matrix;
  if (type === 'csv') {
    try {
      matrix = parse(buf, { bom: true, skip_empty_lines: false, relax_column_count: true, trim: true });
    } catch (e) { throw new ImportFileError(`Could not read the CSV: ${e.message}`); }
  } else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { throw new ImportFileError('Could not read the Excel file.'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new ImportFileError('The workbook has no sheets.');
    matrix = [];
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r); const vals = [];
      for (let i = 1; i <= ws.columnCount; i += 1) vals.push(cellText(row.getCell(i).value).trim());
      matrix.push(vals);
    }
  }
  // keep the original 1-based row numbers so error messages match what the user sees in their spreadsheet
  const numbered = matrix.map((cells, i) => ({ n: i + 1, cells: cells.map((c) => String(c ?? '').trim()) }));
  const filled = numbered.filter((r) => nonEmpty(r.cells) > 0);
  if (filled.length < 2) throw new ImportFileError('The file needs a header row and at least one data row.');
  let hIdx;
  if (headerRow) {
    hIdx = filled.findIndex((r) => r.n === Number(headerRow));
    if (hIdx < 0) throw new ImportFileError(`Row ${headerRow} is empty or beyond the end of the file.`);
  } else hIdx = detectHeaderRow(filled.map((r) => r.cells));
  const hdr = filled[hIdx];
  const headers = hdr.cells;
  if (headers.some((h) => !h)) throw new ImportFileError(`Row ${hdr.n} was used as the header row but has blank column names. Enter the correct header row number.`);
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new ImportFileError('Two columns have the same header name. Rename one and try again.');
  const preamble = filled.slice(0, hIdx).map((r) => ({ row: r.n, text: r.cells.filter(Boolean).join(' | ') }));
  const rows = []; const skipped = [];
  const skipTotals = kind === 'ads' || kind === 'commissions';
  for (const r of filled.slice(hIdx + 1)) {
    const count = nonEmpty(r.cells);
    const isTotal = r.cells.some((c) => /^total\b/i.test(c));
    if (count <= 1) { skipped.push({ row: r.n, reason: 'note line (one cell only)', text: r.cells.filter(Boolean).join(' '), numbers: isTotal ? numbersIn(r.cells) : [] }); continue; }
    if (skipTotals && isTotal && count <= 3) { skipped.push({ row: r.n, reason: 'total row', text: r.cells.filter(Boolean).join(' | '), numbers: numbersIn(r.cells) }); continue; }
    rows.push({ n: r.n, data: Object.fromEntries(headers.map((h, i) => [h, r.cells[i] == null ? '' : r.cells[i]])) });
  }
  if (!rows.length) throw new ImportFileError('No data rows were found below the header row.');
  if (rows.length > cfg.maxImportRows) throw new ImportFileError(`Too many rows (limit ${cfg.maxImportRows}).`);
  return { headers, rows, type, headerRowNumber: hdr.n, preamble, skipped };
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
