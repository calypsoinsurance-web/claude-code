'use strict';
// Builds data/demo.sqlite with SYNTHETIC records only (obviously fake names, @demo.invalid emails, made-up numbers).
// It is a separate file from your real database and is flagged is_demo so every page shows a DEMO banner.
const fs = require('node:fs');
const path = require('node:path');
const { openDb, setSetting, tx } = require('../src/db');
const crm = require('../src/crm');

const file = path.join(__dirname, '..', 'data', 'demo.sqlite');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
const db = openDb(file);

let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dayStr = (d) => d.toISOString().slice(0, 10);
const start = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01
const days = 90;

tx(db, () => {
  setSetting(db, 'is_demo', 'true');
  for (const [k, v] of Object.entries({ reporting_timezone: 'America/New_York', reporting_currency: 'USD', attribution_lookback_days: '30', direct_rule: 'direct_does_not_replace', acquisition_event: 'first_quote', returning_customers: 'first_only', acquisition_observation_end: '2026-09-28', cancellation_treatment: 'gross_only_for_now' })) setSetting(db, k, v);
  const now = new Date().toISOString();

  // advertising (DEMO numbers)
  const ins = db.prepare(`INSERT INTO ad_records(platform,account_id,level,breakdown_signature,channel,network,placement,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,report_date,currency,spend_micros,impressions,link_clicks,link_click_metric,link_click_definition,all_clicks,all_click_metric,reporting_timezone,provenance,synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const camps = [
    { p: 'meta', acct: 'DEMO-META', id: 'demo-m1', name: 'DEMO Meta - Dog owners', chans: ['facebook', 'instagram'], metric: 'demo_link_clicks', def: 'DEMO definition: clicks on links in the ad', base: 40 },
    { p: 'google', acct: 'DEMO-GOOG', id: 'demo-g1', name: 'DEMO Google - Pet insurance search', chans: [''], metric: 'demo_clicks', def: 'DEMO definition: clicks on the ad', base: 55, network: 'search' },
    { p: 'tiktok', acct: 'DEMO-TT', id: 'demo-t1', name: 'DEMO TikTok - Puppy videos', chans: [''], metric: 'demo_clicks_dest', def: 'DEMO definition: destination clicks', base: 25 },
  ];
  for (let i = 0; i < days; i += 1) {
    const d = dayStr(new Date(start.getTime() + i * 86400000));
    for (const c of camps) for (const ch of c.chans) {
      const spend = Math.round((c.base * (0.7 + rnd() * 0.6)) / c.chans.length * 100) / 100;
      const imps = Math.round(spend * (60 + rnd() * 40)); const clicks = Math.round(imps * (0.008 + rnd() * 0.012));
      ins.run(c.p, c.acct, 'campaign', ch ? 'channel' : (c.network ? 'network' : 'none'), ch, c.network || '', '', c.id, c.name, '', null, '', null, d, 'USD', Math.round(spend * 1e6), imps, clicks, c.metric, c.def, null, null, 'America/New_York', 'import', now);
    }
  }

  // customers, quotes, policies
  const srcs = [
    { w: 0.40, t: { source_type: 'paid', platform: 'meta', campaign_ref: 'demo-m1' } },
    { w: 0.22, t: { source_type: 'paid', platform: 'google', campaign_ref: 'demo-g1' } },
    { w: 0.08, t: { source_type: 'paid', platform: 'tiktok', campaign_ref: 'demo-t1' } },
    { w: 0.10, t: { source_type: 'organic', platform: null } }, { w: 0.05, t: { source_type: 'referral', platform: null } },
    { w: 0.05, t: { source_type: 'direct', platform: null } }, { w: 0.10, t: null },
  ];
  const draw = () => { let r = rnd(); for (const s of srcs) { if ((r -= s.w) <= 0) return s.t; } return null; };
  const qIns = db.prepare(`INSERT INTO quotes(customer_id,pet_id,provider,provider_quote_id,dedupe_key,quoted_at,quoted_date,premium_cents,payment_frequency,coverage_json,status,attribution_snapshot_json,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const pIns = db.prepare(`INSERT INTO policies(customer_id,pet_id,quote_id,quote_link_basis,claimed_provider_quote_id,carrier,policy_number,is_issued,issue_date,status,premium_cents,payment_frequency,cancellation_date,expected_commission_cents,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tIns = db.prepare(`INSERT INTO commission_transactions(policy_id,type,amount_cents,currency,txn_date,statement_ref,statement_policy_ref,match_status,dedupe_key,import_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const policies = []; let qn = 0; let pn = 0;
  for (let i = 1; i <= 140; i += 1) {
    const qd = new Date(start.getTime() + Math.floor(rnd() * (days - 5)) * 86400000);
    const touch = draw();
    const first = touch ? { ...touch, at: new Date(qd.getTime() - 86400000).toISOString() } : null;
    const cid = crm.createCustomer(db, { name: `Demo Customer ${String(i).padStart(3, '0')}`, email: `demo${i}@demo.invalid`, state: pick(['NY', 'NJ', 'CT', 'PA']), provider_customer_id: `DEMO-C${i}` }, first);
    const snap = { touches: first ? [first] : [], note: 'DEMO' };
    const npets = rnd() < 0.3 ? 2 : 1; const quoteIds = [];
    for (let k = 0; k < npets; k += 1) {
      const pet = crm.findOrCreatePet(db, cid, { name: `Pet ${i}-${k + 1}`, species: pick(['dog', 'dog', 'cat']), breed: 'Demo mix', age_as_recorded: `${1 + Math.floor(rnd() * 9)} years`, age_recorded_on: dayStr(qd) });
      qn += 1;
      const q = qIns.run(cid, pet.id, 'fetch', `DEMO-Q${qn}`, `fetch|DEMO-Q${qn}`, qd.toISOString(), dayStr(qd), 2500 + Math.floor(rnd() * 4000), 'monthly', '{"demo":true}', 'generated', JSON.stringify(snap), 'import', now, now);
      quoteIds.push({ qid: Number(q.lastInsertRowid), petId: pet.id });
    }
    if (rnd() < 0.38) {
      const lag = 1 + Math.floor(rnd() * 25); const issue = new Date(qd.getTime() + lag * 86400000);
      const bought = quoteIds.slice(0, rnd() < 0.2 ? 2 : 1);
      for (const b of bought) {
        pn += 1; const cancelled = rnd() < 0.12;
        const link = rnd() < 0.9; // 10% of demo policies have no verified quote link -> Unknown
        const r = pIns.run(cid, b.petId, link ? b.qid : null, link ? 'provider_quote_id' : 'unknown', link ? `DEMO-Q${b.qid}` : null, 'Fetch', `DEMO-POL-${pn}`, 1, dayStr(issue), cancelled ? 'Cancelled' : 'Active', 3000, 'monthly', cancelled ? dayStr(new Date(issue.getTime() + 40 * 86400000)) : null, 15000, 'import', now, now);
        policies.push({ id: Number(r.lastInsertRowid), num: `DEMO-POL-${pn}`, issue, cancelled });
      }
    }
  }
  // commission transactions: receipt ~30 days after issue for most; reversal for some cancelled; a lump sum and an unknown line stay unmatched
  let ti = 0;
  for (const p of policies) {
    if (rnd() < 0.85) {
      const d = dayStr(new Date(p.issue.getTime() + 30 * 86400000)); ti += 1;
      tIns.run(p.id, 'receipt', 15000, 'USD', d, `DEMO-STMT-${d.slice(0, 7)}`, p.num, 'matched', `demo-${ti}`, null, now);
      if (p.cancelled && rnd() < 0.7) { ti += 1; const d2 = dayStr(new Date(p.issue.getTime() + 75 * 86400000)); tIns.run(p.id, 'reversal', -15000, 'USD', d2, `DEMO-STMT-${d2.slice(0, 7)}`, p.num, 'matched', `demo-${ti}`, null, now); }
    }
  }
  tIns.run(null, 'receipt', 90000, 'USD', '2026-09-15', 'DEMO-STMT-2026-09', null, 'unmatched', 'demo-lump', null, now);
  tIns.run(null, 'receipt', 15000, 'USD', '2026-09-15', 'DEMO-STMT-2026-09', 'DEMO-UNKNOWN-1', 'unmatched', 'demo-unk', null, now);
  const open = db.prepare('INSERT INTO followups(customer_id,due_date,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  const today = new Date().toISOString().slice(0, 10);
  open.run(1, '2026-09-01', 'DEMO: overdue follow-up example', 'open', now, now); open.run(2, today, 'DEMO: due today example', 'open', now, now); open.run(3, '2027-01-01', 'DEMO: upcoming example', 'open', now, now);
});
const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
console.log(`Demo database created: ${file}\n  customers ${n('customers')}, quotes ${n('quotes')}, policies ${n('policies')}, ad rows ${n('ad_records')}, commission lines ${n('commission_transactions')}\nRun it with:  npm run demo   (sign-in still needs ADMIN_EMAIL / ADMIN_PASSWORD_HASH in .env)`);
