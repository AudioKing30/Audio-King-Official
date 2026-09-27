/**
 * AudioKing Authentication API Router
 * Handles Signup, OTP Verification, Login, Google OAuth, Password Reset,
 * Password Change, Profile Updates, Session Validation, and Logout.
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const {
  hashPassword,
  comparePassword,
  generateOTP,
  hashToken,
  generateSessionToken,
  generateResetToken,
  checkRateLimit
} = require('../security');
const {
  sendSignupVerificationEmail,
  sendPasswordResetEmail,
  sendChangePasswordOtpEmail,
  sendPasswordChangedEmail
} = require('../email');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

const googleCodeExchanges = new Map();
const SESSION_EXPIRY_MS = Number(process.env.SESSION_EXPIRY_MS) || (30 * 24 * 60 * 60 * 1000); // 30 days
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Helper: Strip sensitive fields before returning user object
 */
function sanitizeUser(user) {
  if (!user) return null;
  const customImg = user.custom_profile_image || user.customProfileImage || null;
  const providerImg = user.provider_profile_image || user.providerProfileImage || null;
  const effectiveImg = customImg || user.profile_image || user.profileImage || providerImg || 'assets/images/logo.jpg';
  return {
    id: user.id,
    fullName: user.full_name || user.fullName,
    displayName: user.display_name || user.displayName || (user.full_name || user.fullName || '').split(' ')[0],
    title: user.title || 'Pro Audio Specialist',
    email: user.email,
    phone: user.phone_number || user.phone || '',
    profileImage: effectiveImg,
    customProfileImage: customImg,
    providerProfileImage: providerImg,
    authProvider: user.auth_provider || user.authProvider || 'email',
    role: user.role || 'customer',
    emailVerified: Boolean(user.email_verified ?? user.emailVerified),
    phoneVerified: Boolean(user.phone_verified ?? user.phoneVerified),
    createdAt: user.created_at || user.createdAt,
    lastLoginAt: user.last_login_at || user.lastLoginAt
  };
}

/**
 * Helper: Create session in database & attach cookie
 */
function createSessionForUser(res, userId, req) {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const expiresAt = Date.now() + SESSION_EXPIRY_MS;
  const sessionId = crypto.randomUUID();

  const userAgent = req.headers['user-agent'] || 'Unknown Browser';
  const ipAddress = req.ip || req.connection?.remoteAddress || '127.0.0.1';

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_active_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, expiresAt, now, now, userAgent, ipAddress);

  // Set secure HttpOnly cookie
  res.cookie('audioking_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRY_MS,
    path: '/'
  });

  // If user is admin, also set the admin session cookie for compatibility
  try {
    const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (userRow && userRow.role === 'admin') {
      res.cookie('audioking_admin_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_EXPIRY_MS,
        path: '/'
      });
    }
  } catch (e) {}

  return token;
}

