import { h, api, table, field, banner, cents, fmtTs, todayStr, announce } from '../lib.js';

export async function customers(main) {
  const st = { q: '', source: '', has_policy: '', page: 1 };
  const out = h('div');
  const q = h('input', { type: 'search', placeholder: 'Name, email, phone, address, ID' });
  const source = h('select', null, h('option', { value: '' }, 'Any first source'), ['paid', 'organic', 'referral', 'direct', 'unknown'].map((s) => h('option', { value: s }, s)));
  const hp = h('select', null, h('option', { value: '' }, 'Any'), h('option', { value: 'yes' }, 'Has issued policy'), h('option', { value: 'no' }, 'No issued policy'));
  const add = addForm();
  main.replaceChildren(h('h1', null, 'Customers'),
    h('form', { class: 'filters', role: 'search', onsubmit: (e) => { e.preventDefault(); Object.assign(st, { q: q.value, source: source.value, has_policy: hp.value, page: 1 }); load(); } },
      field('Search', q), field('First tracked source', source), field('Policies', hp), h('button', { type: 'submit' }, 'Search'),
      h('a', { class: 'btn secondary', href: '/api/export/customers.csv' }, 'Export CSV')), out,
    h('details', { class: 'card' }, h('summary', null, 'Add a customer manually'), add));
  async function load() {
    const r = await api(`/customers?${new URLSearchParams({ ...st, page: st.page })}`);
    out.replaceChildren(table(`Customers (${r.total})`, ['Name', 'Email', 'Phone', 'City', 'State', 'ZIP', 'First source', { label: 'Pets', num: 1 }, { label: 'Quotes', num: 1 }, { label: 'Policies', num: 1 }],
      r.rows.map((c) => [h('a', { href: `#/customer/${c.id}` }, c.name), c.email || '—', c.phone || '—', c.city || '—', c.state || '—', c.postal_code || '—', c.first_source_type ? `${c.first_source_type}${c.first_source_platform ? ` / ${c.first_source_platform}` : ''}` : 'Unknown', String(c.pets), String(c.quotes), String(c.policies)]),
      { empty: r.total === 0 && !st.q ? 'No customers yet. Customers appear when someone requests a quote on your page, or when you import a quote/policy report on the Imports page.' : 'No customers match these filters.' }),
    h('div', { class: 'actions' }, h('button', { class: 'secondary', disabled: st.page <= 1, onclick: () => { st.page -= 1; load(); } }, 'Previous'), h('span', { class: 'muted' }, `Page ${r.page}`), h('button', { class: 'secondary', disabled: r.page * r.size >= r.total, onclick: () => { st.page += 1; load(); } }, 'Next')));
  }
  function addForm() {
    const f = { first_name: h('input', { required: true, autocomplete: 'off' }), last_name: h('input', { required: true, autocomplete: 'off' }), email: h('input', { type: 'email' }), phone: h('input', { type: 'tel' }),
      address_line1: h('input'), address_line2: h('input'), city: h('input'), state: h('input', { maxlength: 2 }), postal_code: h('input', { maxlength: 12 }) };
    const msg = h('div', { role: 'status' });
    return h('form', { class: 'inline', onsubmit: async (e) => { e.preventDefault(); try { const r = await api('/customers', { method: 'POST', body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])) }); location.hash = `#/customer/${r.id}`; } catch (x) { msg.replaceChildren(banner('error', x.message)); } } },
      field('First name*', f.first_name), field('Last name*', f.last_name), field('Email', f.email), field('Phone', f.phone), field('Address line 1', f.address_line1), field('Address line 2', f.address_line2), field('City', f.city), field('State', f.state), field('ZIP', f.postal_code), h('button', { type: 'submit' }, 'Add customer'), msg);
  }
  load();
}

