/**
 * AudioKing Admin Authentication & Route Guard Middleware
 * Strictly restricts access to /admin/* web routes and /api/admin/* endpoints
 * to authenticated users with role === 'admin'.
 */

const { db } = require('../db');
const { hashToken } = require('../security');

function getAdminUserFromRequest(req) {
  const rawCandidates = [
    req.headers['authorization']?.replace(/^Bearer\s+/i, ''),
    req.headers['x-admin-token'],
    req.headers['x-session-token'],
    req.cookies?.audioking_admin_session,
    req.cookies?.audioking_session,
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

  if (candidateTokens.length === 0) return null;

  const now = Date.now();
  const sessionQuery = db.prepare(`
    SELECT 
      s.id AS session_id,
      s.expires_at AS session_expires_at,
      u.id,
      u.full_name,
      u.display_name,
      u.email,
      u.role,
      u.profile_image
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);

  for (const token of candidateTokens) {
    try {
      const tokenHash = hashToken(token);
      const record = sessionQuery.get(tokenHash, now);
      if (!record) continue;

      if (record.role !== 'admin') {
        return { forbidden: true, user: record };
      }

      // Refresh last active
      try {
        db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?')
          .run(new Date().toISOString(), record.session_id);
      } catch (e) {}

      return {
        id: record.id,
        fullName: record.full_name,
        displayName: record.display_name || 'Admin',
        email: record.email,
        role: record.role,
        profileImage: record.profile_image || 'assets/images/logo.jpg',
        sessionId: record.session_id
      };
    } catch (err) {
      console.error('[ADMIN AUTH ERROR]', err);
    }
  }

  return null;
}

/**
 * Route guard for Web pages (/admin, /admin/*)
 * Redirects to /admin/login if unauthenticated or not an admin.
 */
function requireAdminWeb(req, res, next) {
  const admin = getAdminUserFromRequest(req);
  if (!admin || admin.forbidden) {
    return res.redirect('/admin/login');
  }
  req.admin = admin;
  next();
}

/**
 * Route guard for API endpoints (/api/admin/*)
 * Returns 401/403 JSON if unauthenticated or not an admin.
 */
function requireAdminApi(req, res, next) {
  const admin = getAdminUserFromRequest(req);
  if (!admin) {
    return res.status(401).json({
      error: 'Admin authentication required. Please sign in.',
      code: 'ADMIN_AUTH_REQUIRED'
    });
  }

  if (admin.forbidden) {
    return res.status(403).json({
      error: 'Access denied. Administrator privileges required.',
      code: 'ADMIN_FORBIDDEN'
    });
  }

  req.admin = admin;
  next();
}

module.exports = {
  requireAdminWeb,
  requireAdminApi,
  getAdminUserFromRequest
};
