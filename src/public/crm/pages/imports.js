import { h, api, table, field, banner, cents, fmtTs, announce } from '../lib.js';

const KINDS = [
  ['ads', 'Advertising report', 'Daily spend, impressions and clicks from Meta, TikTok, Google or LinkedIn. A manual fallback — not an automatic sync.'],
  ['quotes', 'Quotes (customer + pet + quote)', 'A quote report from Fetch / First Connect. Each row = one quote.'],
  ['policies', 'Issued policies', 'A policy report. You tell the app which rows are confirmed issued.'],
  ['commissions', 'Commission statement', 'Receipts, reversals and adjustments from a commission statement.'],
];
const DATE_FORMATS = [['', 'Choose…'], ['iso', 'YYYY-MM-DD'], ['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY']];

export async function imports(main) {
  const body = h('div');
  const tabs = ['New import', 'History', 'Review queue'];
  let tab = 0;
  const draw = () => {
    main.replaceChildren(h('h1', null, 'Imports'),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map((t, i) => h('button', { role: 'tab', 'aria-selected': String(i === tab), onclick: () => { tab = i; draw(); } }, t))), body);
    [newImport, history, review][tab](body);
  };
  draw();
}

function newImport(body) {
  const kindSel = h('select', null, KINDS.map(([k, l]) => h('option', { value: k }, l)));
  const file = h('input', { type: 'file', accept: '.csv,.xlsx' });
  const headerRow = h('input', { type: 'number', min: '1', placeholder: 'auto' });
  const msg = h('div', { role: 'status' });
  const stageArea = h('div');
  const desc = h('p', { class: 'muted' }, KINDS[0][2]);
  kindSel.addEventListener('change', () => { desc.textContent = KINDS.find((k) => k[0] === kindSel.value)[2]; });
  body.replaceChildren(
    h('p', null, 'Re-importing the same file is safe: existing records are matched and not duplicated. Files are read in memory and are not stored. Sample templates (synthetic) are in the ', h('code', null, 'templates/'), ' folder.'),
    h('form', { class: 'inline', onsubmit: async (e) => {
      e.preventDefault(); msg.replaceChildren();
      if (!file.files[0]) return msg.replaceChildren(banner('error', 'Choose a file first.'));
      try {
        const f = file.files[0];
        const r = await api(`/imports/upload?kind=${kindSel.value}${headerRow.value ? `&header_row=${Number(headerRow.value)}` : ''}`, { method: 'POST', raw: await f.arrayBuffer(), headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' } });
        mapStep(stageArea, kindSel.value, r);
      } catch (x) { msg.replaceChildren(banner('error', x.message)); }
    } }, field('What are you importing?', kindSel), field('File (.csv or .xlsx)', file), field('Header row number (optional)', headerRow, 'Leave blank: the app finds the table header itself and tells you which row it used.'), h('button', { type: 'submit' }, 'Read file')),
    desc, msg, stageArea);
}

function optionFields(kind, headers) {
  const o = {}; const rows = [];
  const add = (key, label, node, hint) => { o[key] = node; rows.push(field(label, node, hint)); };
  const text = (p) => h('input', p || {});
  const sel = (opts) => h('select', null, opts.map(([v, l]) => h('option', { value: v }, l)));
  add('date_format', 'How are dates written in this file?*', sel(DATE_FORMATS));
  if (kind === 'ads') {
    add('platform', 'Advertising platform*', sel([['', 'Choose…'], ['meta', 'Meta (Facebook/Instagram)'], ['tiktok', 'TikTok'], ['google', 'Google Ads'], ['linkedin', 'LinkedIn'], ['other', 'Other']]));
    add('level', 'What does each row represent?*', sel([['', 'Choose…'], ['account', 'Whole account (per day)'], ['campaign', 'Campaign (per day)'], ['adset', 'Ad group / ad set (per day)'], ['ad', 'Individual ad (per day)']]), 'Rows at different levels are never added together.');
    add('account_id', 'Account ID (if not a column)', text());
    add('currency', 'Currency (if not a column)', text({ maxlength: 3, placeholder: 'USD' }));
    add('reporting_timezone', 'Time zone of this report*', text({ placeholder: 'America/New_York' }));
    add('link_click_metric', 'Exact name of the link-click column in the platform', text({ placeholder: 'as named by the platform' }), 'Required if you map link clicks.');
    add('link_click_definition', 'Platform definition of that metric', text(), 'Copy it from the platform\'s documentation. Reports with different definitions are not combined.');
    add('all_click_metric', 'Exact name of the all-clicks column', text(), 'Required if you map all clicks. Kept separate from link clicks.');
  }
  if (kind === 'policies') {
    add('carrier', 'Carrier (if not a column)', text({ placeholder: 'e.g. Fetch' }));
    add('issued_rule', 'Which rows are confirmed issued policies?*', sel([['', 'Choose…'], ['all', 'Every row is an issued policy'], ['status_values', 'Only rows whose status is listed below']]));
    add('issued_values', 'Status values that mean issued', text({ placeholder: 'Active, Cancelled' }), 'Comma separated. Include cancelled/lapsed if those policies were issued. Payment-pending is not issuance.');
  }
  if (kind === 'commissions') {
    add('currency', 'Statement currency*', text({ maxlength: 3, placeholder: 'USD' }));
    add('statement_ref', 'Statement reference (if not a column)', text({ placeholder: '2026-03 statement' }));
    add('txn_date_fixed', 'Date to use if the file has no date column', text({ placeholder: 'in the date format chosen above' }), 'Applied to every line. Use the date that matches your rule for when commission counts as received (e.g. the statement\'s "Date Sent" or the statement month end). Do not use a policy effective date.');
    add('carrier', 'Carrier (optional, helps matching)', text());
    add('sign_convention', 'How does the statement show reversals?*', sel([['', 'Choose…'], ['signed', 'Reversals are negative numbers; receipts positive'], ['type_column', 'A type column says receipt / reversal / adjustment']]));
    add('amount_sign', 'With a type column, are amounts…', sel([['', 'Choose…'], ['as_is', 'Already signed'], ['absolute', 'Always positive (app applies the sign for receipts/reversals)']]));
    add('receipt_values', 'Type values meaning receipt', text({ placeholder: 'Commission, Payment' }));
    add('reversal_values', 'Type values meaning reversal', text({ placeholder: 'Chargeback' }));
    add('adjustment_values', 'Type values meaning adjustment', text({ placeholder: 'Adjustment' }));
  }
  if (kind === 'quotes' || kind === 'policies') add('coverage_columns', 'Coverage columns to keep (optional)', text({ placeholder: headers.slice(0, 2).join(', ') }), 'Comma separated column names; stored as recorded.');
  return { o, rows };
}

function mapStep(area, kind, st) {
  const mapSel = {};
  const { o, rows } = optionFields(kind, st.headers);
  const mapRows = Object.entries(st.fields).map(([f, label]) => {
    const sel = h('select', { id: `m_${f}` }, h('option', { value: '' }, '— not in file —'), st.headers.map((hd) => h('option', { value: hd, selected: st.suggested[f] === hd }, hd)));
    mapSel[f] = sel;
    return h('div', { class: 'map-row' }, h('label', { for: `m_${f}` }, label), sel);
  });
  const result = h('div', { 'aria-live': 'polite' });
  const gather = () => {
    const mapping = {}; for (const [f, s] of Object.entries(mapSel)) if (s.value) mapping[f] = s.value;
    const options = {}; const listy = ['issued_values', 'receipt_values', 'reversal_values', 'adjustment_values', 'coverage_columns'];
    for (const [k, n] of Object.entries(o)) { const v = n.value.trim(); if (!v) continue; options[k] = listy.includes(k) ? v.split(',').map((x) => x.trim()).filter(Boolean) : v; }
    return { mapping, options };
  };
  const submit = async (commit) => {
    result.replaceChildren(h('p', { class: 'muted' }, commit ? 'Importing…' : 'Checking…'));
    try {
      const r = await api(`/imports/${st.importId}/${commit ? 'commit' : 'preview'}`, { method: 'POST', body: gather() });
      if (!r.ok) return result.replaceChildren(banner('error', h('strong', null, 'Fix these first:'), h('ul', null, r.problems.map((p) => h('li', null, p)))));
      result.replaceChildren(summary(r, commit));
      announce(commit ? 'Import committed' : 'Preview ready');
    } catch (x) { result.replaceChildren(banner('error', x.message)); }
  };
  area.replaceChildren(
    st.alreadyImportedAs ? banner('', `This exact file was already imported (import #${st.alreadyImportedAs.importId}, ${fmtTs(st.alreadyImportedAs.at)}). Importing again will not create duplicates.`) : null,
    h('p', null, `Table header found on row ${st.headerRow}. ${st.rowCount} data row(s) will be read.`),
    st.preamble.length ? h('details', { class: 'card' }, h('summary', null, `Lines above the table (${st.preamble.length}) — statement details to copy values from`), h('ul', null, st.preamble.map((p) => h('li', null, `Row ${p.row}: ${p.text}`)))) : null,
    st.skipped.length ? banner('', h('strong', null, `${st.skipped.length} row(s) below the table were skipped and will not be imported: `), st.skipped.map((x) => `row ${x.row} (${x.reason}: ${x.text.slice(0, 80)})`).join('; ')) : null,
    h('h2', null, `Step 2: match your columns (${st.rowCount} data rows)`),
    h('p', { class: 'muted' }, 'Suggestions are only hints based on header names. Check each one. Fields marked * are required.'),
    table('First rows of your file', st.headers, st.sample.map((r) => st.headers.map((hd) => r[hd])), { empty: '' }),
    h('div', { class: 'card' }, mapRows),
    h('h2', null, 'Step 3: tell the app what the file means'), h('div', { class: 'card' }, h('div', { class: 'filters' }, rows)),
    h('div', { class: 'actions' }, h('button', { onclick: () => submit(false) }, 'Preview (nothing is saved)'), h('button', { class: 'secondary', onclick: () => { if (confirm('Save this import to the database?')) submit(true); } }, 'Commit import')),
    result);
}

function summary(r, committed) {
  const c = r.counts;
  return h('div', null,
    banner(committed ? 'ok' : '', h('strong', null, committed ? 'Import saved. ' : 'Preview only — nothing has been saved. '),
      `${r.total} rows: ${c.created} new, ${c.updated} updated, ${c.unchanged} already present (skipped), ${c.review} sent to review, ${c.error} with errors.`),
    (() => { if (!r.commissionTotalsCents) return null; const stated = r.skippedRows.flatMap((x) => x.numbers); const net = r.commissionTotalsCents.receipt + r.commissionTotalsCents.reversal + r.commissionTotalsCents.adjustment; if (!stated.length) return h('p', { class: 'muted' }, 'The file states no total, so there is nothing to reconcile against.'); const ok = stated.includes(net); return banner(ok ? 'ok' : 'error', ok ? `Reconciled: the total stated in the file (${cents(net)}) equals the sum of the lines to be imported.` : `Does NOT reconcile: the file states ${stated.map((v) => cents(v)).join(' / ')}, but the lines to be imported sum to ${cents(net)}. Check the type mapping and the row errors before committing.`); })(),
    r.commissionTotalsCents ? h('p', null, `Totals in this file — receipts ${cents(r.commissionTotalsCents.receipt)}, reversals ${cents(r.commissionTotalsCents.reversal)}, adjustments ${cents(r.commissionTotalsCents.adjustment)}. Check these against the statement.`) : null,
    Object.keys(r.notes).length ? h('ul', null, Object.entries(r.notes).map(([k, v]) => h('li', null, `${v} row(s): ${k}`))) : null,
    ['status', 'frequency', 'types'].map((k) => Object.keys(r.distinct[k]).length ? h('p', { class: 'muted' }, `Distinct ${k} values found: ${Object.entries(r.distinct[k]).map(([a, b]) => `${a} (${b})`).join(', ')}`) : null),
    r.errors.length ? table(`Row errors (${r.errors.length})`, [{ label: 'Spreadsheet row', num: 1 }, 'Problem'], r.errors.slice(0, 100).map((e) => [String(e.row), e.message])) : null);
}

async function history(body) {
  const r = await api('/imports');
  body.replaceChildren(table('Import history', ['#', 'Type', 'File', 'Status', { label: 'Rows', num: 1 }, { label: 'New', num: 1 }, { label: 'Updated', num: 1 }, { label: 'Skipped', num: 1 }, { label: 'Review', num: 1 }, { label: 'Errors', num: 1 }, 'When'],
    r.rows.map((i) => [String(i.id), i.kind, i.filename, i.status, String(i.rows_total), String(i.rows_created), String(i.rows_updated), String(i.rows_unchanged), String(i.rows_review), i.rows_errored ? h('a', { href: '#', onclick: async (e) => { e.preventDefault(); const d = await api(`/imports/${i.id}`); alert(d.errors.map((x) => `Row ${x.row_number}: ${x.message}`).join('\n') || 'No errors'); } }, String(i.rows_errored)) : '0', fmtTs(i.committed_at || i.created_at)]),
    { empty: 'No imports yet.' }));
}

async function review(body) {
  const r = await api('/review');
  const msg = h('div', { role: 'status' });
  const resolveRow = (it) => {
    const cid = h('input', { type: 'number', min: '1', 'aria-label': `Customer ID to link for item ${it.id}`, placeholder: 'Customer #' });
    const go = async (action) => { try { await api(`/review/${it.id}/resolve`, { method: 'POST', body: { action, customer_id: Number(cid.value) } }); review(body); } catch (x) { msg.replaceChildren(banner('error', x.message)); } };
    return h('div', { class: 'actions' }, cid, h('button', { class: 'secondary', onclick: () => go('link') }, 'Link to this customer'), h('button', { class: 'secondary', onclick: () => confirm('Create a separate customer record for this row?') && go('create_new') }, 'Create separate customer'));
  };
  body.replaceChildren(msg,
    h('h2', null, 'Uncertain customer matches'), h('p', { class: 'muted' }, 'Customers are never merged by name. Rows with conflicting or missing identifiers wait here until you decide.'),
    table('Customer match review', ['Import row', 'Type', 'Why it needs review', 'Details', 'Decision'], r.items.map((it) => [`#${it.import_id} row ${it.row_number}`, it.payload.kind, it.reason, `${it.payload.values.customer.name || ''} ${it.payload.values.customer.email || ''} ${it.payload.values.customer.provider_customer_id || ''}`.trim() || '—', resolveRow(it)]), { empty: 'Nothing waiting for review.' }),
    h('h2', null, 'Unmatched commission statement lines'), h('p', { class: 'muted' }, 'Kept out of per-policy balances. They are matched automatically only by exact policy number. You can link one manually by policy ID (find the ID in a customer\'s policy list or export).'),
    table('Unmatched commission lines', ['Date', 'Type', { label: 'Amount', num: 1 }, 'Statement', 'Policy # on statement', 'Link to policy ID'], r.unmatchedCommissions.map((t) => [t.txn_date, t.type, cents(t.amount_cents, t.currency), t.statement_ref || '—', t.statement_policy_ref || '—',
      h('div', { class: 'actions' }, h('button', { class: 'secondary', onclick: async () => { const id = Number(prompt('Policy ID to link this line to:')); if (!id) return; try { await api(`/commissions/${t.id}/match`, { method: 'POST', body: { policy_id: id } }); review(body); } catch (x) { msg.replaceChildren(banner('error', x.message)); } } }, 'Link…'))]), { empty: 'No unmatched lines.' }),
    h('h2', null, 'Issued policies with unknown originating quote'), h('p', { class: 'muted' }, 'Their attribution is Unknown. The app never picks a quote from the customer\'s history.'),
    table('Policies without a verified quote link', ['Policy', 'Carrier', 'Issued', 'Customer'], r.policiesWithoutVerifiedQuote.map((p) => [p.policy_number, p.carrier, p.issue_date, h('a', { href: `#/customer/${p.customer_id}` }, `#${p.customer_id}`)]), { empty: 'All issued policies are linked to a verified quote.' }));
}
