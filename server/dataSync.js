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

function exportAllMasterData(db) {
  syncCustomersMaster(db);
  syncOrdersMaster(db);
  syncCouponsMaster(db);
  syncPopularCategoriesMaster(db);
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

    // 4. Hydrate Popular Categories
    const popData = safeReadJson(POPULAR_CATEGORIES_MASTER_PATH, null);
    if (popData && Array.isArray(popData.categories) && popData.categories.length > 0) {
      for (const pc of popData.categories) {
        dynamicInsertOrIgnore(db, 'popular_categories', pc);
      }
    }
  } catch (err) {
    console.error('[HYDRATION ERROR] Failed to hydrate database:', err);
  }
}

module.exports = {
  syncCustomersMaster,
  syncOrdersMaster,
  syncCouponsMaster,
  syncPopularCategoriesMaster,
  exportAllMasterData,
  hydrateDatabaseFromMaster
};