// =========================================================================
// 1. SIGNUP (Initiate Registration with Email OTP)
// =========================================================================
router.post('/signup', async (req, res) => {
  const { fullName, email, password, confirmPassword, phone } = req.body;

  // Validation
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  // Rate limit signup attempts per IP/email
  const limit = checkRateLimit(`signup_${cleanEmail}`, 5, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Too many signup attempts. Please retry in ${limit.retryAfterSec}s.` });
  }

  try {
    // Check if user already exists
    const existingUser = db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(cleanEmail);
    if (existingUser && existingUser.email_verified === 1) {
      return res.status(400).json({
        error: 'An account with this email address already exists. Please sign in instead.'
      });
    }

    // Generate secure 6-digit OTP
    const otp = generateOTP();
    const otpHash = hashToken(otp);
    const passwordHash = await hashPassword(password);
    const expiresAt = Date.now() + OTP_EXPIRY_MS;
    const now = new Date().toISOString();

    let userId = existingUser?.id;
    if (!userId) {
      userId = crypto.randomUUID();
      const displayName = fullName.trim().split(' ')[0] + Math.floor(Math.random() * 90 + 10);
      db.prepare(`
        INSERT INTO users (id, full_name, display_name, title, email, phone_number, profile_image, auth_provider, email_verified, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'email', 0, ?, ?, ?)
      `).run(userId, fullName.trim(), displayName, 'Music Creator & Pro Audio Enthusiast', cleanEmail, (phone || '').trim(), 'assets/images/logo.jpg', passwordHash, now, now);
    } else {
      db.prepare(`
        UPDATE users SET full_name = ?, phone_number = ?, password_hash = ?, updated_at = ? WHERE id = ?
      `).run(fullName.trim(), (phone || '').trim(), passwordHash, now, userId);
    }

    const metadata = JSON.stringify({
      fullName: fullName.trim(),
      phone: (phone || '').trim(),
      passwordHash
    });

    // Invalidate any previous unused signup OTPs for this email
    db.prepare('UPDATE verification_codes SET verified = 1 WHERE email = ? AND purpose = ?')
      .run(cleanEmail, 'signup');

    // Store new verification code
    const codeId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO verification_codes (id, user_id, email, otp_hash, purpose, metadata, expires_at, attempts, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(codeId, userId, cleanEmail, otpHash, 'signup', metadata, expiresAt, now);

    // Send transactional verification email
    await sendSignupVerificationEmail(cleanEmail, otp, fullName);

    return res.json({
      success: true,
      message: "We've sent a verification code to your email address.",
      email: cleanEmail
    });
  } catch (err) {
    console.error('[SIGNUP ERROR]', err);
    return res.status(500).json({ error: 'Failed to process registration. Please try again.' });
  }
});

// =========================================================================
// 2. VERIFY SIGNUP OTP (Complete Registration & Log In)
// =========================================================================
router.post('/verify-signup-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = String(otp).trim();

  try {
    const record = db.prepare(`
      SELECT * FROM verification_codes 
      WHERE email = ? AND purpose = 'signup' AND verified = 0 
      ORDER BY created_at DESC LIMIT 1
    `).get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
    }

    if (Date.now() > record.expires_at) {
      return res.status(400).json({ error: 'This verification code has expired. Please request a new code.' });
    }

    if (record.attempts >= 5) {
      db.prepare('UPDATE verification_codes SET verified = 1 WHERE id = ?').run(record.id);
      return res.status(400).json({ error: 'Too many incorrect attempts. This code is invalidated. Please request a new code.' });
    }

    const inputHash = hashToken(cleanOtp);
    if (inputHash !== record.otp_hash) {
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      return res.status(400).json({ error: 'Incorrect OTP. Please enter the correct verification code.' });
    }

    // OTP Verified successfully!
    db.prepare('UPDATE verification_codes SET verified = 1 WHERE id = ?').run(record.id);

    // Create or activate user
    const meta = JSON.parse(record.metadata || '{}');
    const now = new Date().toISOString();

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (user) {
      // Update existing pending user
      db.prepare(`
        UPDATE users SET 
          full_name = ?, 
          phone_number = ?, 
          password_hash = ?, 
          email_verified = 1, 
          updated_at = ?, 
          last_login_at = ?
        WHERE id = ?
      `).run(meta.fullName, meta.phone, meta.passwordHash, now, now, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      // Insert new user
      const userId = crypto.randomUUID();
      const displayName = meta.fullName.split(' ')[0] + Math.floor(Math.random() * 90 + 10);
      db.prepare(`
        INSERT INTO users (id, full_name, display_name, title, email, phone_number, profile_image, auth_provider, email_verified, password_hash, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'email', 1, ?, ?, ?, ?)
      `).run(userId, meta.fullName, displayName, 'Music Creator & Pro Audio Enthusiast', cleanEmail, meta.phone, 'assets/images/logo.jpg', meta.passwordHash, now, now, now);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    // Link/Record email auth identity
    try {
      db.prepare(`
        INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
        VALUES (?, ?, 'email', ?, ?)
      `).run(crypto.randomUUID(), user.id, cleanEmail, now);
    } catch (e) {}

    // Create authenticated session
    const sessionToken = createSessionForUser(res, user.id, req);

    return res.json({
      success: true,
      message: 'Account successfully verified and activated!',
      token: sessionToken,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('[VERIFY SIGNUP ERROR]', err);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// =========================================================================
// 3. RESEND SIGNUP OTP
// =========================================================================
router.post('/resend-signup-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email address is required.' });

  const cleanEmail = email.trim().toLowerCase();

  // Rate limit resend requests (60 seconds)
  const limit = checkRateLimit(`resend_${cleanEmail}`, 1, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Please wait ${limit.retryAfterSec}s before requesting another code.` });
  }

  try {
    const existing = db.prepare(`
      SELECT * FROM verification_codes 
      WHERE email = ? AND purpose = 'signup' 
      ORDER BY created_at DESC LIMIT 1
    `).get(cleanEmail);

    if (!existing) {
      return res.status(400).json({ error: 'No pending registration found for this email. Please sign up first.' });
    }

    const otp = generateOTP();
    const otpHash = hashToken(otp);
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    db.prepare('UPDATE verification_codes SET verified = 1 WHERE email = ? AND purpose = ?')
      .run(cleanEmail, 'signup');

    const codeId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO verification_codes (id, user_id, email, otp_hash, purpose, metadata, expires_at, attempts, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(codeId, existing.user_id, cleanEmail, otpHash, 'signup', existing.metadata, expiresAt, new Date().toISOString());

    const meta = JSON.parse(existing.metadata || '{}');
    await sendSignupVerificationEmail(cleanEmail, otp, meta.fullName || 'Musician');

    return res.json({ success: true, message: 'A fresh verification code has been sent.' });
  } catch (err) {
    console.error('[RESEND OTP ERROR]', err);
    return res.status(500).json({ error: 'Failed to resend code. Please try again.' });
  }
});

