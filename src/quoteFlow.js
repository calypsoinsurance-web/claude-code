'use strict';
// Public quote submission. Order of operations is chosen so that no failure loses data or invents a result:
//   1. Save customer, pets and a quote_request (CRM first, in one transaction).  -> status crm_saved
//   2. Ask the quote provider for a REAL quote for each pet.
//   3. Save each real quote (frozen attribution included).                         -> status completed
// Failures: provider unavailable/failing leaves the saved customer intact and the request retryable with the same
// idempotency key. If the provider answered but saving failed, the answer is kept in the request row
// (quote_received_unsaved) and the retry saves it without calling the provider again.
const crypto = require('node:crypto');
const { tx, now, getSetting } = require('./db');
const crm = require('./crm');
const { QuoteUnavailableError } = require('./integrations/fetch');

class ValidationError extends Error { constructor(m) { super(m); this.status = 400; } }

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validate(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  const key = str(input.idempotency_key, 100);
  if (!/^[A-Za-z0-9_-]{22,100}$/.test(key)) throw new ValidationError('A valid idempotency_key (random, 22+ characters) is required');
  const c = input.customer || {};
  const customer = { name: str(c.name, 120), email: str(c.email, 320).toLowerCase(), phone: str(c.phone, 40), state: str(c.state, 2).toUpperCase() };
  if (!customer.name) throw new ValidationError('Name is required');
  if (!EMAIL_RE.test(customer.email)) throw new ValidationError('A valid email is required');
  if (customer.state && !/^[A-Z]{2}$/.test(customer.state)) throw new ValidationError('State must be a 2-letter code');
  if (!Array.isArray(input.pets) || input.pets.length < 1 || input.pets.length > 5) throw new ValidationError('Provide 1 to 5 pets');
  const pets = input.pets.map((p, i) => {
    const species = str(p && p.species, 10).toLowerCase();
    if (!['dog', 'cat'].includes(species)) throw new ValidationError(`Pet ${i + 1}: species must be dog or cat`);
    const name = str(p.name, 80);
    if (!name) throw new ValidationError(`Pet ${i + 1}: name is required`);
    return { name, species, breed: str(p.breed, 80), age_as_recorded: str(p.age, 40) };
  });
  if (input.consent !== true) throw new ValidationError('Consent is required');
  return { key, customer, pets, visitorId: str(input.visitor_id, 64) || null };
}

function buildSnapshot(db, visitorId) {
  if (!visitorId) return { touches: [], note: 'No visitor id supplied; nothing linked.' };
  const visits = db.prepare('SELECT * FROM visits WHERE visitor_id = ? ORDER BY visited_at').all(visitorId);
  return {
    captured_at: now(),
    touches: visits.map((v) => ({ visit_id: v.id, at: v.visited_at, source_type: v.source_type, platform: v.platform, utm_source: v.utm_source, utm_medium: v.utm_medium, campaign_ref: v.utm_campaign, ad_ref: v.utm_content, utm_term: v.utm_term, utm_id: v.utm_id, click_ids: v.click_ids_json ? JSON.parse(v.click_ids_json) : {}, referrer: v.referrer })),
  };
}

