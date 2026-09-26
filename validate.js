/**
 * AudioKing Standalone Repeatable Catalog Validation Script
 * Run anytime with: node validate.js
 */
import { AUDIOKING_PRODUCTS } from './js/data/products.js';

console.log('AudioKing Catalog Validation');
console.log('────────────────────────────');

const totalProducts = AUDIOKING_PRODUCTS.length;
const withPrices = AUDIOKING_PRODUCTS.filter(p => typeof p.price === 'number' && p.price > 0).length;
const withCategories = AUDIOKING_PRODUCTS.filter(p => typeof p.category === 'string' && p.category.trim().length > 0).length;
const withBrands = AUDIOKING_PRODUCTS.filter(p => typeof p.brand === 'string' && p.brand.trim().length > 0).length;
const withImages = AUDIOKING_PRODUCTS.filter(p => typeof p.image === 'string' && p.image.trim().length > 0).length;

const ids = new Set();
let duplicates = 0;
let invalidProducts = 0;

for (const p of AUDIOKING_PRODUCTS) {
  if (!p.id || !p.name || !p.brand || !p.category || typeof p.price !== 'number' || p.price <= 0) {
    invalidProducts++;
  }
  if (ids.has(p.id)) {
    duplicates++;
  } else {
    ids.add(p.id);
  }
}

console.log(`Products loaded: ${totalProducts}`);
console.log(`Products with prices: ${withPrices}`);
console.log(`Products with categories: ${withCategories}`);
console.log(`Products with brands: ${withBrands}`);
console.log(`Products with images: ${withImages}`);
console.log(`Duplicate IDs: ${duplicates}`);
console.log(`Invalid products: ${invalidProducts}`);
console.log('────────────────────────────');

const isPassing = (
  totalProducts > 0 &&
  withPrices === totalProducts &&
  withCategories === totalProducts &&
  withBrands === totalProducts &&
  duplicates === 0 &&
  invalidProducts === 0
);

console.log(`STATUS: ${isPassing ? 'PASS' : 'FAIL'}`);

if (!isPassing) {
  process.exit(1);
}
