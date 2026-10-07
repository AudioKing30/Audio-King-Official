/**
 * AudioKing Formatting Utility Functions
 * Handles currency formatting (INR), order ID generation, and date formatting.
 */
import { AUDIOKING_CONFIG } from '../config.js';
import { getApiBaseUrl } from '../services/apiConfig.js';

export function formatINR(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${AUDIOKING_CONFIG.currencySymbol}0`;
  }
  const rounded = Math.round(Number(amount));
  return `${AUDIOKING_CONFIG.currencySymbol}${rounded.toLocaleString('en-IN')}`;
}

export function generateOrderId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `AK-${dateStr}-${rand}`;
}

export function formatDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * Shared discount percentage calculation helper used across storefront, admin, listings, and cart.
 * Formula: Math.round(((mrp - sellingPrice) / mrp) * 100)
 * Returns 0 if mrp <= sellingPrice, if non-positive, or if missing.
 *
 * @param {number|string} mrp
 * @param {number|string} sellingPrice
 * @returns {number}
 */
export function calculateDiscountPercent(mrp, sellingPrice) {
  const m = Number(mrp);
  const s = Number(sellingPrice);
  if (!Number.isFinite(m) || !Number.isFinite(s) || m <= 0 || s <= 0 || s >= m) {
    return 0;
  }
  return Math.round(((m - s) / m) * 100);
}

if (typeof window !== 'undefined') {
  window.calculateDiscountPercent = calculateDiscountPercent;
  window.getProductOfferPercent = getProductOfferPercent;
  window.getProductOfferStampSvg = getProductOfferStampSvg;
  window.getProductOfferStampHtml = getProductOfferStampHtml;
}

/**
 * Checks whether a product has an active offer, discount, or markdown price
 * @param {Object} product
 * @returns {boolean}
 */
export function hasProductOffer(product) {
  if (!product) return false;

  // Pre-orders never display discount rosette stamp badges
  if (product.isPreOrder || product.stockStatus === 'preorder' || (product.badge && /pre-order/i.test(product.badge))) {
    return false;
  }

  const pct = getProductOfferPercent(product);
  return pct > 0;
}

/**
 * Gets the offer discount percent for a product as a strictly rounded whole number with no decimals.
 * @param {Object} product
 * @returns {number}
 */
export function getProductOfferPercent(product) {
  if (!product) return 0;

  // 1. Calculate directly from originalPrice/mrp and price/sellingPrice
  const originalPrice = Number(product.originalPrice ?? product.mrp ?? 0);
  const price = Number(product.price ?? product.sellingPrice ?? product.sp ?? 0);
  const calcDiscount = calculateDiscountPercent(originalPrice, price);
  if (calcDiscount > 0) return calcDiscount;

  // 2. Explicit discount percent or offer discount properties
  const explicit = Number(product.discountPercent ?? product.discount_percent ?? product.offerDiscount ?? product.offer_discount);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }

  // 3. Extract whole number discount percentage from badge text (e.g. "38% OFF")
  if (product.badge) {
    const m = String(product.badge).match(/(\d+(?:\.\d+)?)\s*%\s*off/i);
    if (m) {
      return Math.round(parseFloat(m[1]));
    }
  }

  return 0;
}

/**
 * Generates an ultra-crisp vector SVG rosette offer stamp badge matching the brand reference image.
 * Dynamically renders the exact rounded whole-number discount percentage (e.g. 38% OFF).
 * No decimals are shown. Precision geometry matches brand guidelines.
 *
 * @param {number|string} pct
 * @returns {string}
 */
export function getProductOfferStampSvg(pct) {
  const cleanPct = Math.round(Number(pct)) || 0;
  if (cleanPct <= 0) return '';
  const fontSize = cleanPct >= 100 ? 38 : (cleanPct >= 10 ? 46 : 50);
  const letterSpacing = cleanPct >= 10 ? '-1px' : '0px';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%" class="ak-offer-stamp-img" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="akStampGrad_${cleanPct}" cx="45%" cy="40%" r="65%">
        <stop offset="0%" stop-color="#E81822"/>
        <stop offset="80%" stop-color="#D10C14"/>
        <stop offset="100%" stop-color="#B5070E"/>
      </radialGradient>
    </defs>
    <path d="M 100.00 2.00 C 107.95 5.27, 115.10 16.07, 121.22 20.79 C 128.89 19.76, 140.47 13.99, 149.00 15.13 C 154.25 21.94, 155.04 34.86, 157.98 42.02 C 165.14 44.96, 178.06 45.75, 184.87 51.00 C 186.01 59.53, 180.24 71.11, 179.21 78.78 C 183.93 84.90, 194.73 92.05, 198.00 100.00 C 194.73 107.95, 183.93 115.10, 179.21 121.22 C 180.24 128.89, 186.01 140.47, 184.87 149.00 C 178.06 154.25, 165.14 155.04, 157.98 157.98 C 155.04 165.14, 154.25 178.06, 149.00 184.87 C 140.47 186.01, 128.89 180.24, 121.22 179.21 C 115.10 183.93, 107.95 194.73, 100.00 198.00 C 92.05 194.73, 84.90 183.93, 78.78 179.21 C 71.11 180.24, 59.53 186.01, 51.00 184.87 C 45.75 178.06, 44.96 165.14, 42.02 157.98 C 34.86 155.04, 21.94 154.25, 15.13 149.00 C 13.99 140.47, 19.76 128.89, 20.79 121.22 C 16.07 115.10, 5.27 107.95, 2.00 100.00 C 5.27 92.05, 16.07 84.90, 20.79 78.78 C 19.76 71.11, 13.99 59.53, 15.13 51.00 C 21.94 45.75, 34.86 44.96, 42.02 42.02 C 44.96 34.86, 45.75 21.94, 51.00 15.13 C 59.53 13.99, 71.11 19.76, 78.78 20.79 C 84.90 16.07, 92.05 5.27, 100.00 2.00 Z" fill="url(#akStampGrad_${cleanPct})"/>
    <circle cx="100" cy="100" r="74" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.95"/>
    <line x1="60" y1="48" x2="82" y2="48" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"/>
    <polygon points="100.00,39.50 102.23,44.93 108.08,45.37 103.61,49.17 105.00,54.88 100.00,51.80 95.00,54.88 96.39,49.17 91.92,45.37 97.77,44.93" fill="#FFFFFF"/>
    <line x1="118" y1="48" x2="140" y2="48" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"/>
    <text x="100" y="105" text-anchor="middle" fill="#FFFFFF" font-family="'Arial Black', 'Montserrat', Impact, -apple-system, sans-serif" font-weight="900" font-size="${fontSize}" letter-spacing="${letterSpacing}">${cleanPct}%</text>
    <line x1="58" y1="124" x2="72" y2="124" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/>
    <text x="100" y="131" text-anchor="middle" fill="#FFFFFF" font-family="'Arial Black', 'Montserrat', Impact, -apple-system, sans-serif" font-weight="900" font-size="22" letter-spacing="1.5px">OFF</text>
    <line x1="128" y1="124" x2="142" y2="124" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/>
    <polygon points="100.00,141.50 102.23,146.93 108.08,147.37 103.61,151.17 105.00,156.88 100.00,153.80 95.00,156.88 96.39,151.17 91.92,147.37 97.77,146.93" fill="#FFFFFF"/>
  </svg>`;
}

