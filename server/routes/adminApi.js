/**
 * AudioKing Master Admin REST API Router
 * Provides secure endpoints for:
 * 1. Dashboard Metrics & Low-Stock Alerts
 * 2. Product Management (CRUD, validations, categories, brands)
 * 3. Safe Multi-Image and Video Uploads (strict MIME & magic byte validation)
 * 4. Offers & Blanket Discounts
 * 5. Cart-Level Coupons Manager
 * 6. Two-Tab Orders Tracking & Status Updates
 * 7. Customers & Lifetime Purchase History
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAdminApi } = require('../middleware/adminMiddleware');
const { sendOrderConfirmedEmail, sendOrderDispatchedEmail, sendOrderDeliveredEmail, sendOrderCancelledEmail } = require('../email');

const router = express.Router();

// Protect all routes in this router with requireAdminApi
router.use(requireAdminApi);

/**
 * Synchronize SQLite products table with products_master.json and js/data/products.js
 */
function syncMasterFiles() {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY id ASC').all();
    const formatted = products.map(p => {
      let images = [];
      try { images = JSON.parse(p.images_json || '[]'); } catch (e) { images = []; }
      let specs = [];
      try { specs = JSON.parse(p.specs_json || '[]'); } catch (e) { specs = []; }
      let deepSpecs = [];
      try { deepSpecs = JSON.parse(p.deep_specs_json || '[]'); } catch (e) { deepSpecs = []; }
      return {
        id: p.id,
        name: p.name,
        shortName: p.short_name || p.name,
        brand: p.brand,
        category: p.category,
        section: p.section || 'pro-audio',
        subcategory: p.subcategory || '',
        price: p.price,
        originalPrice: p.original_price,
        stock: p.stock,
        inStock: Boolean(p.in_stock),
        rating: p.rating || 5.0,
        reviewCount: p.review_count || 0,
        badge: p.badge || '',
        sku: p.sku || '',
        description: p.description || '',
        image: p.image || (images[0] || 'assets/images/logo.jpg'),
        images: images.length ? images : (p.image ? [p.image] : ['assets/images/logo.jpg']),
        videoType: p.video_type || null,
        videoUrl: p.video_url || null,
        youtubeVideoId: p.youtube_video_id || null,
        specs: specs,
        deepSpecs: deepSpecs
      };
    });

    const masterPath = path.resolve(__dirname, '..', 'data', 'products_master.json');
    fs.writeFileSync(masterPath, JSON.stringify(formatted, null, 2), 'utf8');

    const jsDataPath = path.resolve(__dirname, '..', '..', 'js', 'data', 'products.js');
    if (fs.existsSync(jsDataPath)) {
      const jsContent = `export const AUDIOKING_PRODUCTS = ${JSON.stringify(formatted, null, 2)};\n`;
      fs.writeFileSync(jsDataPath, jsContent, 'utf8');
    }
  } catch (err) {
    console.warn('[SYNC MASTER FILES WARN]', err.message);
  }
}

// -------------------------------------------------------------
// SECURE FILE UPLOAD CONFIGURATION (Multer + Magic Bytes)
// -------------------------------------------------------------
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const PRODUCT_IMG_DIR = path.join(UPLOADS_DIR, 'products');
const VIDEO_DIR = path.join(UPLOADS_DIR, 'videos');

[UPLOADS_DIR, PRODUCT_IMG_DIR, VIDEO_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Magic bytes validation helper
function validateMagicBytes(filePath, expectedType) {
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    if (expectedType === 'image') {
      // JPEG: FF D8 FF
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
      // WebP: 'RIFF' .... 'WEBP'
      const riff = buffer.toString('ascii', 0, 4);
      const webp = buffer.toString('ascii', 8, 12);
      if (riff === 'RIFF' && webp === 'WEBP') return true;
      return false;
    }

    if (expectedType === 'video') {
      // MP4: contains 'ftyp' at offset 4
      const ftyp = buffer.toString('ascii', 4, 8);
      if (ftyp === 'ftyp') return true;
      // WebM: 1A 45 DF A3 (EBML header)
      if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) return true;
      return false;
    }

    return false;
  } catch (err) {
    console.error('[MAGIC BYTES CHECK ERROR]', err);
    return false;
  }
}

// Multer Storage Configuration
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRODUCT_IMG_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Only JPG, PNG, and WebP images up to 5MB are allowed.'));
    }
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (req, file, cb) => {
    const allowedMime = ['video/mp4', 'video/webm'];
    const allowedExt = ['.mp4', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid video format. Only MP4 and WebM videos up to 50MB are allowed.'));
    }
  }
});

// Upload Handlers with Magic Byte Verification
router.post('/upload/images', imageUpload.array('images', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files uploaded.' });
    }

    const savedPaths = [];
    for (const file of req.files) {
      const isValid = validateMagicBytes(file.path, 'image');
      if (!isValid) {
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: `Security check failed: File "${file.originalname}" is not a valid JPEG, PNG, or WebP image.` });
      }
      savedPaths.push(`uploads/products/${file.filename}`);
    }

    return res.json({ success: true, urls: savedPaths });
  } catch (err) {
    console.error('[IMAGE UPLOAD ERROR]', err);
    return res.status(500).json({ error: err.message || 'Image upload failed.' });
  }
});

