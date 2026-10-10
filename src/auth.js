'use strict';
const crypto = require('node:crypto');
const cfg = require('./config');
const { now } = require('./db');

// Password hashes look like: scrypt$<saltHex>$<hashHex>
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const COOKIE = 'crm_session';

function createSession(db, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + cfg.sessionDays * 86400000);
  db.prepare('INSERT INTO sessions(id_hash, created_at, expires_at) VALUES (?,?,?)').run(sha(token), now(), expires.toISOString());
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${cfg.sessionDays * 86400}`];
  if (cfg.isProduction) attrs.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${attrs.join('; ')}`);
}
function destroySession(db, req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function isAuthenticated(db, req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id_hash = ?').get(sha(t));
  return !!row && row.expires_at > now();
}

// Guard for every private route. Mutating requests must also carry a custom header (CSRF defence together with SameSite=Strict).
function requireAuth(db) {
  return (req, res, next) => {
    if (!isAuthenticated(db, req)) return res.status(401).json({ error: 'Not signed in' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers['x-requested-with'] !== 'crm') return res.status(403).json({ error: 'Missing request header' });
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
        if (!ok) return res.status(403).json({ error: 'Cross-origin request blocked' });
      }
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, isAuthenticated, requireAuth, sha };