/**
 * Renders the high-visibility red rosette offer stamp HTML matching the reference image.
 * Uses crisp vector SVG rendering to ensure any exact percentage (e.g. 38% OFF) displays with perfect precision.
 * @param {Object} product
 * @param {string} extraClass
 * @returns {string}
 */
export function getProductOfferStampHtml(product, extraClass = '') {
  if (!hasProductOffer(product)) return '';

  const pct = getProductOfferPercent(product);
  if (!pct || pct <= 0) return '';

  const offerTitle = product.activeOfferTitle
    ? `${product.activeOfferTitle} (${pct}% OFF)`
    : `${pct}% OFF Special Offer`;

  const svg = getProductOfferStampSvg(pct);
  if (!svg) return '';

  return `
    <div class="ak-offer-stamp-badge ${extraClass}" title="${offerTitle}" aria-label="${offerTitle}">
      ${svg}
    </div>
  `;
}

/**
 * Safely normalizes product image URLs for GitHub Pages, local dev, and express servers
 * @param {string} src
 * @returns {string}
 */
export function resolveProductImage(src) {
  if (!src || src === 'assets/images/logo.jpg' || src === 'assets/images/placeholder.jpg') {
    return 'assets/images/placeholder.svg';
  }
  if (/^https?:\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;

  let clean = String(src).trim().replace(/^(\.\.\/|\.\/)+/, '').replace(/^\/+/, '');
  const base = getApiBaseUrl();

  if (clean.startsWith('uploads/')) {
    return base ? `${base}/${clean}` : `/${clean}`;
  }
  if (clean.startsWith('products/')) {
    return base ? `${base}/uploads/${clean}` : `/uploads/${clean}`;
  }
  if (clean.startsWith('assets/')) {
    return clean;
  }
  return clean;
}



