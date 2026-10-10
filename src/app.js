'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cfgDefault = require('./config');
const auth = require('./auth');
const { publicRouter } = require('./routes/public');
const { privateRouter } = require('./routes/private');

function createApp({ db, adapter, transport, cfg = cfgDefault }) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  app.locals.fetchAdapter = adapter;

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));

  // ---- public surface: quote page, tracker script, public API. No CRM data. ----
  app.use('/api/public', publicRouter(db, adapter, cfg));
  app.get('/t.js', (req, res) => { res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); res.sendFile(path.join(__dirname, 'public', 'quote', 't.js')); });
  // The public quote pages embed Fetch's widget, so they need a looser policy than the CRM. They contain no CRM data.
  app.use('/q', (req, res, next) => {
    res.setHeader('Content-Security-Policy', ["default-src 'self'", "script-src 'self' https://salesfunnelquotesdk.fetchpet.com", "frame-src https://salesfunnelquotesdk.fetchpet.com", "connect-src 'self' https://*.fetchpet.com", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:", "frame-ancestors 'none'", "form-action 'self'"].join('; '));
    next();
  });
  app.use('/q', express.static(path.join(__dirname, 'public', 'quote')));

  // ---- sign in ----
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true });
  app.post('/api/login', loginLimiter, express.json({ limit: '5kb' }), (req, res) => {
    if (!cfg.adminEmail || !cfg.adminPasswordHash) return res.status(503).json({ error: 'Sign-in is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH (see README).' });
    const { email, password } = req.body || {};
    const okEmail = typeof email === 'string' && email.trim().toLowerCase() === cfg.adminEmail;
    const okPw = typeof password === 'string' && auth.verifyPassword(password, cfg.adminPasswordHash); // always evaluated
    if (!(okEmail && okPw)) return res.status(401).json({ error: 'Wrong email or password' });
    auth.createSession(db, res);
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => { auth.destroySession(db, req, res); res.json({ ok: true }); });
  app.get('/api/me', (req, res) => res.json({ authenticated: auth.isAuthenticated(db, req) }));

  // ---- private API: every route behind requireAuth ----
  app.use('/api', auth.requireAuth(db), privateRouter(db, transport, cfg));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/app', express.static(path.join(__dirname, 'public', 'crm')));
  app.get('/', (req, res) => res.redirect('/app/'));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}

module.exports = { createApp };
