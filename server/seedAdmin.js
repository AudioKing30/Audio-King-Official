/**
 * AudioKing Admin & Catalog Database Seeder
 * Seeds:
 * 1. Administrator Account Seeding
 * 2. SQLite Categories & Brands tables
 * 3. SQLite Products table from current catalog (151 products)
 */

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { db } = require('./db');

async function seedAdminAndCatalog() {
  console.log('[SEED] Running Admin & Catalog Seeder...');
  const now = new Date().toISOString();

  // 1. Seed Initial Admin Accounts (admin@audioking.in & audioking30@gmail.com)
  const defaultAdminAccounts = [
    {
      id: 'usr_admin_initial',
      name: process.env.ADMIN_NAME || 'AudioKing Administrator',
      displayName: 'Admin',
      title: 'Store Owner & Audio Specialist',
      email: (process.env.ADMIN_EMAIL || 'admin@audioking.in').toLowerCase().trim(),
      password: process.env.ADMIN_PASSWORD || 'Lovemytele@321'
    },
    {
      id: 'usr_admin_audioking30',
      name: 'AudioKing Store Owner',
      displayName: 'AudioKing30',
      title: 'Founder & Pro Audio Specialist',
      email: 'audioking30@gmail.com',
      password: process.env.ADMIN_PASSWORD || 'Lovemytele@321'
    }
  ];

  for (const acc of defaultAdminAccounts) {
    const existing = db.prepare('SELECT id, email, role, password_hash FROM users WHERE email = ?').get(acc.email);
    if (!existing) {
      const salt = bcrypt.genSaltSync(12);
      const passwordHash = bcrypt.hashSync(acc.password, salt);
      db.prepare(`
        INSERT INTO users (
          id, full_name, display_name, title, email, role,
          auth_provider, email_verified, phone_verified, password_hash,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'admin', 'email', 1, 1, ?, ?, ?)
      `).run(acc.id, acc.name, acc.displayName, acc.title, acc.email, passwordHash, now, now);
      console.log(`[SEED] Admin account seeded: ${acc.email}`);
    } else {
      // Ensure existing admin email has admin role
      db.prepare("UPDATE users SET role = 'admin', email_verified = 1 WHERE email = ?").run(acc.email);
      // If no password hash, set default
      if (!existing.password_hash) {
        const salt = bcrypt.genSaltSync(12);
        const passwordHash = bcrypt.hashSync(acc.password, salt);
        db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(passwordHash, acc.email);
      }
      console.log(`[SEED] Admin account verified & ensured role=admin: ${acc.email}`);
    }
  }

  // 2. Seed Categories & Brands
  try {
    const catModule = await import('../js/data/categories.js');
    const categories = catModule.QUICK_CATEGORIES || [];
    const catInsert = db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, slug, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const cat of categories) {
      const slug = cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      catInsert.run(`cat_${slug}`, cat.name, slug, now);
    }
  } catch (err) {
    console.warn('[SEED] Could not load categories.js for seeding:', err.message);
  }

  try {
    const brandModule = await import('../js/data/brands.js');
    const brands = brandModule.AUDIOKING_BRANDS || [];
    const brandInsert = db.prepare(`
      INSERT OR IGNORE INTO brands (id, name, slug, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const brand of brands) {
      brandInsert.run(brand.id || `brand_${brand.slug}`, brand.name, brand.slug, now);
    }
  } catch (err) {
    console.warn('[SEED] Could not load brands.js for seeding:', err.message);
  }

  // 3. Seed Products into SQLite if empty or incomplete
  let products = [];
  try {
    const jsonPath = path.join(__dirname, 'data', 'products_master.json');
    if (fs.existsSync(jsonPath)) {
      products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }
  } catch (e) {}

  if (!products.length) {
    try {
      const prodModule = await import('../js/data/products.js');
      products = prodModule.AUDIOKING_PRODUCTS || [];
    } catch (e) {}
  }

  const prodCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (prodCount < products.length) {
    console.log(`[SEED] Products count in DB (${prodCount}) is less than master catalog (${products.length}). Upserting all products...`);
    try {
      const upsertProd = db.prepare(`
        INSERT INTO products (
          id, name, short_name, brand, category, subcategory,
          price, original_price, stock, in_stock, rating, review_count,
          badge, sku, description, image, images_json,
          video_type, video_url, youtube_video_id,
          specs_json, deep_specs_json, is_featured,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          short_name = excluded.short_name,
          brand = excluded.brand,
          category = excluded.category,
          subcategory = excluded.subcategory,
          price = excluded.price,
          original_price = excluded.original_price,
          stock = excluded.stock,
          in_stock = excluded.in_stock,
          rating = excluded.rating,
          review_count = excluded.review_count,
          badge = excluded.badge,
          sku = excluded.sku,
          description = excluded.description,
          image = excluded.image,
          images_json = excluded.images_json,
          video_type = excluded.video_type,
          video_url = excluded.video_url,
          youtube_video_id = excluded.youtube_video_id,
          specs_json = excluded.specs_json,
          deep_specs_json = excluded.deep_specs_json,
          is_featured = excluded.is_featured,
          updated_at = excluded.updated_at
      `);

      for (const p of products) {
        const images = Array.isArray(p.images) && p.images.length > 0 ? p.images : (p.image ? [p.image] : []);
        const mainImage = p.image || (images[0] || 'assets/images/logo.jpg');
        const videoType = p.youtubeVideoId ? 'youtube' : (p.videoFile ? 'upload' : null);
        const videoUrl = p.youtubeVideoId ? `https://www.youtube.com/watch?v=${p.youtubeVideoId}` : (p.videoFile || null);

        upsertProd.run(
          p.id,
          p.name,
          p.shortName || p.name,
          p.brand || 'Pro Audio',
          p.category || 'Pro Audio',
          p.subcategory || '',
          Number(p.price) || 0,
          Number(p.originalPrice || p.price) || 0,
          Number(p.stock ?? 10),
          p.inStock !== false ? 1 : 0,
          Number(p.rating || 5.0),
          Number(p.reviewCount || 0),
          p.badge || '',
          p.sku || `AK-${p.id.toUpperCase()}`,
          p.description || '',
          mainImage,
          JSON.stringify(images),
          videoType,
          videoUrl,
          p.youtubeVideoId || null,
          JSON.stringify(p.specs || []),
          JSON.stringify(p.deepSpecs || []),
          p.isFeatured ? 1 : 0,
          now,
          now
        );
      }

      const newCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
      console.log(`[SEED] Successfully initialized ${newCount} products in SQLite database!`);
    } catch (err) {
      console.error('[SEED ERROR] Failed to seed products:', err);
    }
  } else {
    console.log(`[SEED] Products table already contains ${prodCount} products.`);
  }

  // 4. Seed Welcome Community Coupon (AUDIOKING10)
  try {
    const existingCoupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get('AUDIOKING10');
    if (!existingCoupon) {
      db.prepare(`
        INSERT INTO coupons (
          id, code, discount_type, discount_value, min_cart_value,
          usage_limit, used_count, per_user_limit, expires_at,
          is_active, visibility, target_brand, target_category,
          applicable_brand, applicable_category, created_at, updated_at
        ) VALUES (
          'cpn_audioking10', 'AUDIOKING10', 'percentage', 10, 0,
          NULL, 0, 1, NULL,
          1, 'visible', 'all', 'all',
          'all', 'all', ?, ?
        )
      `).run(now, now);
      console.log('[SEED] Seeded AUDIOKING10 welcome coupon (10% off).');
      try {
        const { syncCouponsMaster } = require('./dataSync');
        syncCouponsMaster(db);
      } catch (_) {}
    } else {
      console.log('[SEED] AUDIOKING10 coupon already exists.');
    }
  } catch (err) {
    console.warn('[SEED] Could not seed AUDIOKING10 coupon:', err.message);
  }

  console.log('[SEED] Seeding completed.');
}

if (require.main === module) {
  seedAdminAndCatalog().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedAdminAndCatalog };
