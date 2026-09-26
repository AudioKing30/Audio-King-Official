/**
 * AudioKing Persistent Cart REST API
 * Securely associates cart items with authenticated customer identity in SQLite DB.
 */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// 1. GET /api/user/cart
router.get('/', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, product_id, quantity, created_at, updated_at FROM cart_items WHERE user_id = ? ORDER BY created_at ASC').all(req.user.id);
    const cart = rows.map(r => ({
      id: r.product_id,
      productId: r.product_id,
      qty: r.quantity,
      quantity: r.quantity,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
    return res.json({ success: true, cart });
  } catch (err) {
    console.error('[GET CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve cart items.' });
  }
});

// 2. PUT /api/user/cart (Atomic sync of customer cart)
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

    const rows = db.prepare('SELECT product_id, quantity FROM cart_items WHERE user_id = ?').all(req.user.id);
    const cart = rows.map(r => ({ id: r.product_id, productId: r.product_id, qty: r.quantity, quantity: r.quantity }));
    return res.json({ success: true, cart });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    console.error('[SYNC CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to sync cart.' });
  }
});

// 3. POST /api/user/cart/merge (Merges anonymous local items upon customer login)
router.post('/merge', requireAuth, (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) {
    const rows = db.prepare('SELECT product_id, quantity FROM cart_items WHERE user_id = ?').all(req.user.id);
    const cart = rows.map(r => ({ id: r.product_id, productId: r.product_id, qty: r.quantity, quantity: r.quantity }));
    return res.json({ success: true, cart });
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

    const rows = db.prepare('SELECT product_id, quantity FROM cart_items WHERE user_id = ?').all(req.user.id);
    const cart = rows.map(r => ({ id: r.product_id, productId: r.product_id, qty: r.quantity, quantity: r.quantity }));
    return res.json({ success: true, cart });
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (e) {}
    console.error('[MERGE CART ERROR]', err);
    return res.status(500).json({ error: 'Failed to merge cart.' });
  }
});

// 4. DELETE /api/user/cart (Clear customer cart upon order completion)
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
