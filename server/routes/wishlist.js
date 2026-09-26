/**
 * AudioKing Persistent Wishlist REST API
 * Securely persists saved gear against authenticated customer identity in SQLite DB.
 */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// 1. GET /api/user/wishlist
router.get('/', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT product_id FROM wishlist_items WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    const wishlist = rows.map(r => r.product_id);
    return res.json({ success: true, wishlist });
  } catch (err) {
    console.error('[GET WISHLIST ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve wishlist items.' });
  }
});

// 2. POST /api/user/wishlist (Toggle or add product to wishlist)
router.post('/', requireAuth, (req, res) => {
  const { productId } = req.body;
  if (!productId) {
    return res.status(400).json({ error: 'productId is required.' });
  }

  const pId = String(productId).trim();
  const now = new Date().toISOString();

  try {
    const existing = db.prepare('SELECT id FROM wishlist_items WHERE user_id = ? AND product_id = ?').get(req.user.id, pId);
    let inWishlist = false;

    if (existing) {
      db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(existing.id);
      inWishlist = false;
    } else {
      db.prepare('INSERT INTO wishlist_items (id, user_id, product_id, created_at) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), req.user.id, pId, now);
      inWishlist = true;
    }

    const rows = db.prepare('SELECT product_id FROM wishlist_items WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    const wishlist = rows.map(r => r.product_id);

    return res.json({
      success: true,
      inWishlist,
      wishlist
    });
  } catch (err) {
    console.error('[TOGGLE WISHLIST ERROR]', err);
    return res.status(500).json({ error: 'Failed to update wishlist.' });
  }
});

// 3. DELETE /api/user/wishlist/:productId
router.delete('/:productId', requireAuth, (req, res) => {
  const pId = String(req.params.productId).trim();
  try {
    db.prepare('DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?').run(req.user.id, pId);
    const rows = db.prepare('SELECT product_id FROM wishlist_items WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    const wishlist = rows.map(r => r.product_id);
    return res.json({ success: true, wishlist });
  } catch (err) {
    console.error('[DELETE WISHLIST ERROR]', err);
    return res.status(500).json({ error: 'Failed to remove from wishlist.' });
  }
});

module.exports = router;
