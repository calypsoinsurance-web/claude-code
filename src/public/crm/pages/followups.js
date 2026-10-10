import { h, api, table, field, banner, fmtTs, announce } from '../lib.js';

export async function followups(main) {
  let filter = 'open';
  const out = h('div'); const msg = h('div', { role: 'status' });
  const sel = h('select', null, [['open', 'All open'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['all', 'Everything']].map(([v, l]) => h('option', { value: v }, l)));
  sel.addEventListener('change', () => { filter = sel.value; load(); });
  const show = (e) => msg.replaceChildren(banner('error', e.message));
  main.replaceChildren(h('h1', null, 'Follow-ups'), msg,
    h('div', { class: 'filters' }, field('Show', sel), h('button', { class: 'secondary', onclick: async () => { try { const r = await api('/reminders/run', { method: 'POST' }); msg.replaceChildren(banner(r.failed ? 'error' : 'ok', r.skipped ? r.skipped : `Reminders: ${r.sent} sent, ${r.failed} failed${r.error ? ` (${r.error})` : ''}.`)); load(); } catch (x) { show(x); } } }, 'Send due reminders now'), h('a', { class: 'btn secondary', href: '/api/export/followups.csv' }, 'Export CSV')), out,
    h('p', { class: 'muted' }, 'To add a follow-up, open a customer and use "Add follow-up". Reminders go only to your own address configured on the server (Settings explains timing).'));
  async function load() {
    const r = await api(`/followups?filter=${filter}`);
    out.replaceChildren(h('p', { class: 'muted' }, `"Today" is ${r.today}${r.usingReportingTimezone ? ' in your reporting time zone' : ' in UTC (set a reporting time zone in Settings)'}.`),
      table('Follow-ups', ['Due', 'Customer', 'Note', 'Status', 'Reminder email', 'Actions'], r.rows.map((f) => {
        const overdue = f.status === 'open' && f.due_date < r.today;
        const due = h('input', { type: 'date', value: f.due_date, 'aria-label': `Due date for follow-up ${f.id}` });
        const save = async (body) => { try { await api(`/followups/${f.id}`, { method: 'PATCH', body }); announce('Saved'); load(); } catch (x) { show(x); } };
        return [h('span', null, f.due_date, overdue ? h('span', { class: 'badge bad' }, 'Overdue') : null), h('a', { href: `#/customer/${f.customer_id}` }, f.customer_name), f.note, f.status,
          f.reminder_status ? h('span', null, h('span', { class: `badge ${f.reminder_status === 'failed' ? 'bad' : f.reminder_status === 'sent' ? 'good' : ''}` }, f.reminder_status === 'sending' ? 'uncertain (was sending)' : f.reminder_status), f.reminder_error ? ` ${f.reminder_error}` : '', ['failed', 'sending'].includes(f.reminder_status) ? h('button', { class: 'secondary', onclick: async () => { try { await api(`/reminders/${f.delivery_id}/retry`, { method: 'POST' }); load(); } catch (x) { show(x); } } }, 'Retry') : null) : '—',
          f.status === 'open' ? h('div', { class: 'actions' }, due, h('button', { class: 'secondary', onclick: () => save({ due_date: due.value }) }, 'Change date'), h('button', { onclick: () => save({ status: 'completed' }) }, 'Complete')) : h('div', { class: 'actions' }, fmtTs(f.completed_at), h('button', { class: 'secondary', onclick: () => save({ status: 'open' }) }, 'Reopen'))];
      }), { empty: 'No follow-ups here. Add one from a customer page.' }));
  }
  load();
}
