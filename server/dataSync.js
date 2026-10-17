/**
 * AudioKing Data Persistence & Master JSON Sync Engine
 * Guarantees zero data loss across server restarts, container deployments, and ephemeral filesystems.
 * Automatically mirrors SQLite database tables (customers, orders, coupons, usages) to version-controlled
 * master JSON files and auto-hydrates SQLite upon startup.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, 'data');
const CUSTOMERS_MASTER_PATH = path.join(DATA_DIR, 'customers_master.json');
const ORDERS_MASTER_PATH = path.join(DATA_DIR, 'orders_master.json');
const COUPONS_MASTER_PATH = path.join(DATA_DIR, 'coupons_master.json');
const POPULAR_CATEGORIES_MASTER_PATH = path.join(DATA_DIR, 'popular_categories_master.json');
const POLICIES_MASTER_PATH = path.join(DATA_DIR, 'policies_master.json');
const STORE_TOP6_MASTER_PATH = path.join(DATA_DIR, 'store_top6_master.json');
const SESSIONS_MASTER_PATH = path.join(DATA_DIR, 'sessions_master.json');
const PRODUCTS_MASTER_PATH = path.join(DATA_DIR, 'products_master.json');
const SETTINGS_MASTER_PATH = path.join(DATA_DIR, 'settings_master.json');

/**
 * Safely writes JSON data with atomic temporary file swapping
 */
function safeWriteJson(filePath, data) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempPath = `${filePath}.tmp_${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error(`[DATA SYNC ERROR] Failed writing to ${path.basename(filePath)}:`, err.message);
  }
}

/**
 * Safely reads JSON data
 */
function safeReadJson(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`[DATA SYNC ERROR] Failed reading ${path.basename(filePath)}:`, err.message);
  }
  return fallback;
}

/**
 * Dynamically retrieves table column names
 */
const tableColumnsCache = {};
function getTableColumns(db, tableName) {
  if (tableColumnsCache[tableName]) return tableColumnsCache[tableName];
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
    tableColumnsCache[tableName] = cols;
    return cols;
  } catch (e) {
    return [];
  }
}

/**
 * Dynamically and safely inserts a row into a table using INSERT OR IGNORE,
 * only passing columns that actually exist in the table schema.
 */
function dynamicInsertOrIgnore(db, tableName, row) {
  if (!row || typeof row !== 'object') return { changes: 0 };
  const tableCols = getTableColumns(db, tableName);
  if (!tableCols || tableCols.length === 0) return { changes: 0 };

  const validCols = tableCols.filter(col => row[col] !== undefined);
  if (validCols.length === 0) return { changes: 0 };

  const placeholders = validCols.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${tableName} (${validCols.join(', ')}) VALUES (${placeholders})`;
  const values = validCols.map(col => row[col]);

  try {
    return db.prepare(sql).run(...values);
  } catch (err) {
    console.warn(`[HYDRATION WARN] Insert into ${tableName} failed:`, err.message);
    return { changes: 0 };
  }
}

/**
 * Mirrors all users, auth identities, and addresses to customers_master.json
 */
function syncCustomersMaster(db) {
  try {
    if (!db) return;
    const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
    const identities = db.prepare('SELECT * FROM auth_identities').all();
    const addresses = db.prepare('SELECT * FROM addresses').all();

    const payload = {
      updatedAt: new Date().toISOString(),
      count: users.length,
      users,
      identities,
      addresses
    };
    safeWriteJson(CUSTOMERS_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${users.length} users to customers_master.json`);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncCustomersMaster:', err.message);
  }
}

/**
 * Mirrors all orders and order_items to orders_master.json
 */
function syncOrdersMaster(db) {
  try {
    if (!db) return;
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at ASC').all();
    const orderItems = db.prepare('SELECT * FROM order_items').all();

    const payload = {
      updatedAt: new Date().toISOString(),
      count: orders.length,
      orders,
      orderItems
    };
    safeWriteJson(ORDERS_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${orders.length} orders to orders_master.json`);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncOrdersMaster:', err.message);
  }
}

