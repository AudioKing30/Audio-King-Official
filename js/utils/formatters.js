/**
 * AudioKing Formatting Utility Functions
 * Handles currency formatting (INR), order ID generation, and date formatting.
 */
import { AUDIOKING_CONFIG } from '../config.js';

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
 * Checks whether a product has an active offer, blanket discount, or markdown price
 * @param {Object} product
 * @returns {boolean}
 */
export function hasProductOffer(product) {
  if (!product) return false;

  const price = Number(product.price) || 0;
  const originalPrice = Number(product.originalPrice) || 0;
  const hasDiscount = originalPrice > price && price > 0;
  const discountPercent = hasDiscount
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : (Number(product.discountPercent) || Number(product.offerDiscount) || 0);

  return Boolean(
    product.hasOffer ||
    product.activeOfferTitle ||
    hasDiscount ||
    discountPercent > 0 ||
    (product.badge && /(offer|sale|deal|discount|%\s*off)/i.test(product.badge) && !/pre-order/i.test(product.badge))
  );
}

/**
 * Gets the offer discount percent for a product
 * @param {Object} product
 * @returns {number}
 */
export function getProductOfferPercent(product) {
  if (!product) return 10;
  const price = Number(product.price) || 0;
  const originalPrice = Number(product.originalPrice) || 0;
  if (originalPrice > price && price > 0) {
    return Math.round(((originalPrice - price) / originalPrice) * 100);
  }
  if (Number(product.discountPercent) > 0) return Number(product.discountPercent);
  if (Number(product.offerDiscount) > 0) return Number(product.offerDiscount);
  if (product.badge) {
    const m = product.badge.match(/(\d+)%\s*off/i);
    if (m) return parseInt(m[1], 10);
  }
  return 10;
}

/**
 * Renders the high-visibility red rosette offer stamp HTML matching the reference image
 * @param {Object} product
 * @param {string} extraClass
 * @returns {string}
 */
export function getProductOfferStampHtml(product, extraClass = '') {
  if (!hasProductOffer(product)) return '';

  const pct = getProductOfferPercent(product);
  const offerTitle = product.activeOfferTitle
    ? `${product.activeOfferTitle} (${pct}% OFF)`
    : `${pct}% OFF Special Offer`;

  const availableStamps = [5, 8, 10, 11, 12, 14, 15, 16, 18, 20, 22, 25, 30, 35, 40, 48, 50];
  let stampSrc = 'assets/images/offer-stamp-ref.png';
  if (availableStamps.includes(pct)) {
    stampSrc = `assets/images/offer-stamp-${pct}.png`;
  }

  return `
    <div class="ak-offer-stamp-badge ${extraClass}" title="${offerTitle}" aria-label="${offerTitle}">
      <img class="ak-offer-stamp-img" src="${stampSrc}" alt="${offerTitle}" loading="lazy" onerror="this.onerror=null;this.src='assets/images/offer-stamp-ref.png';">
    </div>
  `;
}

/**
 * Safely normalizes product image URLs for GitHub Pages, local dev, and express servers
 * @param {string} src
 * @returns {string}
 */
export function resolveProductImage(src) {
  if (!src) return 'assets/images/placeholder.jpg';
  if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return src;
  if (src.startsWith('/uploads/')) return src.slice(1);
  if (src.startsWith('/assets/')) return src.slice(1);
  return src;
}


