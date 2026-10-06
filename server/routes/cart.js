/**
 * AudioKing Persistent Cart REST API
 * Securely associates cart items with authenticated customer identity in SQLite DB.
 * Immediate transactional updates for adds, removes, and quantity changes.
 */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Helper: Query full cart rows joined with product catalog details
 */
function queryUserCart(userId) {
  const rows = db.prepare(`
    SELECT c.id AS cart_item_id, c.product_id, c.quantity, c.created_at, c.updated_at
    FROM cart_items c
    WHERE c.user_id = ?
    ORDER BY c.created_at ASC
  `).all(userId);

  return rows.map(r => {
    let baseProductId = r.product_id;
    let variantId = null;
    if (r.product_id && r.product_id.includes('_')) {
      const parts = r.product_id.split('_');
      baseProductId = parts[0];
      variantId = parts[1];
    }
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(baseProductId);
    let variant = null;
    if (variantId) {
      variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId);
    }

    const price = variant
      ? (variant.selling_price != null ? Number(variant.selling_price) : (variant.price_override != null ? Number(variant.price_override) : (p ? Number(p.price) : 0)))
      : (p && p.price != null ? Number(p.price) : 0);

    const originalPrice = variant
      ? (variant.mrp != null ? Number(variant.mrp) : (p ? Number(p.original_price) : 0))
      : (p && p.original_price != null ? Number(p.original_price) : 0);

    const name = (p ? p.name : 'Pro Audio Product') + (variant && variant.option_labels ? ` - ${variant.option_labels}` : '');

    return {
      id: r.product_id,
      productId: baseProductId,
      variantId: variantId,
      optionLabels: variant ? variant.option_labels : '',
      name: name,
      brand: p ? p.brand : 'Pro Audio',
      category: p ? p.category : 'Pro Audio',
      price: price,
      originalPrice: originalPrice,
      image: p ? p.image : 'assets/images/placeholder.svg',
      stock: variant ? Number(variant.stock) : (p && p.stock != null ? Number(p.stock) : 10),
      inStock: variant ? (variant.stock > 0 && variant.is_active) : (p ? p.in_stock !== 0 : true),
      qty: r.quantity,
      quantity: r.quantity,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  });
}

function getCartResponse(userId, res) {
  const cart = queryUserCart(userId);
  return res.json({ success: true, cart, items: cart });
}

// 1. GET /api/user/cart - Retrieve user's saved cart directly from DB
router.get('/', requireAuth, (req, res) => {
  try {
    return getCartResponse(req.user.id, res);
  } catch (err) {
    console.error('[GET CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve cart items.' });
  }
});

// 2. POST /api/user/cart/items - Add or increment a specific product immediately in DB
router.post('/items', requireAuth, (req, res) => {
  const { productId, qty, quantity } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: 'productId is required.' });
  }
  const cleanId = String(productId).trim();
  const quantityToAdd = Math.max(1, parseInt(quantity ?? qty ?? 1, 10) || 1);
  const now = new Date().toISOString();

  try {
    const existing = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, cleanId);

    if (existing) {
      const newQty = existing.quantity + quantityToAdd;
      db.prepare('UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ?').run(newQty, now, existing.id);
    } else {
      db.prepare('INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        crypto.randomUUID(), req.user.id, cleanId, quantityToAdd, now, now
      );
    }

    return getCartResponse(req.user.id, res);
  } catch (err) {
    console.error('[ADD CART ITEM ERROR]', err);
    return res.status(500).json({ error: 'Failed to add item to cart.' });
  }
});

// 3. PATCH /api/user/cart/items/:productId - Update quantity of an item directly in DB
router.patch('/items/:productId', requireAuth, (req, res) => {
  const cleanId = String(req.params.productId).trim();
  const { qty, quantity } = req.body || {};
  const newQty = parseInt(qty ?? quantity, 10);

  if (isNaN(newQty)) {
    return res.status(400).json({ error: 'A valid quantity number is required.' });
  }

  const now = new Date().toISOString();
  try {
    if (newQty <= 0) {
      db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, cleanId);
    } else {
      const existing = db.prepare('SELECT id FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, cleanId);
      if (existing) {
        db.prepare('UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ?').run(newQty, now, existing.id);
      } else {
        db.prepare('INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          crypto.randomUUID(), req.user.id, cleanId, newQty, now, now
        );
      }
    }
    return getCartResponse(req.user.id, res);
  } catch (err) {
    console.error('[UPDATE CART ITEM ERROR]', err);
    return res.status(500).json({ error: 'Failed to update item quantity.' });
  }
});

// 4. DELETE /api/user/cart/items/:productId - Remove specific item directly from DB
router.delete('/items/:productId', requireAuth, (req, res) => {
  const cleanId = String(req.params.productId).trim();
  try {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, cleanId);
    return getCartResponse(req.user.id, res);
  } catch (err) {
    console.error('[DELETE CART ITEM ERROR]', err);
    return res.status(500).json({ error: 'Failed to remove item from cart.' });
  }
});

// 5. PUT /api/user/cart - Atomic transactional sync of customer cart
router.put('/', requireAuth, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items must be an array.' });
  }

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN TRANSACTION;');
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);

    const insertStmt = db.prepare('INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const it of items) {
      const pId = it.id || it.productId;
      const qty = Math.max(1, Number(it.qty || it.quantity) || 1);
      if (pId) {
        insertStmt.run(crypto.randomUUID(), req.user.id, String(pId), qty, now, now);
      }
    }
    db.exec('COMMIT;');

    return getCartResponse(req.user.id, res);
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    console.error('[SYNC CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to sync cart.' });
  }
});

// 6. POST /api/user/cart/merge - Merges guest local items upon customer login without duplicating items
router.post('/merge', requireAuth, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return getCartResponse(req.user.id, res);
  }

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN TRANSACTION;');
    const findStmt = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?');
    const updateStmt = db.prepare('UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ?');
    const insertStmt = db.prepare('INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');

    for (const it of items) {
      const pId = it.id || it.productId;
      const qty = Math.max(1, Number(it.qty || it.quantity) || 1);
      if (!pId) continue;

      const existing = findStmt.get(req.user.id, String(pId));
      if (existing) {
        updateStmt.run(existing.quantity + qty, now, existing.id);
      } else {
        insertStmt.run(crypto.randomUUID(), req.user.id, String(pId), qty, now, now);
      }
    }
    db.exec('COMMIT;');

    return getCartResponse(req.user.id, res);
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    console.error('[MERGE CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to merge cart.' });
  }
});

// 7. DELETE /api/user/cart - Clear customer cart upon order completion
router.delete('/', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    return res.json({ success: true, message: 'Cart cleared.' });
  } catch (err) {
    console.error('[CLEAR CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to clear cart.' });
  }
});

module.exports = router;
