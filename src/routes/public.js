'use strict';
// PUBLIC routes only. Nothing here reads or returns CRM records beyond the caller's own quote result.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getSetting, now } = require('../db');
const { classifyVisit, sanitizeVisitInput } = require('../attribution');
const { submitQuote } = require('../quoteFlow');
const fs = require('node:fs');
const path = require('node:path');

const widgetConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'fetch-widget.json'), 'utf8'));

function publicRouter(db, adapter, cfg) {
  const r = express.Router();

  // CORS only for explicitly allowed origins (your own website).
  r.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && cfg.publicAllowedOrigins.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  r.use(express.json({ limit: '20kb' }));
  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  r.use(limiter);

  r.get('/config', (req, res) => {
    const disclosure = getSetting(db, 'public_disclosure_text');
    res.json({
      formEnabled: getSetting(db, 'public_form_enabled') === 'true' && !!disclosure, disclosure: disclosure || '', trackingEnabled: cfg.trackingEnabled,
      widget: { enabled: getSetting(db, 'public_widget_enabled') === 'true', capture: getSetting(db, 'widget_capture_enabled') === 'true', invoke: widgetConfig.invoke },
      widgetNotice: getSetting(db, 'public_disclosure_text') || '',
    });
  });

  r.post('/visit', (req, res) => {
    if (!cfg.trackingEnabled) return res.status(204).end();
    const v = sanitizeVisitInput(req.body || {});
    if (!v.visitor_id || !/^[A-Za-z0-9_-]{22,64}$/.test(v.visitor_id)) return res.status(400).json({ error: 'invalid visitor id' });
    const own = cfg.publicBaseUrl ? [new URL(cfg.publicBaseUrl).hostname] : [];
    const cls = classifyVisit(v, own);
    const t = now();
    db.prepare(`INSERT INTO visits(visitor_id,visited_at,landing_url,referrer,utm_source,utm_medium,utm_campaign,utm_content,utm_term,utm_id,click_ids_json,source_type,platform,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.visitor_id, t, v.landing_url, v.referrer, v.utm_source, v.utm_medium, v.utm_campaign, v.utm_content, v.utm_term, v.utm_id, JSON.stringify(v.click_ids), cls.source_type, cls.platform, t);
    res.status(204).end();
  });

  // Raw widget events. Only stored if the owner switched capture on; never counted as quotes (payload meaning unverified).
  r.post('/widget-event', (req, res) => {
    if (getSetting(db, 'widget_capture_enabled') !== 'true') return res.status(204).end();
    const b = req.body || {};
    if (!['ready', 'init', 'complete', 'error'].includes(b.event)) return res.status(400).json({ error: 'invalid event' });
    if (b.visitor_id != null && !/^[A-Za-z0-9_-]{22,64}$/.test(String(b.visitor_id))) return res.status(400).json({ error: 'invalid visitor id' });
    let payload; try { payload = JSON.stringify(b.payload === undefined ? null : b.payload); } catch { return res.status(400).json({ error: 'invalid payload' }); }
    if (payload.length > 8000) payload = JSON.stringify({ truncated: true, note: 'payload over 8000 characters was not stored' });
    const url = typeof b.page_url === 'string' ? b.page_url.slice(0, 300) : null;
    db.prepare('INSERT INTO widget_events(visitor_id,event,payload_json,page_url,created_at) VALUES (?,?,?,?,?)').run(b.visitor_id || null, b.event, payload, url, now());
    res.status(204).end();
  });

  const quoteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  r.post('/quote', quoteLimiter, async (req, res) => {
    try {
      const disclosure = getSetting(db, 'public_disclosure_text');
      if (getSetting(db, 'public_form_enabled') !== 'true' || !disclosure) return res.status(503).json({ error: 'The quote form is not available yet.' });
      if (req.body && req.body.website) return res.status(200).json({ status: 'completed', quotes: [], message: 'Thanks.' }); // honeypot: silently drop bots
      const out = await submitQuote(db, adapter, req.body);
      res.json(out);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error('Public quote error:', e.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  return r;
}

module.exports = { publicRouter };
