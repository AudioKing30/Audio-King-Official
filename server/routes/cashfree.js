/**
 * AudioKing Cashfree Payment Gateway API Router
 * 
 * Cashfree Payments PG (API Version: 2023-08-01)
 * Supports:
 * - Direct Checkout via Cashfree JS SDK v3 (Modal & Redirect flows)
 * - UPI (Google Pay, PhonePe, Paytm, BHIM, CRED), Credit/Debit Cards, Net Banking, EMI, Wallets
 * - Live Production & Sandbox testing modes
 * - Automatic detection from Render environment variables or Admin Panel settings
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { hashToken } = require('../security');

const router = express.Router();
const SITE_URL = (process.env.SITE_URL || 'https://audioking.co.in').trim().replace(/\/+$/, '');

function cleanVal(v) {
  if (!v) return '';
  v = String(v).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function getAuthUserFromRequest(req) {
  let token = req.cookies?.audioking_session || 
              req.cookies?.audioking_admin_session || 
              req.cookies?.audioKingToken || 
              req.cookies?.audioKingSessionToken || 
              req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
              req.headers['x-session-token'];
  if (token) {
    token = cleanVal(token);
    const tokenHash = hashToken(token);
    try {
      const session = db.prepare(`
        SELECT u.id, u.full_name, u.email, u.phone_number, u.role
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND (s.expires_at > ? OR u.role = 'admin')
      `).get(tokenHash, Date.now());
      if (session) return session;
    } catch (e) {}
  }
  return null;
}

function getCashfreeCredentials() {
  // 1. Check all possible environment variable names configured in Render or .env
  let appId = cleanVal(
    process.env.CASHFREE_APP_ID || 
    process.env.CASHFREE_CLIENT_ID || 
    process.env.CASHFREE_API_KEY || 
    process.env.CASHFREE_KEY_ID || 
    process.env.CASHFREE_KEY || 
    process.env.CASHFREE_PROD_APP_ID ||
    process.env.CASHFREE_PRODUCTION_APP_ID ||
    process.env.CF_APP_ID || 
    process.env.CF_CLIENT_ID || 
    process.env.CF_KEY || 
    process.env.CF_API_KEY
  );

  let secretKey = cleanVal(
    process.env.CASHFREE_SECRET_KEY || 
    process.env.CASHFREE_CLIENT_SECRET || 
    process.env.CASHFREE_SECRET || 
    process.env.CASHFREE_API_SECRET || 
    process.env.CASHFREE_PROD_SECRET_KEY ||
    process.env.CASHFREE_PRODUCTION_SECRET_KEY ||
    process.env.CF_SECRET_KEY || 
    process.env.CF_CLIENT_SECRET || 
    process.env.CF_SECRET
  );

  let rawMode = cleanVal(
    process.env.CASHFREE_MODE || 
    process.env.CASHFREE_ENVIRONMENT || 
    process.env.CASHFREE_ENV || 
    process.env.CF_MODE || 
    process.env.CF_ENV
  ).toLowerCase();

  let source = appId && secretKey ? 'environment' : 'none';

  // 2. Fallback to site_settings table if not provided via environment
  if (!appId || !secretKey) {
    try {
      const dbAppId = db.prepare("SELECT value FROM site_settings WHERE key = 'cashfree_app_id'").get();
      const dbSecret = db.prepare("SELECT value FROM site_settings WHERE key = 'cashfree_secret_key'").get();
      const dbMode = db.prepare("SELECT value FROM site_settings WHERE key = 'cashfree_mode'").get();
      if (!appId && dbAppId && dbAppId.value) {
        appId = cleanVal(dbAppId.value);
        source = 'database';
      }
      if (!secretKey && dbSecret && dbSecret.value) {
        secretKey = cleanVal(dbSecret.value);
      }
      if (!rawMode && dbMode && dbMode.value) {
        rawMode = cleanVal(dbMode.value).toLowerCase();
      }
    } catch (e) {}
  }

  // 3. Determine environment mode:
  // - If rawMode is explicitly 'production', 'prod', or 'live' -> production
  // - If rawMode is explicitly 'sandbox', 'test', or 'stage' -> sandbox
  // - Otherwise, auto-detect: if App ID doesn't start with TEST or contain test/sandbox, assume production
  let mode = 'sandbox';
  if (['production', 'prod', 'live'].includes(rawMode)) {
    mode = 'production';
  } else if (['sandbox', 'test', 'stage'].includes(rawMode)) {
    mode = 'sandbox';
  } else if (appId && !appId.toUpperCase().startsWith('TEST') && !appId.toLowerCase().includes('sandbox') && !appId.toLowerCase().includes('test') && !appId.includes('placeholder')) {
    mode = 'production';
  }

  const apiVersion = process.env.CASHFREE_API_VERSION || '2023-08-01';
  return { appId, secretKey, mode, apiVersion, source };
}

function getCashfreeEndpoint(path) {
  const { mode } = getCashfreeCredentials();
  const baseUrl = mode === 'production' 
    ? 'https://api.cashfree.com/pg' 
    : 'https://sandbox.cashfree.com/pg';
  return `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * 1. GET /api/payment/cashfree/config
 * Returns public configuration for client SDK initialization.
 */