export async function customerDetail(main, id) {
  const d = await api(`/customers/${Number(id)}`);
  const c = d.customer;
  const notes = h('textarea', { 'aria-label': 'Notes' }, c.notes || '');
  const fu = { due: h('input', { type: 'date', value: todayStr(), required: true }), note: h('input', { required: true, maxlength: 2000 }) };
  const petF = { name: h('input', { required: true }), species: h('select', null, h('option', { value: '' }, '—'), h('option', { value: 'dog' }, 'Dog'), h('option', { value: 'cat' }, 'Cat')), breed: h('input'), age: h('input', { placeholder: 'e.g. 3 years' }) };
  const msg = h('div', { role: 'status' });
  const ef = { first_name: h('input', { value: c.first_name || '' }), last_name: h('input', { value: c.last_name || '' }), email: h('input', { type: 'email', value: c.email || '' }), phone: h('input', { type: 'tel', value: c.phone || '' }),
    address_line1: h('input', { value: c.address_line1 || '' }), address_line2: h('input', { value: c.address_line2 || '' }), city: h('input', { value: c.city || '' }), state: h('input', { maxlength: 2, value: c.state || '' }), postal_code: h('input', { maxlength: 12, value: c.postal_code || '' }) };
  const editCard = () => h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await api(`/customers/${c.id}`, { method: 'PATCH', body: Object.fromEntries(Object.entries(ef).map(([k, v]) => [k, v.value])) }); msg.replaceChildren(banner('ok', 'Customer details saved.')); announce('Saved'); } catch (x) { msg.replaceChildren(banner('error', x.message)); } } },
    c.first_name || c.last_name ? null : banner('', `This record has a single full name ("${c.name}") imported without separate first/last columns. Enter first and last name below to split it; nothing is split automatically.`),
    h('div', { class: 'filters' }, field('First name', ef.first_name), field('Last name', ef.last_name), field('Email', ef.email), field('Phone', ef.phone)),
    h('div', { class: 'filters' }, field('Address line 1', ef.address_line1), field('Address line 2', ef.address_line2), field('City', ef.city), field('State', ef.state), field('ZIP', ef.postal_code)),
    h('dl', null, h('dt', null, 'First tracked source'), h('dd', null, c.first_source_type ? `${c.first_source_type}${c.first_source_platform ? ` / ${c.first_source_platform}` : ''}` : 'Unknown'), h('dt', null, 'Provider customer ID'), h('dd', null, c.provider_customer_id || '—'), h('dt', null, 'Created'), h('dd', null, fmtTs(c.created_at))),
    c.identity_note ? banner('', c.identity_note) : null, h('button', { type: 'submit' }, 'Save details'));
  const petName = (pid) => (d.pets.find((p) => p.id === pid) || {}).name || '—';
  main.replaceChildren(
    h('p', null, h('a', { href: '#/customers' }, '← Customers')), h('h1', null, c.name), msg,
    editCard(),
    h('h2', null, 'Notes'), notes,
    h('p', null, h('button', { onclick: async () => { try { await api(`/customers/${c.id}`, { method: 'PATCH', body: { notes: notes.value } }); msg.replaceChildren(banner('ok', 'Notes saved.')); announce('Notes saved'); } catch (x) { msg.replaceChildren(banner('error', x.message)); } } }, 'Save notes')),
    h('h2', null, 'Pets'),
    table('Pets', ['Name', 'Species', 'Breed', 'Age (as recorded)', 'Recorded on'], d.pets.map((p) => [p.name, p.species || '—', p.breed || '—', p.age_as_recorded || '—', p.age_recorded_on || '—']), { empty: 'No pets recorded.' }),
    h('details', { class: 'card' }, h('summary', null, 'Add a pet'), h('form', { class: 'inline', onsubmit: async (e) => { e.preventDefault(); try { await api(`/customers/${c.id}/pets`, { method: 'POST', body: { name: petF.name.value, species: petF.species.value || undefined, breed: petF.breed.value, age: petF.age.value } }); customerDetail(main, id); } catch (x) { msg.replaceChildren(banner('error', x.message)); } } },
      field('Pet name*', petF.name), field('Dog or cat', petF.species), field('Breed', petF.breed), field('Age', petF.age), h('button', { type: 'submit' }, 'Add pet'))),
    h('h2', null, 'Quotes (history is kept)'),
    table('Quotes', ['Quote date', 'Pet', 'Premium', 'Frequency', 'Status', 'Provider quote ID', 'Source', 'Attribution at quote time'],
      d.quotes.map((q) => { const snap = JSON.parse(q.attribution_snapshot_json); const t = (snap.touches || []).slice(-1)[0]; return [q.quoted_date || fmtTs(q.quoted_at), petName(q.pet_id), cents(q.premium_cents), q.payment_frequency || '—', q.status, q.provider_quote_id || '—', q.source, t ? `${snap.touches.length} tracked visit(s); latest: ${t.source_type}${t.platform ? ` / ${t.platform}` : ''}` : 'No tracked visits (Unknown)']; }), { empty: 'No quotes.' }),
    h('h2', null, 'Policies'),
    table('Policies', ['Policy number', 'Carrier', 'Pet', 'Issued', 'Effective', 'Status', 'Cancelled', 'Premium', 'Originating quote'],
      d.policies.map((p) => [p.policy_number, p.carrier, petName(p.pet_id), p.is_issued ? p.issue_date : 'Not issued', p.effective_date || '—', p.status || '—', p.cancellation_date || '—', cents(p.premium_cents), p.quote_id ? `Quote #${p.quote_id} (verified by provider quote ID)` : 'Unknown']), { empty: 'No policies.' }),
    h('h2', null, 'Tracked visits linked to this customer'),
    table('Tracked visits', ['When', 'Type', 'Platform', 'UTM source', 'UTM medium', 'UTM campaign', 'Referrer'], d.visits.map((v) => [fmtTs(v.visited_at), v.source_type, v.platform || '—', v.utm_source || '—', v.utm_medium || '—', v.utm_campaign || '—', v.referrer || '—']), { empty: 'None. Visits are only linked when a quote form submission carries the visitor ID.' }),
    h('h2', null, 'Follow-ups'),
    table('Follow-ups', ['Due', 'Status', 'Note'], d.followups.map((f) => [f.due_date, f.status, f.note]), { empty: 'No follow-ups.' }),
    h('form', { class: 'inline', onsubmit: async (e) => { e.preventDefault(); try { await api('/followups', { method: 'POST', body: { customer_id: c.id, due_date: fu.due.value, note: fu.note.value } }); customerDetail(main, id); } catch (x) { msg.replaceChildren(banner('error', x.message)); } } },
      field('Due date', fu.due), field('Note', fu.note), h('button', { type: 'submit' }, 'Add follow-up')));
}
