'use strict';
const crypto = require('node:crypto');
const { now } = require('./db');

const norm = (s) => (s == null ? null : String(s).trim() || null);
const normEmail = (s) => { const v = norm(s); return v ? v.toLowerCase() : null; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Customer identity: provider customer ID first, then exact email. Names are NEVER used to match.
// A conflict (e.g. same email but a different provider ID) is returned for human review, not auto-merged.
function matchCustomer(db, { provider_customer_id, email }) {
  const pid = norm(provider_customer_id);
  const em = normEmail(email);
  const byProvider = pid ? db.prepare('SELECT * FROM customers WHERE provider_customer_id = ?').get(pid) : null;
  const byEmail = em ? db.prepare('SELECT * FROM customers WHERE email = ?').get(em) : null;
  if (byProvider && byEmail && byProvider.id !== byEmail.id) return { status: 'conflict', reason: `Provider ID ${pid} and email ${em} point to two different customers (#${byProvider.id}, #${byEmail.id})`, candidates: [byProvider.id, byEmail.id] };
  if (byProvider) {
    if (em && byProvider.email && byProvider.email !== em) return { status: 'conflict', reason: `Provider ID ${pid} belongs to customer #${byProvider.id} but with a different email`, candidates: [byProvider.id] };
    return { status: 'match', customer: byProvider };
  }
  if (byEmail) {
    if (pid && byEmail.provider_customer_id && byEmail.provider_customer_id !== pid) return { status: 'conflict', reason: `Email ${em} belongs to customer #${byEmail.id} with a different provider ID`, candidates: [byEmail.id] };
    return { status: 'match', customer: byEmail };
  }
  if (!pid && !em) return { status: 'no_identifier' };
  return { status: 'none' };
}

function createCustomer(db, c, firstTouch) {
  const t = now();
  const r = db.prepare(`INSERT INTO customers(provider_customer_id,name,email,phone,state,first_source_type,first_source_platform,first_touch_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(norm(c.provider_customer_id), norm(c.name) || '(no name)', normEmail(c.email), norm(c.phone), norm(c.state),
    firstTouch ? firstTouch.source_type : null, firstTouch ? firstTouch.platform : null, firstTouch ? JSON.stringify(firstTouch) : null, t, t);
  return Number(r.lastInsertRowid);
}

// Fill blanks only; never overwrite existing values silently.
function fillCustomerBlanks(db, id, c) {
  const cur = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  const upd = {};
  if (!cur.provider_customer_id && norm(c.provider_customer_id)) upd.provider_customer_id = norm(c.provider_customer_id);
  if (!cur.email && normEmail(c.email)) upd.email = normEmail(c.email);
  if (!cur.phone && norm(c.phone)) upd.phone = norm(c.phone);
  if (!cur.state && norm(c.state)) upd.state = norm(c.state);
  const keys = Object.keys(upd);
  if (!keys.length) return;
  db.prepare(`UPDATE customers SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map((k) => upd[k]), now(), id);
}

function findOrCreatePet(db, customerId, p) {
  const pid = norm(p.provider_pet_id);
  let row = pid ? db.prepare('SELECT * FROM pets WHERE provider_pet_id = ?').get(pid) : null;
  if (row && row.customer_id !== customerId) return { conflict: `Provider pet ID ${pid} already belongs to another customer` };
  if (!row && norm(p.name)) {
    row = db.prepare('SELECT * FROM pets WHERE customer_id = ? AND lower(name) = lower(?) AND coalesce(species,\'\') = coalesce(?,\'\')').get(customerId, norm(p.name), norm(p.species));
  }
  if (row) return { id: row.id };
  const t = now();
  const species = norm(p.species) ? String(p.species).toLowerCase() : null;
  const r = db.prepare(`INSERT INTO pets(customer_id,provider_pet_id,name,species,breed,age_as_recorded,age_recorded_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(customerId, pid, norm(p.name) || '(unnamed)', species === 'dog' || species === 'cat' ? species : null, norm(p.breed), norm(p.age_as_recorded), norm(p.age_recorded_on) || t.slice(0, 10), t, t);
  return { id: Number(r.lastInsertRowid) };
}

function quoteDedupeKey(provider, providerQuoteId, fallbackParts) {
  if (providerQuoteId) return `${provider}|${providerQuoteId}`;
  return `${provider}|noid|${sha(fallbackParts.join('|'))}`;
}

module.exports = { matchCustomer, createCustomer, fillCustomerBlanks, findOrCreatePet, quoteDedupeKey, norm, normEmail, sha };