// =========================================================================
// 4. LOGIN (Email + Password)
// =========================================================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Rate limit login attempts
  const limit = checkRateLimit(`login_${cleanEmail}`, 8, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Too many failed login attempts. Please try again in ${limit.retryAfterSec}s.` });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.email_verified === 0) {
      return res.status(403).json({
        error: 'Please verify your email address to log in.',
        requiresVerification: true,
        email: cleanEmail
      });
    }

    const match = await comparePassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Success: Update last login
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);

    // Create session
    const sessionToken = createSessionForUser(res, user.id, req);

    return res.json({
      success: true,
      message: 'Signed in successfully.',
      token: sessionToken,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    return res.status(500).json({ error: 'Failed to log in. Please try again.' });
  }
});

// =========================================================================
// 5. GOOGLE OAUTH 2.0 (Real Google Authentication via accounts.google.com)
// =========================================================================

function getGoogleRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_REDIRECT_URI.trim()) {
    return process.env.GOOGLE_REDIRECT_URI.trim().replace(/\/+$/, '');
  }
  const host = req.get('host') || 'audioking-api.onrender.com';
  const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' || host.includes('onrender.com');
  const protocol = isHttps ? 'https' : 'http';
  return `${protocol}://${host}/api/auth/google/callback`;
}

/**
 * 5A. Check Google OAuth Configuration
 */
router.get('/google/config', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const configured = Boolean(clientId && clientId.includes('.apps.googleusercontent.com'));
  return res.json({
    configured,
    clientId: configured ? clientId : null,
    redirectUri: getGoogleRedirectUri(req)
  });
});

/**
 * 5B. Direct Google OAuth Redirection Route
 * Immediately redirects the browser to accounts.google.com with zero client-side delay or popup blocker issues.
 */
router.get('/google/redirect', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId || !clientId.includes('.apps.googleusercontent.com')) {
    return res.status(400).send('Google OAuth Client ID is not configured. Please add GOOGLE_CLIENT_ID to .env');
  }

  const redirectUri = getGoogleRedirectUri(req);

  const returnTo = req.query.return_to || '/';
  const stateData = JSON.stringify({
    csrf: crypto.randomBytes(8).toString('hex'),
    returnTo
  });
  const state = Buffer.from(stateData).toString('base64url');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', state);

  return res.redirect(authUrl.toString());
});

/**
 * 5C. Generate Google Authorization URL (JSON API)
 * Redirects browser to accounts.google.com for authentic user account selection
 */
router.get('/google/url', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId || !clientId.includes('.apps.googleusercontent.com')) {
    return res.status(400).json({
      configured: false,
      error: 'Google OAuth Client ID is not configured. Please add GOOGLE_CLIENT_ID to .env'
    });
  }

  const redirectUri = getGoogleRedirectUri(req);

  const returnTo = req.query.return_to || '/';
  const stateData = JSON.stringify({
    csrf: crypto.randomBytes(8).toString('hex'),
    returnTo
  });
  const state = Buffer.from(stateData).toString('base64url');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', state);

  return res.json({
    configured: true,
    url: authUrl.toString(),
    state
  });
});

/**
 * 5C. Google OAuth Authorization Code Callback
 * Receives authorization code from accounts.google.com, exchanges for real user profile,
 * persists user in SQLite database, creates session, and completes login.
 */
