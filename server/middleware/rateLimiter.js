/**
 * AudioKing Admin Login Rate Limiter
 * Enforces maximum 5 failed login attempts per 15 minutes per IP address.
 * Resets on successful authentication.
 */

const loginAttempts = new Map(); // ip -> { count, firstAttemptTime, blockedUntil }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown-ip';
}

function adminLoginRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (record) {
    // Check if currently blocked
    if (record.blockedUntil && now < record.blockedUntil) {
      const remainingMinutes = Math.ceil((record.blockedUntil - now) / (60 * 1000));
      return res.status(429).json({
        error: `Too many login attempts. For security, your IP is temporarily blocked. Please try again in ${remainingMinutes} minute(s).`,
        code: 'RATE_LIMITED',
        retryAfterMinutes: remainingMinutes
      });
    }

    // Check if window expired
    if (now - record.firstAttemptTime > WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }

  next();
}

function recordFailedLogin(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttemptTime: now, blockedUntil: 0 };

  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + WINDOW_MS;
    console.warn(`[RATE LIMIT] IP ${ip} exceeded ${MAX_ATTEMPTS} failed admin login attempts. Blocked for 15 minutes.`);
  }

  loginAttempts.set(ip, record);
}

function resetLoginRateLimit(req) {
  const ip = getClientIp(req);
  loginAttempts.delete(ip);
}

const generalApiBuckets = new Map();
const GENERAL_API_LIMIT = 200; // 200 requests per minute per IP
const GENERAL_API_WINDOW = 60 * 1000;

function generalApiRateLimiter(req, res, next) {
  // Bypass health checks
  if (req.path === '/health' || req.path === '/api/health') return next();

  const ip = getClientIp(req);
  const now = Date.now();
  let timestamps = generalApiBuckets.get(ip) || [];
  timestamps = timestamps.filter(t => now - t < GENERAL_API_WINDOW);

  if (timestamps.length >= GENERAL_API_LIMIT) {
    const oldest = timestamps[0];
    const retrySec = Math.ceil((GENERAL_API_WINDOW - (now - oldest)) / 1000);
    return res.status(429).json({
      error: 'Too many requests. Please slow down and try again shortly.',
      code: 'API_RATE_LIMIT_EXCEEDED',
      retryAfterSec: retrySec
    });
  }

  timestamps.push(now);
  generalApiBuckets.set(ip, timestamps);
  next();
}

// Periodic cleanup of stale rate limiter records (runs every 10m without keeping event loop alive)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.firstAttemptTime > WINDOW_MS && (!record.blockedUntil || now > record.blockedUntil)) {
      loginAttempts.delete(ip);
    }
  }
  for (const [ip, timestamps] of generalApiBuckets.entries()) {
    const active = timestamps.filter(t => now - t < GENERAL_API_WINDOW);
    if (active.length === 0) generalApiBuckets.delete(ip);
    else generalApiBuckets.set(ip, active);
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  adminLoginRateLimiter,
  generalApiRateLimiter,
  recordFailedLogin,
  resetLoginRateLimit
};
