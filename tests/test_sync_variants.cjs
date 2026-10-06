const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const REAL_DB = path.join(__dirname, '..', 'server', 'data', 'audioking.db');
const COPY_DB = path.join(__dirname, '..', 'server', 'data', 'audioking_sync_test.db');

fs.copyFileSync(REAL_DB, COPY_DB);
console.log('Created copy of DB at:', COPY_DB);

function syncVariantPricesToProducts(db) {
  // Find all products that have variants
  const prodsWithVariants = db.prepare(`
    SELECT DISTINCT product_id FROM product_variants
  `).all();

  console.log(`Found ${prodsWithVariants.length} product(s) with variants.`);

  let updatedCount = 0;
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
      updatedCount++;
      console.log(`Synced product [${product_id}]: price=${newPrice}, original_price=${newOriginalPrice}, badge=${newBadge}`);
    }
  }

  return updatedCount;
}

try {
  const dbCopy = new DatabaseSync(COPY_DB);
  console.log('\n--- FIRST SYNC RUN ON DB COPY ---');
  const count1 = syncVariantPricesToProducts(dbCopy);
  console.log(`First run updated: ${count1} product(s)`);

  console.log('\n--- SECOND SYNC RUN ON DB COPY (IDEMPOTENCY TEST) ---');
  const count2 = syncVariantPricesToProducts(dbCopy);
  console.log(`Second run updated: ${count2} product(s) (Expected 0)`);

  if (count2 !== 0) {
    throw new Error('Sync is not idempotent! Second run updated records.');
  }

  dbCopy.close();
  console.log('✓ PASS: Idempotent variant price sync verified on copy DB.');
} finally {
  if (fs.existsSync(COPY_DB)) {
    fs.unlinkSync(COPY_DB);
    console.log('Cleaned up copy DB.');
  }
}