router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query;

  // Decode returnTo from state parameter
  let returnTo = '/';
  if (state) {
    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      if (parsed && parsed.returnTo) returnTo = parsed.returnTo;
    } catch (e) {}
  }
  if (typeof returnTo !== 'string' || returnTo.startsWith('file:') || (!returnTo.startsWith('http:') && !returnTo.startsWith('https:') && !returnTo.startsWith('/'))) {
    returnTo = '/';
  }
  const sep = returnTo.includes('?') ? '&' : '?';
  const targetRedirectUrl = `${returnTo}${sep}auth=google_success`;

  if (error) {
    console.warn('[GOOGLE AUTH CANCELLED/ERROR]', error);
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Google Sign-In Cancelled</title></head>
        <body style="background:#0B0E14; color:#fff; font-family:sans-serif; text-align:center; padding:60px 20px;">
          <h2>Google Sign-In Cancelled</h2>
          <p style="color:#94A3B8;">${error === 'access_denied' ? 'Sign-in was cancelled.' : error}</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'AUDIOKING_GOOGLE_ERROR', error: '${error}' }, '*');
              setTimeout(() => window.close(), 1500);
            } else {
              setTimeout(() => { window.location.href = ${JSON.stringify(returnTo)}; }, 1500);
            }
          </script>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!clientId || !clientSecret) {
    return res.status(500).send('Google credentials not configured on server.');
  }

  const redirectUri = getGoogleRedirectUri(req);

  try {
    // 1. Exchange authorization code for tokens with Google (with deduplication to prevent double-fetch invalid_grant)
    const codeKey = String(code);
    let tokenData;
    if (googleCodeExchanges.has(codeKey)) {
      tokenData = await googleCodeExchanges.get(codeKey);
    } else {
      const exchangePromise = (async () => {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: codeKey,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
          }).toString()
        });
        const parsed = await tokenRes.json().catch(() => ({}));
        return { ok: tokenRes.ok, ...parsed };
      })();

      googleCodeExchanges.set(codeKey, exchangePromise);
      // Clean cache after 60s
      setTimeout(() => googleCodeExchanges.delete(codeKey), 60000);
      tokenData = await exchangePromise;
    }

    const tokens = tokenData;
    if (!tokens || !tokens.access_token) {
      console.error('[GOOGLE TOKEN EXCHANGE ERROR]', tokens);
      const errDetail = tokens?.error_description || tokens?.error || 'Token exchange failed.';
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title></head>
          <body style="background:#0B0E14; color:#fff; font-family:sans-serif; text-align:center; padding:60px 20px;">
            <h2>Google Authentication Failed</h2>
            <p style="color:#ef4444;">${errDetail}</p>
            <p><a href="/" style="color:#FF6B00; text-decoration:none;">&larr; Return to AudioKing</a></p>
            <script>
              try {
                if (window.opener && !window.opener.closed) {
                  window.opener.postMessage({ type: 'AUDIOKING_GOOGLE_ERROR', error: ${JSON.stringify(errDetail)} }, '*');
                  setTimeout(() => window.close(), 1500);
                }
              } catch (e) {}
            </script>
          </body>
        </html>
      `);
    }

    // 2. Retrieve real Google profile using access token
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await userinfoRes.json();

    if (!profile.email) {
      return res.status(400).send('Unable to retrieve verified email from Google.');
    }

    const cleanEmail = profile.email.trim().toLowerCase();
    const fullName = profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || 'Google User';
    const profileImage = profile.picture || 'assets/images/logo.jpg';
    const now = new Date().toISOString();

    // 3. Persistent SQLite Database Identity Linking & Upsert (Never placeholder, duplicate-protected)
    const googleId = profile.sub || profile.id || cleanEmail;
    const existingIdentity = db.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND provider_user_id = ?').get('google', String(googleId));

    let user = null;
    if (existingIdentity) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(existingIdentity.user_id);
    }

    if (!user) {
      // Check if user exists by verified email address
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    }

    if (user) {
      // Link Google identity to existing user if not already linked
      try {
        db.prepare(`
          INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
          VALUES (?, ?, 'google', ?, ?)
        `).run(crypto.randomUUID(), user.id, String(googleId), now);
      } catch (e) {}

      // If email matches admin email, ensure role is 'admin'
      const isAdminEmail = cleanEmail === 'admin@audioking.in' || cleanEmail === 'audioking30@gmail.com';
      const effectiveRole = isAdminEmail ? 'admin' : (user.role || 'customer');

      // Preserve customer-saved full_name and custom avatar as source of truth
      const hasCustomAvatar = Boolean(user.custom_profile_image && user.custom_profile_image.trim());
      const effectiveAvatar = hasCustomAvatar ? user.custom_profile_image : profileImage;
      const preservedFullName = (user.full_name && user.full_name.trim()) ? user.full_name : fullName;

      db.prepare(`
        UPDATE users SET
          email_verified = 1,
          role = ?,
          full_name = ?,
          provider_profile_image = ?,
          profile_image = ?,
          last_login_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(effectiveRole, preservedFullName, profileImage, effectiveAvatar, now, now, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      // Brand new user registration via Google OAuth
      const userId = crypto.randomUUID();
      const displayName = fullName.split(' ')[0] + Math.floor(Math.random() * 90 + 10);
      const isAdminEmail = cleanEmail === 'admin@audioking.in' || cleanEmail === 'audioking30@gmail.com';
      const userRole = isAdminEmail ? 'admin' : 'customer';

      db.prepare(`
        INSERT INTO users (id, full_name, display_name, title, email, role, phone_number, profile_image, provider_profile_image, custom_profile_image, auth_provider, email_verified, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, NULL, 'google', 1, ?, ?, ?)
      `).run(userId, fullName, displayName, 'Music Creator & Pro Audio Enthusiast', cleanEmail, userRole, profileImage, profileImage, now, now, now);
      
      db.prepare(`
        INSERT INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
        VALUES (?, ?, 'google', ?, ?)
      `).run(crypto.randomUUID(), userId, String(googleId), now);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    // 4. Create real authenticated session & cookie
    const sessionToken = createSessionForUser(res, user.id, req);
    const sanitized = sanitizeUser(user);
    const hashRedirectUrl = `${targetRedirectUrl}#auth_token=${encodeURIComponent(sessionToken)}`;

    // 5. Return seamless popup bridge or full redirect
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>AudioKing — Google Account Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              background-color: #0B0E14;
              color: #F8FAFC;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              background: #151A23;
              border: 1px solid rgba(255,255,255,0.08);
              border-radius: 16px;
              padding: 32px 40px;
              text-align: center;
              max-width: 400px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            }
            .spinner {
              width: 40px;
              height: 40px;
              border: 3px solid rgba(255, 107, 0, 0.2);
              border-top-color: #FF6B00;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              margin: 0 auto 20px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            h2 { font-size: 20px; margin: 0 0 8px; color: #fff; }
            p { font-size: 14px; color: #94A3B8; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="spinner"></div>
            <h2>Google Account Connected!</h2>
            <p>Welcome, ${fullName} (${cleanEmail})...</p>
          </div>
          <script>
            const authData = {
              type: 'AUDIOKING_GOOGLE_SUCCESS',
              user: ${JSON.stringify(sanitized)},
              token: ${JSON.stringify(sessionToken)}
            };
            try {
              localStorage.setItem('audioKingSessionToken', authData.token);
              localStorage.setItem('audioking_token', authData.token);
              localStorage.setItem('audioKingToken', authData.token);
              localStorage.setItem('audioKingUser', JSON.stringify(authData.user));
              localStorage.setItem('audioking_user', JSON.stringify(authData.user));
            } catch (e) {}

            try {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage(authData, '*');
                setTimeout(() => window.close(), 400);
              } else {
                window.location.href = ${JSON.stringify(hashRedirectUrl)};
              }
            } catch (e) {
              window.location.href = ${JSON.stringify(hashRedirectUrl)};
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('[GOOGLE CALLBACK ERROR]', err);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Server Error</title></head>
        <body style="background:#0B0E14; color:#fff; font-family:sans-serif; text-align:center; padding:60px 20px;">
          <h2>Google Authentication Error</h2>
          <p style="color:#ef4444;">${err.message}</p>
          <p><a href="/" style="color:#FF6B00; text-decoration:none;">&larr; Return to AudioKing</a></p>
        </body>
      </html>
    `);
  }
});

/**
 * 5D. Real Google Token Verification (For Google Identity Services / One-Tap / Native Apps)
 * Validates Google ID token via official tokeninfo API.
 * STRICTLY NO PLACEHOLDER.
 */
router.post('/google', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Google authentication credential is required.' });
  }

  try {
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired Google token. Please sign in again.' });
    }

    const payload = await googleRes.json();
    if (!payload || !payload.email) {
      return res.status(401).json({ error: 'Could not verify email from Google.' });
    }

    const cleanEmail = payload.email.trim().toLowerCase();
    const fullName = payload.name || payload.given_name || 'Google Musician';
    const profileImage = payload.picture || 'assets/images/logo.jpg';
    const now = new Date().toISOString();

    // Persistent SQLite Database Identity Linking & Upsert
    const googleId = payload.sub || cleanEmail;
    const existingIdentity = db.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND provider_user_id = ?').get('google', String(googleId));

    let user = null;
    if (existingIdentity) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(existingIdentity.user_id);
    }

    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    }

    if (user) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
          VALUES (?, ?, 'google', ?, ?)
        `).run(crypto.randomUUID(), user.id, String(googleId), now);
      } catch (e) {}

      // Preserve customer-saved full_name and custom avatar as source of truth
      const hasCustomAvatar = Boolean(user.custom_profile_image && user.custom_profile_image.trim());
      const effectiveAvatar = hasCustomAvatar ? user.custom_profile_image : profileImage;
      const preservedFullName = (user.full_name && user.full_name.trim()) ? user.full_name : fullName;

      db.prepare(`
        UPDATE users SET 
          email_verified = 1,
          full_name = ?,
          provider_profile_image = ?,
          profile_image = ?,
          last_login_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(preservedFullName, profileImage, effectiveAvatar, now, now, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      const userId = crypto.randomUUID();
      const displayName = fullName.split(' ')[0] + Math.floor(Math.random() * 90 + 10);
      db.prepare(`
        INSERT INTO users (id, full_name, display_name, title, email, phone_number, profile_image, provider_profile_image, custom_profile_image, auth_provider, email_verified, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, '', ?, ?, NULL, 'google', 1, ?, ?, ?)
      `).run(userId, fullName, displayName, 'Music Creator & Pro Audio Enthusiast', cleanEmail, profileImage, profileImage, now, now, now);

      db.prepare(`
        INSERT INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
        VALUES (?, ?, 'google', ?, ?)
      `).run(crypto.randomUUID(), userId, String(googleId), now);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    const sessionToken = createSessionForUser(res, user.id, req);

    return res.json({
      success: true,
      message: 'Signed in via Google successfully.',
      token: sessionToken,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('[GOOGLE AUTH ERROR]', err);
    return res.status(500).json({ error: 'Google sign-in verification failed.' });
  }
});

// =========================================================================
// 6. FORGOT PASSWORD (Send OTP)
// =========================================================================
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email address is required.' });

  const cleanEmail = email.trim().toLowerCase();

  const limit = checkRateLimit(`forgot_${cleanEmail}`, 3, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Too many password reset attempts. Please wait ${limit.retryAfterSec}s.` });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (user) {
      const otp = generateOTP();
      const otpHash = hashToken(otp);
      const expiresAt = Date.now() + OTP_EXPIRY_MS;

      // Invalidate existing reset OTPs
      db.prepare('UPDATE verification_codes SET verified = 1 WHERE email = ? AND purpose = ?')
        .run(cleanEmail, 'password_reset');

      const codeId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO verification_codes (id, user_id, email, otp_hash, purpose, metadata, expires_at, attempts, verified, created_at)
        VALUES (?, ?, ?, ?, 'password_reset', null, ?, 0, 0, ?)
      `).run(codeId, user.id, cleanEmail, otpHash, expiresAt, new Date().toISOString());

      await sendPasswordResetEmail(cleanEmail, otp, user.full_name);
    } else {
      // Fake delay to prevent user enumeration
      await new Promise(r => setTimeout(r, 400));
    }

    return res.json({
      success: true,
      message: 'If an account exists with this email, a verification code has been sent.',
      email: cleanEmail
    });
  } catch (err) {
    console.error('[FORGOT PASSWORD ERROR]', err);
    return res.status(500).json({ error: 'Failed to request password reset. Please try again.' });
  }
});

// =========================================================================
// 7. VERIFY RESET OTP (Issue Single-Use Reset Token)
// =========================================================================
router.post('/verify-reset-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanOtp = String(otp).trim();

  try {
    const record = db.prepare(`
      SELECT * FROM verification_codes 
      WHERE email = ? AND purpose = 'password_reset' AND verified = 0 
      ORDER BY created_at DESC LIMIT 1
    `).get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No active password reset request found. Please request a new OTP.' });
    }

    if (Date.now() > record.expires_at) {
      return res.status(400).json({ error: 'This OTP has expired. Please request a new OTP.' });
    }

    if (record.attempts >= 5) {
      db.prepare('UPDATE verification_codes SET verified = 1 WHERE id = ?').run(record.id);
      return res.status(400).json({ error: 'Too many incorrect attempts. This OTP is locked. Please request a new OTP.' });
    }

    const inputHash = hashToken(cleanOtp);
    if (inputHash !== record.otp_hash) {
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
      return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
    }

    // Mark OTP as verified
    db.prepare('UPDATE verification_codes SET verified = 1 WHERE id = ?').run(record.id);

    // Issue a 15-minute single-use reset token
    const resetToken = generateResetToken();
    const tokenHash = hashToken(resetToken);
    const tokenExpiresAt = Date.now() + (15 * 60 * 1000);

    const tokenId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO verification_codes (id, user_id, email, otp_hash, purpose, metadata, expires_at, attempts, verified, created_at)
      VALUES (?, ?, ?, ?, 'reset_token', null, ?, 0, 0, ?)
    `).run(tokenId, record.user_id, cleanEmail, tokenHash, tokenExpiresAt, new Date().toISOString());

    return res.json({
      success: true,
      message: 'OTP verified. Please set your new password.',
      resetToken
    });
  } catch (err) {
    console.error('[VERIFY RESET OTP ERROR]', err);
    return res.status(500).json({ error: 'Failed to verify OTP. Please try again.' });
  }
});

