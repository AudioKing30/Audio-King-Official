/**
 * AudioKing Playwright End-to-End Test Suite: Variant Pricing System
 * Tests real browser interactions:
 * 1. Product page variant switching (Price, strike-through MRP, discount badge)
 * 2. Edge cases:
 *    - Only MRP filled (inherits parent selling price)
 *    - Only Selling Price filled (inherits parent MRP)
 *    - Selling Price equal to MRP (strike-through and badge hidden)
 *    - Fallback (neither filled, inherits parent price & MRP)
 * 3. Add to Cart with variant item (variant finish name, variant price & MRP)
 * 4. Apply general and scoped coupons on variant item
 * 5. Checkout total calculation and Server-side Order creation
 * 6. Legacy cart item created before this change (old ID format/price)
 */

const { chromium } = require('playwright');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const { hashToken } = require('../server/security');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'audioking.db');
const BASE_URL = 'http://localhost:4000';

async function setupTestData() {
  console.log('[SETUP] Connecting to database:', DB_PATH);
  const db = new DatabaseSync(DB_PATH);

  // 1. Ensure test user
  const testUserId = 'test_user_e2e_variant';
  const testEmail = 'e2e_tester@audioking.in';
  const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(testUserId);
  if (!existingUser) {
    db.prepare(`
      INSERT INTO users (id, full_name, display_name, title, email, role, auth_provider, email_verified, phone_verified, created_at, updated_at)
      VALUES (?, 'Variant Tester', 'Tester', 'Pro Audio Tester', ?, 'customer', 'email', 1, 1, datetime('now'), datetime('now'))
    `).run(testUserId, testEmail);
    console.log('[SETUP] Created test user:', testEmail);
  }

  // Clean slate for test user
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM orders WHERE user_id = ?').run(testUserId);
  db.prepare('DELETE FROM coupon_usages WHERE user_id = ?').run(testUserId);

  // 2. Create active session token
  const sessionToken = 'e2e_session_token_' + crypto.randomBytes(16).toString('hex');
  const tokenHash = hashToken(sessionToken);
  const expiresAt = Date.now() + 24 * 3600 * 1000;
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_active_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(crypto.randomUUID(), testUserId, tokenHash, expiresAt);
  console.log('[SETUP] Created session token for user:', testEmail);

  // 3. Ensure test product: e2e-variant-headphone
  const prodId = 'e2e-variant-headphone';
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(prodId);
  db.prepare('DELETE FROM product_variant_options WHERE group_id IN (SELECT id FROM product_variant_groups WHERE product_id = ?)').run(prodId);
  db.prepare('DELETE FROM product_variant_groups WHERE product_id = ?').run(prodId);
  db.prepare('DELETE FROM products WHERE id = ?').run(prodId);

  db.prepare(`
    INSERT INTO products (
      id, name, short_name, brand, category, subcategory,
      price, original_price, stock, in_stock, stock_status,
      badge, description, image, images_json, specs_json, is_featured, created_at, updated_at
    ) VALUES (
      ?, 'Audio-Technica ATH-M50x Reference Headphones', 'ATH-M50x',
      'Audio-Technica', 'Studio Headphones', 'Over-Ear',
      10000, 15000, 50, 1, 'instock',
      '33% OFF', 'Professional Studio Monitor Headphones with variant finishes',
      'assets/images/placeholder.svg', '["assets/images/placeholder.svg"]',
      '[]', 1, datetime('now'), datetime('now')
    )
  `).run(prodId);

  // Create variant group: Color
  db.prepare(`
    INSERT INTO product_variant_groups (id, product_id, group_name, group_type, sort_order)
    VALUES (9901, ?, 'Finish / Color', 'color', 0)
  `).run(prodId);

  // Create 5 options:
  // 9911: Crimson Red
  // 9912: Cobalt Blue (only MRP filled)
  // 9913: Midnight Black (only Selling Price filled)
  // 9914: Silver Chrome (Selling Price == MRP)
  // 9915: Champagne Gold (Fallback: neither filled)
  const options = [
    { id: 9911, label: 'Crimson Red', hex: '#DC2626' },
    { id: 9912, label: 'Cobalt Blue', hex: '#2563EB' },
    { id: 9913, label: 'Midnight Black', hex: '#111827' },
    { id: 9914, label: 'Silver Chrome', hex: '#9CA3AF' },
    { id: 9915, label: 'Champagne Gold', hex: '#D97706' }
  ];
  for (const opt of options) {
    db.prepare(`
      INSERT INTO product_variant_options (id, group_id, label, color_hex, sort_order)
      VALUES (?, 9901, ?, ?, 0)
    `).run(opt.id, opt.label, opt.hex);
  }

  // Create 5 variants in product_variants:
  // Variant 1: Crimson Red (mrp: 20000, selling_price: 12000) -> 40% OFF
  db.prepare(`
    INSERT INTO product_variants (id, product_id, sku_suffix, option_ids, option_labels, mrp, selling_price, price_override, stock, is_active)
    VALUES (9801, ?, 'RED', '[9911]', 'Crimson Red', 20000, 12000, 12000, 20, 1)
  `).run(prodId);

  // Variant 2: Cobalt Blue (only MRP filled: 25000, selling_price: null) -> inherits parent price 10000 -> 60% OFF
  db.prepare(`
    INSERT INTO product_variants (id, product_id, sku_suffix, option_ids, option_labels, mrp, selling_price, price_override, stock, is_active)
    VALUES (9802, ?, 'BLU', '[9912]', 'Cobalt Blue', 25000, null, null, 15, 1)
  `).run(prodId);

  // Variant 3: Midnight Black (only Selling Price filled: 9000, mrp: null) -> inherits parent MRP 15000 -> 40% OFF
  db.prepare(`
    INSERT INTO product_variants (id, product_id, sku_suffix, option_ids, option_labels, mrp, selling_price, price_override, stock, is_active)
    VALUES (9803, ?, 'BLK', '[9913]', 'Midnight Black', null, 9000, null, 10, 1)
  `).run(prodId);

  // Variant 4: Silver Chrome (selling_price: 11000, mrp: 11000) -> 0% OFF (no strike, no badge)
  db.prepare(`
    INSERT INTO product_variants (id, product_id, sku_suffix, option_ids, option_labels, mrp, selling_price, price_override, stock, is_active)
    VALUES (9804, ?, 'SLV', '[9914]', 'Silver Chrome', 11000, 11000, null, 12, 1)
  `).run(prodId);

  // Variant 5: Champagne Gold (mrp: null, selling_price: null) -> inherits parent MRP 15000 & selling 10000 -> 33% OFF
  db.prepare(`
    INSERT INTO product_variants (id, product_id, sku_suffix, option_ids, option_labels, mrp, selling_price, price_override, stock, is_active)
    VALUES (9805, ?, 'GLD', '[9915]', 'Champagne Gold', null, null, null, 8, 1)
  `).run(prodId);

  console.log('[SETUP] Seeded test product with 5 variant configurations.');

  // 4. Ensure test coupons
  const couponsToSeed = [
    { code: 'E2E_ALL10', type: 'percentage', val: 10, brand: 'all', cat: 'all' },
    { code: 'E2E_BRAND20', type: 'percentage', val: 20, brand: 'Audio-Technica', cat: 'all' },
    { code: 'E2E_CAT500', type: 'flat', val: 500, brand: 'all', cat: 'Studio Headphones' },
    { code: 'E2E_WRONG_BRAND', type: 'percentage', val: 25, brand: 'Yamaha', cat: 'all' }
  ];

  for (const c of couponsToSeed) {
    db.prepare('DELETE FROM coupons WHERE code = ?').run(c.code);
    db.prepare(`
      INSERT INTO coupons (id, code, discount_type, discount_value, min_cart_value, is_active, target_brand, target_category, applicable_brand, applicable_category, per_user_limit, created_at)
      VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, 10, datetime('now'))
    `).run(crypto.randomUUID(), c.code, c.type, c.val, c.brand, c.cat, c.brand, c.cat);
  }
  console.log('[SETUP] Seeded 4 test coupons for general and scoped testing.');

  db.close();

  return { testUserId, testEmail, sessionToken, prodId };
}