router.get('/config', (req, res) => {
  const { appId, mode, source } = getCashfreeCredentials();
  const isLive = Boolean(appId && !appId.includes('placeholder') && mode === 'production');

  return res.json({
    success: true,
    appId: appId || 'test_app_placeholder',
    mode,
    isLive,
    source,
    currency: 'INR',
    companyName: 'AudioKing India',
    themeColor: '#0B315F'
  });
});

/**
 * 2. POST /api/payment/cashfree/create-order
 * Generates an official Cashfree payment_session_id.
 */
router.post('/create-order', async (req, res) => {
  try {
    const authUser = getAuthUserFromRequest(req);
    const { amount, currency = 'INR', orderId: clientOrderId, customer, returnUrl, paymentMethod } = req.body || {};

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid payment amount in INR is required.' });
    }

    const { appId, secretKey, mode, apiVersion } = getCashfreeCredentials();

    const rawOrderId = clientOrderId || ('ak_order_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
    const orderId = String(rawOrderId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45);
    const customerId = (authUser?.id || customer?.userId || ('cust_' + Date.now())).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45);
    const rawPhone = (customer?.phone || authUser?.phone_number || '').replace(/[^0-9]/g, '');
    const customerPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : '9876543210';
    const customerEmail = (customer?.email || authUser?.email || 'customer@audioking.co.in').trim().toLowerCase();
    const customerName = (customer?.name || customer?.fullName || authUser?.full_name || 'Valued Customer').trim().substring(0, 100);

    // If credentials are configured, create real session with Cashfree API
    if (appId && secretKey && !appId.includes('placeholder')) {
      const endpoint = getCashfreeEndpoint('/orders');
      
      const clientOrigin = (req.get('origin') || req.get('referer') || '').replace(/\/+$/, '');
      const baseSite = clientOrigin || SITE_URL;
      const orderMeta = {
        return_url: returnUrl || `${baseSite}/?cf_order_id={order_id}&order_id={order_id}`,
        notify_url: process.env.CASHFREE_WEBHOOK_URL || `${baseSite}/api/payment/cashfree/webhook`
      };

      // If user selected a specific payment method, prioritize or restrict it in Cashfree
      if (paymentMethod) {
        const pm = String(paymentMethod).toLowerCase();
        if (pm.includes('upi')) {
          orderMeta.payment_methods = 'upi,cc,dc,nb';
        } else if (pm.includes('card')) {
          orderMeta.payment_methods = 'cc,dc,upi,nb';
        } else if (pm.includes('net') || pm.includes('bank')) {
          orderMeta.payment_methods = 'nb,upi,cc,dc';
        }
      }

      const payload = {
        order_id: orderId,
        order_amount: Math.round(Number(amount) * 100) / 100,
        order_currency: currency.toUpperCase(),
        customer_details: {
          customer_id: customerId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone
        },
        order_meta: orderMeta,
        order_note: `AudioKing Pro Audio Order ${orderId}`
      };

      console.log(`[CASHFREE] Creating order on Cashfree (${mode.toUpperCase()} mode): ${orderId} for ₹${amount}`);

      const cfRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-client-id': appId,
          'x-client-secret': secretKey,
          'x-api-version': apiVersion,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const cfData = await cfRes.json();

      if (!cfRes.ok) {
        console.error(`[CASHFREE CREATE ORDER ERROR] HTTP ${cfRes.status} (${mode} mode):`, cfData);
        return res.status(cfRes.status).json({
          error: cfData.message || 'Failed to initiate Cashfree payment session.',
          details: cfData
        });
      }

      console.log(`[CASHFREE] Order created successfully: ${cfData.order_id}, session: ${cfData.payment_session_id?.substring(0, 16)}...`);
      return res.json({
        success: true,
        orderId: cfData.order_id,
        paymentSessionId: cfData.payment_session_id,
        amount: cfData.order_amount,
        currency: cfData.order_currency,
        mode,
        isMock: false
      });
    }

    // --- Sandbox Simulation Mode (Fallback when merchant keys are pending) ---
    console.warn('[CASHFREE] No live credentials detected. Returning test simulation session.');
    const mockSessionId = 'session_' + crypto.randomUUID().replace(/-/g, '').substring(0, 24);

    return res.json({
      success: true,
      orderId,
      paymentSessionId: mockSessionId,
      amount: Number(amount),
      currency: currency.toUpperCase(),
      mode: 'sandbox',
      isMock: true,
      message: 'Cashfree simulation session created. Add CASHFREE_APP_ID & CASHFREE_SECRET_KEY to process live payments.'
    });
  } catch (err) {
    console.error('[CASHFREE EXCEPTION]', err);
    return res.status(500).json({ error: 'Cashfree communication error: ' + err.message });
  }
});

