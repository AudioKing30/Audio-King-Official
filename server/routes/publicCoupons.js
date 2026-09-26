/**
 * AudioKing Public Coupons API
 * Handles cart-level coupon validation and real-time discount computation.
 */

const express = require('express');
const { db } = require('../db');

const router = express.Router();

/**
 * POST /api/coupons/validate
 * Validates a coupon code against minimum cart value, expiry, usage limit, and active status.
 */
router.post('/validate', (req, res) => {
  try {
    const { code, cartTotal } = req.body || {};

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ valid: false, message: 'Please enter a coupon code.' });
    }

    const numericTotal = Number(cartTotal);
    if (isNaN(numericTotal) || numericTotal <= 0) {
      return res.status(400).json({ valid: false, message: 'Invalid cart total.' });
    }

    const cleanCode = code.trim().toUpperCase();
    const coupon = db.prepare(`
      SELECT id, code, discount_type, discount_value, min_cart_value, usage_limit, used_count, expires_at, is_active
      FROM coupons
      WHERE code = ? COLLATE NOCASE
    `).get(cleanCode);

    if (!coupon || !coupon.is_active) {
      return res.status(400).json({ valid: false, message: `Coupon code "${cleanCode}" is invalid or inactive.` });
    }

    // Expiry check
    if (coupon.expires_at) {
      const today = new Date().toISOString().split('T')[0];
      if (coupon.expires_at < today) {
        return res.status(400).json({ valid: false, message: `Coupon "${cleanCode}" expired on ${coupon.expires_at}.` });
      }
    }

    // Usage limit check
    if (coupon.usage_limit !== null && coupon.usage_limit !== undefined && coupon.usage_limit > 0) {
      if (coupon.used_count >= coupon.usage_limit) {
        return res.status(400).json({ valid: false, message: `Coupon "${cleanCode}" has reached its maximum usage limit.` });
      }
    }

    // Minimum cart value threshold check
    if (coupon.min_cart_value && numericTotal < coupon.min_cart_value) {
      const diff = coupon.min_cart_value - numericTotal;
      return res.status(400).json({
        valid: false,
        message: `Coupon "${cleanCode}" requires a minimum cart value of ₹${coupon.min_cart_value.toLocaleString('en-IN')}. Add ₹${diff.toLocaleString('en-IN')} more to qualify!`
      });
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = Math.round((numericTotal * Number(coupon.discount_value)) / 100);
    } else {
      discountAmount = Math.min(Number(coupon.discount_value), numericTotal);
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
