/**
 * AudioKing User Saved Addresses API Router
 * Manages multiple delivery addresses connected to authenticated user ID.
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { syncCustomersMaster } = require('../dataSync');

const router = express.Router();

// All address routes require authentication
router.use(requireAuth);

/**
 * 1. List user's saved addresses
 */
router.get('/', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT 
        id, 
        tag, 
        recipient_name AS name, 
        phone, 
        street, 
        city, 
        state, 
        pin, 
        is_default AS isDefault, 
        created_at AS createdAt, 
        updated_at AS updatedAt
      FROM addresses
      WHERE user_id = ?
      ORDER BY is_default DESC, created_at DESC
    `).all(req.user.id);

    return res.json({
      success: true,
      addresses: list.map(a => ({ ...a, isDefault: Boolean(a.isDefault) }))
    });
  } catch (err) {
    console.error('[GET ADDRESSES ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve addresses.' });
  }
});

/**
 * 2. Add new address
 */
router.post('/', (req, res) => {
  const { tag, name, recipient_name, phone, street, city, state, pin, isDefault, is_default } = req.body;
  const resolvedName = (name || recipient_name || '').trim();

  if (!resolvedName || !phone || !street || !city || !state || !pin) {
    return res.status(400).json({ error: 'All address fields are required.' });
  }

  try {
    const existingCount = db.prepare('SELECT COUNT(*) AS count FROM addresses WHERE user_id = ?').get(req.user.id).count;
    const makeDefault = Boolean((isDefault ?? is_default) || existingCount === 0);

    // If setting as default, clear existing defaults
    if (makeDefault) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }

    const addrId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO addresses (id, user_id, tag, recipient_name, phone, street, city, state, pin, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addrId,
      req.user.id,
      tag || 'Studio',
      resolvedName,
      String(phone).trim(),
      street.trim(),
      city.trim(),
      state.trim(),
      pin.trim(),
      makeDefault ? 1 : 0,
      now,
      now
    );

    const created = db.prepare(`
      SELECT id, tag, recipient_name AS name, phone, street, city, state, pin, is_default AS isDefault
      FROM addresses WHERE id = ?
    `).get(addrId);

    try { syncCustomersMaster(db); } catch (e) {}

    return res.status(201).json({
      success: true,
      message: 'Address saved successfully.',
      address: {
        ...created,
        recipient_name: created.name,
        name: created.name,
        isDefault: Boolean(created.isDefault),
        is_default: Boolean(created.isDefault)
      }
    });
  } catch (err) {
    console.error('[CREATE ADDRESS ERROR]', err);
    return res.status(500).json({ error: 'Failed to save address.' });
  }
});

/**
 * 3. Update existing address
 */
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { tag, name, recipient_name, phone, street, city, state, pin, isDefault, is_default } = req.body;
  const resolvedName = name || recipient_name;
  const resolvedDefault = isDefault ?? is_default;

  try {
    const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Address not found.' });
    }

    if (resolvedDefault) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE addresses SET
        tag = COALESCE(?, tag),
        recipient_name = COALESCE(?, recipient_name),
        phone = COALESCE(?, phone),
        street = COALESCE(?, street),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        pin = COALESCE(?, pin),
        is_default = COALESCE(?, is_default),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      tag || null,
      resolvedName ? resolvedName.trim() : null,
      phone ? String(phone).trim() : null,
      street ? street.trim() : null,
      city ? city.trim() : null,
      state ? state.trim() : null,
      pin ? pin.trim() : null,
      resolvedDefault !== undefined ? (resolvedDefault ? 1 : 0) : null,
      now,
      id,
      req.user.id
    );

    const updated = db.prepare(`
      SELECT id, tag, recipient_name AS name, phone, street, city, state, pin, is_default AS isDefault
      FROM addresses WHERE id = ?
    `).get(id);

    try { syncCustomersMaster(db); } catch (e) {}

    return res.json({
      success: true,
      message: 'Address updated successfully.',
      address: {
        ...updated,
        recipient_name: updated.name,
        name: updated.name,
        isDefault: Boolean(updated.isDefault),
        is_default: Boolean(updated.isDefault)
      }
    });
  } catch (err) {
    console.error('[UPDATE ADDRESS ERROR]', err);
    return res.status(500).json({ error: 'Failed to update address.' });
  }
});

/**
 * 4. Delete address
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Address not found.' });
    }

    db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(id, req.user.id);

    // If deleted address was default, make the most recent one default
    if (existing.is_default) {
      const nextDefault = db.prepare('SELECT id FROM addresses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id);
      if (nextDefault) {
        db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ?').run(nextDefault.id);
      }
    }

    try { syncCustomersMaster(db); } catch (e) {}

    return res.json({ success: true, message: 'Address deleted successfully.' });
  } catch (err) {
    console.error('[DELETE ADDRESS ERROR]', err);
    return res.status(500).json({ error: 'Failed to delete address.' });
  }
});

/**
 * 5. Set default address
 */
router.post('/:id/default', (req, res) => {
  const { id } = req.params;

  try {
    const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Address not found.' });
    }

    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    db.prepare('UPDATE addresses SET is_default = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);

    try { syncCustomersMaster(db); } catch (e) {}

    return res.json({ success: true, message: 'Default address updated.' });
  } catch (err) {
    console.error('[SET DEFAULT ADDRESS ERROR]', err);
    return res.status(500).json({ error: 'Failed to set default address.' });
  }
});

module.exports = router;