/**
 * Mirrors all coupons and usages to coupons_master.json
 */
function syncCouponsMaster(db) {
  try {
    if (!db) return;
    const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at ASC').all();
    let usages = [];
    try {
      usages = db.prepare('SELECT * FROM coupon_usages ORDER BY created_at ASC').all();
    } catch (_) {}

    const payload = {
      updatedAt: new Date().toISOString(),
      count: coupons.length,
      coupons,
      usages
    };
    safeWriteJson(COUPONS_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${coupons.length} coupons and ${usages.length} usages to coupons_master.json`);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncCouponsMaster:', err.message);
  }
}

/**
 * Exports all database entities to their respective master JSON files
 */

/**
 * Mirrors popular categories to popular_categories_master.json
 */
function syncPopularCategoriesMaster(db) {
  try {
    if (!db) return;
    const categories = db.prepare('SELECT * FROM popular_categories ORDER BY sort_order ASC').all();
    const payload = {
      updatedAt: new Date().toISOString(),
      count: categories.length,
      categories
    };
    safeWriteJson(POPULAR_CATEGORIES_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${categories.length} popular categories to popular_categories_master.json`);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncPopularCategoriesMaster:', err.message);
  }
}

/**
 * Mirrors all valid unexpired sessions to sessions_master.json
 */
function syncSessionsMaster(db) {
  try {
    if (!db) return;
    const now = Date.now();
    // Persist all active sessions (both admin and customer)
    const sessions = db.prepare('SELECT * FROM sessions WHERE expires_at > ?').all(now);
    const payload = {
      updatedAt: new Date().toISOString(),
      count: sessions.length,
      sessions
    };
    safeWriteJson(SESSIONS_MASTER_PATH, payload);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncSessionsMaster:', err.message);
  }
}

/**
 * Mirrors all catalog products to products_master.json
 */
function syncProductsMaster(db) {
  try {
    if (!db) return;
    const products = db.prepare('SELECT * FROM products ORDER BY id ASC').all();
    const formatted = products.map(p => {
      let images = [];
      try { images = JSON.parse(p.images_json || '[]'); } catch (e) { images = []; }
      let specs = [];
      try { specs = JSON.parse(p.specs_json || '[]'); } catch (e) { specs = []; }
      let deepSpecs = [];
      try { deepSpecs = JSON.parse(p.deep_specs_json || '[]'); } catch (e) { deepSpecs = []; }
      let ytVideos = [];
      try { ytVideos = JSON.parse(p.youtube_videos_json || '[]'); } catch (e) { ytVideos = []; }
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
        inStock: Boolean(p.in_stock === 1 && p.stock > 0),
        isPreOrder: Boolean(p.in_stock === 2 || p.stock_status === 'preorder' || (p.badge && p.badge.toLowerCase().includes('pre-order'))),
        stockStatus: (p.in_stock === 2 || p.stock_status === 'preorder' || (p.badge && p.badge.toLowerCase().includes('pre-order'))) ? 'preorder' : ((p.in_stock === 0 || p.stock === 0) ? 'outofstock' : 'instock'),
        rating: p.rating || 5.0,
        reviewCount: p.review_count || 0,
        badge: (p.in_stock === 2 || p.stock_status === 'preorder') ? 'Pre-Order' : (p.badge || ''),
        sku: p.sku || '',
        description: p.description || '',
        image: p.image || (images[0] || 'assets/images/placeholder.svg'),
        images: images.length ? images : (p.image ? [p.image] : ['assets/images/placeholder.svg']),
        videoType: p.video_type || null,
        videoUrl: p.video_url || null,
        youtubeVideoId: p.youtube_video_id || null,
        youtubeVideos: ytVideos,
        specs: specs,
        deepSpecs: deepSpecs
      };
    });
    safeWriteJson(PRODUCTS_MASTER_PATH, formatted);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncProductsMaster:', err.message);
  }
}