router.post('/upload/video', videoUpload.single('video'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const isValid = validateMagicBytes(req.file.path, 'video');
    if (!isValid) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Security check failed: File "${req.file.originalname}" is not a valid MP4 or WebM video.` });
    }

    return res.json({
      success: true,
      url: `uploads/videos/${req.file.filename}`
    });
  } catch (err) {
    console.error('[VIDEO UPLOAD ERROR]', err);
    return res.status(500).json({ error: err.message || 'Video upload failed.' });
  }
});

// -------------------------------------------------------------
// 1. DASHBOARD METRICS & LOW STOCK ALERTS
// -------------------------------------------------------------
router.get('/dashboard/stats', (req, res) => {
  try {
    const totalCustomers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role != 'admin'").get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    const currentOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status IN ('Confirmed', 'Dispatched', 'Pending', 'Shipped')").get().count;
    const completedOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'Delivered'").get().count;
    
    const revRow = db.prepare("SELECT SUM(total_amount) AS total FROM orders WHERE status NOT IN ('Cancelled', 'Returned')").get();
    const totalRevenue = revRow.total || 0;

    const lowStockProducts = db.prepare(`
      SELECT id, name, category, brand, stock, in_stock, image, price, original_price
      FROM products
      WHERE stock < 5
      ORDER BY stock ASC
      LIMIT 10
    `).all();

    return res.json({
      success: true,
      stats: {
        totalCustomers,
        totalOrders,
        currentOrders,
        completedOrders,
        totalRevenue: Math.round(totalRevenue),
        lowStockCount: lowStockProducts.length,
        lowStockProducts
      }
    });
  } catch (err) {
    console.error('[DASHBOARD STATS ERROR]', err);
    return res.status(500).json({ error: 'Failed to load dashboard metrics.' });
  }
});

// -------------------------------------------------------------
// -------------------------------------------------------------
// 2. CATEGORIES & BRANDS (FULL CRUD WITH PRODUCT CASCADE)
// -------------------------------------------------------------
router.get('/categories', (req, res) => {
  try {
    // Auto-sync any categories present in products table
    const unseeded = db.prepare(`
      SELECT DISTINCT category AS name FROM products 
      WHERE category IS NOT NULL AND TRIM(category) != '' 
        AND LOWER(category) NOT IN (SELECT LOWER(name) FROM categories)
    `).all();
    const now = new Date().toISOString();
    for (const item of unseeded) {
      const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      db.prepare('INSERT OR IGNORE INTO categories (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
        .run(`cat_${slug}`, item.name.trim(), slug, now);
    }

    const categories = db.prepare(`
      SELECT c.id, c.name, c.slug, COALESCE(c.section, 'pro-audio') AS section, c.created_at, COUNT(p.id) AS product_count 
      FROM categories c 
      LEFT JOIN products p ON LOWER(TRIM(p.category)) = LOWER(TRIM(c.name))
      GROUP BY c.id 
      ORDER BY c.name COLLATE NOCASE ASC
    `).all();

    return res.json({ success: true, categories });
  } catch (err) {
    console.error('[FETCH CATEGORIES ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name, section } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    const cleanName = name.trim();
    const cleanSection = (section === 'musical-instruments' || section === 'home-audio') ? section : 'pro-audio';
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = `cat_${slug}_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(cleanName);
    if (existing) {
      return res.status(400).json({ error: 'A category with this name already exists.' });
    }

    db.prepare('INSERT INTO categories (id, name, slug, section, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, cleanName, slug, cleanSection, now);

    return res.status(201).json({ success: true, category: { id, name: cleanName, slug, section: cleanSection, product_count: 0 } });
  } catch (err) {
    console.error('[CREATE CATEGORY ERROR]', err);
    return res.status(500).json({ error: 'Failed to create category.' });
  }
});

router.put('/categories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, section } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'New category name is required.' });
    }
    const cleanName = name.trim();
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    // Check duplicate name
    const dup = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?').get(cleanName, id);
    if (dup) {
      return res.status(400).json({ error: 'Another category with this name already exists.' });
    }

    const oldName = existing.name;
    const targetSection = (section === 'musical-instruments' || section === 'home-audio' || section === 'pro-audio') 
      ? section 
      : (existing.section || 'pro-audio');

    // Update category row
    db.prepare('UPDATE categories SET name = ?, slug = ?, section = ? WHERE id = ?').run(cleanName, slug, targetSection, id);

    // Cascade update all products referencing old category name
    const prodUpdate = db.prepare('UPDATE products SET category = ?, section = ? WHERE LOWER(TRIM(category)) = LOWER(TRIM(?))').run(cleanName, targetSection, oldName);

    // Cascade update category-targeted blanket offers
    db.prepare("UPDATE offers SET target_id = ? WHERE target_type = 'category' AND LOWER(TRIM(target_id)) = LOWER(TRIM(?))").run(cleanName, oldName);

    syncMasterFiles();

    return res.json({
      success: true,
      message: `Category updated to "${cleanName}". Updated ${prodUpdate.changes} matching products.`,
      category: { id, name: cleanName, slug, section: targetSection }
    });
  } catch (err) {
    console.error('[RENAME CATEGORY ERROR]', err);
    return res.status(500).json({ error: 'Failed to rename category.' });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    const catName = existing ? existing.name : id;

    // Find all matching products to cascade delete
    const matchingProducts = db.prepare('SELECT id FROM products WHERE LOWER(TRIM(category)) = LOWER(TRIM(?))').all(catName);
    const prodIds = matchingProducts.map(p => p.id);

    if (prodIds.length > 0) {
      const placeholders = prodIds.map(() => '?').join(',');
      try {
        db.prepare(`DELETE FROM product_variant_options WHERE group_id IN (SELECT id FROM product_variant_groups WHERE product_id IN (${placeholders}))`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM product_variant_groups WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM product_variants WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM cart_items WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM wishlist_items WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM offers WHERE target_type = 'product' AND target_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}

      db.prepare(`DELETE FROM products WHERE LOWER(TRIM(category)) = LOWER(TRIM(?))`).run(catName);
    }

    try {
      db.prepare("DELETE FROM offers WHERE target_type = 'category' AND LOWER(TRIM(target_id)) = LOWER(TRIM(?))").run(catName);
    } catch (e) {}
    db.prepare('DELETE FROM categories WHERE id = ? OR LOWER(TRIM(name)) = LOWER(TRIM(?))').run(id, catName);

    syncMasterFiles();

    console.log(`[ADMIN CASCADE DELETE] Terminated category "${catName}" and ${prodIds.length} associated products.`);
    return res.json({
      success: true,
      message: `Category "${catName}" and all ${prodIds.length} associated products and sections have been terminated.`,
      deletedCount: prodIds.length
    });
  } catch (err) {
    console.error('[DELETE CATEGORY ERROR]', err);
    return res.status(500).json({ error: 'Failed to delete category: ' + err.message });
  }
});

