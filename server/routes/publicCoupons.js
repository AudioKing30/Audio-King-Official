/**
 * AudioKing Public Coupons API
 * Handles cart-level coupon validation, real-time discount computation,
 * rate limiting, and public visible coupon listing for checkout.
 * Supports Target Brand & Category line-item scoping, per-user limits, and DB validation.
 */

const express = require('express');
const { db } = require('../db');
const { checkRateLimit, hashToken } = require('../security');

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
 * Public endpoint to list VISIBLE, active, non-expired coupons with cart eligibility.
 * Hidden coupons are STRICTLY EXCLUDED and NEVER returned in this response.
 */
function handleListVisibleCoupons(req, res) {
  try {
    const { cartTotal, items } = req.body || {};
    const numericTotal = Math.max(0, Number(cartTotal) || 0);
    const itemsList = Array.isArray(items) ? items : [];
    const userId = getUserIdFromRequest(req);
    const today = new Date().toISOString().split('T')[0];

    // Enforce DB lookup for variant selling prices and brand/category scoping
    let computedSubtotal = 0;
    const enrichedItems = itemsList.map(item => {
      const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
      const rawId = String(item.productId || item.id || '');
      const baseProdId = rawId.includes('_') ? rawId.split('_')[0] : (item.productId || item.id);
      const variantId = item.variantId || (rawId.includes('_') ? rawId.split('_')[1] : null);

      let verifiedPrice = Math.max(0, parseFloat(item.price || item.unitPrice || 0));
      let brand = (item.brand || '').trim().toLowerCase();
      let category = (item.category || '').trim().toLowerCase();

      if (baseProdId) {
        try {
          const p = db.prepare('SELECT brand, category, price FROM products WHERE id = ?').get(baseProdId);
          if (p) {
            if (!brand) brand = (p.brand || '').trim().toLowerCase();
            if (!category) category = (p.category || '').trim().toLowerCase();
            if (!variantId && verifiedPrice <= 0) verifiedPrice = Number(p.price);
          }
          if (variantId) {
            const v = db.prepare('SELECT selling_price, price_override FROM product_variants WHERE id = ?').get(variantId);
            if (v) {
              const vPrice = v.selling_price != null ? Number(v.selling_price) : (v.price_override != null ? Number(v.price_override) : null);
              if (vPrice != null) verifiedPrice = vPrice;
            }
          }
        } catch (e) {}
      }

      computedSubtotal += (verifiedPrice * qty);
      return {
        price: verifiedPrice,
        quantity: qty,
        brand,
        category
      };
    });

    const effectiveCartTotal = numericTotal > 0 ? numericTotal : computedSubtotal;

    // Strict query: ONLY active, non-expired, non-exhausted VISIBLE coupons
    const visibleCoupons = db.prepare(`
      SELECT id, code, discount_type, discount_value, min_cart_value, usage_limit, used_count, 
             COALESCE(per_user_limit, 1) AS per_user_limit, expires_at,
             LOWER(COALESCE(target_brand, applicable_brand, 'all')) AS target_brand,
             LOWER(COALESCE(target_category, applicable_category, 'all')) AS target_category
      FROM coupons
      WHERE is_active = 1
        AND (visibility IS NULL OR LOWER(visibility) = 'visible')
        AND (expires_at IS NULL OR expires_at >= ?)
        AND (usage_limit IS NULL OR usage_limit = 0 OR used_count < usage_limit)
      ORDER BY created_at DESC
    `).all(today);

    const evaluatedCoupons = visibleCoupons.map(coupon => {
      const hasBrandScope = coupon.target_brand && coupon.target_brand !== 'all';
      const hasCatScope = coupon.target_category && coupon.target_category !== 'all';

      // Check per-user limit
      let userExhausted = false;
      if (userId && coupon.per_user_limit > 0) {
        try {
          const userUsage = db.prepare('SELECT COUNT(*) AS count FROM coupon_usages WHERE user_id = ? AND coupon_id = ?').get(userId, coupon.id);
          if (userUsage && userUsage.count >= coupon.per_user_limit) {
            userExhausted = true;
          }
        } catch (e) {}
      }

      // Check applicable base for scoped discounts
      let applicableBase = effectiveCartTotal;
      let brandOrCatMatched = true;

      if (hasBrandScope || hasCatScope) {
        if (enrichedItems.length === 0) {
          applicableBase = 0;
          brandOrCatMatched = false;
        } else {
          applicableBase = enrichedItems.reduce((sum, it) => {
            const bMatch = !hasBrandScope || it.brand === coupon.target_brand.trim();
            const cMatch = !hasCatScope || it.category === coupon.target_category.trim();
            if (bMatch && cMatch) {
              return sum + (it.price * it.quantity);
            }
            return sum;
          }, 0);
          brandOrCatMatched = applicableBase > 0;
        }
      }

      let eligible = true;
      let reason = '';

      if (userExhausted) {
        eligible = false;
        reason = `Per-user usage limit (${coupon.per_user_limit}) reached`;
      } else if (hasBrandScope || hasCatScope) {
        if (!brandOrCatMatched || applicableBase <= 0) {
          eligible = false;
          reason = 'Not valid for items in your cart';
        } else if (coupon.min_cart_value > 0 && effectiveCartTotal < coupon.min_cart_value) {
          const diff = coupon.min_cart_value - effectiveCartTotal;
          eligible = false;
          reason = `Add ₹${diff.toLocaleString('en-IN')} more to use this`;
        }
      } else if (coupon.min_cart_value > 0 && effectiveCartTotal < coupon.min_cart_value) {
        const diff = coupon.min_cart_value - effectiveCartTotal;
        eligible = false;
        reason = `Add ₹${diff.toLocaleString('en-IN')} more to use this`;
      } else if (effectiveCartTotal <= 0) {
        eligible = false;
        reason = 'Add items to cart to apply';
      }

      let potentialDiscount = 0;
      if (eligible) {
        if (coupon.discount_type === 'percentage') {
          potentialDiscount = Math.round((applicableBase * Number(coupon.discount_value)) / 100);
        } else {
          potentialDiscount = Math.min(Number(coupon.discount_value), applicableBase);
        }
      }

      // Human readable terms
      const termsParts = [];
      if (coupon.min_cart_value > 0) {
        termsParts.push(`Min order ₹${Number(coupon.min_cart_value).toLocaleString('en-IN')}`);
      }
      if (hasBrandScope) {
        termsParts.push(`Scope: Brand "${coupon.target_brand.toUpperCase()}"`);
      }
      if (hasCatScope) {
        termsParts.push(`Scope: Category "${coupon.target_category}"`);
      }
      if (coupon.expires_at) {
        termsParts.push(`Expires ${coupon.expires_at}`);
      }
      const shortTerms = termsParts.join(' · ') || 'No minimum order required';

      return {
        code: coupon.code,
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value,
        minCartValue: coupon.min_cart_value,
        expiresAt: coupon.expires_at,
        targetBrand: coupon.target_brand,
        targetCategory: coupon.target_category,
        shortTerms,
        eligible,
        reason,
        potentialDiscount
      };
    });

    // Sort order: ELIGIBLE coupons first (higher discount first), INELIGIBLE after
    evaluatedCoupons.sort((a, b) => {
      if (a.eligible && !b.eligible) return -1;
      if (!a.eligible && b.eligible) return 1;
      if (a.eligible && b.eligible) return b.potentialDiscount - a.potentialDiscount;
      return a.minCartValue - b.minCartValue;
    });

    return res.json({
      success: true,
      coupons: evaluatedCoupons
    });
  } catch (err) {
    console.error('[VISIBLE COUPONS ERROR]', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch available coupons.' });
  }
}

// Register public visible coupons endpoints
router.post('/available', handleListVisibleCoupons);
router.get('/available', handleListVisibleCoupons);
router.post('/visible', handleListVisibleCoupons);
router.get('/visible', handleListVisibleCoupons);

/**
 * POST /api/coupons/validate
 * Validates a coupon code against minimum cart value, expiry, usage limit, per-user limit,
 * active status, and Target Brand / Category scoping.
 * Enforces rate limiting (10 attempts/min per IP/session) to stop brute-forcing hidden codes.
 * Returns a standardized generic error message ("Invalid or expired coupon.") for non-existent,
 * inactive, or expired codes so attackers cannot probe private codes.
 */
router.post('/validate', (req, res) => {
  try {
    // 1. Rate Limiting Check (10 attempts / minute)
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown_ip';
    const sessionToken = req.cookies?.audioking_session || req.cookies?.audioKingToken || '';
    const rateLimitKey = `coupon_validate_${clientIp}_${sessionToken}`;
    const rl = checkRateLimit(rateLimitKey, 10, 60000);

    if (!rl.allowed) {
      return res.status(429).json({
        valid: false,
        message: 'Too many attempts, try again shortly.',
        error: 'Too many attempts, try again shortly.'
      });
    }

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
             COALESCE(per_user_limit, 1) AS per_user_limit, expires_at, is_active, visibility,
             LOWER(COALESCE(target_brand, applicable_brand, 'all')) AS target_brand,
             LOWER(COALESCE(target_category, applicable_category, 'all')) AS target_category
      FROM coupons
      WHERE code = ? COLLATE NOCASE
    `).get(cleanCode);

    // Standardized generic message to protect hidden codes
    const genericInvalidMsg = 'Invalid or expired coupon.';

    if (!coupon || !coupon.is_active) {
      return res.status(400).json({ valid: false, message: genericInvalidMsg, error: genericInvalidMsg });
    }

    // Expiry check
    if (coupon.expires_at) {
      const today = new Date().toISOString().split('T')[0];
      if (coupon.expires_at < today) {
        return res.status(400).json({ valid: false, message: genericInvalidMsg, error: genericInvalidMsg });
      }
    }

    // Global usage limit check
    if (coupon.usage_limit !== null && coupon.usage_limit !== undefined && coupon.usage_limit > 0) {
      if (coupon.used_count >= coupon.usage_limit) {
        return res.status(400).json({ valid: false, message: genericInvalidMsg, error: genericInvalidMsg });
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

    // Target Brand and Target Category Scope Validation (server-verified variant prices)
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
        const rawId = item.productId || item.id || item.product?.id;
        const pId = (rawId && String(rawId).includes('_')) ? String(rawId).split('_')[0] : rawId;
        const variantId = item.variantId || ((rawId && String(rawId).includes('_')) ? String(rawId).split('_')[1] : null);

        let verifiedPrice = Number(item.price || item.product?.price || 0);

        if (pId) {
          try {
            const dbProd = db.prepare('SELECT brand, category, price FROM products WHERE id = ?').get(pId);
            if (dbProd) {
              b = b || dbProd.brand || '';
              c = c || dbProd.category || '';
              if (!variantId && verifiedPrice <= 0) verifiedPrice = Number(dbProd.price);
            }
            if (variantId) {
              const v = db.prepare('SELECT selling_price, price_override FROM product_variants WHERE id = ?').get(variantId);
              if (v) {
                const vPrice = v.selling_price != null ? Number(v.selling_price) : (v.price_override != null ? Number(v.price_override) : null);
                if (vPrice != null) verifiedPrice = vPrice;
              }
            }
          } catch (e) {}
        }
        const itemBrand = b.toLowerCase();
        const itemCat = c.toLowerCase();
        const brandMatches = !hasBrandScope || itemBrand === coupon.target_brand.trim();
        const catMatches = !hasCatScope || itemCat === coupon.target_category.trim();

        if (brandMatches && catMatches) {
          const qty = Number(item.quantity || item.qty || 1);
          return sum + (verifiedPrice * qty);
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
