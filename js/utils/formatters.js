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
 * (Stamps and percentage badges removed per design finalization)
 * @param {Object} product
 * @returns {boolean}
 */
export function hasProductOffer(product) {
  return false;
}

/**
 * Gets the offer discount percent for a product.
 * Returns 0 to suppress all on-product discount badges/stamps.
 * @param {Object} product
 * @returns {number}
 */
export function getProductOfferPercent(product) {
  return 0;
}

/**
 * Suppressed offer stamp SVG generator.
 * @param {number|string} pct
 * @returns {string}
 */
export function getProductOfferStampSvg(pct) {
  return '';
}

/**
 * Suppressed offer stamp HTML generator.
 * @param {Object} product
 * @param {string} extraClass
 * @returns {string}
 */
export function getProductOfferStampHtml(product, extraClass = '') {
  return '';
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



