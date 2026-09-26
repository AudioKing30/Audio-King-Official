/**
 * AudioKing Centralized API Configuration
 * Resolves the active backend API URL based on runtime environment:
 * - Production GitHub Pages -> points to live Render backend
 * - Local dev (file://, Live Server) -> points to http://localhost:3000
 * - Self-hosted Express -> uses same-origin relative URLs
 */

export function getApiBaseUrl() {
  if (typeof window !== 'undefined') {
    // 1. Explicit window override
    if (window.AUDIOKING_API_URL) {
      return String(window.AUDIOKING_API_URL).trim().replace(/\/+$/, '');
    }

    // 2. LocalStorage override (useful for runtime testing)
    try {
      const saved = localStorage.getItem('audioking_api_url');
      if (saved) return String(saved).trim().replace(/\/+$/, '');
    } catch (e) {}

    // 3. GitHub Pages deployment: target the live Render web service
    if (window.location.hostname.includes('github.io')) {
      return 'https://audioking-api.onrender.com';
    }

    // 4. Local filesystem or live server development
    if (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3000')) {
      return 'http://localhost:3000';
    }
  }

  // 5. Default same-origin (served by Express server)
  return '';
}

/**
 * Prefix an endpoint with the active API base URL
 * @param {string} endpoint - e.g. '/api/products' or 'api/auth/me'
 * @returns {string} full URL or relative path
 */
export function apiUrl(endpoint = '') {
  if (!endpoint) return getApiBaseUrl();
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const base = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${cleanEndpoint}`;
}

// Expose globally for non-bundled scripts (admin/js/admin.js, admin/login.html, etc.)
if (typeof window !== 'undefined') {
  window.getAudioKingApiUrl = apiUrl;
  window.getAudioKingApiBase = getApiBaseUrl;
}