router.get('/brands', (req, res) => {
  try {
    // Auto-sync any brands present in products table
    const unseeded = db.prepare(`
      SELECT DISTINCT brand AS name FROM products 
      WHERE brand IS NOT NULL AND TRIM(brand) != '' 
        AND LOWER(brand) NOT IN (SELECT LOWER(name) FROM brands)
    `).all();
    const now = new Date().toISOString();
    for (const item of unseeded) {
      const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      db.prepare('INSERT OR IGNORE INTO brands (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
        .run(`brand_${slug}`, item.name.trim(), slug, now);
    }

    const brands = db.prepare(`
      SELECT b.id, b.name, b.slug, b.created_at, COUNT(p.id) AS product_count 
      FROM brands b 
      LEFT JOIN products p ON LOWER(TRIM(p.brand)) = LOWER(TRIM(b.name))
      GROUP BY b.id 
      ORDER BY b.name COLLATE NOCASE ASC
    `).all();

    return res.json({ success: true, brands });
  } catch (err) {
    console.error('[FETCH BRANDS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch brands.' });
  }
});

router.post('/brands', (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Brand name is required.' });
    }
    const cleanName = name.trim();
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = `brand_${slug}_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM brands WHERE LOWER(name) = LOWER(?)').get(cleanName);
    if (existing) {
      return res.status(400).json({ error: 'A brand with this name already exists.' });
    }

    db.prepare('INSERT INTO brands (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .run(id, cleanName, slug, now);

    return res.status(201).json({ success: true, brand: { id, name: cleanName, slug, product_count: 0 } });
  } catch (err) {
    console.error('[CREATE BRAND ERROR]', err);
    return res.status(500).json({ error: 'Failed to create brand.' });
  }
});

router.put('/brands/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'New brand name is required.' });
    }
    const cleanName = name.trim();
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const existing = db.prepare('SELECT * FROM brands WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Brand not found.' });
    }

    // Check duplicate name
    const dup = db.prepare('SELECT id FROM brands WHERE LOWER(name) = LOWER(?) AND id != ?').get(cleanName, id);
    if (dup) {
      return res.status(400).json({ error: 'Another brand with this name already exists.' });
    }

    const oldName = existing.name;

    // Update brand row
    db.prepare('UPDATE brands SET name = ?, slug = ? WHERE id = ?').run(cleanName, slug, id);

    // Cascade update all products referencing old brand name
    const prodUpdate = db.prepare('UPDATE products SET brand = ? WHERE LOWER(TRIM(brand)) = LOWER(TRIM(?))').run(cleanName, oldName);

    // Cascade update brand-targeted offers if any
    try {
      db.prepare("UPDATE offers SET target_id = ? WHERE target_type = 'brand' AND LOWER(TRIM(target_id)) = LOWER(TRIM(?))").run(cleanName, oldName);
    } catch (e) {}

    syncMasterFiles();

    return res.json({
      success: true,
      message: `Brand updated to "${cleanName}". Updated ${prodUpdate.changes} matching products.`,
      brand: { id, name: cleanName, slug }
    });
  } catch (err) {
    console.error('[RENAME BRAND ERROR]', err);
    return res.status(500).json({ error: 'Failed to rename brand.' });
  }
});

router.delete('/brands/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM brands WHERE id = ?').get(id);
    const brandName = existing ? existing.name : id;

    // Find all matching products to cascade delete
    const matchingProducts = db.prepare('SELECT id FROM products WHERE LOWER(TRIM(brand)) = LOWER(TRIM(?))').all(brandName);
    const prodIds = matchingProducts.map(p => p.id);

    if (prodIds.length > 0) {
      const placeholders = prodIds.map(() => '?').join(',');
      try {
        db.prepare(`DELETE FROM product_variant_options WHERE group_id IN (SELECT id FROM product_variant_groups WHERE product_id IN (${placeholders}))`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM product_variant_groups WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM product_variants WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM cart_items WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM wishlist_items WHERE product_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}
      try {
        db.prepare(`DELETE FROM offers WHERE target_type = 'product' AND target_id IN (${placeholders})`).run(...prodIds);
      } catch (e) {}

      db.prepare(`DELETE FROM products WHERE LOWER(TRIM(brand)) = LOWER(TRIM(?))`).run(brandName);
    }

    try {
      db.prepare("DELETE FROM offers WHERE target_type = 'brand' AND LOWER(TRIM(target_id)) = LOWER(TRIM(?))").run(brandName);
    } catch (e) {}
    db.prepare('DELETE FROM brands WHERE id = ? OR LOWER(TRIM(name)) = LOWER(TRIM(?))').run(id, brandName);

    syncMasterFiles();

    console.log(`[ADMIN CASCADE DELETE] Terminated brand "${brandName}" and ${prodIds.length} associated products.`);
    return res.json({
      success: true,
      message: `Brand "${brandName}" and all ${prodIds.length} associated products and sections have been terminated.`,
      deletedCount: prodIds.length
    });
  } catch (err) {
    console.error('[DELETE BRAND ERROR]', err);
    return res.status(500).json({ error: 'Failed to delete brand: ' + err.message });
  }
});

// -------------------------------------------------------------
// 3. PRODUCT MANAGEMENT (CRUD, VALIDATION, DISCOUNT %)
// -------------------------------------------------------------
router.get('/products', (req, res) => {
  try {
    const { search, category, brand, stockStatus } = req.query || {};
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR brand LIKE ? OR category LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    if (category && category !== 'All') {
      query += ' AND category = ? COLLATE NOCASE';
      params.push(category);
    }

    if (brand && brand !== 'All') {
      query += ' AND brand = ? COLLATE NOCASE';
      params.push(brand);
    }

    if (stockStatus === 'low') {
      query += ' AND stock > 0 AND stock < 5';
    } else if (stockStatus === 'out') {
      query += ' AND (stock <= 0 OR in_stock = 0)';
    } else if (stockStatus === 'in') {
      query += ' AND stock > 0 AND in_stock = 1';
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.prepare(query).all(...params);

    const formatted = rows.map(r => {
      let images = [];
      try { images = JSON.parse(r.images_json || '[]'); } catch (e) {}
      if (!images.length && r.image) images = [r.image];

      const mrp = Number(r.original_price) || Number(r.price) || 0;
      const sellingPrice = Number(r.price) || mrp;
      const discountPercent = mrp > sellingPrice ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;

      return {
        id: r.id,
        name: r.name,
        shortName: r.short_name || r.name,
        category: r.category,
        section: r.section || 'pro-audio',
        brand: r.brand,
        originalPrice: mrp,
        price: sellingPrice,
        discountPercent,
        stock: Number(r.stock ?? 0),
        inStock: Boolean(r.in_stock && r.stock > 0),
        image: r.image || images[0] || 'assets/images/logo.jpg',
        images,
        videoType: r.video_type || null,
        videoUrl: r.video_url || null,
        youtubeVideoId: r.youtube_video_id || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    });

    return res.json({ success: true, count: formatted.length, products: formatted });
  } catch (err) {
    console.error('[ADMIN GET PRODUCTS ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve products.' });
  }
});

router.get('/products/:id', (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Product not found.' });

    let images = [];
    try { images = JSON.parse(r.images_json || '[]'); } catch (e) {}
    if (!images.length && r.image) images = [r.image];

    let specs = [];
    try { specs = JSON.parse(r.specs_json || '[]'); } catch (e) {}

    let deepSpecs = [];
    try { deepSpecs = JSON.parse(r.deep_specs_json || '[]'); } catch (e) {}

    const mrp = Number(r.original_price) || Number(r.price) || 0;
    const sellingPrice = Number(r.price) || mrp;
    const discountPercent = mrp > sellingPrice ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;

    return res.json({
      success: true,
      product: {
        id: r.id,
        name: r.name,
        shortName: r.short_name || r.name,
        category: r.category,
        section: r.section || 'pro-audio',
        brand: r.brand,
        subcategory: r.subcategory || '',
        originalPrice: mrp,
        price: sellingPrice,
        discountPercent,
        stock: Number(r.stock ?? 0),
        inStock: Boolean(r.in_stock),
        badge: r.badge || '',
        sku: r.sku || '',
        description: r.description || '',
        image: r.image || images[0] || 'assets/images/logo.jpg',
        images,
        videoType: r.video_type || null,
        videoUrl: r.video_url || null,
        youtubeVideoId: r.youtube_video_id || null,
        specs,
        deepSpecs,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve product details.' });
  }
});

// Helper: Extract YouTube ID from URL or return raw ID
function parseYouTubeId(input) {
  if (!input) return null;
  const str = input.trim();
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(str)) return str;
  return null;
}

// POST: Add new product
router.post('/products', (req, res) => {
  try {
    const {
      name, category, brand, images, videoChoice, videoInput,
      mrp, sellingPrice, stock, inStock, description, section
    } = req.body || {};

    if (!name || !name.trim()) return res.status(400).json({ error: 'Product name is required.' });
    if (!category || !category.trim()) return res.status(400).json({ error: 'Category is required.' });
    if (!brand || !brand.trim()) return res.status(400).json({ error: 'Brand is required.' });

    const cleanSection = (section === 'musical-instruments' || section === 'home-audio') ? section : 'pro-audio';

    const numMrp = parseFloat(mrp);
    const numSelling = parseFloat(sellingPrice);

    if (isNaN(numMrp) || numMrp <= 0) return res.status(400).json({ error: 'Please enter a valid MRP (₹).' });
    if (isNaN(numSelling) || numSelling <= 0) return res.status(400).json({ error: 'Please enter a valid Selling Price (₹).' });

    // CRITICAL VALIDATION: Selling Price cannot exceed MRP
    if (numSelling > numMrp) {
      return res.status(400).json({ error: 'Selling Price (₹' + numSelling + ') cannot exceed MRP (₹' + numMrp + ').' });
    }

    const numStock = parseInt(stock, 10);
    const validStock = isNaN(numStock) || numStock < 0 ? 0 : numStock;
    // Auto-flip inStock if stock is 0, but allow manual toggle if stock > 0
    const finalInStock = validStock === 0 ? 0 : (inStock !== false ? 1 : 0);

    const imageArray = Array.isArray(images) && images.length > 0 ? images : ['assets/images/logo.jpg'];
    const mainImage = imageArray[0];

    // Video processing
    let videoType = null;
    let videoUrl = null;
    let youtubeVideoId = null;

    if (videoChoice === 'youtube' && videoInput) {
      youtubeVideoId = parseYouTubeId(videoInput);
      videoType = 'youtube';
      videoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId || videoInput}`;
    } else if (videoChoice === 'upload' && videoInput) {
      videoType = 'upload';
      videoUrl = videoInput;
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const id = `${slug}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    // Auto-register category & brand if not already present
    db.prepare('INSERT OR IGNORE INTO categories (id, name, slug, section, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`cat_${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, category.trim(), category.toLowerCase().replace(/[^a-z0-9]+/g, '-'), cleanSection, now);

    db.prepare('INSERT OR IGNORE INTO brands (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
      .run(`brand_${brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, brand.trim(), brand.toLowerCase().replace(/[^a-z0-9]+/g, '-'), now);

    db.prepare(`
      INSERT INTO products (
        id, name, short_name, brand, category, subcategory, section,
        price, original_price, stock, in_stock, rating, review_count,
        badge, sku, description, image, images_json,
        video_type, video_url, youtube_video_id,
        specs_json, deep_specs_json, is_featured,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `).run(
      id,
      name.trim(),
      name.trim(),
      brand.trim(),
      category.trim(),
      '',
      cleanSection,
      numSelling,
      numMrp,
      validStock,
      finalInStock,
      5.0,
      0,
      '',
      `AK-${id.toUpperCase()}`,
      description || '',
      mainImage,
      JSON.stringify(imageArray),
      videoType,
      videoUrl,
      youtubeVideoId,
      '[]',
      '[]',
      0,
      now,
      now
    );

    syncMasterFiles();

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      productId: id
    });
  } catch (err) {
    console.error('[ADMIN CREATE PRODUCT ERROR]', err);
    return res.status(500).json({ error: 'Failed to create product: ' + err.message });
  }
});

// PUT: Edit existing product independently
router.put('/products/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const body = req.body || {};
    const name = body.name !== undefined ? body.name.trim() : existing.name;
    const category = body.category !== undefined ? body.category.trim() : existing.category;
    const brand = body.brand !== undefined ? body.brand.trim() : existing.brand;
    const section = (body.section === 'musical-instruments' || body.section === 'home-audio' || body.section === 'pro-audio')
      ? body.section
      : (existing.section || 'pro-audio');

    const mrp = body.mrp !== undefined ? parseFloat(body.mrp) : Number(existing.original_price);
    const sellingPrice = body.sellingPrice !== undefined ? parseFloat(body.sellingPrice) : Number(existing.price);

    if (sellingPrice > mrp) {
      return res.status(400).json({ error: 'Selling Price (₹' + sellingPrice + ') cannot exceed MRP (₹' + mrp + ').' });
    }

    const stock = body.stock !== undefined ? parseInt(body.stock, 10) : Number(existing.stock);
    const inStock = stock === 0 ? 0 : (body.inStock !== undefined ? (body.inStock ? 1 : 0) : existing.in_stock);

    let imagesJson = existing.images_json;
    let mainImage = existing.image;
    if (body.images && Array.isArray(body.images)) {
      imagesJson = JSON.stringify(body.images);
      mainImage = body.images[0] || mainImage;
    }

    let videoType = existing.video_type;
    let videoUrl = existing.video_url;
    let youtubeVideoId = existing.youtube_video_id;

    if (body.videoChoice !== undefined) {
      if (body.videoChoice === 'youtube') {
        videoType = 'youtube';
        youtubeVideoId = parseYouTubeId(body.videoInput || '');
        videoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId || body.videoInput}`;
      } else if (body.videoChoice === 'upload') {
        videoType = 'upload';
        videoUrl = body.videoInput || null;
        youtubeVideoId = null;
      } else if (body.videoChoice === 'none') {
        videoType = null;
        videoUrl = null;
        youtubeVideoId = null;
      }
    }

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE products SET
        name = ?, brand = ?, category = ?, section = ?,
        price = ?, original_price = ?, stock = ?, in_stock = ?,
        image = ?, images_json = ?, video_type = ?, video_url = ?, youtube_video_id = ?,
        description = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      brand,
      category,
      section,
      sellingPrice,
      mrp,
      stock,
      inStock,
      mainImage,
      imagesJson,
      videoType,
      videoUrl,
      youtubeVideoId,
      body.description !== undefined ? body.description : existing.description,
      now,
      req.params.id
    );

    syncMasterFiles();

    return res.json({ success: true, message: 'Product updated successfully.' });
  } catch (err) {
    console.error('[ADMIN UPDATE PRODUCT ERROR]', err);
    return res.status(500).json({ error: 'Failed to update product: ' + err.message });
  }
});

