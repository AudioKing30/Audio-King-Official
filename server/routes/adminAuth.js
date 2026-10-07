/**
 * AudioKing Admin Authentication Routes
 * Handles admin login with rate-limiting, session generation, logout,
 * admin session status, and secure password updates.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { hashToken, generateSessionToken } = require('../security');
const { adminLoginRateLimiter, recordFailedLogin, resetLoginRateLimit } = require('../middleware/rateLimiter');
const { requireAdminApi } = require('../middleware/adminMiddleware');

const router = express.Router();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * 1. ADMIN LOGIN
 * POST /api/admin/auth/login
 */
router.post('/login', adminLoginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide both email and password.' });
    }

    const cleanInput = String(email).trim().toLowerCase();
    const existingUser = db.prepare(`
      SELECT id, full_name, display_name, email, role, password_hash, profile_image
      FROM users
      WHERE email = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE OR full_name = ? COLLATE NOCASE
    `).get(cleanInput, cleanInput, cleanInput);

    if (!existingUser) {
      recordFailedLogin(req);
      return res.status(404).json({ error: 'This user is not registered yet. Please register your account first.', notRegistered: true });
    }

    if (existingUser.role !== 'admin') {
      recordFailedLogin(req);
      return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
    }

    const user = existingUser;
    if (!user.password_hash) {
      recordFailedLogin(req);
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    const isMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!isMatch) {
      recordFailedLogin(req);
      return res.status(401).json({ error: 'Invalid admin credentials.' });
    }

    // Reset rate limiter on successful authentication
    resetLoginRateLimit(req);

    // Create session
    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO sessions (
        id, user_id, token_hash, expires_at, created_at, last_active_at, user_agent, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      user.id,
      tokenHash,
      expiresAt,
      nowIso,
      nowIso,
      req.headers['user-agent'] || '',
      req.ip || ''
    );

    // Update last_login_at
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso, user.id);

    // Set HttpOnly cookie
    res.cookie('audioking_admin_session', rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/'
    });

    return res.json({
      success: true,
      message: 'Admin authentication successful.',
      token: rawToken,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        profileImage: user.profile_image || 'assets/images/logo.jpg'
      }
    });
  } catch (err) {
    console.error('[ADMIN LOGIN ERROR]', err);
    return res.status(500).json({ error: 'Internal server error during admin login.' });
  }
});

/**
 * 2. ADMIN LOGOUT
 * POST /api/admin/auth/logout
 */
router.post('/logout', (req, res) => {
  try {
    const token = req.cookies?.audioking_admin_session || 
                  req.cookies?.audioking_session ||
                  req.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (token) {
      const tokenHash = hashToken(token);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    }

    res.clearCookie('audioking_admin_session', { httpOnly: true, sameSite: 'lax', path: '/' });
    // Also clear regular session cookie to prevent stale cookies
    res.clearCookie('audioking_session', { httpOnly: true, sameSite: 'lax', path: '/' });
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    console.error('[ADMIN LOGOUT ERROR]', err);
    return res.status(500).json({ error: 'Failed to log out.' });
  }
});

/**
 * 3. CURRENT ADMIN PROFILE
 * GET /api/admin/auth/me
 */
router.get('/me', requireAdminApi, (req, res) => {
  return res.json({
    success: true,
    user: req.admin
  });
});

/**
 * 4. CHANGE ADMIN PASSWORD
 * POST /api/admin/auth/change-password
 */
router.post('/change-password', requireAdminApi, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please provide current and new passwords.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match.' });
    }

    const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.admin.id);
    if (!user || !user.password_hash) {
      return res.status(404).json({ error: 'Admin account not found.' });
    }

    const isMatch = await bcrypt.compare(String(currentPassword), user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const salt = bcrypt.genSaltSync(12);
    const newHash = bcrypt.hashSync(String(newPassword), salt);
    const nowIso = new Date().toISOString();

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, nowIso, req.admin.id);

    console.log(`[ADMIN] Password updated successfully for: ${req.admin.email}`);
    return res.json({
      success: true,
      message: 'Password updated successfully. Please keep your new credentials secure.'
    });
  } catch (err) {
    console.error('[ADMIN CHANGE PASSWORD ERROR]', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

module.exports = router;