function syncSettingsMaster(db) {
  try {
    if (!db) return;
    const rows = db.prepare('SELECT key, value, updated_at FROM site_settings').all();
    const payload = {
      updatedAt: new Date().toISOString(),
      count: rows.length,
      settings: rows || []
    };
    safeWriteJson(SETTINGS_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${rows.length} site settings to settings_master.json`);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncSettingsMaster:', err.message);
  }
}

function exportAllMasterData(db) {
  syncCustomersMaster(db);
  syncOrdersMaster(db);
  syncCouponsMaster(db);
  syncPopularCategoriesMaster(db);
  syncProductsMaster(db);
  syncSessionsMaster(db);
  syncSettingsMaster(db);
}

/**
 * Auto-hydrates SQLite database from master JSON files on startup if tables are empty or missing records
 */
function hydrateDatabaseFromMaster(db) {
  try {
    if (!db) return;
    console.log('[HYDRATION] Checking persistent master files for auto-restoration...');

    // 1. Hydrate Users & Customers
    const custData = safeReadJson(CUSTOMERS_MASTER_PATH, null);
    if (custData && Array.isArray(custData.users) && custData.users.length > 0) {
      let restoredUsers = 0;
      for (const u of custData.users) {
        const res = dynamicInsertOrIgnore(db, 'users', u);
        if (res && res.changes > 0) restoredUsers++;
      }
      if (restoredUsers > 0) {
        console.log(`[HYDRATION] Successfully restored ${restoredUsers} user accounts from customers_master.json!`);
      }

      // Hydrate Auth Identities
      if (Array.isArray(custData.identities)) {
        for (const iden of custData.identities) {
          dynamicInsertOrIgnore(db, 'auth_identities', iden);
        }
      }

      // Hydrate Addresses
      if (Array.isArray(custData.addresses)) {
        for (const a of custData.addresses) {
          dynamicInsertOrIgnore(db, 'addresses', a);
        }
      }
    }

    // 2. Hydrate Orders & Order Items
    const ordData = safeReadJson(ORDERS_MASTER_PATH, null);
    if (ordData && Array.isArray(ordData.orders) && ordData.orders.length > 0) {
      let restoredOrders = 0;
      for (const o of ordData.orders) {
        const res = dynamicInsertOrIgnore(db, 'orders', o);
        if (res && res.changes > 0) restoredOrders++;
      }
      if (restoredOrders > 0) {
        console.log(`[HYDRATION] Successfully restored ${restoredOrders} customer orders from orders_master.json!`);
      }

      if (Array.isArray(ordData.orderItems)) {
        for (const it of ordData.orderItems) {
          dynamicInsertOrIgnore(db, 'order_items', it);
        }
      }
    }

    // 3. Hydrate Coupons & Usages
    const cpnData = safeReadJson(COUPONS_MASTER_PATH, null);
    if (cpnData && Array.isArray(cpnData.coupons) && cpnData.coupons.length > 0) {
      let restoredCoupons = 0;
      for (const c of cpnData.coupons) {
        const res = dynamicInsertOrIgnore(db, 'coupons', c);
        if (res && res.changes > 0) restoredCoupons++;
      }
      if (restoredCoupons > 0) {
        console.log(`[HYDRATION] Successfully restored ${restoredCoupons} coupons from coupons_master.json!`);
      }

      if (Array.isArray(cpnData.usages)) {
        for (const u of cpnData.usages) {
          dynamicInsertOrIgnore(db, 'coupon_usages', u);
        }
      }
    }

    // 4. Hydrate Popular Categories from master file
    const popData = safeReadJson(POPULAR_CATEGORIES_MASTER_PATH, null);
    if (popData && Array.isArray(popData.categories) && popData.categories.length > 0) {
      const upsertPopCat = db.prepare(`
        INSERT INTO popular_categories (id, category_name, display_name, image_url, size_class, sort_order, created_at, updated_at)
        VALUES (@id, @category_name, @display_name, @image_url, @size_class, @sort_order, @created_at, @updated_at)
        ON CONFLICT(id) DO UPDATE SET
          category_name = excluded.category_name,
          display_name = excluded.display_name,
          image_url = excluded.image_url,
          size_class = excluded.size_class,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
      `);
      for (const pc of popData.categories) {
        upsertPopCat.run({
          id: pc.id,
          category_name: pc.category_name,
          display_name: pc.display_name || pc.category_name,
          image_url: pc.image_url,
          size_class: pc.size_class || null,
          sort_order: pc.sort_order,
          created_at: pc.created_at || new Date().toISOString(),
          updated_at: pc.updated_at || new Date().toISOString()
        });
      }
      console.log(`[HYDRATION] Hydrated ${popData.categories.length} popular categories from popular_categories_master.json`);
    }

    // 5. Hydrate Legal Policies
    const polData = safeReadJson(POLICIES_MASTER_PATH, null);
    if (polData && polData.policies) {
      const pEntries = Object.values(polData.policies);
      for (const pol of pEntries) {
        const row = {
          id: pol.id,
          title: pol.title,
          subtitle: pol.subtitle || 'AudioKing',
          badge: pol.badge || 'Official Policy',
          intro: pol.intro || '',
          sections_json: JSON.stringify(pol.sections || []),
          updated_at: pol.updated_at || new Date().toISOString(),
          updated_by: 'Admin'
        };
        dynamicInsertOrIgnore(db, 'legal_policies', row);
      }
      console.log(`[HYDRATION] Hydrated ${pEntries.length} legal policies from policies_master.json`);
    }

    // 6. Hydrate Store Top 6 Priority Products
    const top6Data = safeReadJson(STORE_TOP6_MASTER_PATH, null);
    if (top6Data && Array.isArray(top6Data.top6ProductIds)) {
      db.prepare(`
        INSERT INTO featured_settings (key, value_json, updated_at)
        VALUES ('store_top6_product_ids', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(top6Data.top6ProductIds));
      console.log(`[HYDRATION] Hydrated ${top6Data.top6ProductIds.length} store top 6 products from store_top6_master.json`);
    }

    // 7. Hydrate Catalog Products from products_master.json
    const prodData = safeReadJson(PRODUCTS_MASTER_PATH, null);
    if (prodData && Array.isArray(prodData) && prodData.length > 0) {
      const existingIds = new Set(db.prepare('SELECT id FROM products').all().map(r => r.id));
      let restoredProds = 0;
      const insertProd = db.prepare(`
        INSERT OR IGNORE INTO products (
          id, name, short_name, brand, category, subcategory, section,
          price, original_price, stock, in_stock, stock_status, rating, review_count,
          badge, sku, description, image, images_json,
          video_type, video_url, youtube_video_id, youtube_videos_json,
          specs_json, deep_specs_json, is_featured,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?
        )
      `);

      const nowIso = new Date().toISOString();
      for (const p of prodData) {
        if (!existingIds.has(p.id)) {
          const images = Array.isArray(p.images) && p.images.length > 0 ? p.images : (p.image ? [p.image] : []);
          const mainImage = p.image || (images[0] || 'assets/images/placeholder.svg');
          insertProd.run(
            p.id,
            p.name,
            p.shortName || p.name,
            p.brand || 'Pro Audio',
            p.category || 'Pro Audio',
            p.subcategory || '',
            p.section || 'pro-audio',
            Number(p.price) || 0,
            Number(p.originalPrice || p.price) || 0,
            Number(p.stock ?? 10),
            p.isPreOrder ? 2 : (p.inStock ? 1 : 0),
            p.stockStatus || (p.isPreOrder ? 'preorder' : (p.inStock ? 'instock' : 'outofstock')),
            Number(p.rating || 5.0),
            Number(p.reviewCount || 0),
            p.badge || (p.isPreOrder ? 'Pre-Order' : ''),
            p.sku || `AK-${p.id.toUpperCase()}`,
            p.description || '',
            mainImage,
            JSON.stringify(images),
            p.videoType || null,
            p.videoUrl || null,
            p.youtubeVideoId || null,
            JSON.stringify(p.youtubeVideos || []),
            JSON.stringify(p.specs || []),
            JSON.stringify(p.deepSpecs || []),
            p.isFeatured ? 1 : 0,
            p.created_at || nowIso,
            p.updated_at || nowIso
          );
          existingIds.add(p.id);
          restoredProds++;
        }
      }
      if (restoredProds > 0) {
        console.log(`[HYDRATION] Successfully restored ${restoredProds} new products from products_master.json into SQLite!`);
      }
    }

    // 8. Hydrate Active Sessions from sessions_master.json
    const sessData = safeReadJson(SESSIONS_MASTER_PATH, null);
    if (sessData && Array.isArray(sessData.sessions) && sessData.sessions.length > 0) {
      const now = Date.now();
      let restoredSess = 0;
      for (const s of sessData.sessions) {
        if (s.expires_at && s.expires_at > now) {
          const res = dynamicInsertOrIgnore(db, 'sessions', s);
          if (res && res.changes > 0) restoredSess++;
        }
      }
      if (restoredSess > 0) {
        console.log(`[HYDRATION] Successfully restored ${restoredSess} active sessions from sessions_master.json!`);
      }
    }

    // 9. Hydrate Site Settings from settings_master.json
    hydrateSettingsFromMaster(db);
  } catch (err) {
    console.error('[HYDRATION ERROR] Failed to hydrate database:', err);
  }
}