// DELETE: Delete product
router.delete('/products/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id, name FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    syncMasterFiles();
    console.log(`[ADMIN] Deleted product: ${existing.name} (${req.params.id})`);
    return res.json({ success: true, message: `Product "${existing.name}" deleted successfully.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete product.' });
  }
});

// -------------------------------------------------------------
// 4. OFFERS & BLANKET DISCOUNTS
// -------------------------------------------------------------
router.get('/offers', (req, res) => {
  try {
    const offers = db.prepare('SELECT * FROM offers ORDER BY created_at DESC').all();
    return res.json({ success: true, offers });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch offers.' });
  }
});

router.post('/offers', (req, res) => {
  try {
    const { title, targetType, targetId, discountPercent, startDate, endDate } = req.body || {};

    if (!title || !title.trim()) return res.status(400).json({ error: 'Offer title is required.' });
    if (!targetType || !['category', 'product'].includes(targetType)) {
      return res.status(400).json({ error: 'Target type must be "category" or "product".' });
    }
    if (!targetId || !targetId.trim()) return res.status(400).json({ error: 'Target is required.' });

    const numDiscount = parseFloat(discountPercent);
    if (isNaN(numDiscount) || numDiscount <= 0 || numDiscount > 100) {
      return res.status(400).json({ error: 'Discount percentage must be between 1% and 100%.' });
    }

    const id = `offer_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO offers (id, title, target_type, target_id, discount_percent, start_date, end_date, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      title.trim(),
      targetType,
      targetId.trim(),
      numDiscount,
      startDate || null,
      endDate || null,
      now
    );

    return res.status(201).json({ success: true, message: 'Offer created and applied successfully.', offerId: id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create offer.' });
  }
});

router.patch('/offers/:id/toggle', (req, res) => {
  try {
    const offer = db.prepare('SELECT id, is_active FROM offers WHERE id = ?').get(req.params.id);
    if (!offer) return res.status(404).json({ error: 'Offer not found.' });

    const newStatus = offer.is_active ? 0 : 1;
    db.prepare('UPDATE offers SET is_active = ? WHERE id = ?').run(newStatus, offer.id);

    return res.json({ success: true, isActive: Boolean(newStatus) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to toggle offer.' });
  }
});

router.delete('/offers/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Offer deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete offer.' });
  }
});

