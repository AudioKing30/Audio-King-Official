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
/**
 * Helper: Extract authenticated user from session cookie or header
 */
function getAuthUser(req) {
  let token = req.cookies?.audioking_session || 
              req.cookies?.audioking_admin_session || 
              req.cookies?.audioKingToken || 
              req.cookies?.audioKingSessionToken || 
              req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
              req.headers['x-session-token'] ||
              req.headers['x-admin-token'];
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

  // Fallback 1: check X-User-Id / query userId against users table
  const idFallback = (req.headers['x-user-id'] || req.query.userId || '').trim();
  if (idFallback) {
    try {
      const user = db.prepare('SELECT id, full_name, email, phone_number, role FROM users WHERE id = ?').get(idFallback);
      if (user) return user;
    } catch (e) {}
  }

  // Fallback 2: check X-User-Email / query email against users table
  const emailFallback = (req.headers['x-user-email'] || req.query.email || '').trim().toLowerCase();
  if (emailFallback) {
    try {
      const user = db.prepare('SELECT id, full_name, email, phone_number, role FROM users WHERE email = ? COLLATE NOCASE').get(emailFallback);
      if (user) return user;
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
    if (!authUser) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required to view order history. Please sign in.',
        code: 'AUTH_REQUIRED'
      });
    }

    let targetUserId = authUser.id;
    let targetEmail = (authUser.email || req.headers['x-user-email'] || req.query.email || '').trim().toLowerCase();
    let targetPhone = (authUser.phone_number || '').trim();

    // Only verified administrators can query orders of another customer email
    const emailParam = (req.query.email || '').trim().toLowerCase();
    if (authUser.role === 'admin' && emailParam && emailParam !== targetEmail) {
      const userRow = db.prepare('SELECT id, email, phone_number FROM users WHERE email = ? COLLATE NOCASE').get(emailParam);
      if (userRow) {
        targetUserId = userRow.id;
        targetEmail = userRow.email;
        targetPhone = userRow.phone_number || '';
      }
    }

    // Comprehensive order matching:
    // Matches by user_id OR user email OR shipping_address email OR phone OR specific order_number
    let ordersQuerySql = `
      SELECT DISTINCT 
        o.id, o.user_id, o.order_number, o.total_amount, o.status, 
        o.shipping_address, o.payment_method, o.coupon_code, o.discount_amount, 
        o.gst_number, o.created_at, o.updated_at
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.user_id = ?
    `;
    const queryParams = [targetUserId];

    if (targetEmail) {
      ordersQuerySql += `
        OR (u.email IS NOT NULL AND LOWER(TRIM(u.email)) = ?)
        OR LOWER(TRIM(COALESCE(json_extract(o.shipping_address, '$.email'), ''))) = ?
        OR (o.shipping_address LIKE '%' || ? || '%')
      `;
      queryParams.push(targetEmail, targetEmail, targetEmail);
    }

    const cleanPhone = targetPhone.replace(/\D/g, '').slice(-10);
    if (cleanPhone && cleanPhone.length === 10) {
      ordersQuerySql += `
        OR (o.shipping_address LIKE '%' || ? || '%')
      `;
      queryParams.push(cleanPhone);
    }

    const requestedOrderNumber = (req.query.orderNumber || req.query.orderId || '').trim();
    if (requestedOrderNumber) {
      ordersQuerySql += `
        OR o.order_number = ?
      `;
      queryParams.push(requestedOrderNumber);
    }

    ordersQuerySql += ` ORDER BY o.created_at DESC`;

    const orderRows = db.prepare(ordersQuerySql).all(...queryParams);

    // Retroactively attach any matched orders to this user's primary user_id
    for (const ord of orderRows) {
      if (ord.user_id !== targetUserId) {
        try {
          db.prepare('UPDATE orders SET user_id = ? WHERE id = ?').run(targetUserId, ord.id);
        } catch (_) {}
      }
    }

    const itemsQuery = db.prepare(`
      SELECT id, order_id, product_id, product_name, product_image, quantity, unit_price, subtotal, gst_percent
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
        gstNumber: order.gst_number || null,
        status: order.status,
        shippingAddress,
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        items: items.map(item => ({
          id: item.id,
          productId: item.product_id,
          name: item.product_name,
          image: item.product_image || 'assets/images/placeholder.svg',
          quantity: item.quantity,
          unitPrice: item.unit_price,
          subtotal: item.subtotal,
          gstPercent: item.gst_percent !== undefined && item.gst_percent !== null ? Number(item.gst_percent) : 18.0
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
router.get('/:id', (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const order = db.prepare(`
      SELECT o.*, u.email as user_email FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ? OR o.order_number = ?
    `).get(req.params.id, req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const userEmail = (authUser.email || '').toLowerCase().trim();
    const isOwner = authUser.role === 'admin' ||
                    order.user_id === authUser.id ||
                    (order.user_email && order.user_email.toLowerCase().trim() === userEmail) ||
                    (order.shipping_address && order.shipping_address.toLowerCase().includes(userEmail));
    if (!isOwner) {
      return res.status(403).json({ error: 'Unauthorized to view this order.' });
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
        couponCode: order.coupon_code || null,
        discountAmount: order.discount_amount || 0,
        gstNumber: order.gst_number || null,
        status: order.status,
        shippingAddress,
        paymentMethod: order.payment_method,
        createdAt: order.created_at,
        items: items.map(item => ({
          ...item,
          gstPercent: item.gst_percent !== undefined && item.gst_percent !== null ? Number(item.gst_percent) : 18.0
        }))
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
  const method = paymentMethod || 'Prepaid Online (UPI)';
  const orderNum = orderNumber || generateOrderNumber();
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  // 1. Resolve user ID (Authenticated Session vs Existing Customer vs Guest)
  const authUser = getAuthUser(req);
  let userId = null;
  let customerName = (shipping.name || shipping.fullName || cust.fullName || cust.name || (authUser && authUser.full_name) || 'Valued Customer').trim();
  let customerEmail = (shipping.email || cust.email || (authUser && authUser.email) || req.headers['x-user-email'] || '').trim().toLowerCase();
  let customerPhone = (shipping.phone || shipping.phoneNumber || cust.phone || cust.phoneNumber || (authUser && authUser.phone_number) || '').trim();

  const candidateUserId = (shipping.userId || cust.userId || req.headers['x-user-id'] || '').trim();

  if (authUser) {
    userId = authUser.id;
    if (!customerEmail) customerEmail = authUser.email;
    if (!customerPhone) customerPhone = authUser.phone_number || '';
  } else if (candidateUserId) {
    const matchedUser = db.prepare('SELECT id, full_name, email, phone_number FROM users WHERE id = ?').get(candidateUserId);
    if (matchedUser) {
      userId = matchedUser.id;
      if (!customerEmail) customerEmail = matchedUser.email;
      if (!customerPhone) customerPhone = matchedUser.phone_number || '';
    }
  }

  if (!userId && customerEmail) {
    const existingUser = db.prepare('SELECT id, full_name, email, phone_number FROM users WHERE email = ? COLLATE NOCASE').get(customerEmail);
    if (existingUser) {
      userId = existingUser.id;
      if (customerPhone && !existingUser.phone_number) {
        try { db.prepare('UPDATE users SET phone_number = ? WHERE id = ?').run(customerPhone, userId); } catch (_) {}
      }
    }
  }

  // If order was placed by an unauthenticated guest, assign to guest account without polluting registered customer count
  if (!userId) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, full_name, display_name, title, email, role, auth_provider, email_verified, created_at, updated_at)
      VALUES ('usr_guest_checkout', 'Guest Customer', 'Guest', 'Customer', 'guest@audioking.co.in', 'guest', 'guest', 0, ?, ?)
    `).run(now, now);
    userId = 'usr_guest_checkout';
  }

  // 2. Calculate items subtotal with server-side catalog price verification
  let itemsSubtotal = 0;
  const processedItems = items.map(item => {
    const qty = Math.max(1, parseInt(item.quantity || item.qty, 10) || 1);
    const prodId = item.productId || item.id || null;
    const rawProdStr = String(item.productId || item.id || '');
    let baseProdId = rawProdStr.includes('_') ? rawProdStr.split('_')[0] : (item.productId || item.id || null);
    let variantId = item.variantId || (rawProdStr.includes('_') ? rawProdStr.split('_')[1] : null);

    let verifiedPrice = Math.max(0, parseFloat(item.unitPrice || item.price) || 0);
    let verifiedName = item.name || 'Pro Audio Equipment';
    let verifiedImage = item.image || item.img || 'assets/images/placeholder.svg';

    // Verify against database product catalog to prevent price tampering
    let itemGstPercent = Number(item.gstPercent ?? item.gst_percent ?? 18.0);
    if (baseProdId) {
      try {
        const catalogProduct = db.prepare('SELECT id, name, price, image, gst_percent FROM products WHERE id = ?').get(baseProdId);
        if (catalogProduct) {
          verifiedPrice = Number(catalogProduct.price);
          verifiedName = catalogProduct.name;
          verifiedImage = catalogProduct.image || verifiedImage;
          if (catalogProduct.gst_percent !== undefined && catalogProduct.gst_percent !== null) {
            itemGstPercent = Number(catalogProduct.gst_percent);
          }
        }
        if (variantId) {
          const v = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId);
          if (v) {
            const vPrice = v.selling_price != null ? Number(v.selling_price) : (v.price_override != null ? Number(v.price_override) : null);
            if (vPrice != null) {
              verifiedPrice = vPrice;
            }
            if (v.option_labels && !verifiedName.includes(v.option_labels)) {
              verifiedName = `${verifiedName} - ${v.option_labels}`;
            }
          }
        }
      } catch (e) {
        console.warn(`[ORDER VERIFY] Could not cross-reference product ${baseProdId}:`, e.message);
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
      subtotal,
      gstPercent: itemGstPercent
    };
  });

  // 3. Server-side coupon verification & discount application
  let appliedCouponCode = null;
  let appliedDiscountAmount = 0;
  let appliedCouponId = null;

  if (couponCode && typeof couponCode === 'string') {
    const cleanCode = couponCode.trim().toUpperCase();
    const coupon = db.prepare(`
      SELECT id, code, discount_type, discount_value, min_cart_value, usage_limit, used_count,
             COALESCE(per_user_limit, 1) AS per_user_limit, expires_at, is_active,
             LOWER(COALESCE(target_brand, applicable_brand, 'all')) AS target_brand,
             LOWER(COALESCE(target_category, applicable_category, 'all')) AS target_category
      FROM coupons
      WHERE code = ? COLLATE NOCASE
    `).get(cleanCode);

    if (coupon && coupon.is_active) {
      const today = now.split('T')[0];
      const notExpired = !coupon.expires_at || coupon.expires_at >= today;
      const withinLimit = coupon.usage_limit === null || coupon.usage_limit === undefined || coupon.used_count < coupon.usage_limit;
      const meetsMinVal = !coupon.min_cart_value || itemsSubtotal >= coupon.min_cart_value;

      // Check per-user limit
      let withinUserLimit = true;
      if (userId && coupon.per_user_limit > 0) {
        try {
          const userUsage = db.prepare('SELECT COUNT(*) AS count FROM coupon_usages WHERE user_id = ? AND coupon_id = ?').get(userId, coupon.id);
          if (userUsage && userUsage.count >= coupon.per_user_limit) {
            withinUserLimit = false;
          }
        } catch (e) {}
      }

      // Check targeting scope (Target Brand & Target Category)
      const hasBrandScope = coupon.target_brand && coupon.target_brand !== 'all';
      const hasCatScope = coupon.target_category && coupon.target_category !== 'all';

      let applicableBase = itemsSubtotal;
      if (hasBrandScope || hasCatScope) {
        applicableBase = processedItems.reduce((sum, it) => {
          let b = '';
          let c = '';
          const pLookupId = it.productId ? (String(it.productId).includes('_') ? String(it.productId).split('_')[0] : String(it.productId)) : null;
          if (pLookupId) {
            try {
              const pRow = db.prepare('SELECT brand, category FROM products WHERE id = ?').get(pLookupId);
              if (pRow) {
                b = pRow.brand || '';
                c = pRow.category || '';
              }
            } catch (e) {}
          }
          const itemBrand = b.trim().toLowerCase();
          const itemCat = c.trim().toLowerCase();
          const brandMatches = !hasBrandScope || itemBrand === coupon.target_brand.trim();
          const catMatches = !hasCatScope || itemCat === coupon.target_category.trim();
          if (brandMatches && catMatches) {
            return sum + it.subtotal;
          }
          return sum;
        }, 0);
      }

      if (notExpired && withinLimit && meetsMinVal && withinUserLimit && applicableBase > 0) {
        appliedCouponCode = coupon.code;
        appliedCouponId = coupon.id;
        if (coupon.discount_type === 'percentage') {
          appliedDiscountAmount = Math.round((applicableBase * Number(coupon.discount_value)) / 100);
        } else {
          appliedDiscountAmount = Math.min(Number(coupon.discount_value), applicableBase);
        }

        db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
        console.log(`[ORDER] Coupon ${coupon.code} applied to order ${orderNum}. Discount: ₹${appliedDiscountAmount}`);
      }
    }
  }

  const finalTotalAmount = Math.max(0, itemsSubtotal - appliedDiscountAmount);

  try {
    shipping.email = customerEmail;
    shipping.name = customerName;
    shipping.phone = customerPhone;
    if (userId) shipping.userId = userId;
    const addressJson = JSON.stringify(shipping);

    let userGst = '';
    if (userId) {
      try {
        const uRow = db.prepare('SELECT gst_number FROM users WHERE id = ?').get(userId);
        if (uRow && uRow.gst_number) userGst = uRow.gst_number;
      } catch (_) {}
    }
    const finalGstNumber = (req.body.gstNumber || shipping.gstNumber || userGst || '').trim().toUpperCase();

    db.prepare(`
      INSERT INTO orders (
        id, user_id, order_number, total_amount, status, shipping_address,
        payment_method, coupon_code, discount_amount, gst_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Confirmed', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      userId,
      orderNum,
      finalTotalAmount,
      addressJson,
      method,
      appliedCouponCode,
      appliedDiscountAmount,
      finalGstNumber || null,
      now,
      now
    );

    const insertItem = db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, product_image, quantity, unit_price, subtotal, gst_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of processedItems) {
      insertItem.run(it.id, orderId, it.productId, it.name, it.image, it.quantity, it.unitPrice, it.subtotal, it.gstPercent || 18.0);
    }

    // Record coupon usage per user if coupon was applied
    if (appliedCouponId && userId) {
      try {
        db.prepare(`
          INSERT INTO coupon_usages (id, coupon_id, user_id, order_id, discount_amount, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), appliedCouponId, userId, orderId, appliedDiscountAmount, now);
      } catch (e) {
        console.warn('[ORDER] Could not record coupon usage:', e.message);
      }
    }

    // Automatically clear user's cart in the DB upon order placement
    if (userId) {
      try {
        db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
      } catch (e) {}
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

    // Auto-mirror order, customer, and coupon stats to master JSON files for permanent persistence
    try {
      const { syncOrdersMaster, syncCustomersMaster, syncCouponsMaster } = require('../dataSync');
      syncOrdersMaster(db);
      syncCustomersMaster(db);
      syncCouponsMaster(db);
    } catch (e) {
      console.warn('[ORDER SYNC WARN]', e.message);
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
        gstNumber: finalGstNumber || null,
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
