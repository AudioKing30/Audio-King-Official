/**
 * AudioKing Session Authentication Middleware
 * Validates session token from HttpOnly cookies or Bearer Authorization header
 * against persistent database records and attaches authenticated user to req.user.
 */

const { db } = require('../db');
const { hashToken } = require('../security');

function extractCandidateTokens(req) {
  const rawCandidates = [
    req.headers['authorization']?.replace(/^Bearer\s+/i, ''),
    req.headers['x-session-token'],
    req.headers['x-admin-token'],
    req.headers['x-auth-token'],
    req.cookies?.audioking_session,
    req.cookies?.audioking_admin_session,
    req.cookies?.audioKingToken,
    req.cookies?.audioKingSessionToken
  ];

  const candidateTokens = [];
  for (let c of rawCandidates) {
    if (!c) continue;
    c = String(c).trim();
    if ((c.startsWith('"') && c.endsWith('"')) || (c.startsWith("'") && c.endsWith("'"))) {
      c = c.slice(1, -1).trim();
    }
    if (c && !candidateTokens.includes(c)) {
      candidateTokens.push(c);
    }
  }
  return candidateTokens;
}

function requireAuth(req, res, next) {
  const candidateTokens = extractCandidateTokens(req);

  if (candidateTokens.length === 0) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in.',
      code: 'AUTH_REQUIRED'
    });
  }

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
      WHERE s.token_hash = ?
    `);

    let validRecord = null;
    let matchedToken = null;

    for (const token of candidateTokens) {
      try {
        const tokenHash = hashToken(token);
        const record = sessionQuery.get(tokenHash);
        if (!record) continue;

        // Check expiration: permanent for admin, otherwise respect expires_at
        if (record.role === 'admin' || (record.session_expires_at && record.session_expires_at > now)) {
          validRecord = record;
          matchedToken = token;
          break;
        }
      } catch (err) {
        // Continue to next candidate
      }
    }

    if (!validRecord) {
      // Clear invalid cookie only if no candidate tokens were valid
      res.clearCookie('audioking_session', { httpOnly: true, sameSite: 'lax', path: '/' });
      return res.status(401).json({
        error: 'Your session has expired. Please sign in again.',
        code: 'SESSION_EXPIRED'
      });
    }

    // Auto-extend admin sessions to permanent 10 years
    if (validRecord.role === 'admin') {
      const tenYearsLater = now + (10 * 365 * 24 * 60 * 60 * 1000);
      if (!validRecord.session_expires_at || (validRecord.session_expires_at - now) < (9 * 365 * 24 * 60 * 60 * 1000)) {
        try {
          db.prepare('UPDATE sessions SET expires_at = ?, last_active_at = ? WHERE id = ?')
            .run(tenYearsLater, new Date().toISOString(), validRecord.session_id);
        } catch (e) {}
      }
    } else {
      // Update last active timestamp on session for regular customer
      try {
        db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?')
          .run(new Date().toISOString(), validRecord.session_id);
      } catch (e) {}
    }

    const effectiveAvatar = validRecord.custom_profile_image || validRecord.profile_image || validRecord.provider_profile_image || 'assets/images/logo.jpg';

    // Attach user object to request
    req.user = {
      id: validRecord.id,
      fullName: validRecord.full_name,
      displayName: validRecord.display_name || validRecord.full_name.split(' ')[0],
      title: validRecord.title || (validRecord.role === 'admin' ? 'Store Administrator' : 'Pro Audio Enthusiast'),
      email: validRecord.email,
      role: validRecord.role || 'customer',
      phone: validRecord.phone_number || '',
      profileImage: effectiveAvatar,
      customProfileImage: validRecord.custom_profile_image || null,
      providerProfileImage: validRecord.provider_profile_image || null,
      authProvider: validRecord.auth_provider,
      emailVerified: Boolean(validRecord.email_verified),
      phoneVerified: Boolean(validRecord.phone_verified),
      createdAt: validRecord.created_at,
      lastLoginAt: validRecord.last_login_at,
      passwordHash: validRecord.password_hash
    };

    req.sessionId = validRecord.session_id;
    req.sessionToken = matchedToken;

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
  const candidateTokens = extractCandidateTokens(req);

  if (candidateTokens.length === 0) {
    req.user = null;
    return next();
  }

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
        u.last_login_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ?
    `);

    let validRecord = null;
    let matchedToken = null;

    for (const token of candidateTokens) {
      try {
        const tokenHash = hashToken(token);
        const record = sessionQuery.get(tokenHash);
        if (!record) continue;

        if (record.role === 'admin' || (record.session_expires_at && record.session_expires_at > now)) {
          validRecord = record;
          matchedToken = token;
          break;
        }
      } catch (e) {}
    }

    if (validRecord) {
      const effectiveAvatar = validRecord.custom_profile_image || validRecord.profile_image || validRecord.provider_profile_image || 'assets/images/logo.jpg';
      req.user = {
        id: validRecord.id,
        fullName: validRecord.full_name,
        displayName: validRecord.display_name || validRecord.full_name.split(' ')[0],
        title: validRecord.title,
        email: validRecord.email,
        role: validRecord.role || 'customer',
        phone: validRecord.phone_number || '',
        profileImage: effectiveAvatar,
        customProfileImage: validRecord.custom_profile_image || null,
        providerProfileImage: validRecord.provider_profile_image || null,
        authProvider: validRecord.auth_provider,
        emailVerified: Boolean(validRecord.email_verified),
        phoneVerified: Boolean(validRecord.phone_verified),
        createdAt: validRecord.created_at,
        lastLoginAt: validRecord.last_login_at,
        passwordHash: validRecord.password_hash
      };
      req.sessionId = validRecord.session_id;
      req.sessionToken = matchedToken;
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