async function submitQuote(db, adapter, rawInput) {
  const input = validate(rawInput);
  const payloadHash = crm.sha(JSON.stringify({ c: input.customer, p: input.pets }));
  const keyHash = crm.sha(input.key);

  let req = db.prepare('SELECT * FROM quote_requests WHERE idempotency_key = ?').get(keyHash);
  if (req && req.payload_hash !== payloadHash) throw Object.assign(new ValidationError('This submission id was already used with different details'), { status: 409 });

  if (!req) {
    try {
      req = tx(db, () => {
        const m = crm.matchCustomer(db, { email: input.customer.email });
        let customerId;
        if (m.status === 'match') { customerId = m.customer.id; crm.fillCustomerBlanks(db, customerId, input.customer); }
        else {
          const snap0 = buildSnapshot(db, input.visitorId);
          const first = snap0.touches[0];
          customerId = crm.createCustomer(db, input.customer, first ? { source_type: first.source_type, platform: first.platform, at: first.at, utm_source: first.utm_source, utm_medium: first.utm_medium, campaign_ref: first.campaign_ref } : null);
        }
        if (input.visitorId) db.prepare('UPDATE visits SET customer_id = ? WHERE visitor_id = ? AND customer_id IS NULL').run(customerId, input.visitorId);
        const t = now();
        // Attribution is frozen here, at submission time, and reused by every retry.
        const r = db.prepare(`INSERT INTO quote_requests(idempotency_key,access_token_hash,customer_id,payload_hash,status,attribution_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
          .run(keyHash, keyHash, customerId, payloadHash, 'crm_saved', JSON.stringify(buildSnapshot(db, input.visitorId)), t, t);
        const reqId = Number(r.lastInsertRowid);
        for (const p of input.pets) crm.findOrCreatePet(db, customerId, p);
        return db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(reqId);
      });
    } catch (e) {
      // Concurrent duplicate: the other submission won the unique key. Treat as a retry of the same request.
      req = db.prepare('SELECT * FROM quote_requests WHERE idempotency_key = ?').get(keyHash);
      if (!req) throw e;
    }
  }
  return progress(db, adapter, req, input);
}

async function progress(db, adapter, req, input) {
  if (req.status === 'completed') return presentResult(db, req);
  const customerId = req.customer_id;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const snapshot = JSON.parse(req.attribution_snapshot_json);
  const setStatus = (status, err, extra) => db.prepare('UPDATE quote_requests SET status=?, error_message=?, attempts=attempts+?, updated_at=?, provider_response_json=coalesce(?, provider_response_json) WHERE id=?')
    .run(status, err || null, extra && extra.attempt ? 1 : 0, now(), extra && extra.response ? JSON.stringify(extra.response) : null, req.id);

  // Previously received provider answers are re-used instead of asking the provider again.
  let saved = req.provider_response_json ? JSON.parse(req.provider_response_json) : {};
  const results = [];
  for (const p of input.pets) {
    const petRes = crm.findOrCreatePet(db, customerId, p);
    const petKey = String(petRes.id);
    let answer = saved[petKey];
    if (!answer) {
      try {
        answer = await adapter.createQuote({ customer, pet: p });
        validateAnswer(answer);
      } catch (e) {
        if (e instanceof QuoteUnavailableError) {
          setStatus('quote_unavailable', e.message, { attempt: true });
          ensureLeadFollowup(db, customerId);
          return presentResult(db, { ...req, status: 'quote_unavailable' });
        }
        setStatus('quote_failed', 'The quote provider returned an error.', { attempt: true });
        console.error('Quote provider error:', e.message); // message only; never log customer data
        return presentResult(db, { ...req, status: 'quote_failed' });
      }
      saved[petKey] = answer;
      setStatus('quote_received_unsaved', null, { response: saved, attempt: true }); // persist the real answer before saving the quote row
    }
    results.push({ petId: petRes.id, answer });
  }
  try {
    tx(db, () => {
      for (const r of results) {
        const key = crm.quoteDedupeKey('fetch', r.answer.providerQuoteId, ['req', req.id, r.petId]);
        if (db.prepare('SELECT 1 FROM quotes WHERE dedupe_key = ?').get(key)) continue; // safe retry
        const t = now();
        db.prepare(`INSERT INTO quotes(customer_id,pet_id,quote_request_id,provider,provider_quote_id,dedupe_key,quoted_at,premium_cents,payment_frequency,coverage_json,status,attribution_snapshot_json,source,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(customerId, r.petId, req.id, 'fetch', r.answer.providerQuoteId || null, key, t, r.answer.premiumCents, r.answer.paymentFrequency, JSON.stringify(r.answer.coverage || {}), 'generated', JSON.stringify(snapshot), 'public_form', t, t);
      }
      db.prepare("UPDATE quote_requests SET status='completed', error_message=NULL, updated_at=? WHERE id=?").run(now(), req.id);
    });
  } catch (e) {
    console.error('CRM save failed after provider answered:', e.message);
    return presentResult(db, { ...req, status: 'quote_received_unsaved' });
  }
  return presentResult(db, { ...req, status: 'completed' });
}

function validateAnswer(a) {
  if (!a || typeof a !== 'object' || !Number.isInteger(a.premiumCents) || a.premiumCents <= 0 || !a.paymentFrequency) {
    throw new Error('Provider answer is missing a real premium/frequency'); // never invent values
  }
}

function ensureLeadFollowup(db, customerId) {
  const exists = db.prepare("SELECT 1 FROM followups WHERE customer_id = ? AND status='open' AND note LIKE 'Quote not generated%'").get(customerId);
  if (exists) return;
  const t = now();
  db.prepare('INSERT INTO followups(customer_id,due_date,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(customerId, t.slice(0, 10), 'Quote not generated online (live quoting unavailable). Contact the customer.', 'open', t, t);
}

// What the PUBLIC customer sees: only the outcome of their own request. No record ids beyond their own quotes.
function presentResult(db, req) {
  const base = { status: req.status };
  if (req.status === 'completed') {
    base.quotes = db.prepare(`SELECT q.premium_cents, q.payment_frequency, q.coverage_json, p.name AS pet_name FROM quotes q LEFT JOIN pets p ON p.id=q.pet_id WHERE q.quote_request_id = ? ORDER BY q.id`).all(req.id)
      .map((q) => ({ pet: q.pet_name, premium_cents: q.premium_cents, payment_frequency: q.payment_frequency, coverage: JSON.parse(q.coverage_json || '{}') }));
    base.message = 'Here are your quotes. Payment happens on the insurer\'s site.';
  } else if (req.status === 'quote_unavailable') {
    base.message = 'Online quotes are not available right now. Your details were saved and we will follow up.';
  } else if (req.status === 'quote_failed') {
    base.message = 'We could not get a quote right now. Your details were saved. Please try again in a moment.';
  } else if (req.status === 'quote_received_unsaved') {
    base.message = 'Your quote was received but is still being saved. Please try again in a moment.';
  } else {
    base.message = 'Your details were saved.';
  }
  return base;
}

module.exports = { submitQuote, validate, ValidationError, buildSnapshot };
