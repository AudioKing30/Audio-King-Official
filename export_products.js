/**
 * AudioKing Product Catalog Exporter
 * Exports all 286 products from SQLite database into js/data/products.js
 * and server/data/products_master.json
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./server/db');

function exportProducts() {
  const rows = db.prepare('SELECT * FROM products ORDER BY created_at ASC').all();
  console.log(`[EXPORT] Read ${rows.length} products from SQLite database.`);

  const products = rows.map(p => {
    let images = [];
    try {
      images = JSON.parse(p.images_json || '[]');
    } catch (e) {
      images = p.image ? [p.image] : [];
    }
    if (!images.length && p.image) images = [p.image];

    let specs = [];
    try {
      specs = JSON.parse(p.specs_json || '[]');
    } catch (e) {}

    let deepSpecs = [];
    try {
      deepSpecs = JSON.parse(p.deep_specs_json || '[]');
    } catch (e) {}

    return {
      id: p.id,
      name: p.name,
      shortName: p.short_name || p.name,
      brand: p.brand,
      category: p.category,
      subcategory: p.subcategory || '',
      price: Number(p.price),
      originalPrice: Number(p.original_price || p.price),
      rating: Number(p.rating || 5.0),
      reviewCount: Number(p.review_count || 0),
      image: p.image || (images[0] || 'assets/images/logo.jpg'),
      images: images,
      isFeatured: Boolean(p.is_featured),
      badge: p.badge || '',
      inStock: Boolean(p.in_stock),
      stock: Number(p.stock ?? 10),
      sku: p.sku || `AK-${p.id.toUpperCase()}`,
      description: p.description || '',
      specs: specs,
      deepSpecs: deepSpecs
    };
  });

  // 1. Write server/data/products_master.json
  const jsonPath = path.join(__dirname, 'server', 'data', 'products_master.json');
  fs.writeFileSync(jsonPath, JSON.stringify(products, null, 2), 'utf8');
  console.log(`[EXPORT] Wrote ${products.length} products to ${jsonPath}`);

  // 2. Write js/data/products.js
  const jsContent = `/**
 * AudioKing Master Product Catalog
 * Auto-generated from database: ${products.length} Products
 */

export const AUDIOKING_PRODUCTS = ${JSON.stringify(products, null, 2)};

export const FEATURED_PRODUCTS = AUDIOKING_PRODUCTS.filter(p => p.isFeatured);
`;

  const jsPath = path.join(__dirname, 'js', 'data', 'products.js');
  fs.writeFileSync(jsPath, jsContent, 'utf8');
  console.log(`[EXPORT] Wrote ${products.length} products to ${jsPath}`);
}

exportProducts();
