/**
 * AudioKing Cryptographic Security & Rate Limiting Module
 * Provides bcrypt password hashing, secure OTP generation, SHA-256 token hashing,
 * and sliding-window rate limiters.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = 10;

/**
 * Hash a plain text password using bcrypt
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Invalid password provided');
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compare plain text password against bcrypt hash
 */
async function comparePassword(plainPassword, hashedPassword) {
  if (!plainPassword || !hashedPassword) return false;
  return bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Generate a cryptographically secure 6-digit numeric OTP
 */
function generateOTP() {
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

/**
 * Hash a string (e.g. OTP, session token) using SHA-256
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Generate a high-entropy random session token (64 hex characters)
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a single-use password reset token (32 hex characters)
 */
function generateResetToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * In-memory Sliding Window Rate Limiter
 */
const rateLimitBuckets = new Map();

function checkRateLimit(key, maxRequests = 5, windowMs = 60000) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);

  if (!bucket) {
    bucket = [];
    rateLimitBuckets.set(key, bucket);
  }

  // Remove timestamps outside window
  bucket = bucket.filter(time => now - time < windowMs);
  rateLimitBuckets.set(key, bucket);

  if (bucket.length >= maxRequests) {
    const oldest = bucket[0];
    const retryAfterSec = Math.ceil((windowMs - (now - oldest)) / 1000);
    return { allowed: false, retryAfterSec };
  }

  bucket.push(now);
  return { allowed: true, remaining: maxRequests - bucket.length };
}

/**
 * Check whether a key is currently rate-limited without incrementing counter
 */
function isRateLimited(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket) return { allowed: true, remaining: maxRequests };

  bucket = bucket.filter(time => now - time < windowMs);
  rateLimitBuckets.set(key, bucket);

  if (bucket.length >= maxRequests) {
    const oldest = bucket[0];
    const retryAfterSec = Math.ceil((windowMs - (now - oldest)) / 1000);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, remaining: maxRequests - bucket.length };
}

/**
 * Record a failed attempt against the rate limit bucket for the given key
 */
function recordRateLimitFailure(key, windowMs = 60000) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket) {
    bucket = [];
    rateLimitBuckets.set(key, bucket);
  }
  bucket = bucket.filter(time => now - time < windowMs);
  bucket.push(now);
  rateLimitBuckets.set(key, bucket);
}

// Clean up stale buckets every 5 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    const fresh = bucket.filter(time => now - time < 300000);
    if (fresh.length === 0) {
      rateLimitBuckets.delete(key);
    } else {
      rateLimitBuckets.set(key, fresh);
    }
  }
}, 300000);
if (cleanupInterval.unref) cleanupInterval.unref();

module.exports = {
  hashPassword,
  comparePassword,
  generateOTP,
  hashToken,
  generateSessionToken,
  generateResetToken,
  checkRateLimit,
  isRateLimited,
  recordRateLimitFailure
};
