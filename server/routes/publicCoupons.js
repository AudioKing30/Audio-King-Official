/**
 * AudioKing Public Coupons API
 * Handles cart-level coupon validation and real-time discount computation.
 * Supports Target Brand and Target Category line-item scoping, per-user limits, and DB validation.
 */

const express = require('express');
const { db } = require('../db');
const { hashToken } = require('../security');

const router = express.Router();

function getUserIdFromRequest(req) {
  let token = req.cookies?.audioking_session || 
              req.cookies?.audioking_admin_session || 
              req.cookies?.audioKingToken || 
              req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (token) {
    const cleanToken = String(token).trim().replace(/^["']|["']$/g, '');
    const tokenHash = hashToken(cleanToken);
    try {
      const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now());
      if (session) return session.user_id;
    } catch (e) {}
  }
  return null;
}

/**
 * POST /api/coupons/validate
 * Validates a coupon code against minimum cart value, expiry, usage limit, per-user limit,
 * active status, and Target Brand / Category scoping.
 */
router.post('/validate', (req, res) => {
  try {
    const { code, cartTotal, items } = req.body || {};

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ valid: false, message: 'Please enter a coupon code.' });
    }

    const numericTotal = Number(cartTotal);
    if (isNaN(numericTotal) || numericTotal <= 0) {
      return res.status(400).json({ valid: false, message: 'Invalid cart total.' });
    }

    const cleanCode = code.trim().toUpperCase();
    const coupon = db.prepare(`
      SELECT id, code, discount_type, discount_value, min_cart_value, usage_limit, used_count, 
             COALESCE(per_user_limit, 1) AS per_user_limit, expires_at, is_active,
             LOWER(COALESCE(target_brand, applicable_brand, 'all')) AS target_brand,
             LOWER(COALESCE(target_category, applicable_category, 'all')) AS target_category
      FROM coupons
      WHERE code = ? COLLATE NOCASE
    `).get(cleanCode);

    if (!coupon || !coupon.is_active) {
      const msg = `Coupon code "${cleanCode}" is invalid or inactive.`;
      return res.status(400).json({ valid: false, message: msg, error: msg });
    }

    // Expiry check
    if (coupon.expires_at) {
      const today = new Date().toISOString().split('T')[0];
      if (coupon.expires_at < today) {
        const msg = `Coupon "${cleanCode}" expired on ${coupon.expires_at}.`;
        return res.status(400).json({ valid: false, message: msg, error: msg });
      }
    }

    // Global usage limit check
    if (coupon.usage_limit !== null && coupon.usage_limit !== undefined && coupon.usage_limit > 0) {
      if (coupon.used_count >= coupon.usage_limit) {
        const msg = `Coupon "${cleanCode}" has reached its maximum usage limit.`;
        return res.status(400).json({ valid: false, message: msg, error: msg });
      }
    }

    // Per-user usage limit check
    const userId = getUserIdFromRequest(req);
    if (userId && coupon.per_user_limit > 0) {
      try {
        const userUsage = db.prepare('SELECT COUNT(*) AS count FROM coupon_usages WHERE user_id = ? AND coupon_id = ?').get(userId, coupon.id);
        if (userUsage && userUsage.count >= coupon.per_user_limit) {
          const msg = `You have already reached the maximum usage limit (${coupon.per_user_limit}) for coupon "${cleanCode}".`;
          return res.status(400).json({
            valid: false,
            message: msg,
            error: msg
          });
        }
      } catch (e) {}
    }

    // Target Brand and Target Category Scope Validation
    const hasBrandScope = coupon.target_brand && coupon.target_brand !== 'all';
    const hasCatScope = coupon.target_category && coupon.target_category !== 'all';
    let applicableBase = numericTotal;

    if (hasBrandScope || hasCatScope) {
      if (!items || !Array.isArray(items) || items.length === 0) {
        const msg = 'This coupon is not applicable to items in your cart.';
        return res.status(400).json({
          valid: false,
          message: msg,
          error: msg
        });
      }

      applicableBase = items.reduce((sum, item) => {
        let b = (item.brand || item.product?.brand || '').trim();
        let c = (item.category || item.product?.category || '').trim();
        const pId = item.id || item.productId || item.product?.id;
        if ((!b || !c) && pId) {
          try {
            const dbProd = db.prepare('SELECT brand, category FROM products WHERE id = ?').get(pId);
            if (dbProd) {
              b = b || dbProd.brand || '';
              c = c || dbProd.category || '';
            }
          } catch (e) {}
        }
        const itemBrand = b.toLowerCase();
        const itemCat = c.toLowerCase();
        const brandMatches = !hasBrandScope || itemBrand === coupon.target_brand.trim();
        const catMatches = !hasCatScope || itemCat === coupon.target_category.trim();

        if (brandMatches && catMatches) {
          const price = Number(item.price || item.product?.price || 0);
          const qty = Number(item.quantity || item.qty || 1);
          return sum + (price * qty);
        }
        return sum;
      }, 0);

      if (applicableBase <= 0) {
        const msg = 'This coupon is not applicable to items in your cart.';
        return res.status(400).json({
          valid: false,
          message: msg,
          error: msg
        });
      }
    }

    // Minimum cart value threshold check
    if (coupon.min_cart_value && numericTotal < coupon.min_cart_value) {
      const diff = coupon.min_cart_value - numericTotal;
      const msg = `Coupon "${cleanCode}" requires a minimum cart value of ₹${coupon.min_cart_value.toLocaleString('en-IN')}. Add ₹${diff.toLocaleString('en-IN')} more to qualify!`;
      return res.status(400).json({
        valid: false,
        message: msg,
        error: msg
      });
    }

    // Calculate discount amount (applied ONLY to qualifying line items)
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = Math.round((applicableBase * Number(coupon.discount_value)) / 100);
    } else {
      discountAmount = Math.min(Number(coupon.discount_value), applicableBase);
    }

    const newTotal = Math.max(0, numericTotal - discountAmount);

    return res.json({
      valid: true,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      discountAmount,
      minCartValue: coupon.min_cart_value,
      newTotal,
      message: `Coupon "${coupon.code}" applied! You saved ₹${discountAmount.toLocaleString('en-IN')}.`
    });
  } catch (err) {
    console.error('[VALIDATE COUPON ERROR]', err);
    return res.status(500).json({ valid: false, message: 'Server error while validating coupon.' });
  }
});

module.exports = router;
