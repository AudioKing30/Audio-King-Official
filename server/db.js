/**
 * AudioKing Persistent Database Engine (SQLite via node:sqlite)
 * Provides ACID-compliant schema, prepared statements, and transactional models.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Ensure data directory exists
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'audioking.db');
const dataDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.resolve(dbPath));

// Enable Foreign Keys & Write-Ahead Logging (WAL) for performance and consistency
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Initialize Database Tables
 */
function initDatabase() {
  db.exec(`
    -- USERS TABLE
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      display_name TEXT,
      title TEXT,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      phone_number TEXT,
      profile_image TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'email',
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    -- VERIFICATION CODES (For Signup OTP & Password Reset)
    CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT NOT NULL COLLATE NOCASE,
      otp_hash TEXT NOT NULL,
      purpose TEXT NOT NULL,
      metadata TEXT,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_verification_lookup ON verification_codes(email, purpose, verified);

    -- SESSIONS TABLE (For Stateful Secure Session Tracking)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- USER SAVED ADDRESSES TABLE
    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag TEXT DEFAULT 'Studio',
      recipient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      street TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pin TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

    -- AUTH IDENTITIES TABLE (For Multi-Provider Linking & Duplicate Account Prevention)
    CREATE TABLE IF NOT EXISTS auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_identities_lookup ON auth_identities(provider, provider_user_id);

    -- ORDERS TABLE (Backed by Real SQLite Database)
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_number TEXT UNIQUE NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Confirmed',
      shipping_address TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

    -- ORDER ITEMS TABLE (Normalized Line Items Per Order)
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT,
      product_name TEXT NOT NULL,
      product_image TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

    -- PERSISTENT CART ITEMS (Database-backed ecommerce cart per customer)
    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);

    -- PERSISTENT WISHLIST ITEMS (Database-backed wishlist per customer)
    CREATE TABLE IF NOT EXISTS wishlist_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_wishlist_items_user ON wishlist_items(user_id);

    -- PRODUCTS TABLE (Live SQLite Catalog)
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT,
      brand TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT,
      price REAL NOT NULL,
      original_price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 10,
      in_stock INTEGER NOT NULL DEFAULT 1,
      rating REAL DEFAULT 5.0,
      review_count INTEGER DEFAULT 0,
      badge TEXT,
      sku TEXT,
      description TEXT,
      image TEXT,
      images_json TEXT NOT NULL DEFAULT '[]',
      video_type TEXT,
      video_url TEXT,
      youtube_video_id TEXT,
      specs_json TEXT DEFAULT '[]',
      deep_specs_json TEXT DEFAULT '[]',
      is_featured INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);

    -- CATEGORIES TABLE
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      slug TEXT,
      created_at TEXT NOT NULL
    );

    -- BRANDS TABLE
    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      slug TEXT,
      created_at TEXT NOT NULL
    );

    -- OFFERS / BLANKET DISCOUNTS TABLE
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      target_type TEXT NOT NULL, -- 'category' | 'product'
      target_id TEXT NOT NULL,
      discount_percent REAL NOT NULL,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- COUPONS TABLE
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL COLLATE NOCASE,
      discount_type TEXT NOT NULL, -- 'flat' | 'percentage'
      discount_value REAL NOT NULL,
      min_cart_value REAL NOT NULL DEFAULT 0,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      per_user_limit INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'visible',
      target_brand TEXT DEFAULT 'all',
      target_category TEXT DEFAULT 'all',
      applicable_brand TEXT DEFAULT 'all',
      applicable_category TEXT DEFAULT 'all',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

    -- COUPON USAGES TABLE (Per-User Redemptions)
    CREATE TABLE IF NOT EXISTS coupon_usages (
      id TEXT PRIMARY KEY,
      coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_coupon_usages_lookup ON coupon_usages(user_id, coupon_id);
    CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);

    -- PAGE VIEWS TABLE (Lightweight Analytics Tracker)
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      product_id TEXT,
      referrer TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      session_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
    CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_product ON page_views(product_id);

    -- PRODUCT VARIANT GROUPS (Color, Size, Custom)
    CREATE TABLE IF NOT EXISTS product_variant_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      group_name TEXT NOT NULL,
      group_type TEXT NOT NULL DEFAULT 'text',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_variant_groups_product ON product_variant_groups(product_id);

    -- PRODUCT VARIANT OPTIONS (Individual values within a group)
    CREATE TABLE IF NOT EXISTS product_variant_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES product_variant_groups(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      color_hex TEXT,
      variant_image TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_variant_options_group ON product_variant_options(group_id);

    -- PRODUCT VARIANTS (Combination matrix with per-variant stock)
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku_suffix TEXT,
      option_ids TEXT NOT NULL DEFAULT '[]',
      option_labels TEXT NOT NULL DEFAULT '',
      mrp REAL,
      selling_price REAL,
      price_override REAL,
      stock INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

    -- HERO SLIDES TABLE (Customizable Homepage Hero Slideshow)
    CREATE TABLE IF NOT EXISTS hero_slides (
      id TEXT PRIMARY KEY,
      eyebrow TEXT,
      title TEXT NOT NULL,
      accent_text TEXT,
      subtitle TEXT,
      image_url TEXT NOT NULL,
      cta_text TEXT,
      cta_link TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hero_slides_order ON hero_slides(sort_order ASC);

    -- FEATURED PRODUCTS SETTINGS (Pinned/Locked products)
    CREATE TABLE IF NOT EXISTS featured_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe schema migrations for existing database columns
  try {
    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    const userColNames = userColumns.map(c => c.name);
    if (!userColNames.includes('role')) {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';");
    }
    if (!userColNames.includes('custom_profile_image')) {
      db.exec('ALTER TABLE users ADD COLUMN custom_profile_image TEXT;');
    }
    if (!userColNames.includes('provider_profile_image')) {
      db.exec('ALTER TABLE users ADD COLUMN provider_profile_image TEXT;');
    }

    const orderColumns = db.prepare("PRAGMA table_info(orders)").all();
    const orderColNames = orderColumns.map(c => c.name);
    if (!orderColNames.includes('coupon_code')) {
      db.exec('ALTER TABLE orders ADD COLUMN coupon_code TEXT;');
    }
    if (!orderColNames.includes('discount_amount')) {
      db.exec('ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0;');
    }

    const catColumns = db.prepare("PRAGMA table_info(categories)").all();
    const catColNames = catColumns.map(c => c.name);
    if (!catColNames.includes('section')) {
      db.exec("ALTER TABLE categories ADD COLUMN section TEXT DEFAULT 'pro-audio';");
    }

    const prodColumns = db.prepare("PRAGMA table_info(products)").all();
    const prodColNames = prodColumns.map(c => c.name);
    if (!prodColNames.includes('section')) {
      db.exec("ALTER TABLE products ADD COLUMN section TEXT DEFAULT 'pro-audio';");
    }
    if (!prodColNames.includes('stock_status')) {
      db.exec("ALTER TABLE products ADD COLUMN stock_status TEXT DEFAULT 'instock';");
    }

    const variantColumns = db.prepare("PRAGMA table_info(product_variants)").all();
    const variantColNames = variantColumns.map(c => c.name);
    if (!variantColNames.includes('mrp')) {
      db.exec('ALTER TABLE product_variants ADD COLUMN mrp REAL;');
    }
    if (!variantColNames.includes('selling_price')) {
      db.exec('ALTER TABLE product_variants ADD COLUMN selling_price REAL;');
    }

    // Backfill stock_status based on in_stock and badge
    db.prepare(`
      UPDATE products 
      SET stock_status = CASE 
        WHEN in_stock = 2 OR (badge IS NOT NULL AND LOWER(badge) LIKE '%pre-order%') THEN 'preorder'
        WHEN in_stock = 0 OR stock <= 0 THEN 'outofstock'
        ELSE 'instock'
      END
      WHERE stock_status IS NULL OR stock_status = ''
    `).run();

    const couponColumns = db.prepare("PRAGMA table_info(coupons)").all();
    const couponColNames = couponColumns.map(c => c.name);
    if (!couponColNames.includes('target_brand')) {
      db.exec("ALTER TABLE coupons ADD COLUMN target_brand TEXT DEFAULT 'all';");
    }
    if (!couponColNames.includes('target_category')) {
      db.exec("ALTER TABLE coupons ADD COLUMN target_category TEXT DEFAULT 'all';");
    }
    if (!couponColNames.includes('applicable_brand')) {
      db.exec("ALTER TABLE coupons ADD COLUMN applicable_brand TEXT DEFAULT 'all';");
    }
    if (!couponColNames.includes('applicable_category')) {
      db.exec("ALTER TABLE coupons ADD COLUMN applicable_category TEXT DEFAULT 'all';");
    }
    if (!couponColNames.includes('per_user_limit')) {
      db.exec("ALTER TABLE coupons ADD COLUMN per_user_limit INTEGER NOT NULL DEFAULT 1;");
    }
    if (!couponColNames.includes('updated_at')) {
      db.exec("ALTER TABLE coupons ADD COLUMN updated_at TEXT;");
    }
    if (!couponColNames.includes('visibility')) {
      db.exec("ALTER TABLE coupons ADD COLUMN visibility TEXT NOT NULL DEFAULT 'visible';");
    }
    db.prepare("UPDATE coupons SET visibility = 'visible' WHERE visibility IS NULL OR visibility = ''").run();

    // Backfill existing coupons to 'all' so nothing breaks
    db.prepare(`
      UPDATE coupons 
      SET target_brand = CASE 
            WHEN target_brand IS NOT NULL AND target_brand != '' AND LOWER(target_brand) != 'all' THEN target_brand
            WHEN applicable_brand IS NOT NULL AND applicable_brand != '' AND LOWER(applicable_brand) != 'all' THEN applicable_brand
            ELSE 'all'
          END,
          target_category = CASE 
            WHEN target_category IS NOT NULL AND target_category != '' AND LOWER(target_category) != 'all' THEN target_category
            WHEN applicable_category IS NOT NULL AND applicable_category != '' AND LOWER(applicable_category) != 'all' THEN applicable_category
            ELSE 'all'
          END,
          applicable_brand = CASE 
            WHEN applicable_brand IS NOT NULL AND applicable_brand != '' AND LOWER(applicable_brand) != 'all' THEN applicable_brand
            ELSE 'all'
          END,
          applicable_category = CASE 
            WHEN applicable_category IS NOT NULL AND applicable_category != '' AND LOWER(applicable_category) != 'all' THEN applicable_category
            ELSE 'all'
          END
    `).run();

    // Ensure musical instrument categories default to 'musical-instruments' section
    db.prepare(`
      UPDATE categories SET section = 'musical-instruments'
      WHERE (LOWER(name) LIKE '%keyboard%' 
         OR LOWER(name) LIKE '%piano%' 
         OR LOWER(name) LIKE '%drum%' 
         OR LOWER(name) LIKE '%guitar%' 
         OR LOWER(name) LIKE '%synth%')
        AND (section IS NULL OR section = '' OR section = 'pro-audio')
    `).run();

    // Ensure Arowana Audioglyphs naming consistency and category normalization in database
    db.prepare("UPDATE products SET brand = 'Arowana Audioglyphs' WHERE brand = 'Arowana Audioglyph'").run();
    db.prepare("DELETE FROM brands WHERE LOWER(name) = 'arowana audioglyph'").run();
    db.prepare("UPDATE products SET category = 'Power Supply Cables' WHERE category = 'Power supply cabels'").run();
    db.prepare("DELETE FROM categories WHERE LOWER(name) = 'power supply cabels'").run();

    // Normalize uploaded image paths by stripping leading slashes so they resolve universally
    db.prepare("UPDATE products SET image = SUBSTR(image, 2) WHERE image LIKE '/uploads/%'").run();
    const slashJsonProds = db.prepare("SELECT id, images_json FROM products WHERE images_json LIKE '%/uploads/%'").all();
    for (const p of slashJsonProds) {
      db.prepare('UPDATE products SET images_json = ? WHERE id = ?').run(p.images_json.replace(/\/uploads\//g, 'uploads/'), p.id);
    }

    // Seed default hero slides if table is empty
    const slideCount = db.prepare('SELECT COUNT(*) AS count FROM hero_slides').get();
    if (slideCount && slideCount.count === 0) {
      const nowIso = new Date().toISOString();
      const defaultSlides = [
        {
          id: 'hero-slide-1',
          eyebrow: 'PROFESSIONAL AUDIO',
          title: 'Sound.',
          accent_text: 'Built Better.',
          subtitle: 'Professional gear for studios, creators, and performers. Find the right equipment for every sound.',
          image_url: 'assets/images/hero/hero-slide-1.png',
          cta_text: 'Explore Pro Audio →',
          cta_link: '#catalog',
          sort_order: 1
        },
        {
          id: 'hero-slide-2',
          eyebrow: 'MAKE MUSIC TOGETHER',
          title: 'Your Sound. Your People. Your',
          accent_text: 'Moment.',
          subtitle: 'Everything you need to create, connect, and make every session worth remembering.',
          image_url: 'assets/images/hero/hero-slide-2.png',
          cta_text: 'Explore Musical Instruments →',
          cta_link: '#catalog',
          sort_order: 2
        },
        {
          id: 'hero-slide-3',
          eyebrow: 'STUDIO CREATIVITY',
          title: 'Turn Ideas Into',
          accent_text: 'Sound.',
          subtitle: 'The right tools help your ideas move faster, sound better, and become something worth sharing.',
          image_url: 'assets/images/hero/hero-slide-create.png',
          cta_text: 'Build Your Setup →',
          cta_link: '#catalog',
          sort_order: 3
        }
      ];

      const insertSlide = db.prepare(`
        INSERT INTO hero_slides (id, eyebrow, title, accent_text, subtitle, image_url, cta_text, cta_link, sort_order, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      for (const s of defaultSlides) {
        insertSlide.run(s.id, s.eyebrow, s.title, s.accent_text, s.subtitle, s.image_url, s.cta_text, s.cta_link, s.sort_order, nowIso, nowIso);
      }
    }

    // Seed default featured settings if empty
    const featRow = db.prepare("SELECT key FROM featured_settings WHERE key = 'locked_product_ids'").get();
    if (!featRow) {
      db.prepare("INSERT INTO featured_settings (key, value_json, updated_at) VALUES ('locked_product_ids', '[]', datetime('now'))").run();
    }

    // Idempotent auto-sync: default variant's selling price & MRP to parent product
    const prodsWithVariants = db.prepare('SELECT DISTINCT product_id FROM product_variants').all();
    for (const { product_id } of prodsWithVariants) {
      const firstVariant = db.prepare(`
        SELECT * FROM product_variants
        WHERE product_id = ?
        ORDER BY is_active DESC, id ASC
        LIMIT 1
      `).get(product_id);

      if (!firstVariant) continue;
      const sellingPrice = firstVariant.selling_price ?? firstVariant.price_override;
      const mrp = firstVariant.mrp;
      if (sellingPrice == null && mrp == null) continue;

      const currentProd = db.prepare('SELECT price, original_price, badge FROM products WHERE id = ?').get(product_id);
      if (!currentProd) continue;

      let newPrice = currentProd.price;
      let newOriginalPrice = currentProd.original_price;
      let newBadge = currentProd.badge;
      let needsUpdate = false;

      if (sellingPrice != null && Number(currentProd.price) !== Number(sellingPrice)) {
        newPrice = Number(sellingPrice);
        needsUpdate = true;
      }
      if (mrp != null && Number(currentProd.original_price) !== Number(mrp)) {
        newOriginalPrice = Number(mrp);
        needsUpdate = true;
      }
      if (newOriginalPrice > newPrice && newPrice > 0) {
        const discount = Math.round(((newOriginalPrice - newPrice) / newOriginalPrice) * 100);
        const computedBadge = `${discount}% OFF`;
        if (newBadge !== computedBadge) {
          newBadge = computedBadge;
          needsUpdate = true;
        }
      }
      if (needsUpdate) {
        db.prepare(`
          UPDATE products
          SET price = ?, original_price = ?, badge = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newPrice, newOriginalPrice, newBadge, product_id);
      }
    }
  } catch (e) {
    console.warn('[DB Migration Warning]', e.message);
  }

  // Auto-hydrate persistent master records (customers, orders, coupons)
  try {
    const { hydrateDatabaseFromMaster } = require('./dataSync');
    hydrateDatabaseFromMaster(db);
  } catch (e) {
    console.warn('[HYDRATION WARNING]', e.message);
  }

  console.log(`[DB] Database initialized successfully at: ${path.resolve(dbPath)}`);
}

// Run schema initialization
initDatabase();

module.exports = {
  db,
  initDatabase
};
