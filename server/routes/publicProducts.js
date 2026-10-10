/**
 * AudioKing Public Products API
 * Dynamically serves catalog products from SQLite database.
 * Computes real-time active blanket category/product offers and dynamic discount badges.
 */

const express = require('express');
const { db } = require('../db');

const router = express.Router();

/**
 * Helper to fetch all currently active offers
 */
function getActiveOffers() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const offers = db.prepare(`
    SELECT id, title, target_type, target_id, discount_percent, start_date, end_date, is_active
    FROM offers
    WHERE is_active = 1
  `).all();

  return offers.filter(o => {
    if (o.start_date && o.start_date > today) return false;
    if (o.end_date && o.end_date < today) return false;
    return true;
  });
}

/**
 * Format SQLite product row to match standard AudioKing product schema
 */
function formatProduct(row, activeOffers = []) {
  const cleanImgPath = (src) => {
    if (!src || typeof src !== 'string') return src;
    if (src.startsWith('/uploads/')) return src.slice(1);
    if (src.startsWith('/assets/')) return src.slice(1);
    return src;
  };

  let images = [];
  try {
    images = (JSON.parse(row.images_json || '[]')).map(cleanImgPath);
  } catch (e) {
    images = [];
  }
  if (!images.length && row.image) images = [cleanImgPath(row.image)];
  const mainImage = cleanImgPath(row.image) || images[0] || 'assets/images/placeholder.svg';

  let specs = [];
  try {
    specs = JSON.parse(row.specs_json || '[]');
  } catch (e) {
    specs = [];
  }

  let deepSpecs = [];
  try {
    deepSpecs = JSON.parse(row.deep_specs_json || '[]');
  } catch (e) {
    deepSpecs = [];
  }

  const originalPrice = Number(row.original_price) || Number(row.price) || 0;
  let sellingPrice = Number(row.price) || originalPrice;

  // Check applicable blanket offers (category-level or product-level)
  let activeOfferTitle = null;
  let maxOfferDiscount = 0;

  for (const offer of activeOffers) {
    let matches = false;
    if (offer.target_type === 'category' && offer.target_id.toLowerCase() === (row.category || '').toLowerCase()) {
      matches = true;
    } else if (offer.target_type === 'product' && offer.target_id === row.id) {
      matches = true;
    }

    if (matches && offer.discount_percent > maxOfferDiscount) {
      maxOfferDiscount = offer.discount_percent;
      activeOfferTitle = offer.title;
    }
  }

  if (maxOfferDiscount > 0) {
    const offerPrice = Math.round(originalPrice * (1 - maxOfferDiscount / 100));
    // Apply offer price if lower than current selling price
    if (offerPrice < sellingPrice) {
      sellingPrice = offerPrice;
    }
  }

  // Auto-calculated discount percentage
  const discountPercent = originalPrice > sellingPrice 
    ? Math.round(((originalPrice - sellingPrice) / originalPrice) * 100) 
    : 0;

    let youtubeVideos = [];
    try {
      youtubeVideos = JSON.parse(row.youtube_videos_json || '[]');
    } catch (e) {
      youtubeVideos = [];
    }
    if (!youtubeVideos.length && row.youtube_video_id) {
      youtubeVideos = [{
        id: row.youtube_video_id,
        url: row.video_url || `https://www.youtube.com/watch?v=${row.youtube_video_id}`
      }];
    }

    return {
      id: row.id,
      name: row.name,
      shortName: row.short_name || row.name,
      brand: row.brand,
      category: row.category,
      subcategory: row.subcategory || '',
      price: sellingPrice,
      originalPrice: originalPrice,
      discountPercent,
      activeOfferTitle,
      offerDiscount: maxOfferDiscount,
      hasOffer: Boolean(activeOfferTitle || maxOfferDiscount > 0 || (originalPrice > sellingPrice && originalPrice > 0)),
      stock: Number(row.stock ?? 10),
      inStock: Boolean((row.in_stock === 1 || row.stock_status === 'instock') && row.in_stock !== 2 && row.stock_status !== 'preorder' && !(row.badge && row.badge.toLowerCase().includes('pre-order')) && row.stock > 0),
      isOutOfStock: Boolean(row.in_stock !== 2 && row.stock_status !== 'preorder' && !(row.badge && row.badge.toLowerCase().includes('pre-order')) && (row.in_stock === 0 || row.stock === 0 || row.stock_status === 'outofstock')),
      isPreOrder: Boolean(row.in_stock === 2 || row.stock_status === 'preorder' || (row.badge && row.badge.toLowerCase().includes('pre-order'))),
      stockStatus: (row.in_stock === 2 || row.stock_status === 'preorder' || (row.badge && row.badge.toLowerCase().includes('pre-order'))) ? 'preorder' : ((row.in_stock === 0 || row.stock === 0 || row.stock_status === 'outofstock') ? 'outofstock' : 'instock'),
      rating: Number(row.rating || 5.0),
      reviewCount: Number(row.review_count || 0),
      badge: (row.in_stock === 2 || row.stock_status === 'preorder' || (row.badge && row.badge.toLowerCase().includes('pre-order'))) ? 'Pre-Order' : (activeOfferTitle ? `${maxOfferDiscount}% OFF · ${activeOfferTitle}` : (row.badge || (discountPercent > 0 ? `${discountPercent}% OFF` : ''))),
      sku: row.sku || `AK-${row.id.toUpperCase()}`,
      description: row.description || '',
      image: mainImage,
      images: images,
      videoType: row.video_type || (youtubeVideos.length ? 'youtube' : null),
      videoUrl: row.video_url || (youtubeVideos[0]?.url || null),
      youtubeVideoId: row.youtube_video_id || (youtubeVideos[0]?.id || null),
      youtubeVideos: youtubeVideos,
      specs: specs,
      deepSpecs: deepSpecs,
      isFeatured: Boolean(row.is_featured),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
}

/**
 * Helper to attach variant groups, options, and combinations to a list of formatted products
 */
function attachVariantsToProducts(products) {
  if (!products || !products.length) return products;

  const productIds = products.map(p => p.id);
  const placeholders = productIds.map(() => '?').join(',');

  const allGroups = db.prepare(`
    SELECT * FROM product_variant_groups 
    WHERE product_id IN (${placeholders}) 
    ORDER BY sort_order ASC
  `).all(...productIds);

  if (!allGroups.length) {
    products.forEach(p => {
      p.hasVariants = false;
      p.variantGroups = [];
      p.variants = [];
    });
    return products;
  }

  const groupIds = allGroups.map(g => g.id);
  const groupPlaceholders = groupIds.map(() => '?').join(',');

  const allOptions = db.prepare(`
    SELECT * FROM product_variant_options 
    WHERE group_id IN (${groupPlaceholders}) 
    ORDER BY sort_order ASC
  `).all(...groupIds);

  const allVariants = db.prepare(`
    SELECT * FROM product_variants 
    WHERE product_id IN (${placeholders}) AND is_active = 1 
    ORDER BY id ASC
  `).all(...productIds);

  const cleanImgPath = (src) => {
    if (!src || typeof src !== 'string') return src;
    if (src.startsWith('/uploads/')) return src.slice(1);
    if (src.startsWith('/assets/')) return src.slice(1);
    return src;
  };

  const optionsByGroup = {};
  for (const opt of allOptions) {
    if (!optionsByGroup[opt.group_id]) optionsByGroup[opt.group_id] = [];
    optionsByGroup[opt.group_id].push({
      id: opt.id,
      label: opt.label,
      colorHex: opt.color_hex,
      variantImage: cleanImgPath(opt.variant_image)
    });
  }

  const groupsByProduct = {};
  for (const g of allGroups) {
    if (!groupsByProduct[g.product_id]) groupsByProduct[g.product_id] = [];
    groupsByProduct[g.product_id].push({
      id: g.id,
      name: g.group_name,
      type: g.group_type,
      options: optionsByGroup[g.id] || []
    });
  }

  const variantsByProduct = {};
  for (const v of allVariants) {
    if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
    let optionIds = [];
    try {
      optionIds = JSON.parse(v.option_ids || '[]');
    } catch (e) {
      optionIds = [];
    }
    variantsByProduct[v.product_id].push({
      id: v.id,
      skuSuffix: v.sku_suffix,
      optionIds: optionIds,
      optionLabels: v.option_labels,
      mrp: v.mrp != null ? Number(v.mrp) : null,
      sellingPrice: v.selling_price != null ? Number(v.selling_price) : null,
      priceOverride: v.price_override != null ? Number(v.price_override) : null,
      stock: Number(v.stock || 0),
      isActive: Boolean(v.is_active)
    });
  }

  for (const p of products) {
    const pGroups = groupsByProduct[p.id] || [];
    const pVariants = variantsByProduct[p.id] || [];
    if (pGroups.length > 0) {
      p.hasVariants = true;
      p.variantGroups = pGroups;
      p.variants = pVariants;
    } else {
      p.hasVariants = false;
      p.variantGroups = [];
      p.variants = [];
    }
  }

  return products;
}

/**
 * 1. GET ALL PRODUCTS
 * GET /api/products
 */
router.get('/', (req, res) => {
  try {
    const { category, brand, search, stockStatus, availability } = req.query || {};
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category && category !== 'All') {
      query += ' AND category = ? COLLATE NOCASE';
      params.push(category);
    }

    if (brand && brand !== 'All') {
      query += ' AND brand = ? COLLATE NOCASE';
      params.push(brand);
    }

    if (search) {
      query += ' AND (name LIKE ? OR brand LIKE ? OR category LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const st = stockStatus || availability;
    if (st === 'preorder') {
      query += " AND (in_stock = 2 OR stock_status = 'preorder' OR (badge IS NOT NULL AND LOWER(badge) LIKE '%pre-order%'))";
    } else if (st === 'in' || st === 'instock') {
      query += " AND (in_stock = 1 OR stock_status = 'instock') AND stock > 0 AND in_stock != 2 AND (stock_status IS NULL OR stock_status != 'preorder') AND (badge IS NULL OR LOWER(badge) NOT LIKE '%pre-order%')";
    } else if (st === 'out' || st === 'outofstock') {
      query += " AND (in_stock = 0 OR stock <= 0 OR stock_status = 'outofstock') AND in_stock != 2 AND (stock_status IS NULL OR stock_status != 'preorder')";
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.prepare(query).all(...params);
    const activeOffers = getActiveOffers();
    const products = rows.map(r => formatProduct(r, activeOffers));
    attachVariantsToProducts(products);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (err) {
    console.error('[GET PRODUCTS ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve products.' });
  }
});

/**
 * 2A. GET ALL ACTIVE BRANDS (Public Storefront & Navigation)
 * GET /api/products/meta/brands & /api/products/brands
 */
const getPublicBrandsHandler = (req, res) => {
  try {
    // Auto-sync any brand in products table not yet in brands table
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
      SELECT b.id, b.name, b.slug, COUNT(p.id) AS product_count 
      FROM brands b 
      LEFT JOIN products p ON LOWER(TRIM(p.brand)) = LOWER(TRIM(b.name))
      GROUP BY b.id 
      ORDER BY b.name COLLATE NOCASE ASC
    `).all();

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.json({ success: true, count: brands.length, brands });
  } catch (err) {
    console.error('[GET PUBLIC BRANDS ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve brands.' });
  }
};

router.get('/meta/brands', getPublicBrandsHandler);
router.get('/brands', getPublicBrandsHandler);

/**
 * 2B. GET ALL ACTIVE CATEGORIES (Public Storefront & Navigation)
 * GET /api/products/meta/categories & /api/products/categories
 */
const getPublicCategoriesHandler = (req, res) => {
  try {
    // Auto-sync any category in products table not yet in categories table
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
      SELECT c.id, c.name, c.slug, COALESCE(c.section, 'pro-audio') AS section, COUNT(p.id) AS product_count 
      FROM categories c 
      LEFT JOIN products p ON LOWER(TRIM(p.category)) = LOWER(TRIM(c.name))
      GROUP BY c.id 
      ORDER BY c.name COLLATE NOCASE ASC
    `).all();

    return res.json({ success: true, count: categories.length, categories });
  } catch (err) {
    console.error('[GET PUBLIC CATEGORIES ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve categories.' });
  }
};