/**
 * 3. POST /api/payment/cashfree/verify
 * Verifies transaction status with Cashfree via Orders and Payments endpoints.
 */
router.post('/verify', async (req, res) => {
  try {
    const { orderId, isMock } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required for payment verification.' });
    }

    const { appId, secretKey, mode, apiVersion } = getCashfreeCredentials();

    if (appId && secretKey && !appId.includes('placeholder') && !isMock) {
      const orderEndpoint = getCashfreeEndpoint(`/orders/${encodeURIComponent(orderId)}`);
      const paymentsEndpoint = getCashfreeEndpoint(`/orders/${encodeURIComponent(orderId)}/payments`);

      let orderData = null;
      let paymentsData = null;
      let isPaid = false;
      let successfulPayment = null;

      // Poll up to 4 attempts (1.5s delay) to allow Cashfree and bank reconciliation to settle
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const [orderRes, paymentsRes] = await Promise.all([
            fetch(orderEndpoint, {
              method: 'GET',
              headers: {
                'x-client-id': appId,
                'x-client-secret': secretKey,
                'x-api-version': apiVersion,
                'Accept': 'application/json'
              }
            }),
            fetch(paymentsEndpoint, {
              method: 'GET',
              headers: {
                'x-client-id': appId,
                'x-client-secret': secretKey,
                'x-api-version': apiVersion,
                'Accept': 'application/json'
              }
            })
          ]);

          if (orderRes.ok) orderData = await orderRes.json().catch(() => null);
          if (paymentsRes.ok) paymentsData = await paymentsRes.json().catch(() => null);

          // Check if order_status is PAID
          if (orderData && orderData.order_status === 'PAID') {
            isPaid = true;
          }

          // Check if any payment in payments array succeeded
          if (Array.isArray(paymentsData) && paymentsData.length > 0) {
            successfulPayment = paymentsData.find(p => p.payment_status === 'SUCCESS');
            if (successfulPayment) {
              isPaid = true;
            }
          }

          if (isPaid) break;
        } catch (pollErr) {
          console.warn(`[CASHFREE POLL WARN] Attempt ${attempt + 1}:`, pollErr.message);
        }

        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
      }

      if (!orderData && !paymentsData) {
        return res.status(400).json({
          success: false,
          error: 'Could not contact Cashfree servers to verify order.'
        });
      }

      if (isPaid) {
        const paymentId = successfulPayment?.cf_payment_id ? String(successfulPayment.cf_payment_id) : `cf_pay_${orderId}`;
        const bankRef = successfulPayment?.bank_reference || '';
        let paymentMethodStr = 'Cashfree PG';
        if (successfulPayment?.payment_method) {
          const pm = successfulPayment.payment_method;
          if (pm.upi) paymentMethodStr = `UPI (${pm.upi.channel || 'App'})`;
          else if (pm.card) paymentMethodStr = `Card ending ${pm.card.card_number?.slice(-4) || '****'}`;
          else if (pm.netbanking) paymentMethodStr = `Net Banking (${pm.netbanking.netbanking_bank_name || 'Bank'})`;
        }

        // Update database order if it already exists
        try {
          db.prepare(`
            UPDATE orders 
            SET status = 'Confirmed', payment_status = 'PAID', payment_id = ?, updated_at = ? 
            WHERE (order_number = ? OR id = ?) AND status != 'Cancelled'
          `).run(paymentId, new Date().toISOString(), orderId, orderId);
        } catch (_) {}

        return res.json({
          success: true,
          verified: true,
          orderId,
          orderStatus: 'PAID',
          amount: orderData?.order_amount || successfulPayment?.payment_amount,
          paymentId,
          bankReference: bankRef,
          paymentMethod: paymentMethodStr,
          mode,
          isMock: false
        });
      }

      return res.status(400).json({
        success: false,
        verified: false,
        orderId,
        orderStatus: orderData?.order_status || 'PENDING',
        error: orderData?.message || 'Payment has not been completed yet. If debited, please wait a moment for bank reconciliation.'
      });
    }

    // Simulation verification
    return res.json({
      success: true,
      verified: true,
      orderId,
      orderStatus: 'PAID',
      paymentId: 'cf_sim_' + Date.now(),
      isMock: true,
      message: 'Cashfree payment simulated successfully.'
    });
  } catch (err) {
    console.error('[CASHFREE VERIFY EXCEPTION]', err);
    return res.status(500).json({ error: 'Failed to verify Cashfree payment: ' + err.message });
  }
});