// =========================================================================
// 8. RESET PASSWORD (Using Verified Reset Token)
// =========================================================================
router.post('/reset-password', async (req, res) => {
  const { email, resetToken, newPassword, confirmPassword } = req.body;

  if (!email || !resetToken || !newPassword) {
    return res.status(400).json({ error: 'Email, reset token, and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const tokenHash = hashToken(resetToken);

  try {
    const tokenRecord = db.prepare(`
      SELECT * FROM verification_codes 
      WHERE email = ? AND otp_hash = ? AND purpose = 'reset_token' AND verified = 0
    `).get(cleanEmail, tokenHash);

    if (!tokenRecord || Date.now() > tokenRecord.expires_at) {
      return res.status(400).json({ error: 'Invalid or expired password reset session. Please request a new OTP.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user) {
      return res.status(400).json({ error: 'User account not found.' });
    }

    // Invalidate reset token
    db.prepare('UPDATE verification_codes SET verified = 1 WHERE id = ?').run(tokenRecord.id);

    // Hash new password & update
    const newHash = await hashPassword(newPassword);
    const now = new Date().toISOString();

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, now, user.id);

    // Invalidate all existing sessions for security
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    res.clearCookie('audioking_session');

    // Send confirmation email
    await sendPasswordChangedEmail(user.email, user.full_name);

    return res.json({
      success: true,
      message: 'Password has been reset successfully. You may now sign in with your new password.'
    });
  } catch (err) {
    console.error('[RESET PASSWORD ERROR]', err);
    return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

// =========================================================================
// 9A. REQUEST CHANGE PASSWORD OTP (Authenticated In-App)
// =========================================================================
router.post('/change-password-otp', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  // Rate limit
  const limit = checkRateLimit(`change_pass_otp_${req.user.id}`, 3, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: `Please wait ${limit.retryAfterSec}s before requesting another verification code.` });
  }

  try {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'Your account was created via Google OAuth. Please set a password through Forgot Password.' });
    }

    const match = await comparePassword(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const otp = generateOTP();
    const otpHash = hashToken(otp);
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    // Invalidate prior unused change_password OTPs for this user
    db.prepare("UPDATE verification_codes SET verified = 1 WHERE user_id = ? AND purpose = 'change_password'")
      .run(req.user.id);

    const codeId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO verification_codes (id, user_id, email, otp_hash, purpose, metadata, expires_at, attempts, verified, created_at)
      VALUES (?, ?, ?, ?, 'change_password', null, ?, 0, 0, ?)
    `).run(codeId, req.user.id, req.user.email, otpHash, expiresAt, new Date().toISOString());

    await sendChangePasswordOtpEmail(req.user.email, otp, req.user.fullName);

    return res.json({
      success: true,
      message: `A 6-digit verification code was sent to ${req.user.email}. Please verify to confirm password change.`
    });
  } catch (err) {
    console.error('[REQUEST CHANGE PASSWORD OTP ERROR]', err);
    return res.status(500).json({ error: 'Failed to dispatch verification code. Please try again.' });
  }
});

// =========================================================================
// 9B. CONFIRM CHANGE PASSWORD WITH OTP (Authenticated In-App)
// =========================================================================
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword, otp } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  if (!otp || String(otp).trim().length !== 6) {
    return res.status(400).json({ error: 'Please enter the 6-digit verification code sent to your email.' });
  }

  const cleanOtp = String(otp).trim();

  try {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

    if (!user || !user.password_hash) {
      return res.status(400).json({ error: 'Your account was created via Google OAuth. Please set a password through Forgot Password.' });
    }

    const match = await comparePassword(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    // Verify OTP from database
    const codeRecord = db.prepare(`
      SELECT * FROM verification_codes 
      WHERE user_id = ? AND purpose = 'change_password' AND verified = 0 
      ORDER BY created_at DESC LIMIT 1
    `).get(req.user.id);

    if (!codeRecord || codeRecord.expires_at < Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    const otpHash = hashToken(cleanOtp);
    if (otpHash !== codeRecord.otp_hash) {
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(codeRecord.id);
      return res.status(400).json({ error: 'Invalid verification code. Please check and try again.' });
    }

    // Mark OTP as verified
    db.prepare('UPDATE verification_codes SET verified = 1 WHERE id = ?').run(codeRecord.id);

    const newHash = await hashPassword(newPassword);
    const now = new Date().toISOString();

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(newHash, now, req.user.id);

    // Send security notification
    await sendPasswordChangedEmail(req.user.email, req.user.fullName);

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error('[CHANGE PASSWORD ERROR]', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

// =========================================================================
// 10. UPDATE PROFILE (Authenticated)
// =========================================================================
router.patch('/profile', requireAuth, (req, res) => {
  const {
    firstName, lastName,
    fullName: reqFullName, full_name,
    displayName, display_name,
    title,
    phone, phone_number,
    profileImage, profile_image
  } = req.body;

  try {
    let resolvedFullName = full_name || reqFullName;
    if (!resolvedFullName && (firstName || lastName)) {
      resolvedFullName = `${firstName || ''} ${lastName || ''}`.trim();
    }
    const fullName = resolvedFullName || req.user.fullName;
    const resolvedDisplayName = (display_name !== undefined ? display_name : displayName);
    const resolvedTitle = title !== undefined ? title : null;
    const resolvedPhone = phone_number !== undefined ? phone_number : phone;
    const resolvedAvatar = profile_image !== undefined ? profile_image : profileImage;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE users SET 
        full_name = ?,
        display_name = COALESCE(?, display_name),
        title = COALESCE(?, title),
        phone_number = COALESCE(?, phone_number),
        profile_image = COALESCE(?, profile_image),
        custom_profile_image = COALESCE(?, custom_profile_image),
        updated_at = ?
      WHERE id = ?
    `).run(
      fullName,
      resolvedDisplayName ? String(resolvedDisplayName).trim() : null,
      resolvedTitle ? String(resolvedTitle).trim() : null,
      resolvedPhone ? String(resolvedPhone).trim() : null,
      resolvedAvatar || null,
      resolvedAvatar || null,
      now,
      req.user.id
    );

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: sanitizeUser(updatedUser)
    });
  } catch (err) {
    console.error('[UPDATE PROFILE ERROR]', err);
    return res.status(500).json({ error: 'Failed to save profile changes.' });
  }
});

// =========================================================================
// 11. GET CURRENT AUTHENTICATED USER (/api/auth/me)
// =========================================================================
router.get('/me', requireAuth, (req, res) => {
  return res.json({
    success: true,
    user: req.user
  });
});

// =========================================================================
// 12. LOGOUT
// =========================================================================
router.post('/logout', (req, res) => {
  const token = req.cookies?.audioking_session || 
                req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  if (token) {
    const tokenHash = hashToken(token);
    try {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    } catch (e) {}
  }

  res.clearCookie('audioking_session', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });

  return res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
