/**
 * AudioKing Admin Authentication & Route Guard Middleware
 * Strictly restricts access to /admin/* web routes and /api/admin/* endpoints
 * to authenticated users with role === 'admin'.
 */

const { db } = require('../db');
const { hashToken } = require('../security');

function getAdminUserFromRequest(req) {
  const rawCandidates = [
    req.headers['x-admin-token'],
    req.cookies?.audioking_admin_session,
    req.headers['authorization']?.replace(/^Bearer\s+/i, ''),
    req.headers['x-session-token'],
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

  if (candidateTokens.length > 0) {
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
      WHERE s.token_hash = ?
    `);

    let nonAdminUser = null;

    for (const token of candidateTokens) {
      try {
        const tokenHash = hashToken(token);
        const record = sessionQuery.get(tokenHash);
        if (!record) continue;

        if (record.role === 'admin') {
          // Permanent lifetime admin session: auto-extend by 10 years and update last active
          try {
            const tenYearsLater = Date.now() + (10 * 365 * 24 * 60 * 60 * 1000);
            db.prepare('UPDATE sessions SET expires_at = ?, last_active_at = ? WHERE id = ?')
              .run(tenYearsLater, new Date().toISOString(), record.session_id);
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
        } else {
          // For non-admin, respect expiration
          if (record.session_expires_at && record.session_expires_at > Date.now()) {
            nonAdminUser = record;
          }
        }
      } catch (err) {
        console.error('[ADMIN AUTH ERROR]', err);
      }
    }

    // If non-admin user tokens were provided, strictly deny access
    if (nonAdminUser) {
      return { forbidden: true, user: nonAdminUser };
    }
  }

  // Explicit opt-in local development bypass only
  const allowDevBypass = process.env.ALLOW_DEV_ADMIN_BYPASS === 'true' && process.env.NODE_ENV !== 'production';
  if (allowDevBypass) {
    try {
      const defaultAdmin = db.prepare("SELECT id, full_name, display_name, email, role, profile_image FROM users WHERE role = 'admin' LIMIT 1").get();
      if (defaultAdmin) {
        return {
          id: defaultAdmin.id,
          fullName: defaultAdmin.full_name,
          displayName: defaultAdmin.display_name || defaultAdmin.full_name || 'Admin',
          email: defaultAdmin.email,
          role: defaultAdmin.role,
          profileImage: defaultAdmin.profile_image || 'assets/images/logo.jpg',
          sessionId: 'dev_local_admin_session'
        };
      }
    } catch (e) {
      console.error('[DEV ADMIN FALLBACK ERROR]', e);
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
