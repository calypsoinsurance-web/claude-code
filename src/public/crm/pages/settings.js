import { h, api, table, field, banner, fmtTs, announce } from '../lib.js';

export async function settings(main) {
  const [s, integ] = await Promise.all([api('/settings'), api('/integrations')]);
  const v = s.settings; const msg = h('div', { role: 'status' });
  const inputs = {};
  const save = async (keys) => {
    const body = {}; for (const k of keys) body[k] = inputs[k].type === 'checkbox' ? String(inputs[k].checked) : inputs[k].value;
    try { await api('/settings', { method: 'PUT', body }); msg.replaceChildren(banner('ok', 'Saved.')); announce('Settings saved'); settings(main); } catch (x) { msg.replaceChildren(banner('error', x.message)); }
  };
  const mk = (key, props, sel) => { inputs[key] = sel ? h('select', null, [['', '— not decided —'], ...sel].map(([val, label]) => h('option', { value: val, selected: (v[key] || '') === val }, label))) : h('input', { value: v[key] || '', ...(props || {}) }); return inputs[key]; };

  const decisionKeys = s.decisions.map((d) => d.key);
  const decisions = s.decisions.map((d) => field(`${d.label}`, mk(d.key, d.key === 'attribution_lookback_days' ? { type: 'number', min: '1' } : d.key === 'acquisition_observation_end' ? { type: 'date' } : {}, d.options ? d.options.map((o) => [o, o]) : null), `${d.help} Needed for: ${d.needFor}.`));

  const remKeys = ['reminder_email_confirmed', 'reminder_hour', 'reminder_timezone', 'reminder_enabled'];
  inputs.reminder_email_confirmed = h('input', { type: 'checkbox', checked: v.reminder_email_confirmed === 'true' });
  inputs.reminder_enabled = h('input', { type: 'checkbox', checked: v.reminder_enabled === 'true' });
  const pubKeys = ['public_disclosure_text', 'public_form_enabled'];
  inputs.public_form_enabled = h('input', { type: 'checkbox', checked: v.public_form_enabled === 'true' });
  inputs.public_disclosure_text = h('textarea', null, v.public_disclosure_text || '');
  inputs.reminder_hour = h('input', { type: 'number', min: '0', max: '23', value: v.reminder_hour || '' });
  inputs.reminder_timezone = h('input', { value: v.reminder_timezone || '', placeholder: 'America/New_York' });

  main.replaceChildren(h('h1', null, 'Settings'), msg,
    h('h2', null, 'Decisions'), h('p', { class: 'muted' }, 'The app does not guess these. Related numbers show N/A (or stay off) until you decide. Changing a rule re-evaluates reports from the stored data; quote snapshots themselves never change.'),
    h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); save(decisionKeys); } }, h('div', { class: 'filters' }, decisions), h('button', { type: 'submit' }, 'Save decisions')),
    h('h2', null, 'Follow-up reminder emails'),
    h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); save(remKeys); } },
      h('p', null, 'Reminders are sent only to: ', h('strong', null, s.adminEmail || '(ADMIN_EMAIL not set on the server)')),
      !s.env.smtpConfigured ? banner('', 'Email sending is not configured on the server (SMTP_* variables). Reminders cannot be delivered; tasks stay visible on the Follow-ups page.') : null,
      h('label', null, h('span', null, inputs.reminder_email_confirmed, ' I confirm this is my address'), h('span', { class: 'muted' }, 'Required before enabling.')),
      h('div', { class: 'filters' }, field('Send at this hour (0–23, local to the zone below)', inputs.reminder_hour), field('Reminder time zone', inputs.reminder_timezone)),
      h('label', null, h('span', null, inputs.reminder_enabled, ' Enable daily reminders'), h('span', { class: 'muted' }, 'One email lists follow-ups that are due or overdue and not yet reminded. Each follow-up date is reminded once.')),
      h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save reminder settings'), h('button', { type: 'button', class: 'secondary', onclick: async () => { try { const r = await api('/reminders/test', { method: 'POST' }); msg.replaceChildren(banner('ok', `Test sent to ${r.sentTo}.`)); } catch (x) { msg.replaceChildren(banner('error', x.message)); } } }, 'Send a test email'))),
    h('h2', null, 'Public quote page'),
    h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); save(pubKeys); } },
      banner('', 'Live Fetch quoting is ', h('strong', null, 'disabled'), '. If you turn the form on, visitors can leave details and you get a follow-up, but no quote is shown (no prices are ever invented).'),
      field('Disclosure / consent text shown above the form', inputs.public_disclosure_text, 'Use wording approved by Fetch and your compliance requirements. The form stays off while this is empty.'),
      h('label', null, h('span', null, inputs.public_form_enabled, ' Enable public form at /q/'), h('span', { class: 'muted' }, `Tracking cookies/storage are ${s.env.trackingEnabled ? 'ENABLED' : 'off'} on the server (TRACKING_ENABLED).`)),
      h('button', { type: 'submit' }, 'Save')),
    h('h2', null, 'Integration status'),
    h('p', { class: 'muted' }, '"Documented" = a public source says it exists. "Available to your account" must be confirmed with the provider. "Tested" is only true after a real call succeeded with your credentials. Nothing is tested yet.'),
    table('Integrations', ['Integration', 'Documented', 'Available to your account', 'Implemented / tested', 'Live status', 'Last success', 'Fallback'],
      integ.integrations.map((i) => [i.name, i.documented, i.availableToAccount, `${i.implemented ? 'Implemented' : 'Not implemented'} / ${i.tested ? 'tested' : 'NOT tested'}`, `${i.live.state}: ${i.live.detail}`, fmtTs(i.lastSuccessAt), i.fallback])),
    h('h2', null, 'Export and backup'),
    h('div', { class: 'card' }, h('p', null, 'Download your data as CSV:'),
      h('div', { class: 'actions' }, ['customers', 'pets', 'quotes', 'policies', 'commissions', 'followups', 'advertising'].map((n) => h('a', { class: 'btn secondary', href: `/api/export/${n}.csv` }, n))),
      h('p', { class: 'muted' }, 'A full database backup is made with the command line (see README → Backups). CSV exports are a convenience copy, not a restorable backup.')),
    h('h2', null, 'Source classification rules'),
    h('div', { class: 'card' }, h('ul', null,
      h('li', null, 'Paid: a platform click ID (fbclid, gclid/wbraid/gbraid, ttclid) is present, or utm_medium is a paid value such as cpc, ppc, paid, paid_social.'),
      h('li', null, 'Organic: utm_medium is organic/social, or the referrer is a search engine and there are no UTM tags.'),
      h('li', null, 'Referral: an outside website referred the visit and there are no UTM tags.'),
      h('li', null, 'Direct: no referrer and no tags.'), h('li', null, 'Unknown: anything else, and any quote with no linked tracked visit. Source is never inferred from timing.'),
      h('li', null, 'Campaign and ad matching uses utm_campaign and utm_content EXACTLY equal to the imported campaign/ad ID, so put the platform IDs in those fields of your ad URLs.'))));
}
