/**
 * Test strictly verifying:
 * 1. Variant MRP & SP auto-connection to main product MRP & SP in Admin UI.
 * 2. Visible vs Invisible coupons in Admin (dropdown, filter, badge).
 * 3. Invisible coupon does NOT appear in checkout list, but applies when typed manually.
 */
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function run() {
  // Start server on port 4500 with test db
  const testDbPath = path.join(__dirname, '..', 'server', 'data', 'audioking_user_req_test.db');
  const sourceDbPath = path.join(__dirname, '..', 'server', 'data', 'audioking.db');
  fs.copyFileSync(sourceDbPath, testDbPath);

  process.env.DB_PATH = testDbPath;
  process.env.PORT = '4500';
  process.env.NODE_ENV = 'test';

  const { hashToken } = require('../server/security');
  const crypto = require('crypto');
  const { db } = require('../server/db');

  // Insert valid admin session
  const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const sessionToken = 'admin_req_session_' + crypto.randomBytes(16).toString('hex');
  const tokenHash = hashToken(sessionToken);
  const sessId = 'sess_req_' + Date.now();
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessId, adminUser.id, tokenHash, Date.now() + 86400000, Date.now(), Date.now());

  const app = require('../server/index');
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(4500, resolve));
  console.log('[TEST] Server running on port 4500');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([
    { name: 'audioking_session', value: sessionToken, domain: 'localhost', path: '/' },
    { name: 'audioking_admin_session', value: sessionToken, domain: 'localhost', path: '/' },
    { name: 'audioKingRole', value: 'admin', domain: 'localhost', path: '/' }
  ]);
  const page = await context.newPage();
  page.on('console', msg => console.log('[PAGE CONSOLE]', msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));
  page.on('dialog', async dialog => {
    console.log('[PAGE DIALOG]', dialog.type(), dialog.message());
    await dialog.accept();
  });

  try {
    // Authenticate admin
    await page.goto('http://localhost:4500/admin/index.html');
    await page.waitForTimeout(1000);

    // 1. Test Admin Variant auto-connection
    console.log('[STEP 1] Testing Variant MRP & SP auto-connection in Admin...');
    await page.click('button:has-text("Add New Product")');
    await page.waitForSelector('#enableVariantsToggle', { state: 'attached' });

    // Fill product info
    await page.fill('#productName', 'Test Auto-Sync Headphones');
    await page.selectOption('#productCategory', { index: 1 });
    await page.selectOption('#productBrand', { index: 1 });
    await page.fill('#productMrp', '25000');
    await page.fill('#productSellingPrice', '18000');

    // Enable variants via click
    await page.evaluate(() => {
      const toggle = document.getElementById('enableVariantsToggle');
      if (!toggle.checked) toggle.click();
    });
    await page.waitForTimeout(500);

    // Add variant option
    await page.fill('#optInput_0', 'Midnight Black');
    await page.evaluate(() => { addVariantOption(0); });
    await page.waitForTimeout(500);

    // Check table headers
    const thMrp = await page.textContent('th:has-text("MRP [Strikethrough Price]")');
    const thSp = await page.textContent('th:has-text("SP [Selling Price]")');
    if (!thMrp || !thSp) throw new Error('Variant table headers missing MRP/SP labels!');
    console.log('✓ Found variant matrix headers: MRP [Strikethrough Price] & SP [Selling Price]');

    // Check that first variant row inherited product prices
    const v0Mrp = await page.inputValue('#variantInputMrp_0');
    const v0Sp = await page.inputValue('#variantInputSp_0');
    console.log(`Variant 0 initial prices: MRP=${v0Mrp}, SP=${v0Sp}`);
    if (v0Mrp !== '25000' || v0Sp !== '18000') {
      throw new Error(`Variant 0 did not inherit product prices! Got MRP=${v0Mrp}, SP=${v0Sp}`);
    }

    // Now edit Variant 0's MRP and SP directly
    await page.fill('#variantInputMrp_0', '30000');
    await page.fill('#variantInputSp_0', '21000');
    await page.waitForTimeout(300);

    // Verify parent product inputs auto-updated!
    const updatedProdMrp = await page.inputValue('#productMrp');
    const updatedProdSp = await page.inputValue('#productSellingPrice');
    console.log(`Parent product updated prices: MRP=${updatedProdMrp}, SP=${updatedProdSp}`);
    if (updatedProdMrp !== '30000' || updatedProdSp !== '21000') {
      throw new Error(`Parent product did not auto-update from Variant 0! Got MRP=${updatedProdMrp}, SP=${updatedProdSp}`);
    }
    console.log('✓ PASS: Variant 0 MRP & SP auto-connected to parent product MRP & SP!');

    await page.evaluate(() => {
      if (typeof window.switchView === 'function') {
        window.switchView('coupons');
      } else {
        window.location.hash = '#coupons';
      }
    });
    await page.waitForSelector('#couponVisibility', { state: 'visible' });

    const options = await page.$$eval('#couponVisibility option', opts => opts.map(o => ({ value: o.value, text: o.textContent.trim() })));
    console.log('Coupon Visibility Dropdown options:', options);
    const hasVisible = options.some(o => o.value === 'visible' && o.text.toLowerCase().includes('visible'));
    const hasInvisible = options.some(o => (o.value === 'invisible' || o.value === 'hidden') && o.text.toLowerCase().includes('invisible'));
    if (!hasVisible || !hasInvisible) {
      throw new Error('Coupon Visibility dropdown missing Visible or Invisible options!');
    }
    console.log('✓ PASS: Visibility dropdown contains "Visible" and "Invisible" options.');

    // Create an Invisible coupon
    const invisibleCode = 'CELEB_PRIV_' + Date.now().toString().slice(-4);
    await page.fill('#couponCode', invisibleCode);
    await page.selectOption('#couponVisibility', 'invisible');
    await page.selectOption('#couponType', 'flat');
    await page.fill('#couponValue', '1500');
    await page.fill('#couponMinCart', '5000');
    await page.click('button:has-text("Generate Coupon Code")');
    await page.waitForTimeout(1000);

    // Verify it appears with Invisible badge
    const badgeText = await page.textContent(`tr:has-text("${invisibleCode}") .badge-visibility`);
    console.log(`Badge for ${invisibleCode}:`, badgeText.trim());
    if (!badgeText.toLowerCase().includes('invisible')) {
      throw new Error(`Coupon badge is not "Invisible"! Got: ${badgeText}`);
    }
    console.log('✓ PASS: Created coupon shows "Invisible" badge in table.');

    // Test filter: Click "Invisible" filter tab
    await page.click('#couponFilterInvisible');
    await page.waitForTimeout(500);
    const visibleInTable = await page.isVisible(`tr:has-text("${invisibleCode}")`);
    if (!visibleInTable) throw new Error('Invisible coupon not shown under Invisible filter!');
    console.log('✓ PASS: Filter "Invisible" correctly lists the invisible coupon.');

    // 3. Test Checkout Behavior (Invisible coupon NOT in picker, but works when typed)
    console.log('[STEP 3] Testing Storefront Checkout with Visible and Invisible coupons...');
    await page.goto('http://localhost:4500/#product/adam-audio-a44h-single', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Add to cart
    await page.locator('#ppAddToCartBtn').click();
    await page.waitForTimeout(600);

    const backdrop = page.locator('#akCartBackdrop');
    const drawerOpen = await backdrop.evaluate(el => el.classList.contains('open')).catch(() => false);
    if (!drawerOpen) {
      await page.locator('#akCartTrigger').click();
      await page.waitForTimeout(500);
    }

    // Proceed to checkout
    await page.locator('#akProceedCheckoutBtn').click();
    await page.waitForTimeout(800);

    // Fill Step 1 Shipping
    await page.locator('#akAddrName').fill('Rohan Verma');
    await page.locator('#akAddrPhone').fill('9876543210');
    await page.locator('#akAddrPin').fill('400001');
    await page.locator('#akAddrLine1').fill('Flat 402, Sound Engineering Studios');
    await page.locator('#akAddrCity').fill('Mumbai');
    await page.locator('#akAddrState').fill('Maharashtra');

    await page.locator('#akModalCheckoutSubmitBtn').click();
    await page.waitForTimeout(1000);

    await page.waitForSelector('#akVisibleCouponsContainer');
    await page.waitForTimeout(1200);

    // Check that CELEB_PRIVATE_99 is NOT in the visible coupons picker
    const pickerText = await page.textContent('#akVisibleCouponsContainer');
    if (pickerText.includes(invisibleCode)) {
      throw new Error(`SECURITY LEAK: Invisible coupon "${invisibleCode}" appeared in the checkout picker!`);
    }
    console.log('✓ PASS: Invisible coupon is strictly hidden from checkout apply coupon list.');

    // Now type the invisible code into the promo code input
    await page.fill('#akCouponInput', invisibleCode);
    await page.click('#akApplyCouponBtn');
    await page.waitForTimeout(1000);

    // Check that it applied successfully
    const appliedMsg = await page.textContent('#akCouponMsg');
    console.log('Coupon result message:', appliedMsg);
    if (!appliedMsg.includes('applied') && !appliedMsg.includes('✓')) {
      throw new Error(`Invisible coupon failed to apply! Got msg: ${appliedMsg}`);
    }
    console.log('✓ PASS: Invisible coupon applies successfully when typed into coupon code input bar!');

    console.log('\n======================================================');
    console.log('  ALL USER REQUIREMENT VERIFICATIONS PASSED 100%!     ');
    console.log('======================================================\n');
  } finally {
    await browser.close();
    server.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }
  }
}

run().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