function hydrateSettingsFromMaster(db) {
  try {
    if (!db) return;
    const data = safeReadJson(SETTINGS_MASTER_PATH, null);
    if (data && Array.isArray(data.settings) && data.settings.length > 0) {
      for (const s of data.settings) {
        if (!s.key) continue;
        db.prepare(`
          INSERT INTO site_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(s.key, s.value, s.updated_at || new Date().toISOString());
      }
      console.log(`[HYDRATION] Hydrated ${data.settings.length} site settings from settings_master.json`);
    }
  } catch (err) {
    console.error('[HYDRATION ERROR] hydrateSettingsFromMaster:', err.message);
  }
}

/**
 * Mirrors legal policies to policies_master.json
 */
function syncPoliciesMaster(db) {
  try {
    if (!db) return;
    const rows = db.prepare('SELECT * FROM legal_policies').all();
    const policies = {};
    for (const r of rows) {
      let sections = [];
      try { sections = JSON.parse(r.sections_json); } catch (e) {}
      policies[r.id] = {
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        badge: r.badge,
        updated_at: r.updated_at,
        intro: r.intro,
        sections
      };
    }
    const payload = {
      updatedAt: new Date().toISOString(),
      policies
    };
    safeWriteJson(POLICIES_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${rows.length} legal policies to policies_master.json`);

    // Also mirror to storefront js/data/legal.js so code bundles stay strictly updated
    const legalJsPath = path.join(__dirname, '..', 'js', 'data', 'legal.js');
    if (fs.existsSync(legalJsPath) && policies.terms && policies.returns && policies.privacy && policies.shipping) {
      const legalJsContent = `/**
 * AudioKing Legal Policies
 * Authoritative complete policies for Terms & Conditions, Privacy Policy,
 * Shipping & Payment, and Returns & Refunds.
 * Auto-synchronized with Database and Admin Panel.
 * Last Updated: ${new Date().toISOString()}
 */

export const termsPolicy = ${JSON.stringify(policies.terms, null, 2)};

export const returnsPolicy = ${JSON.stringify(policies.returns, null, 2)};

export const privacyPolicy = ${JSON.stringify(policies.privacy, null, 2)};

export const shippingPolicy = ${JSON.stringify(policies.shipping, null, 2)};

export const aboutPolicy = {
  id: 'about',
  title: 'About AudioKing',
  subtitle: 'Official Mumbai Pro Audio & Instruments Destination',
  badge: 'Certified Audio Specialists',
  updated_at: '${policies.terms.updated_at}',
  intro: \`
    <div class="ak-legal-statutory-card" style="background: #F8FAFC; border: 1.5px solid #CBD5E1; border-left: 4px solid var(--ak-orange, #EA580C); border-radius: 8px; padding: 14px 18px; margin-bottom: 20px;">
      <ol style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #1E293B; line-height: 1.8; font-weight: 500;">
        <li>The Corporate Identity Number of the company is <strong style="font-family: monospace; font-size: 14px; color: #0F172A; letter-spacing: 0.5px;">U29100MH2020PTC344745</strong></li>
        <li><strong>GSTIN</strong> - <strong style="font-family: monospace; font-size: 14px; color: #0F172A; letter-spacing: 0.5px;">27AAHCV5628B1ZC</strong></li>
        <li><strong>LEGAL NAME</strong> - <strong style="color: #0F172A;">VASP ADVISORS PVT LTD</strong></li>
        <li><strong>TRADE NAME</strong> - <strong style="color: #0F172A;">VASP ADVISORS PVT LTD</strong></li>
      </ol>
    </div>
    <p>AudioKing is India's premier pro audio retailer and studio equipment specialist. Based in Mumbai, Maharashtra, we provide music producers, sound engineers, broadcasting studios, and touring musicians with 100% genuine gear backed by official manufacturer warranties and expert sound engineering consultancy.</p>
  \`,
  sections: [
    {
      number: 1,
      heading: 'Mumbai Experience Centre & Showroom',
      body: \`
        <p>Located at D-101, Bonanza Industrial Estate, Ashok Chakravarty Road, Kandivali East, Mumbai - 400101, our experience centre offers hands-on listening sessions for studio monitors, vocal booth testing for world-class microphones, and dedicated stages for synthesizers and digital pianos.</p>
      \`
    },
    {
      number: 2,
      heading: 'Authorized Brand Distribution',
      body: \`
        <p>We are authorized dealers for leading international audio brands including ADAM Audio, Focusrite, Nord, Lauten Audio, Universal Audio, Focal Professional, BluGuitar, Audix, Novation, Eikon, Proel, Native Instruments, and more.</p>
      \`
    },
    {
      number: 3,
      heading: 'Direct Specialist Helpline',
      body: \`
        <p>Need acoustic guidance or help building your studio chain? Our audio engineers are available Monday to Saturday, 10:00 AM to 07:00 PM at +91 8928207822 or via email at info@audioking.co.in.</p>
      \`
    }
  ]
};

export const LEGAL_DOCUMENTS = {
  terms: termsPolicy,
  privacy: privacyPolicy,
  shipping: shippingPolicy,
  returns: returnsPolicy,
  cancellation: returnsPolicy,
  warranty: termsPolicy,
  about: aboutPolicy
};
`;
      fs.writeFileSync(legalJsPath, legalJsContent, 'utf8');
      console.log('[DATA SYNC] Mirrored legal policies to js/data/legal.js');
    }
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncPoliciesMaster:', err.message);
  }
}

/**
 * Mirrors store top 6 products to store_top6_master.json
 */
function syncStoreTop6Master(db, customIds = null) {
  try {
    if (!db) return;
    let list = customIds;
    if (!list) {
      const row = db.prepare("SELECT value_json FROM featured_settings WHERE key = 'store_top6_product_ids'").get();
      try { list = row ? JSON.parse(row.value_json) : []; } catch (e) { list = []; }
    }
    const payload = {
      updatedAt: new Date().toISOString(),
      top6ProductIds: list || []
    };
    safeWriteJson(STORE_TOP6_MASTER_PATH, payload);
    console.log(`[DATA SYNC] Mirrored ${(list || []).length} store top 6 products to store_top6_master.json`);
  } catch (err) {
    console.error('[DATA SYNC ERROR] syncStoreTop6Master:', err.message);
  }
}

module.exports = {
  syncCustomersMaster,
  syncOrdersMaster,
  syncCouponsMaster,
  syncPopularCategoriesMaster,
  syncPoliciesMaster,
  syncStoreTop6Master,
  syncSessionsMaster,
  syncProductsMaster,
  syncSettingsMaster,
  hydrateSettingsFromMaster,
  exportAllMasterData,
  hydrateDatabaseFromMaster
};