// -------------------------------------------------------------
// 5. COUPONS (CART-LEVEL)
// -------------------------------------------------------------
router.get('/coupons', (req, res) => {
  try {
    const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    return res.json({ success: true, coupons });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch coupons.' });
  }
});

router.post('/coupons', (req, res) => {
  try {
    const { code, discountType, discountValue, minCartValue, usageLimit, expiresAt, isActive } = req.body || {};

    if (!code || !code.trim()) return res.status(400).json({ error: 'Coupon code is required.' });
    const cleanCode = code.trim().toUpperCase();

    if (!discountType || !['flat', 'percentage'].includes(discountType)) {
      return res.status(400).json({ error: 'Discount type must be "flat" or "percentage".' });
    }

    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) return res.status(400).json({ error: 'Please enter a valid discount value.' });
    if (discountType === 'percentage' && val > 100) {
      return res.status(400).json({ error: 'Percentage discount cannot exceed 100%.' });
    }

    const minCart = minCartValue !== undefined ? Math.max(0, parseFloat(minCartValue) || 0) : 0;
    const limit = usageLimit ? parseInt(usageLimit, 10) : null;
    const id = `cpn_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM coupons WHERE code = ? COLLATE NOCASE').get(cleanCode);
    if (existing) return res.status(400).json({ error: `Coupon code "${cleanCode}" already exists.` });

    db.prepare(`
      INSERT INTO coupons (
        id, code, discount_type, discount_value, min_cart_value, usage_limit, used_count, expires_at, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      cleanCode,
      discountType,
      val,
      minCart,
      limit,
      expiresAt || null,
      isActive !== false ? 1 : 0,
      now
    );

    return res.status(201).json({ success: true, message: `Coupon "${cleanCode}" created successfully.`, couponId: id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create coupon: ' + err.message });
  }
});

router.patch('/coupons/:id', (req, res) => {
  try {
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(req.params.id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });

    const newActive = req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : (coupon.is_active ? 0 : 1);
    db.prepare('UPDATE coupons SET is_active = ? WHERE id = ?').run(newActive, coupon.id);

    return res.json({ success: true, isActive: Boolean(newActive) });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update coupon.' });
  }
});