/**
 * 4. POST /api/payment/cashfree/webhook
 * Handles Cashfree Payment Success & Failed Webhooks asynchronously.
 */
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    console.log('[CASHFREE WEBHOOK RECEIVED]', event?.type || 'EVENT');

    const orderId = event?.data?.order?.order_id || event?.order_id;
    const paymentId = event?.data?.payment?.cf_payment_id || event?.cf_payment_id || `cf_pay_${orderId}`;
    const paymentStatus = (event?.data?.payment?.payment_status || event?.payment_status || '').toUpperCase();

    if (orderId && paymentStatus === 'SUCCESS') {
      try {
        db.prepare(`
          UPDATE orders 
          SET status = 'Confirmed', payment_status = 'PAID', payment_id = ?, updated_at = ? 
          WHERE (order_number = ? OR id = ?) AND status != 'Cancelled'
        `).run(String(paymentId), new Date().toISOString(), orderId, orderId);

        const { syncOrdersMaster } = require('../dataSync');
        syncOrdersMaster(db);
        console.log(`[CASHFREE WEBHOOK] Order ${orderId} marked PAID successfully.`);
      } catch (dbErr) {
        console.warn('[CASHFREE WEBHOOK DB WARN]', dbErr.message);
      }
    }

    return res.status(200).json({ status: 'OK' });
  } catch (err) {
    console.error('[CASHFREE WEBHOOK ERROR]', err.message);
    return res.status(200).json({ status: 'HANDLED_WITH_WARNING' });
  }
});

module.exports = router;
module.exports.getCashfreeCredentials = getCashfreeCredentials;
module.exports.getCashfreeEndpoint = getCashfreeEndpoint;
