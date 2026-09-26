/**
 * AudioKing Orders API Router
 * Manages order creation, retrieval, and order-item relationships.
 * Strictly scoped to authenticated user ID from backend session.
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Helper: Generate formatted Order ID if not provided
 */
function generateOrderNumber() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `AK-${dateStr}-${rand}`;
}

/**
 * 1. GET ALL ORDERS FOR CURRENT AUTHENTICATED CUSTOMER
 * GET /api/user/orders
 */
router.get('/', requireAuth, (req, res) => {
  try {
    const ordersQuery = db.prepare(`
      SELECT id, user_id, order_number, total_amount, status, shipping_address, payment_method, coupon_code, discount_amount, created_at, updated_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
    `);

    const orderRows = ordersQuery.all(req.user.id);

    const itemsQuery = db.prepare(`
      SELECT id, order_id, product_id, product_name, product_image, quantity, unit_price, subtotal
      FROM order_items
      WHERE order_id = ?
    `);

    const formattedOrders = orderRows.map(order => {
      const items = itemsQuery.all(order.id);
      let shippingAddress = {};
      try {
        shippingAddress = JSON.parse(order.shipping_address);
      } catch (e) {
        shippingAddress = { text: order.shipping_address };
      }

      return {
        id: order.id,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        couponCode: order.coupon_code || null,
        discountAmount: order.discount_amount || 0,
        status: order.status,
        shippingAddress,
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        items: items.map(item => ({
          id: item.id,
          productId: item.product_id,
          name: item.product_name,
          image: item.product_image || 'assets/images/logo.jpg',
          quantity: item.quantity,
          unitPrice: item.unit_price,
          subtotal: item.subtotal
        }))
      };
    });

    return res.json({
      success: true,
      count: formattedOrders.length,
      orders: formattedOrders
    });
  } catch (err) {
    console.error('[GET ORDERS ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve order history.' });
  }
});

/**
 * 2. GET SINGLE ORDER DETAIL
 * GET /api/user/orders/:id
 * Strictly verifies ownership by req.user.id
 */
router.get('/:id', requireAuth, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT * FROM orders WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found or unauthorized.' });
    }

    const items = db.prepare(`
      SELECT * FROM order_items WHERE order_id = ?
    `).all(order.id);

    let shippingAddress = {};
    try {
      shippingAddress = JSON.parse(order.shipping_address);
    } catch (e) {
      shippingAddress = { text: order.shipping_address };
    }

    return res.json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.order_number,
        totalAmount: order.total_amount,
        status: order.status,
        shippingAddress,
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        items
      }
    });
  } catch (err) {
    console.error('[GET SINGLE ORDER ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve order details.' });
  }
});

/**
 * 3. CREATE NEW ORDER
 * POST /api/user/orders
 * Derives customer ID exclusively from authenticated backend session
 */
router.post('/', requireAuth, (req, res) => {
  const { items, customer, shippingAddress, paymentMethod, orderNumber, couponCode } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one product item.' });
  }

  const shipping = shippingAddress || customer || {};
  const method = paymentMethod || 'Cash on Delivery (COD)';
  const orderNum = orderNumber || generateOrderNumber();
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Calculate items subtotal
  let itemsSubtotal = 0;
  const processedItems = items.map(item => {
    const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
    const price = Math.max(0, parseFloat(item.unitPrice || item.price) || 0);
    const subtotal = qty * price;
    itemsSubtotal += subtotal;

    return {
      id: crypto.randomUUID(),
      productId: item.id || item.productId || null,
      name: item.name || 'Pro Audio Equipment',
      image: item.image || item.img || 'assets/images/logo.jpg',
      quantity: qty,
      unitPrice: price,
      subtotal
    };
  });

  // Server-side coupon verification & discount application
  let appliedCouponCode = null;
  let appliedDiscountAmount = 0;

  if (couponCode && typeof couponCode === 'string') {
    const cleanCode = couponCode.trim().toUpperCase();
    const coupon = db.prepare(`
      SELECT id, code, discount_type, discount_value, min_cart_value, usage_limit, used_count, expires_at, is_active
      FROM coupons
      WHERE code = ? COLLATE NOCASE
    `).get(cleanCode);

    if (coupon && coupon.is_active) {
      const today = now.split('T')[0];
      const notExpired = !coupon.expires_at || coupon.expires_at >= today;
      const withinLimit = coupon.usage_limit === null || coupon.usage_limit === undefined || coupon.used_count < coupon.usage_limit;
      const meetsMinVal = !coupon.min_cart_value || itemsSubtotal >= coupon.min_cart_value;

      if (notExpired && withinLimit && meetsMinVal) {
        appliedCouponCode = coupon.code;
        if (coupon.discount_type === 'percentage') {
          appliedDiscountAmount = Math.round((itemsSubtotal * Number(coupon.discount_value)) / 100);
        } else {
          appliedDiscountAmount = Math.min(Number(coupon.discount_value), itemsSubtotal);
        }

        // Atomically increment coupon used_count
        db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
        console.log(`[ORDER] Coupon ${coupon.code} applied to order ${orderNum}. Discount: ₹${appliedDiscountAmount}`);
      }
    }
  }

  const finalTotalAmount = Math.max(0, itemsSubtotal - appliedDiscountAmount);

  try {
    const addressJson = JSON.stringify(shipping);

    db.prepare(`
      INSERT INTO orders (
        id, user_id, order_number, total_amount, status, shipping_address,
        payment_method, coupon_code, discount_amount, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Confirmed', ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      req.user.id,
      orderNum,
      finalTotalAmount,
      addressJson,
      method,
      appliedCouponCode,
      appliedDiscountAmount,
      now,
      now
    );

    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, product_image, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of processedItems) {
      insertItem.run(it.id, orderId, it.productId, it.name, it.image, it.quantity, it.unitPrice, it.subtotal);
    }

    return res.status(201).json({
      success: true,
      message: 'Order created and persisted successfully.',
      order: {
        id: orderId,
        orderNumber: orderNum,
        subtotal: itemsSubtotal,
        discountAmount: appliedDiscountAmount,
        couponCode: appliedCouponCode,
        totalAmount: finalTotalAmount,
        status: 'Confirmed',
        items: processedItems,
        shippingAddress: shipping,
        paymentMethod: method,
        createdAt: now
      }
    });
  } catch (err) {
    console.error('[CREATE ORDER ERROR]', err);
    return res.status(500).json({ error: 'Failed to create and save order.' });
  }
});

module.exports = router;
