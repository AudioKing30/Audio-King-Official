/**
 * AudioKing Production Authentication & User Service
 * Manages all communication with /api/auth and /api/user/addresses.
 * Backed by real SQLite DB, Bcrypt hashing, OTP verification, and Session Tokens.
 * Safeguards credentials and ensures complete isolation between customers and admins.
 */

import { AUDIOKING_CONFIG } from '../config.js';
import { getStorage, setStorage, removeStorage } from '../utils/storage.js';
import { getApiBaseUrl, apiUrl } from './apiConfig.js';

class AuthService {
  constructor() {
    this.localUserKey = AUDIOKING_CONFIG.userStorageKey || 'audioking_user';
    this.listeners = new Set();
    this.isLoggingIn = false;

    this.currentUser = null;
    this.status = this.getToken() ? 'loading' : 'unauthenticated';

    this._lastPrewarm = 0;
    this._effectiveBaseUrl = null;

    // Proactively pre-warm backend server in background on startup
    if (typeof window !== 'undefined') {
      setTimeout(() => this.prewarmServer(), 200);
      setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden) {
          this.prewarmServer();
        }
      }, 9 * 60 * 1000); // 9 min keep-alive (Render sleeps after 15m)
    }
  }

  /**
   * Proactively ping backend health endpoint to ensure container is awake.
   * Runs non-blockingly in the background.
   */
  prewarmServer() {
    const now = Date.now();
    if (this._lastPrewarm && (now - this._lastPrewarm < 25000)) {
      return;
    }
    this._lastPrewarm = now;

    const base = this._effectiveBaseUrl || this.getBaseUrl();
    const urls = [];
    if (base) urls.push(`${base}/api/health`);
    else urls.push('/api/health');

    if (typeof window !== 'undefined' && window.location.hostname.includes('github.io') && !base.includes('onrender.com')) {
      urls.push('https://audioking-api.onrender.com/api/health');
    }

    urls.forEach(u => {
      try {
        fetch(u, { method: 'GET', keepalive: true, cache: 'no-store' })
          .then(res => {
            if (res.ok) console.log('[AUTH] Server is warm and ready:', u);
          })
          .catch(() => {});
      } catch (e) {}
    });
  }

  getToken() {
    let token = getStorage('audioKingSessionToken', null) || 
                getStorage('audioking_token', null) || 
                getStorage('audioKingToken', null);
    if (!token && typeof localStorage !== 'undefined') {
      token = localStorage.getItem('audioKingSessionToken') || 
              localStorage.getItem('audioking_token') || 
              localStorage.getItem('audioKingToken');
    }
    if (token && typeof token === 'string') {
      token = token.trim();
      if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        token = token.slice(1, -1);
      }
    }
    return token || null;
  }

  getUserAddressKey() {
    const u = this.getUser();
    return u && u.id ? `audioking_addresses_${u.id}` : 'audioking_guest_addresses';
  }

  /**
   * Determine API base URL dynamically based on environment
   */
  getBaseUrl() {
    return getApiBaseUrl();
  }

  /**
   * Subscribe to auth state changes
   */
  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.currentUser, this.status);
    return () => this.listeners.delete(callback);
  }

  notify() {
    this.listeners.forEach(fn => {
      try { fn(this.currentUser, this.status); } catch (e) {}
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ak:auth-changed', {
        detail: { user: this.currentUser, status: this.status }
      }));
    }
  }

  /**
   * Safe fetch wrapper with adaptive timeouts, automatic cold-start retry,
   * multi-host fallback, and network failure resilience.
   */
  async safeFetch(endpoint, options = {}) {
    const primaryBase = this._effectiveBaseUrl || this.getBaseUrl();
    const isPost = (options.method || 'GET').toUpperCase() === 'POST';
    const defaultTimeout = isPost ? 35000 : 15000;
    const timeoutMs = options.timeoutMs || defaultTimeout;
    const maxRetries = options.retries !== undefined ? options.retries : (isPost ? 2 : 1);

    let lastResult = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const activeBase = this._effectiveBaseUrl || primaryBase;
      const url = `${activeBase}${endpoint}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const token = this.getToken();
      const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

      try {
        const res = await fetch(url, {
          ...options,
          signal: controller.signal,
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            ...authHeaders,
            ...(options.headers || {})
          }
        });
        clearTimeout(timeoutId);

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const data = isJson ? await res.json().catch(() => ({})) : {};
        const isStaticFallback = res.status === 404 || (!isJson && res.status >= 400);

        lastResult = { 
          ok: res.ok && isJson, 
          status: res.status, 
          data, 
          networkError: false, 
          isStaticFallback 
        };

        // Standard client responses (200, 400, 401, 403, 404, 409, 422, 429) return immediately
        const isColdStart = res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504;
        if (!isColdStart) {
          return lastResult;
        }

        // 502/503/504 detected (Render container warming up)
        if (attempt < maxRetries) {
          console.warn(`[AUTH] Gateway warming up (HTTP ${res.status}) on ${endpoint} (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in 2.2s...`);
          if (typeof options.onRetry === 'function') {
            options.onRetry(attempt + 1, maxRetries + 1);
          }
          await new Promise(r => setTimeout(r, 2200));
          continue;
        }

        return lastResult;
      } catch (err) {
        clearTimeout(timeoutId);
        lastResult = { ok: false, status: 0, data: null, networkError: true, isStaticFallback: true, error: err.message };

        // If network error / timeout and retries remaining, wait and retry
        if (attempt < maxRetries) {
          console.warn(`[AUTH] Connection waiting on ${endpoint} (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in 2.2s...`);
          if (typeof options.onRetry === 'function') {
            options.onRetry(attempt + 1, maxRetries + 1);
          }
          await new Promise(r => setTimeout(r, 2200));
          continue;
        }

        // Secondary fallback: if primaryBase was http://localhost:3000 and it completely failed with network error
        if (primaryBase === 'http://localhost:3000' && !endpoint.includes('health')) {
          try {
            console.warn('[AUTH] Local server unreachable. Attempting live cloud API fallback (audioking-api.onrender.com)...');
            const fallbackUrl = `https://audioking-api.onrender.com${endpoint}`;
            const fbController = new AbortController();
            const fbTimeout = setTimeout(() => fbController.abort(), 30000);
            const fbRes = await fetch(fallbackUrl, {
              ...options,
              signal: fbController.signal,
              credentials: 'include',
              headers: {
                'Accept': 'application/json',
                ...authHeaders,
                ...(options.headers || {})
              }
            });
            clearTimeout(fbTimeout);
            const fbContentType = fbRes.headers.get('content-type') || '';
            const fbIsJson = fbContentType.includes('application/json');
            const fbData = fbIsJson ? await fbRes.json().catch(() => ({})) : {};
            if (fbRes.ok) {
              this._effectiveBaseUrl = 'https://audioking-api.onrender.com';
            }
            return {
              ok: fbRes.ok && fbIsJson,
              status: fbRes.status,
              data: fbData,
              networkError: false,
              isStaticFallback: false
            };
          } catch (fbErr) {
            // Secondary also failed, return lastResult
          }
        }

        return lastResult;
      }
    }

    return lastResult;
  }

  /**
   * Initialize and restore session from backend or persistent store on load.
   */
  async init() {
    // 0. Extract token from URL hash or query if redirected from Google OAuth or external bridge
    if (typeof window !== 'undefined') {
      try {
        let redirectToken = null;
        if (window.location.hash && window.location.hash.includes('auth_token=')) {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          redirectToken = hashParams.get('auth_token');
        } else if (window.location.search && window.location.search.includes('token=')) {
          const urlParams = new URLSearchParams(window.location.search);
          redirectToken = urlParams.get('token');
        }

        if (redirectToken) {
          setStorage('audioKingSessionToken', redirectToken);
          setStorage('audioking_token', redirectToken);
          setStorage('audioKingToken', redirectToken);
        }

        // Clean any sensitive auth params from address bar immediately so links shared by user are clean
        if (window.location.search.includes('auth=google_success') || window.location.search.includes('token=') || window.location.hash.includes('auth_token=')) {
          const cleanSearch = window.location.search
            .replace(/[?&]auth=google_success/g, '')
            .replace(/[?&]token=[^&]+/g, '')
            .replace(/^&/, '?');
          let cleanHash = window.location.hash.replace(/[#&]auth_token=[^&]+/g, '');
          if (!cleanHash || cleanHash === '#') cleanHash = '';
          const cleanUrl = window.location.pathname + (cleanSearch && cleanSearch !== '?' ? cleanSearch : '') + cleanHash;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      } catch (e) {}
    }

    const token = this.getToken();

    // If there is NO session token in this browser, user is unequivocally an unauthenticated guest!
    if (!token) {
      this.currentUser = null;
      this.status = 'unauthenticated';
      removeStorage(this.localUserKey);
      removeStorage('audioKingUser');
      this.notify();
      return null;
    }

    // If already authenticated via login during page initialization, preserve it and recheck in background
    if (this.status === 'authenticated' && this.currentUser) {
      this._recheckSession();
      return this.currentUser;
    }

    // 1. Verify session with the backend database
    let res = await this.safeFetch('/api/auth/me', { method: 'GET' });

    // 2. If network error on first try, wait 1.5s and retry once (handles Render cold-start)
    if (res.networkError) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      res = await this.safeFetch('/api/auth/me', { method: 'GET' });
    }

    // Guard against race condition: user logged in while /api/auth/me was in-flight
    if (this.isLoggingIn || (this.status === 'authenticated' && this.currentUser)) {
      return this.currentUser;
    }

    if (res.ok && res.data?.user) {
      // Server confirmed valid session
      this.currentUser = res.data.user;
      this.status = 'authenticated';
      setStorage(this.localUserKey, this.currentUser);
      setStorage('audioKingUser', this.currentUser);
    } else if (res.networkError || res.status === 502 || res.status === 503 || res.status === 504) {
      // Server unreachable or warming up — keep existing cached session for this token temporarily
      const local = getStorage(this.localUserKey, null) || getStorage('audioKingUser', null);
      if (local && local.email && local.id) {
        this.currentUser = local;
        this.status = 'authenticated';
        setTimeout(() => this._recheckSession(), 5000);
      } else {
        this.currentUser = null;
        this.status = 'unauthenticated';
      }
    } else {
      // Server explicitly rejected with 401 or user not found — purge session completely
      this.currentUser = null;
      this.status = 'unauthenticated';
      removeStorage(this.localUserKey);
      removeStorage('audioKingUser');
      removeStorage('audioKingSessionToken');
      removeStorage('audioking_token');
      removeStorage('audioKingToken');
    }

    this.notify();
    return this.currentUser;
  }

  /**
   * Background session re-check after network recovery.
   */
  async _recheckSession() {
    const token = this.getToken();
    if (!token) {
      this.currentUser = null;
      this.status = 'unauthenticated';
      removeStorage(this.localUserKey);
      removeStorage('audioKingUser');
      this.notify();
      return;
    }

    try {
      const res = await this.safeFetch('/api/auth/me', { method: 'GET' });
      if (res.ok && res.data?.user) {
        this.currentUser = res.data.user;
        this.status = 'authenticated';
        setStorage(this.localUserKey, this.currentUser);
        setStorage('audioKingUser', this.currentUser);
        this.notify();
      } else if (res.status === 401) {
        // Server confirmed session expired or logged out
        this.currentUser = null;
        this.status = 'unauthenticated';
        removeStorage(this.localUserKey);
        removeStorage('audioKingUser');
        removeStorage('audioKingSessionToken');
        removeStorage('audioking_token');
        removeStorage('audioKingToken');
        this.notify();
      }
    } catch (e) {}
  }

  getUser() {
    return this.currentUser;
  }

  getStatus() {
    return this.status;
  }

  isAuthenticated() {
    return this.status === 'authenticated' && !!this.currentUser;
  }

  /**
   * 1. Sign Up (Send verification OTP)
   */
  async signup(data) {
    this.prewarmServer();
    const res = await this.safeFetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      return res.data;
    }

    if (res.networkError || res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Unable to reach the registration server. Please check your connection and try again.');
    }

    throw new Error(res.data?.error || 'Registration failed. Please try again.');
  }

  /**
   * 2. Verify Signup OTP
   */
  async verifySignupOtp(email, otp) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = String(otp || '').trim();

    const res = await this.safeFetch('/api/auth/verify-signup-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, otp: cleanOtp })
    });

    if (res.ok && res.data?.user) {
      this.currentUser = res.data.user;
      this.status = 'authenticated';
      if (res.data.token) {
        setStorage('audioKingSessionToken', res.data.token);
        setStorage('audioking_token', res.data.token);
        setStorage('audioKingToken', res.data.token);
      }
      setStorage(this.localUserKey, this.currentUser);
      setStorage('audioKingUser', this.currentUser);
      this.notify();
      return res.data;
    }

    if (res.networkError || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Unable to reach server. Please wait a few seconds and try again.');
    }

    throw new Error(res.data?.error || 'Invalid or expired verification code.');
  }

  /**
   * 3. Resend Signup OTP
   */
  async resendSignupOtp(email) {
    const res = await this.safeFetch('/api/auth/resend-signup-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    if (res.ok) return res.data;
    if (res.networkError || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Unable to reach server. Please try again in a moment.');
    }
    throw new Error(res.data?.error || 'Failed to resend code.');
  }

  /**
   * 4. Login (Email + Password) - Resilient to Render cold-starts with automatic retries
   */
  async login(email, password, options = {}) {
    this.isLoggingIn = true;
    const cleanEmail = (email || '').trim().toLowerCase();

    // Trigger immediate background wake-up ping
    this.prewarmServer();

    try {
      const res = await this.safeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
        timeoutMs: 35000,
        retries: 3,
        onRetry: (attempt, total) => {
          if (typeof options.onStatus === 'function') {
            options.onStatus(`Connecting to secure authentication server (${attempt}/${total})...`);
          }
        }
      });

      if (res.ok && res.data?.user) {
        this.currentUser = res.data.user;
        this.status = 'authenticated';
        if (res.data.token) {
          setStorage('audioKingSessionToken', res.data.token);
          setStorage('audioking_token', res.data.token);
          setStorage('audioKingToken', res.data.token);
        }
        setStorage(this.localUserKey, this.currentUser);
        setStorage('audioKingUser', this.currentUser);
        this.notify();
        return res.data;
      }

      if (res.networkError || res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error('Unable to reach the authentication server. Please check your internet connection and try again.');
      }

      const err = new Error(res.data?.error || (res.status === 404 ? 'This user is not registered yet. Please register your account first.' : 'Invalid email or password.'));
      err.requiresVerification = res.data?.requiresVerification;
      err.notRegistered = Boolean(res.data?.notRegistered || res.status === 404);
      err.email = res.data?.email || cleanEmail;
      err.status = res.status;
      throw err;
    } finally {
      this.isLoggingIn = false;
    }
  }

  /**
   * 5A. Get Google Authorization URL
   */
  async getGoogleAuthUrl() {
    const res = await this.safeFetch('/api/auth/google/url', { method: 'GET' });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Google OAuth is not configured yet.');
    }
    return res.data;
  }

  /**
   * 5B. Real Google OAuth Authentication
   */
  async initiateGoogleAuth() {
    const baseUrl = this.getBaseUrl();
    const returnTo = (typeof window !== 'undefined' && window.location.href) ? window.location.href : '/';
    const redirectUrl = `${baseUrl}/api/auth/google/redirect?return_to=${encodeURIComponent(returnTo)}`;

    // 1. Try synchronous popup window immediately
    let popup = null;
    try {
      const width = 520;
      const height = 650;
      const left = (typeof window !== 'undefined' && window.screenX !== undefined)
        ? window.screenX + Math.max(0, (window.outerWidth - width) / 2)
        : 100;
      const top = (typeof window !== 'undefined' && window.screenY !== undefined)
        ? window.screenY + Math.max(0, (window.outerHeight - height) / 2)
        : 100;

      popup = window.open(
        redirectUrl,
        'AudioKingGoogleAuth',
        `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes,resizable=yes,scrollbars=yes`
      );
    } catch (e) {
      popup = null;
    }

    // 2. If popup was blocked or denied by browser, navigate current window
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.location.href = redirectUrl;
      return new Promise(() => {});
    }

    // 3. If popup opened, wait for completion message
    return new Promise((resolve, reject) => {
      let settled = false;

      const messageHandler = (event) => {
        if (event.data && event.data.type === 'AUDIOKING_GOOGLE_SUCCESS') {
          if (event.data.token) {
            setStorage('audioKingSessionToken', event.data.token);
            setStorage('audioking_token', event.data.token);
            setStorage('audioKingToken', event.data.token);
          }
          if (event.data.user) {
            this.currentUser = event.data.user;
            this.status = 'authenticated';
            setStorage(this.localUserKey, this.currentUser);
            setStorage('audioKingUser', this.currentUser);
          }
          this.notify();
          cleanup();
          resolve({ success: true, user: this.currentUser });
        } else if (event.data && event.data.type === 'AUDIOKING_GOOGLE_ERROR') {
          cleanup();
          reject(new Error(event.data.error || 'Google sign-in was cancelled.'));
        }
      };

      const pollTimer = setInterval(() => {
        if (!popup || popup.closed) {
          setTimeout(async () => {
            if (settled) return;
            const restored = await this.init();
            if (restored) {
              cleanup();
              resolve({ success: true, user: restored });
            } else {
              cleanup();
              reject(new Error('Google sign-in popup was closed.'));
            }
          }, 800);
        }
      }, 500);

      const cleanup = () => {
        settled = true;
        clearInterval(pollTimer);
        window.removeEventListener('message', messageHandler);
      };

      window.addEventListener('message', messageHandler);
    });
  }

  /**
   * 5C. Google Sign-In with ID Token (GIS One Tap / Button)
   */
  async googleLogin(credential) {
    if (!credential) {
      return this.initiateGoogleAuth();
    }

    const res = await this.safeFetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    });

    if (res.ok && res.data?.user) {
      this.currentUser = res.data.user;
      this.status = 'authenticated';
      if (res.data.token) {
        setStorage('audioKingSessionToken', res.data.token);
        setStorage('audioking_token', res.data.token);
        setStorage('audioKingToken', res.data.token);
      }
      setStorage(this.localUserKey, this.currentUser);
      setStorage('audioKingUser', this.currentUser);
      this.notify();
      return res.data;
    }

    throw new Error(res.data?.error || 'Google sign-in verification failed.');
  }

  /**
   * 6. Forgot Password
   */
  async forgotPassword(email) {
    const res = await this.safeFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    if (res.ok) return res.data;
    if (res.networkError || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Unable to reach reset server. Please wait a moment and try again.');
    }
    throw new Error(res.data?.error || 'Failed to dispatch reset code.');
  }

  /**
   * 7. Verify Reset OTP
   */
  async verifyResetOtp(email, otp) {
    const res = await this.safeFetch('/api/auth/verify-reset-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    if (res.ok) return res.data;
    if (res.networkError || res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error('Unable to reach server. Please try again.');
    }
    throw new Error(res.data?.error || 'Invalid or expired reset code.');
  }

  /**
   * 8. Reset Password
   */
  async resetPassword(email, resetToken, newPassword, confirmPassword) {
    const res = await this.safeFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, resetToken, newPassword, confirmPassword })
    });

    if (res.ok) {
      if (res.data?.user) {
        this.currentUser = res.data.user;
        this.status = 'authenticated';
        if (res.data.token) {
          setStorage('audioKingSessionToken', res.data.token);
          setStorage('audioking_token', res.data.token);
          setStorage('audioKingToken', res.data.token);
        }
        setStorage(this.localUserKey, this.currentUser);
        setStorage('audioKingUser', this.currentUser);
        this.notify();
      }
      return res.data;
    }

    throw new Error(res.data?.error || 'Failed to update password.');
  }

  /**
   * 9A. Request Change Password OTP (In-App Authenticated)
   */
  async requestChangePasswordOtp(currentPassword, newPassword, confirmPassword) {
    const res = await this.safeFetch('/api/auth/change-password-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });

    if (res.ok) return res.data;
    throw new Error(res.data?.error || 'Failed to dispatch verification code.');
  }

  /**
   * 9B. Confirm Change Password with OTP (In-App Authenticated)
   */
  async changePassword(currentPassword, newPassword, confirmPassword, otp) {
    const res = await this.safeFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword, otp })
    });

    if (res.ok) return res.data;
    throw new Error(res.data?.error || 'Failed to change password.');
  }

  /**
   * 10. Update Profile
   */
  async updateProfile(profileData) {
    const res = await this.safeFetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData)
    });

    if (res.ok && res.data?.user) {
      this.currentUser = res.data.user;
      setStorage(this.localUserKey, this.currentUser);
      setStorage('audioKingUser', this.currentUser);
      this.notify();
      return res.data;
    }

    throw new Error(res.data?.error || 'Failed to update profile.');
  }

  /**
   * 11. Logout - Purges all session tokens, user profiles, and cached keys
   */
  async logout() {
    const oldUser = this.currentUser;
    try {
      await this.safeFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}

    this.currentUser = null;
    this.status = 'unauthenticated';

    removeStorage(this.localUserKey);
    removeStorage('audioKingUser');
    removeStorage('audioking_user');
    removeStorage('audioKingSessionToken');
    removeStorage('audioking_token');
    removeStorage('audioKingToken');
    removeStorage('audioking_pending_signup');
    removeStorage('audiokingSavedAddress');
    removeStorage('audioking_user_addresses');
    removeStorage('audioking_admin_view');

    try {
      localStorage.removeItem('audioKingSessionToken');
      localStorage.removeItem('audioking_token');
      localStorage.removeItem('audioKingToken');
      localStorage.removeItem('audioKingUser');
      localStorage.removeItem('audioking_user');
      localStorage.removeItem('audioking_admin_view');
      // NOTE: audioking_registered_users is intentionally NOT cleared — it's global data
    } catch (e) {}

    if (oldUser && oldUser.id) {
      removeStorage(`audioking_addresses_${oldUser.id}`);
      removeStorage(`audioking_orders_${oldUser.id}`);
      removeStorage(`audioking_saved_address_${oldUser.id}`);
    }

    this.notify();
  }

  // =========================================================================
  // ADDRESSES CRUD (Strictly Scoped to Active User)
  // =========================================================================
  async getAddresses() {
    const key = this.getUserAddressKey();
    const res = await this.safeFetch('/api/user/addresses', { method: 'GET' });
    if (res.ok && Array.isArray(res.data?.addresses)) {
      setStorage(key, res.data.addresses);
      return res.data.addresses;
    }
    return getStorage(key, []);
  }

  async addAddress(addr) {
    const key = this.getUserAddressKey();
    const res = await this.safeFetch('/api/user/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addr)
    });

    if (res.ok && res.data?.address) {
      const list = await this.getAddresses();
      list.push(res.data.address);
      setStorage(key, list);
      return res.data.address;
    }

    throw new Error(res.data?.error || 'Failed to save address.');
  }

  async updateAddress(id, addr) {
    const key = this.getUserAddressKey();
    const res = await this.safeFetch(`/api/user/addresses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addr)
    });

    if (res.ok && res.data?.address) {
      let list = getStorage(key, []);
      list = list.map(a => a.id === id ? { ...a, ...res.data.address } : a);
      setStorage(key, list);
      return res.data.address;
    }

    throw new Error(res.data?.error || 'Failed to update address.');
  }

  async deleteAddress(id) {
    const key = this.getUserAddressKey();
    const res = await this.safeFetch(`/api/user/addresses/${id}`, { method: 'DELETE' });
    if (res.ok) {
      let list = getStorage(key, []);
      list = list.filter(a => a.id !== id);
      setStorage(key, list);
      return true;
    }
    throw new Error(res.data?.error || 'Failed to delete address.');
  }

  async setDefaultAddress(id) {
    const key = this.getUserAddressKey();
    const res = await this.safeFetch(`/api/user/addresses/${id}/default`, { method: 'POST' });
    if (res.ok) {
      let list = getStorage(key, []);
      list = list.map(a => ({ ...a, is_default: a.id === id }));
      setStorage(key, list);
      return true;
    }
    throw new Error(res.data?.error || 'Failed to set default address.');
  }
}

export const authService = new AuthService();