router.delete('/coupons/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
    return res.json({ success: true, message: 'Coupon deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete coupon.' });
  }
});

// -------------------------------------------------------------
// 6. ORDERS (TWO TABS: CURRENT VS HISTORY)
// -------------------------------------------------------------
router.get('/orders', (req, res) => {
  try {
    const { tab } = req.query || {};
    let query = `
      SELECT 
        o.id, o.user_id, o.order_number, o.total_amount, o.status,
        o.shipping_address, o.payment_method, o.coupon_code, o.discount_amount,
        o.created_at, o.updated_at,
        u.full_name AS customer_name, u.email AS customer_email, u.phone_number AS customer_phone
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `;

    if (tab === 'current') {
      query += " AND o.status IN ('Confirmed', 'Dispatched', 'Pending', 'Shipped')";
    } else if (tab === 'history') {
      query += " AND o.status IN ('Delivered', 'Cancelled', 'Returned')";
    }

    query += ' ORDER BY o.created_at DESC';

    const orders = db.prepare(query).all();

    const itemsQuery = db.prepare('SELECT id, product_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?');

    const formatted = orders.map(ord => {
      const items = itemsQuery.all(ord.id);
      let parsedAddress = {};
      try { 
        parsedAddress = JSON.parse(ord.shipping_address); 
      } catch (e) { 
        parsedAddress = { address: ord.shipping_address }; 
      }

      return {
        id: ord.id,
        orderNumber: ord.order_number,
        customerName: ord.customer_name || (parsedAddress && (parsedAddress.name || parsedAddress.fullName)) || 'Store Customer',
        customerEmail: ord.customer_email || (parsedAddress && parsedAddress.email) || 'customer@audioking.in',
        customerPhone: ord.customer_phone || (parsedAddress && (parsedAddress.phone || parsedAddress.phoneNumber)) || 'N/A',
        shippingAddress: parsedAddress,
        paymentMethod: ord.payment_method || 'Prepaid / Online',
        itemsSummary: items.map(i => `${i.product_name} (x${i.quantity})`).join(', ') || 'Audio Products',
        itemsCount: items.length,
        totalAmount: ord.total_amount,
        couponCode: ord.coupon_code || null,
        discountAmount: ord.discount_amount || 0,
        status: ord.status,
        createdAt: ord.created_at
      };
    });

    return res.json({ success: true, count: formatted.length, orders: formatted });
  } catch (err) {
    console.error('[ADMIN GET ORDERS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

router.get('/orders/:id', (req, res) => {
  try {
    const ord = db.prepare(`
      SELECT 
        o.*,
        u.full_name AS customer_name, u.email AS customer_email, u.phone_number AS customer_phone
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `).get(req.params.id);

    if (!ord) return res.status(404).json({ error: 'Order not found.' });

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id);
    let shippingAddress = {};
    try { shippingAddress = JSON.parse(ord.shipping_address); } catch (e) { shippingAddress = { text: ord.shipping_address }; }

    return res.json({
      success: true,
      order: {
        id: ord.id,
        orderNumber: ord.order_number,
        customerName: ord.customer_name || (shippingAddress && (shippingAddress.name || shippingAddress.fullName)) || 'Store Customer',
        customerEmail: ord.customer_email || (shippingAddress && shippingAddress.email) || 'customer@audioking.in',
        customerPhone: ord.customer_phone || (shippingAddress && (shippingAddress.phone || shippingAddress.phoneNumber)) || 'N/A',
        totalAmount: ord.total_amount,
        couponCode: ord.coupon_code || null,
        discountAmount: ord.discount_amount || 0,
        status: ord.status,
        paymentMethod: ord.payment_method || 'Prepaid / Online',
        shippingAddress,
        createdAt: ord.created_at,
        updatedAt: ord.updated_at,
        items: items.map(i => ({
          id: i.id,
          productId: i.product_id,
          name: i.product_name,
          image: i.product_image || 'assets/images/logo.jpg',
          quantity: i.quantity,
          unitPrice: i.unit_price,
          subtotal: i.subtotal
        }))
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch order details.' });
  }
});

router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const validStatuses = ['Confirmed', 'Dispatched', 'Delivered', 'Cancelled', 'Returned', 'Pending', 'Shipped'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const ord = db.prepare(`
      SELECT o.*, u.full_name, u.email, u.phone_number 
      FROM orders o 
      LEFT JOIN users u ON o.user_id = u.id 
      WHERE o.id = ?
    `).get(req.params.id);

    if (!ord) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, req.params.id);

    // Fetch items for email template
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id);
    let shippingAddress = {};
    try { 
      shippingAddress = JSON.parse(ord.shipping_address); 
    } catch (e) { 
      shippingAddress = { address: ord.shipping_address }; 
    }

    const customerEmail = ord.email || (shippingAddress && shippingAddress.email);
    const customerName = ord.full_name || (shippingAddress && (shippingAddress.name || shippingAddress.fullName)) || 'Musician';

    // Dispatch status-specific email notification
    if (status === 'Confirmed') {
      sendOrderConfirmedEmail({
        email: customerEmail,
        fullName: customerName,
        orderNumber: ord.order_number,
        totalAmount: ord.total_amount,
        items,
        shippingAddress
      }).catch(e => console.error('[ORDER EMAIL ERROR - CONFIRMED]', e));
    } else if (status === 'Dispatched' || status === 'Shipped') {
      sendOrderDispatchedEmail({
        email: customerEmail,
        fullName: customerName,
        orderNumber: ord.order_number,
        totalAmount: ord.total_amount,
        items,
        shippingAddress
      }).catch(e => console.error('[ORDER EMAIL ERROR - DISPATCHED]', e));
    } else if (status === 'Delivered') {
      sendOrderDeliveredEmail({
        email: customerEmail,
        fullName: customerName,
        orderNumber: ord.order_number,
        totalAmount: ord.total_amount,
        items
      }).catch(e => console.error('[ORDER EMAIL ERROR - DELIVERED]', e));
    } else if (status === 'Cancelled') {
      sendOrderCancelledEmail({
        email: customerEmail,
        fullName: customerName,
        orderNumber: ord.order_number
      }).catch(e => console.error('[ORDER EMAIL ERROR - CANCELLED]', e));
    }

    return res.json({ success: true, message: `Order status updated to ${status}.` });
  } catch (err) {
    console.error('[ADMIN UPDATE ORDER STATUS ERROR]', err);
    return res.status(500).json({ error: 'Failed to update order status.' });
  }
});

// -------------------------------------------------------------
// 7. CUSTOMERS & ORDER HISTORY
// -------------------------------------------------------------
router.get('/customers', (req, res) => {
  try {
    const customers = db.prepare(`
      SELECT 
        u.id, u.full_name, u.email, u.phone_number, u.created_at,
        ai.provider AS auth_provider,
        COUNT(o.id) AS orders_count,
        COALESCE(SUM(o.total_amount), 0) AS total_spent
      FROM users u
      LEFT JOIN auth_identities ai ON u.id = ai.user_id
      LEFT JOIN orders o ON u.id = o.user_id AND o.status NOT IN ('Cancelled', 'Returned')
      WHERE u.role != 'admin'
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    const formatted = customers.map(c => ({
      id: c.id,
      name: c.full_name,
      email: c.email,
      phone: c.phone_number || 'N/A',
      provider: c.auth_provider === 'google' ? 'Google Account' : 'Email Account',
      ordersCount: Number(c.orders_count || 0),
      totalSpent: Math.round(Number(c.total_spent || 0)),
      joinedAt: c.created_at
    }));

    return res.json({ success: true, count: formatted.length, customers: formatted });
  } catch (err) {
    console.error('[ADMIN GET CUSTOMERS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch customer list.' });
  }
});

router.get('/customers/:id/orders', (req, res) => {
  try {
    const customer = db.prepare('SELECT id, full_name, email, phone_number FROM users WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const orders = db.prepare(`
      SELECT id, order_number, total_amount, status, payment_method, coupon_code, discount_amount, created_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(customer.id);

    const itemsQuery = db.prepare('SELECT id, product_name, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?');

    const formattedOrders = orders.map(o => ({
      ...o,
      items: itemsQuery.all(o.id)
    }));

    return res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.full_name,
        email: customer.email,
        phone: customer.phone_number || 'N/A'
      },
      orders: formattedOrders
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch customer orders.' });
  }
});
// -------------------------------------------------------------
// 8. PRODUCT VARIANTS (Color, Size, Custom Options)
// -------------------------------------------------------------

/**
 * GET /products/:id/variants — Fetch all variant groups, options, and combinations
 */
router.get('/products/:id/variants', (req, res) => {
  try {
    const productId = req.params.id;
    const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    const groups = db.prepare(`
      SELECT * FROM product_variant_groups WHERE product_id = ? ORDER BY sort_order ASC
    `).all(productId);

    const optionsQuery = db.prepare(`
      SELECT * FROM product_variant_options WHERE group_id = ? ORDER BY sort_order ASC
    `);

    const groupsWithOptions = groups.map(g => ({
      id: g.id,
      name: g.group_name,
      type: g.group_type,
      sortOrder: g.sort_order,
      options: optionsQuery.all(g.id).map(o => ({
        id: o.id,
        label: o.label,
        colorHex: o.color_hex,
        variantImage: o.variant_image,
        sortOrder: o.sort_order
      }))
    }));

    const variants = db.prepare(`
      SELECT * FROM product_variants WHERE product_id = ? ORDER BY id ASC
    `).all(productId);

    const formattedVariants = variants.map(v => ({
      id: v.id,
      skuSuffix: v.sku_suffix,
      optionIds: JSON.parse(v.option_ids || '[]'),
      optionLabels: v.option_labels,
      priceOverride: v.price_override,
      stock: v.stock,
      isActive: Boolean(v.is_active)
    }));

    res.json({
      success: true,
      hasVariants: groups.length > 0,
      groups: groupsWithOptions,
      variants: formattedVariants
    });
  } catch (err) {
    console.error('[ADMIN GET VARIANTS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch variants.' });
  }
});

/**
 * POST /products/:id/variants — Save entire variant structure
 * Body: { groups: [...], variants: [...] }
 */
router.post('/products/:id/variants', (req, res) => {
  try {
    const productId = req.params.id;
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    const { groups = [], variants = [] } = req.body || {};

    // Delete existing variant data for this product (cascade handles options)
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM product_variant_groups WHERE product_id = ?').run(productId);

    const now = new Date().toISOString();
    const oldToNewOptionId = {};

    // Insert groups and options
    const insertGroup = db.prepare(`
      INSERT INTO product_variant_groups (product_id, group_name, group_type, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertOption = db.prepare(`
      INSERT INTO product_variant_options (group_id, label, color_hex, variant_image, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const group of groups) {
      const gResult = insertGroup.run(productId, group.name, group.type || 'text', group.sortOrder || 0, now);
      const newGroupId = Number(gResult.lastInsertRowid);

      for (const opt of (group.options || [])) {
        const oResult = insertOption.run(
          newGroupId,
          opt.label,
          opt.colorHex || null,
          opt.variantImage || null,
          opt.sortOrder || 0
        );
        const newOptId = Number(oResult.lastInsertRowid);
        // Map old temp IDs to new DB IDs
        if (opt.tempId !== undefined) {
          oldToNewOptionId[opt.tempId] = newOptId;
        }
        if (opt.id !== undefined) {
          oldToNewOptionId[opt.id] = newOptId;
        }
      }
    }

    // Insert variant combinations
    const insertVariant = db.prepare(`
      INSERT INTO product_variants (product_id, sku_suffix, option_ids, option_labels, price_override, stock, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalVariantStock = 0;

    for (const v of variants) {
      // Remap option IDs if needed
      const remappedIds = (v.optionIds || []).map(id => oldToNewOptionId[id] || id);
      const stock = Math.max(0, parseInt(v.stock) || 0);
      totalVariantStock += stock;

      insertVariant.run(
        productId,
        v.skuSuffix || null,
        JSON.stringify(remappedIds),
        v.optionLabels || '',
        v.priceOverride != null ? Number(v.priceOverride) : null,
        stock,
        v.isActive !== false ? 1 : 0,
        now
      );
    }

    // Update parent product stock to sum of variant stocks
    if (variants.length > 0) {
      const inStock = totalVariantStock > 0 ? 1 : 0;
      db.prepare('UPDATE products SET stock = ?, in_stock = ?, updated_at = ? WHERE id = ?')
        .run(totalVariantStock, inStock, now, productId);
    }

    res.json({
      success: true,
      message: `Saved ${groups.length} variant group(s) with ${variants.length} combination(s).`,
      totalStock: totalVariantStock
    });
  } catch (err) {
    console.error('[ADMIN SAVE VARIANTS ERROR]', err);
    res.status(500).json({ error: 'Failed to save variants.' });
  }
});

/**
 * DELETE /products/:id/variants — Remove all variants (revert to simple product)
 */
router.delete('/products/:id/variants', (req, res) => {
  try {
    const productId = req.params.id;
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM product_variant_groups WHERE product_id = ?').run(productId);

    res.json({ success: true, message: 'All variants removed. Product reverted to simple mode.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete variants.' });
  }
});

// -------------------------------------------------------------
// 8. HOMEPAGE HERO SLIDES & FEATURED SETTINGS
// -------------------------------------------------------------
router.get('/hero-slides', (req, res) => {
  try {
    const slides = db.prepare('SELECT * FROM hero_slides ORDER BY sort_order ASC, created_at ASC').all();
    return res.json({ success: true, count: slides.length, slides });
  } catch (err) {
    console.error('[ADMIN GET HERO SLIDES ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch hero slides.' });
  }
});

router.post('/hero-slides', (req, res) => {
  try {
    const { eyebrow, title, accent_text, subtitle, image_url, cta_text, cta_link, is_active } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Slide title is required.' });
    }
    if (!image_url || !image_url.trim()) {
      return res.status(400).json({ error: 'Slide image is required.' });
    }

    const cleanImg = image_url.trim().replace(/^\/+/, '');
    const maxOrder = db.prepare('SELECT MAX(sort_order) AS max_o FROM hero_slides').get();
    const sortOrder = (maxOrder && maxOrder.max_o ? maxOrder.max_o : 0) + 1;
    const id = `hero-slide-${Date.now().toString(36)}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO hero_slides (id, eyebrow, title, accent_text, subtitle, image_url, cta_text, cta_link, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      (eyebrow || '').trim(),
      title.trim(),
      (accent_text || '').trim(),
      (subtitle || '').trim(),
      cleanImg,
      (cta_text || 'Explore Gear →').trim(),
      (cta_link || '#catalog').trim(),
      sortOrder,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      nowIso,
      nowIso
    );

    const slide = db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(id);
    return res.status(201).json({ success: true, slide });
  } catch (err) {
    console.error('[ADMIN CREATE HERO SLIDE ERROR]', err);
    return res.status(500).json({ error: 'Failed to create hero slide: ' + err.message });
  }
});

router.put('/hero-slides/reorder', (req, res) => {
  try {
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array required.' });
    }

    const stmt = db.prepare('UPDATE hero_slides SET sort_order = ? WHERE id = ?');
    orderedIds.forEach((id, idx) => {
      stmt.run(idx + 1, id);
    });

    const slides = db.prepare('SELECT * FROM hero_slides ORDER BY sort_order ASC').all();
    return res.json({ success: true, slides });
  } catch (err) {
    console.error('[REORDER HERO SLIDES ERROR]', err);
    return res.status(500).json({ error: 'Failed to reorder hero slides.' });
  }
});

router.put('/hero-slides/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { eyebrow, title, accent_text, subtitle, image_url, cta_text, cta_link, is_active, sort_order } = req.body || {};

    const existing = db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Hero slide not found.' });
    }

    const nowIso = new Date().toISOString();
    const cleanImg = image_url ? image_url.trim().replace(/^\/+/, '') : existing.image_url;

    db.prepare(`
      UPDATE hero_slides SET
        eyebrow = ?,
        title = ?,
        accent_text = ?,
        subtitle = ?,
        image_url = ?,
        cta_text = ?,
        cta_link = ?,
        sort_order = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      eyebrow !== undefined ? (eyebrow || '').trim() : existing.eyebrow,
      title !== undefined ? title.trim() : existing.title,
      accent_text !== undefined ? (accent_text || '').trim() : existing.accent_text,
      subtitle !== undefined ? (subtitle || '').trim() : existing.subtitle,
      cleanImg,
      cta_text !== undefined ? (cta_text || '').trim() : existing.cta_text,
      cta_link !== undefined ? (cta_link || '').trim() : existing.cta_link,
      sort_order !== undefined ? Number(sort_order) : existing.sort_order,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      nowIso,
      id
    );

    const slide = db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(id);
    return res.json({ success: true, slide });
  } catch (err) {
    console.error('[ADMIN UPDATE HERO SLIDE ERROR]', err);
    return res.status(500).json({ error: 'Failed to update hero slide: ' + err.message });
  }
});

router.delete('/hero-slides/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM hero_slides WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Hero slide not found.' });
    }

    db.prepare('DELETE FROM hero_slides WHERE id = ?').run(id);
    return res.json({ success: true, message: 'Hero slide removed.' });
  } catch (err) {
    console.error('[ADMIN DELETE HERO SLIDE ERROR]', err);
    return res.status(500).json({ error: 'Failed to delete hero slide.' });
  }
});

// FEATURED PRODUCTS SETTINGS (Pinned/Locked Products)
router.get('/featured-settings', (req, res) => {
  try {
    const row = db.prepare("SELECT value_json FROM featured_settings WHERE key = 'locked_product_ids'").get();
    let lockedProductIds = [];
    if (row && row.value_json) {
      try { lockedProductIds = JSON.parse(row.value_json); } catch (e) {}
    }
    return res.json({ success: true, lockedProductIds });
  } catch (err) {
    console.error('[ADMIN GET FEATURED SETTINGS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch featured settings.' });
  }
});

router.put('/featured-settings', (req, res) => {
  try {
    const { lockedProductIds } = req.body || {};
    if (!Array.isArray(lockedProductIds)) {
      return res.status(400).json({ error: 'lockedProductIds must be an array of product IDs.' });
    }

    const valueJson = JSON.stringify(lockedProductIds);
    db.prepare(`
      INSERT INTO featured_settings (key, value_json, updated_at)
      VALUES ('locked_product_ids', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(valueJson);

    return res.json({ success: true, lockedProductIds });
  } catch (err) {
    console.error('[ADMIN SAVE FEATURED SETTINGS ERROR]', err);
    return res.status(500).json({ error: 'Failed to save featured settings.' });
  }
});

module.exports = router;