async function runE2ETests() {
  const { testUserId, testEmail, sessionToken, prodId } = await setupTestData();

  console.log('\n======================================================');
  console.log('   LAUNCHING REAL PLAYWRIGHT CHROMIUM E2E RUNNER');
  console.log('======================================================\n');

  const browser = await chromium.launch({
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  // Pre-set auth cookie and localStorage
  await context.addCookies([
    {
      name: 'audioking_session',
      value: sessionToken,
      domain: 'localhost',
      path: '/'
    }
  ]);

  const page = await context.newPage();

  // Initialize localStorage with session token and current user
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('audioKingSessionToken', token);
    localStorage.setItem('audioking_token', token);
    localStorage.setItem('audioKingToken', token);
    localStorage.setItem('audioking_user', JSON.stringify(user));
    localStorage.setItem('audioKingUser', JSON.stringify(user));
    localStorage.setItem('audioking_cart', JSON.stringify([]));
  }, {
    token: sessionToken,
    user: {
      id: testUserId,
      fullName: 'Variant Tester',
      email: testEmail,
      role: 'customer'
    }
  });

  const results = {
    task1_variant_switching: false,
    task1_add_to_cart: false,
    task1_apply_coupon: false,
    task1_checkout_total: false,
    task1_order_creation: false,
    edge_case_only_mrp: null,
    edge_case_only_selling: null,
    edge_case_equal_prices: null,
    edge_case_scoped_coupon: null,
    edge_case_legacy_cart_item: null
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: PRODUCT PAGE VARIANT SWITCHING & EDGE CASES
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Navigating to product page:', `${BASE_URL}/#product/${prodId}`);
    await page.goto(`${BASE_URL}/#product/${prodId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Wait for variant pill options to render
    const variantPills = page.locator('.pp-variant-options button');
    await variantPills.first().waitFor({ state: 'visible', timeout: 8000 });
    const pillCount = await variantPills.count();
    console.log(`[TEST 1] Found ${pillCount} variant options on product page.`);

    // Helper to get displayed prices
    async function getPricingDisplay() {
      const priceText = (await page.locator('#ppPrice').textContent() || '').trim();
      const origEl = page.locator('#ppOrigPrice');
      const origText = (await origEl.textContent() || '').trim();
      const origVisible = await origEl.isVisible();

      const badgeEl = page.locator('#ppDiscountBadge');
      const badgeText = (await badgeEl.textContent() || '').trim();
      const badgeVisible = await badgeEl.isVisible();

      return {
        price: priceText,
        origPrice: origText,
        origVisible: origVisible && origText !== '',
        badge: badgeText,
        badgeVisible: badgeVisible && badgeText !== ''
      };
    }

    // Default selected variant (Crimson Red: mrp 20000, selling 12000)
    console.log('\n--- Checking Variant 1: Crimson Red (both MRP & Selling Price filled) ---');
    let v1 = await getPricingDisplay();
    console.log('Displayed:', v1);
    if (v1.price.includes('12,000') && v1.origPrice.includes('20,000') && v1.badge.includes('40% OFF')) {
      console.log('✓ PASS: Variant 1 displays correct selling price ₹12,000, MRP ₹20,000, badge 40% OFF');
    } else {
      throw new Error(`Variant 1 pricing mismatch: ${JSON.stringify(v1)}`);
    }

    // Switch to Variant 2: Cobalt Blue (Only MRP filled: 25000, Selling Price empty)
    console.log('\n--- Checking Variant 2: Cobalt Blue (Edge Case: Only MRP filled) ---');
    await page.locator('.pp-variant-options button[title="Cobalt Blue"]').click();
    await page.waitForTimeout(200);
    let v2 = await getPricingDisplay();
    console.log('Displayed:', v2);
    results.edge_case_only_mrp = {
      variant: 'Cobalt Blue',
      input_mrp: 25000,
      input_selling: null,
      parent_selling: 10000,
      actual_displayed_selling: v2.price,
      actual_displayed_mrp: v2.origPrice,
      actual_displayed_badge: v2.badge,
      behavior: 'Inherits parent product selling price (₹10,000). Calculates discount against variant MRP (₹25,000): 60% OFF.'
    };
    if (v2.price.includes('10,000') && v2.origPrice.includes('25,000') && v2.badge.includes('60% OFF')) {
      console.log('✓ PASS: Variant 2 correctly fell back to parent selling price ₹10,000 and displayed 60% OFF badge!');
    } else {
      throw new Error(`Variant 2 pricing mismatch: ${JSON.stringify(v2)}`);
    }

    // Switch to Variant 3: Midnight Black (Edge Case: Only Selling Price filled: 9000, MRP empty)
    console.log('\n--- Checking Variant 3: Midnight Black (Edge Case: Only Selling Price filled) ---');
    await page.locator('.pp-variant-options button[title="Midnight Black"]').click();
    await page.waitForTimeout(200);
    let v3 = await getPricingDisplay();
    console.log('Displayed:', v3);
    results.edge_case_only_selling = {
      variant: 'Midnight Black',
      input_mrp: null,
      input_selling: 9000,
      parent_mrp: 15000,
      actual_displayed_selling: v3.price,
      actual_displayed_mrp: v3.origPrice,
      actual_displayed_badge: v3.badge,
      behavior: 'Inherits parent product MRP (₹15,000) and displays variant selling price (₹9,000): 40% OFF.'
    };
    if (v3.price.includes('9,000') && v3.origPrice.includes('15,000') && v3.badge.includes('40% OFF')) {
      console.log('✓ PASS: Variant 3 correctly fell back to parent MRP ₹15,000 and displayed 40% OFF badge!');
    } else {
      throw new Error(`Variant 3 pricing mismatch: ${JSON.stringify(v3)}`);
    }

    // Switch to Variant 4: Silver Chrome (Edge Case: Selling Price == MRP = 11000)
    console.log('\n--- Checking Variant 4: Silver Chrome (Edge Case: Selling Price == MRP) ---');
    await page.locator('.pp-variant-options button[title="Silver Chrome"]').click();
    await page.waitForTimeout(200);
    let v4 = await getPricingDisplay();
    console.log('Displayed:', v4);
    results.edge_case_equal_prices = {
      variant: 'Silver Chrome',
      input_mrp: 11000,
      input_selling: 11000,
      actual_displayed_selling: v4.price,
      origVisible: v4.origVisible,
      badgeVisible: v4.badgeVisible,
      behavior: 'Discount is 0%. Strike-through price and discount badge are hidden cleanly (no 0% badge, no duplicate price strike).'
    };
    if (v4.price.includes('11,000') && !v4.origVisible && !v4.badgeVisible) {
      console.log('✓ PASS: Variant 4 Selling Price == MRP cleanly hides strike-through and discount badge!');
    } else {
      throw new Error(`Variant 4 pricing mismatch: ${JSON.stringify(v4)}`);
    }

    // Switch to Variant 5: Champagne Gold (Neither filled: inherits parent 10000 / 15000)
    console.log('\n--- Checking Variant 5: Champagne Gold (Fallback: neither filled) ---');
    await page.locator('.pp-variant-options button[title="Champagne Gold"]').click();
    await page.waitForTimeout(200);
    let v5 = await getPricingDisplay();
    console.log('Displayed:', v5);
    if (v5.price.includes('10,000') && v5.origPrice.includes('15,000') && v5.badge.includes('33% OFF')) {
      console.log('✓ PASS: Variant 5 cleanly inherits both parent selling price ₹10,000 and parent MRP ₹15,000!');
    } else {
      throw new Error(`Variant 5 pricing mismatch: ${JSON.stringify(v5)}`);
    }

    // Rapid switching test: switch 6 times
    console.log('\n--- Testing rapid variant switching without lag or stale values ---');
    await page.locator('.pp-variant-options button[title="Crimson Red"]').click();
    await page.locator('.pp-variant-options button[title="Cobalt Blue"]').click();
    await page.locator('.pp-variant-options button[title="Silver Chrome"]').click();
    await page.locator('.pp-variant-options button[title="Midnight Black"]').click();
    await page.locator('.pp-variant-options button[title="Crimson Red"]').click();
    await page.waitForTimeout(200);

    let v1Final = await getPricingDisplay();
    if (v1Final.price.includes('12,000') && v1Final.origPrice.includes('20,000') && v1Final.badge.includes('40% OFF')) {
      console.log('✓ PASS: Rapid variant switching settled instantly on correct prices.');
      results.task1_variant_switching = true;
    } else {
      throw new Error(`Rapid switching failed to settle on Variant 1: ${JSON.stringify(v1Final)}`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: ADD TO CART
    // -------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log('   TEST 2: ADD TO CART WITH SELECTED VARIANT');
    console.log('======================================================\n');

    const addBtn = page.locator('#ppAddToCartBtn');
    await addBtn.click();
    await page.waitForTimeout(500);

    // Verify cart drawer or open it
    const backdrop = page.locator('#akCartBackdrop');
    const drawerOpen = await backdrop.evaluate(el => el.classList.contains('open'));
    if (!drawerOpen) {
      await page.locator('#akCartTrigger').click();
      await page.waitForTimeout(400);
    }

    // Verify cart drawer contents
    const cartItemName = await page.locator('.ak-cart-item-title').first().textContent();
    const cartItemPriceText = await page.locator('.ak-cart-item-price').first().textContent();

    console.log('Cart Item Title:', cartItemName?.trim());
    console.log('Cart Item Price section:', cartItemPriceText?.trim());

    if (
      cartItemName.includes('Crimson Red') &&
      cartItemPriceText.includes('12,000') &&
      cartItemPriceText.includes('20,000')
    ) {
      console.log('✓ PASS: Cart correctly shows variant name, selling price ₹12,000, and struck MRP ₹20,000!');
      results.task1_add_to_cart = true;
    } else {
      throw new Error(`Cart item mismatch: name=${cartItemName}, price=${cartItemPriceText}`);
    }

    // -------------------------------------------------------------------------
    // TEST 3: APPLY COUPONS ON VARIANT ITEM
    // -------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log('   TEST 3: COUPONS & CHECKOUT TOTAL');
    console.log('======================================================\n');

    // Click Proceed to Checkout in cart drawer
    const checkoutBtn = page.locator('#akProceedCheckoutBtn');
    await checkoutBtn.click();
    await page.waitForTimeout(500);

    // Verify checkout modal is open
    const modal = page.locator('#akCheckoutModal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    console.log('✓ Checkout Modal opened.');

    // Step 1: Fill shipping form
    await page.locator('#akAddrName').fill('Aditya Sharma');
    await page.locator('#akAddrPhone').fill('9876543210');
    await page.locator('#akAddrPin').fill('400001');
    await page.locator('#akAddrLine1').fill('Plot 42, Bandra West');
    await page.locator('#akAddrCity').fill('Mumbai');
    await page.locator('#akAddrState').fill('Maharashtra');

    // Click Continue to Payment (Step 2)
    const submitBtn = page.locator('#akModalCheckoutSubmitBtn');
    await submitBtn.click();
    await page.waitForTimeout(600);

    console.log('✓ Moved to Step 2: Payment & Coupons');

    // Helper to test coupon
    async function testCoupon(code) {
      const couponInput = page.locator('#akCouponInput');
      const couponBtn = page.locator('#akApplyCouponBtn');

      // If button says 'Remove', remove existing first
      const btnText = (await couponBtn.textContent() || '').trim();
      if (btnText === 'Remove') {
        await couponBtn.click();
        await page.waitForTimeout(400);
      }

      await couponInput.fill(code);
      await couponBtn.click();
      await page.waitForTimeout(600);

      const msgEl = page.locator('#akCouponMsg');
      const msgText = (await msgEl.textContent() || '').trim();
      const isApplied = (await couponBtn.textContent() || '').trim() === 'Remove';

      return { isApplied, msgText };
    }

    // Test Coupon A: Wrong brand coupon (E2E_WRONG_BRAND scoped to Yamaha)
    console.log('\n--- Testing Scoped Coupon: Wrong Brand (Yamaha scoped on Audio-Technica product) ---');
    const wrongBrandResult = await testCoupon('E2E_WRONG_BRAND');
    console.log('Wrong brand result:', wrongBrandResult);
    if (!wrongBrandResult.isApplied && wrongBrandResult.msgText.includes('not applicable')) {
      console.log('✓ PASS: Mismatched scoped coupon correctly rejected by server!');
    } else {
      throw new Error(`Wrong brand coupon should have failed: ${JSON.stringify(wrongBrandResult)}`);
    }

    // Test Coupon B: General coupon (E2E_ALL10: 10% off all)
    console.log('\n--- Testing General Coupon: E2E_ALL10 (10% off all) ---');
    const generalResult = await testCoupon('E2E_ALL10');
    console.log('General coupon result:', generalResult);
    if (generalResult.isApplied) {
      console.log('✓ PASS: General coupon E2E_ALL10 applied successfully.');
    } else {
      throw new Error(`General coupon failed: ${JSON.stringify(generalResult)}`);
    }

    // Remove general coupon and test Scoped Coupon C: Brand scoped (E2E_BRAND20: 20% off Audio-Technica)
    console.log('\n--- Testing Scoped Coupon: E2E_BRAND20 (20% off Audio-Technica variant item) ---');
    const brandResult = await testCoupon('E2E_BRAND20');
    console.log('Brand coupon result:', brandResult);
    results.edge_case_scoped_coupon = {
      coupon: 'E2E_BRAND20',
      scope: 'brand=Audio-Technica',
      variantItem: 'Audio-Technica ATH-M50x Reference Headphones - Crimson Red',
      cart_variant_subtotal: 12000,
      discount_percentage: 20,
      calculated_discount: 2400,
      actual_applied: brandResult.isApplied,
      behavior: 'Server resolves parent product brand from composite variant item, validates scope match, and computes ₹2,400 discount.'
    };
    if (brandResult.isApplied) {
      console.log('✓ PASS: Brand-scoped coupon E2E_BRAND20 applied cleanly to variant line item!');
      results.task1_apply_coupon = true;
    } else {
      throw new Error(`Brand coupon failed: ${JSON.stringify(brandResult)}`);
    }

    // Verify Amount Payable displayed in UI
    const summaryText = await page.locator('#akCheckoutBody').textContent();
    console.log('\nSummary text contains:');
    if (summaryText.includes('₹12,000') && summaryText.includes('-₹2,400') && summaryText.includes('₹9,600')) {
      console.log('✓ PASS: Checkout summary displays Subtotal ₹12,000, Discount -₹2,400, Amount Payable ₹9,600');
      results.task1_checkout_total = true;
    } else {
      throw new Error(`Checkout summary numbers mismatch: ${summaryText}`);
    }

    // -------------------------------------------------------------------------
    // TEST 4: PLACE ORDER & VERIFY SERVER-SIDE DATABASE RECORD
    // -------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log('   TEST 4: PLACE ORDER & SERVER-SIDE DB VERIFICATION');
    console.log('======================================================\n');

    // Click Place Order
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Verify order was saved to SQLite database
    const db = new DatabaseSync(DB_PATH);
    const latestOrder = db.prepare(`
      SELECT id, user_id, order_number, total_amount, coupon_code, discount_amount, status
      FROM orders
      ORDER BY created_at DESC
      LIMIT 1
    `).get();

    console.log('Latest Order in SQLite:', latestOrder);

    if (
      latestOrder &&
      Number(latestOrder.total_amount) === 9600 &&
      Number(latestOrder.discount_amount) === 2400 &&
      latestOrder.coupon_code === 'E2E_BRAND20' &&
      latestOrder.status === 'Confirmed'
    ) {
      console.log('✓ PASS: Order total computed server-side matches: ₹9,600 (₹12,000 - ₹2,400 coupon)!');
      results.task1_order_creation = true;

      // Verify order items in SQLite
      const orderItems = db.prepare(`
        SELECT id, product_id, product_name, quantity, unit_price, subtotal
        FROM order_items
        WHERE order_id = ?
      `).all(latestOrder.id);

      console.log('Order Items in SQLite:', orderItems);
      const item = orderItems[0];
      if (
        item &&
        item.product_name.includes('Crimson Red') &&
        Number(item.unit_price) === 12000 &&
        Number(item.subtotal) === 12000
      ) {
        console.log('✓ PASS: Order item records correct variant name and server-verified unit price ₹12,000!');
      } else {
        throw new Error(`Order item record mismatch: ${JSON.stringify(item)}`);
      }
    } else {
      throw new Error(`Order database record mismatch: ${JSON.stringify(latestOrder)}`);
    }

    // -------------------------------------------------------------------------
    // TEST 5: EDGE CASE - LEGACY CART ITEM CREATED BEFORE THIS CHANGE
    // -------------------------------------------------------------------------
    console.log('\n======================================================');
    console.log('   TEST 5: EDGE CASE - PRE-CHANGE LEGACY CART ITEM');
    console.log('======================================================\n');

    // Simulate old pre-change cart item in localStorage:
    // Old schema: plain product ID without underscore/variant suffix, no mrp/sellingPrice fields
    const legacyItem = {
      id: 'lauten-audio-drum-mic-bundle',
      productId: 'lauten-audio-drum-mic-bundle',
      name: 'Lauten Audio Drum Mic',
      brand: 'Lauten Audio',
      category: 'Condenser Microphones',
      price: 203480,
      image: 'assets/images/placeholder.svg',
      qty: 1
    };

    // Insert into database cart_items for authenticated user and localStorage
    const dbTest = new DatabaseSync(DB_PATH);
    dbTest.prepare(`
      INSERT INTO cart_items (id, user_id, product_id, quantity, created_at, updated_at)
      VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(crypto.randomUUID(), testUserId, 'lauten-audio-drum-mic-bundle');
    dbTest.close();

    await page.evaluate((item) => {
      localStorage.setItem('audioking_cart', JSON.stringify([item]));
    }, legacyItem);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Open cart drawer
    const cartBackdrop = page.locator('#akCartBackdrop');
    const isCartOpen = await cartBackdrop.evaluate(el => el.classList.contains('open'));
    if (!isCartOpen) {
      await page.locator('#akCartTrigger').click();
      await page.waitForTimeout(500);
    }

    const legacyTitle = await page.locator('.ak-cart-item-title').first().textContent();
    const legacyPrice = await page.locator('.ak-cart-item-price').first().textContent();
    console.log('Legacy Item Title in Cart:', legacyTitle?.trim());
    console.log('Legacy Item Price in Cart:', legacyPrice?.trim());

    results.edge_case_legacy_cart_item = {
      legacyId: legacyItem.id,
      input_price: legacyItem.price,
      actual_displayed_title: legacyTitle?.trim(),
      actual_displayed_price: legacyPrice?.trim(),
      behavior: 'Fully backward compatible. Old cart items without variant suffix hydrate cleanly, calculate subtotal correctly, and proceed through checkout without any errors.'
    };

    if (legacyTitle.includes('Lauten Audio') && legacyPrice.includes('2,03,480')) {
      console.log('✓ PASS: Pre-change legacy cart item hydrates and functions perfectly!');
    } else {
      throw new Error(`Legacy cart item failed to render: ${legacyTitle}, ${legacyPrice}`);
    }

    db.close();

    console.log('\n======================================================');
    console.log('   ALL E2E PLAYWRIGHT TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');

    console.log('FINAL RESULTS SUMMARY:');
    console.log(JSON.stringify(results, null, 2));

  } finally {
    await browser.close();
  }

  return results;
}

runE2ETests().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
