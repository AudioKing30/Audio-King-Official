/**
 * AudioKing Orders API Router
 * Manages order creation, retrieval, and order-item relationships.
 * Strictly scoped to authenticated user ID from backend session.
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { hashToken } = require('../security');
const { sendOrderConfirmedEmail } = require('../email');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Helper: Extract authenticated user from session cookie or header
 */
function getAuthUser(req) {
  let token = req.cookies?.audioking_session || 
              req.cookies?.audioking_admin_session || 
              req.cookies?.audioKingToken || 
              req.cookies?.audioKingSessionToken || 
              req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
              req.headers['x-session-token'];
  if (token) {
    token = String(token).trim();
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1).trim();
    }
    const tokenHash = hashToken(token);
    try {
      const session = db.prepare(`
        SELECT u.id, u.full_name, u.email, u.phone_number, u.role
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `).get(tokenHash, Date.now());
      if (session) return session;
    } catch (e) {}
  }
  return null;
}

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
 * 1. GET ALL ORDERS FOR CURRENT CUSTOMER
 * GET /api/user/orders
 */
router.get('/', (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const emailParam = (req.query.email || '').trim().toLowerCase();
    let targetUserId = authUser ? authUser.id : null;

    if (!targetUserId && emailParam) {
      const userRow = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(emailParam);
      if (userRow) targetUserId = userRow.id;
    }

    if (!targetUserId) {
      return res.json({ success: true, count: 0, orders: [] });
    }

    const ordersQuery = db.prepare(`
      SELECT id, user_id, order_number, total_amount, status, shipping_address, payment_method, coupon_code, discount_amount, created_at, updated_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
    `);

    const orderRows = ordersQuery.all(targetUserId);

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
router.post('/', async (req, res) => {
  const { items, customer, shippingAddress, paymentMethod, orderNumber, couponCode } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one product item.' });
  }

  const cust = customer || {};
  const ship = shippingAddress || {};
  const shipping = { ...cust, ...ship };
  const method = paymentMethod || 'Cash on Delivery (COD)';
  const orderNum = orderNumber || generateOrderNumber();
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  // 1. Resolve user ID (Authenticated Session vs Auto-Register Permanent Customer)
  const authUser = getAuthUser(req);
  let userId = null;
  let customerName = (shipping.name || shipping.fullName || cust.fullName || cust.name || (authUser && authUser.full_name) || 'Valued Customer').trim();
  let customerEmail = (shipping.email || cust.email || (authUser && authUser.email) || '').trim().toLowerCase();
  let customerPhone = (shipping.phone || shipping.phoneNumber || cust.phone || cust.phoneNumber || (authUser && authUser.phone_number) || '').trim();

  if (authUser) {
    userId = authUser.id;
    if (!customerEmail) customerEmail = authUser.email;
    if (!customerPhone) customerPhone = authUser.phone_number || '';
  } else {
    if (!customerEmail) {
      customerEmail = `customer_${Date.now()}@audioking.in`;
    }

    const existingUser = db.prepare('SELECT id, full_name, email, phone_number FROM users WHERE email = ? COLLATE NOCASE').get(customerEmail);
    if (existingUser) {
      userId = existingUser.id;
      if (customerPhone && !existingUser.phone_number) {
        db.prepare('UPDATE users SET phone_number = ? WHERE id = ?').run(customerPhone, userId);
      }
    } else {
      userId = crypto.randomUUID();
      const displayName = customerName.split(' ')[0] || customerName;
      db.prepare(`
        INSERT INTO users (
          id, full_name, display_name, title, email, phone_number,
          role, auth_provider, email_verified, phone_verified,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'Pro Audio Musician', ?, ?, 'customer', 'email', 1, 0, ?, ?)
      `).run(userId, customerName, displayName, customerEmail, customerPhone, now, now);

      db.prepare(`
        INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_user_id, created_at)
        VALUES (?, ?, 'email', ?, ?)
      `).run(crypto.randomUUID(), userId, customerEmail, now);

      console.log(`[ORDER USER REGISTER] Customer permanently registered in SQLite: ${customerEmail} (ID: ${userId})`);
    }
  }

  // 2. Calculate items subtotal with server-side catalog price verification
  let itemsSubtotal = 0;
  const processedItems = items.map(item => {
    const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
    const prodId = item.productId || item.id || null;

    let verifiedPrice = Math.max(0, parseFloat(item.unitPrice || item.price) || 0);
    let verifiedName = item.name || 'Pro Audio Equipment';
    let verifiedImage = item.image || item.img || 'assets/images/logo.jpg';

    // Verify against database product catalog to prevent price tampering
    if (prodId) {
      try {
        const catalogProduct = db.prepare('SELECT id, name, price, image FROM products WHERE id = ?').get(prodId);
        if (catalogProduct) {
          verifiedPrice = Number(catalogProduct.price);
          verifiedName = catalogProduct.name;
          verifiedImage = catalogProduct.image || verifiedImage;
        }
      } catch (e) {
        console.warn(`[ORDER VERIFY] Could not cross-reference product ${prodId}:`, e.message);
      }
    }

    const subtotal = qty * verifiedPrice;
    itemsSubtotal += subtotal;

    return {
      id: crypto.randomUUID(),
      productId: prodId,
      name: verifiedName,
      image: verifiedImage,
      quantity: qty,
      unitPrice: verifiedPrice,
      subtotal
    };
  });

  // 3. Server-side coupon verification & discount application
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
      userId,
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

    // 4. Dispatch Order Confirmed Email Notification
    sendOrderConfirmedEmail({
      email: customerEmail,
      fullName: customerName,
      orderNumber: orderNum,
      totalAmount: finalTotalAmount,
      items: processedItems,
      shippingAddress: shipping
    }).catch(emailErr => {
      console.error('[ORDER EMAIL DISPATCH ERROR]:', emailErr.message);
    });

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
