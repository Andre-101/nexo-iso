/** Protección ligera para un único proceso API; no sustituye el límite del proxy. */
'use strict';
const crypto = require('node:crypto');
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 2000;
const attempts = new Map();
function keyFromEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
function prune(now) {
  for (const [key, item] of attempts) {
    if (now - item.first >= WINDOW_MS) attempts.delete(key);
  }
  while (attempts.size >= MAX_KEYS) attempts.delete(attempts.keys().next().value);
}
function loginThrottle(req, res, next) {
  const key = keyFromEmail(req.body?.email);
  req.loginThrottleKey = key;
  if (!key) return next();
  const now = Date.now();
  const item = attempts.get(key);
  if (item && now - item.first < WINDOW_MS && item.failures >= MAX_FAILURES) {
    res.set('Retry-After', String(Math.max(1, Math.ceil((item.first + WINDOW_MS - now) / 1000))));
    return res.status(429).json({ message: 'Demasiados intentos. Inténtelo más tarde.' });
  }
  return next();
}
function failedLogin(req) {
  const key = req.loginThrottleKey;
  if (!key) return;
  const now = Date.now();
  let item = attempts.get(key);
  if (!item || now - item.first >= WINDOW_MS) {
    prune(now);
    item = { first: now, failures: 0 };
    attempts.set(key, item);
  }
  item.failures++;
}
function successfulLogin(req) {
  if (req.loginThrottleKey) attempts.delete(req.loginThrottleKey);
}
module.exports = {loginThrottle, failedLogin, successfulLogin, keyFromEmail, MAX_FAILURES, WINDOW_MS};