router.get('/meta/categories', getPublicCategoriesHandler);
router.get('/categories', getPublicCategoriesHandler);

/**
 * GET HERO SLIDES (Active Homepage Slideshow)
 * GET /api/products/hero-slides
 */
router.get('/hero-slides', (req, res) => {
  try {
    const slides = db.prepare('SELECT * FROM hero_slides WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC').all();
    return res.json({ success: true, count: slides.length, slides });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve hero slides.' });
  }
});

/**
 * GET FEATURED SETTINGS (Pinned/Locked Featured Products)
 * GET /api/products/featured-settings
 */
router.get('/featured-settings', (req, res) => {
  try {
    const row = db.prepare("SELECT value_json FROM featured_settings WHERE key = 'locked_product_ids'").get();
    let lockedProductIds = [];
    if (row && row.value_json) {
      try { lockedProductIds = JSON.parse(row.value_json); } catch (e) {}
    }
    return res.json({ success: true, lockedProductIds });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve featured settings.' });
  }
});

/**
 * 3. GET SINGLE PRODUCT DETAIL
 * GET /api/products/:id
 */
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const activeOffers = getActiveOffers();
    const product = formatProduct(row, activeOffers);
    attachVariantsToProducts([product]);

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.json({
      success: true,
      product
    });
  } catch (err) {
    console.error('[GET SINGLE PRODUCT ERROR]', err);
    return res.status(500).json({ error: 'Failed to retrieve product details.' });
  }
});

module.exports = router;
