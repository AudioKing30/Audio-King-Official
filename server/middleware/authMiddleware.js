/**
 * AudioKing Session Authentication Middleware
 * Validates session token from HttpOnly cookies or Bearer Authorization header
 * against persistent database records and attaches authenticated user to req.user.
 */

const { db } = require('../db');
const { hashToken } = require('../security');

function requireAuth(req, res, next) {
  let token = req.cookies?.audioking_session || 
              req.cookies?.audioking_admin_session || 
              req.cookies?.audioKingToken || 
              req.cookies?.audioKingSessionToken || 
              req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
              req.headers['x-session-token'];

  if (token) {
    token = String(token).trim();
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1).trim();
    }
  }

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in.',
      code: 'AUTH_REQUIRED'
    });
  }

  const tokenHash = hashToken(token);
  const now = Date.now();

  try {
    const sessionQuery = db.prepare(`
      SELECT 
        s.id AS session_id,
        s.expires_at AS session_expires_at,
        u.id,
        u.full_name,
        u.display_name,
        u.title,
        u.email,
        u.role,
        u.phone_number,
        u.profile_image,
        u.custom_profile_image,
        u.provider_profile_image,
        u.auth_provider,
        u.email_verified,
        u.phone_verified,
        u.password_hash,
        u.created_at,
        u.updated_at,
        u.last_login_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `);

    const record = sessionQuery.get(tokenHash, now);

    if (!record) {
      // Clear invalid cookie
      res.clearCookie('audioking_session', { httpOnly: true, sameSite: 'lax' });
      return res.status(401).json({
        error: 'Your session has expired. Please sign in again.',
        code: 'SESSION_EXPIRED'
      });
    }

    // Update last active timestamp on session
    try {
      db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?')
        .run(new Date().toISOString(), record.session_id);
    } catch (e) {}

    const effectiveAvatar = record.custom_profile_image || record.profile_image || record.provider_profile_image || 'assets/images/logo.jpg';

    // Attach user object to request
    req.user = {
      id: record.id,
      fullName: record.full_name,
      displayName: record.display_name || record.full_name.split(' ')[0],
      title: record.title || 'Pro Audio Specialist',
      email: record.email,
      role: record.role || 'customer',
      phone: record.phone_number || '',
      profileImage: effectiveAvatar,
      customProfileImage: record.custom_profile_image || null,
      providerProfileImage: record.provider_profile_image || null,
      authProvider: record.auth_provider,
      emailVerified: Boolean(record.email_verified),
      phoneVerified: Boolean(record.phone_verified),
      createdAt: record.created_at,
      lastLoginAt: record.last_login_at,
      passwordHash: record.password_hash // Available for server-side verification only
    };

    req.sessionId = record.session_id;
    req.sessionToken = token;

    next();
  } catch (err) {
    console.error('[AUTH MIDDLEWARE ERROR]', err);
    return res.status(500).json({ error: 'Failed to authenticate session.' });
  }
}

/**
 * Optional Auth Middleware
 * Populates req.user if valid session exists, but allows request to proceed if unauthenticated.
 */
function optionalAuth(req, res, next) {
  const token = req.cookies?.audioking_session || 
                req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
                req.headers['x-session-token'];

  if (!token) {
    req.user = null;
    return next();
  }

  const tokenHash = hashToken(token);
  const now = Date.now();

  try {
    const sessionQuery = db.prepare(`
      SELECT 
        s.id AS session_id,
        u.id,
        u.full_name,
        u.display_name,
        u.title,
        u.email,
        u.role,
        u.phone_number,
        u.profile_image,
        u.custom_profile_image,
        u.provider_profile_image,
        u.auth_provider,
        u.email_verified,
        u.phone_verified,
        u.password_hash,
        u.created_at,
        u.last_login_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `);

    const record = sessionQuery.get(tokenHash, now);
    if (record) {
      const effectiveAvatar = record.custom_profile_image || record.profile_image || record.provider_profile_image || 'assets/images/logo.jpg';
      req.user = {
        id: record.id,
        fullName: record.full_name,
        displayName: record.display_name || record.full_name.split(' ')[0],
        title: record.title,
        email: record.email,
        role: record.role || 'customer',
        phone: record.phone_number || '',
        profileImage: effectiveAvatar,
        customProfileImage: record.custom_profile_image || null,
        providerProfileImage: record.provider_profile_image || null,
        authProvider: record.auth_provider,
        emailVerified: Boolean(record.email_verified),
        phoneVerified: Boolean(record.phone_verified),
        createdAt: record.created_at,
        lastLoginAt: record.last_login_at,
        passwordHash: record.password_hash
      };
      req.sessionId = record.session_id;
    } else {
      req.user = null;
    }
  } catch (e) {
    req.user = null;
  }
  next();
}

module.exports = {
  requireAuth,
  optionalAuth
};
