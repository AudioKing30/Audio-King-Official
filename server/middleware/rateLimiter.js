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

module.exports = {
  adminLoginRateLimiter,
  recordFailedLogin,
  resetLoginRateLimit
};
