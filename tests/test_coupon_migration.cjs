const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const origDbPath = path.join(__dirname, '..', 'server', 'data', 'audioking.db');
const copyDbPath = path.join(__dirname, '..', 'server', 'data', 'audioking_copy.db');

console.log('--- STEP 1: Copying database to audioking_copy.db ---');
fs.copyFileSync(origDbPath, copyDbPath);

const db = new DatabaseSync(copyDbPath);

// Count original coupons
const initialCoupons = db.prepare('SELECT * FROM coupons').all();
console.log(`Original coupons count: ${initialCoupons.length}`);

// Migration function simulating server/db.js
function runMigration(d) {
  const couponColumns = d.prepare("PRAGMA table_info(coupons)").all();
  const couponColNames = couponColumns.map(c => c.name);
  if (!couponColNames.includes('visibility')) {
    d.exec("ALTER TABLE coupons ADD COLUMN visibility TEXT NOT NULL DEFAULT 'visible';");
    console.log('Added visibility column to coupons table.');
  } else {
    console.log('visibility column already exists.');
  }

  // Backfill if null
  d.prepare("UPDATE coupons SET visibility = 'visible' WHERE visibility IS NULL OR visibility = ''").run();
}

console.log('\n--- STEP 2: Running migration (Run 1) ---');
runMigration(db);

const afterRun1 = db.prepare('SELECT id, code, visibility FROM coupons').all();
console.log('Coupons after Run 1:');
afterRun1.forEach(c => console.log(`  - [${c.code}] visibility: ${c.visibility}`));

if (afterRun1.length !== initialCoupons.length) {
  console.error('ERROR: Coupon count mismatch after Run 1!');
  process.exit(1);
}
if (afterRun1.some(c => c.visibility !== 'visible')) {
  console.error('ERROR: Non-visible coupon detected after Run 1!');
  process.exit(1);
}

console.log('\n--- STEP 3: Running migration (Run 2 - Idempotence test) ---');
runMigration(db);

const afterRun2 = db.prepare('SELECT id, code, visibility FROM coupons').all();
if (afterRun2.length !== initialCoupons.length) {
  console.error('ERROR: Coupon count mismatch after Run 2!');
  process.exit(1);
}
console.log('Idempotence verified successfully: no errors, no duplicate column errors, count preserved.');

db.close();

// Cleanup copy
if (fs.existsSync(copyDbPath)) {
  fs.unlinkSync(copyDbPath);
  console.log('\nCleaned up audioking_copy.db.');
}

console.log('\nALL DATABASE MIGRATION VERIFICATION CHECKS PASSED!');
