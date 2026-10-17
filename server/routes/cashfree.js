/**
 * AudioKing Cashfree Payment Gateway API Router
 * 
 * Cashfree Payments PG (API Version: 2023-08-01)
 * Supports:
 * - Direct Checkout via Cashfree JS SDK v3
 * - UPI (GPay, PhonePe, Paytm, BHIM), Credit/Debit Cards, Net Banking, EMI, Wallets
 * - Sandbox testing & Live Production modes
 * - Automatic simulation fallback when merchant keys are pending
 */

const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { hashToken } = require('../security');

const router = express.Router();
const SITE_URL = (process.env.SITE_URL || 'https://audioking.co.in').trim().replace(/\/+$/, '');

function getAuthUserFromRequest(req) {
  let token = req.cookies?.audioking_session || 
              req.cookies?.audioking_admin_session || 
              req.cookies?.audioKingToken || 
              req.cookies?.audioKingSessionToken || 
              req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
              req.headers['x-session-token'];
  if (token) {
    token = String(token).trim();
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1).trim();
    }
    const tokenHash = hashToken(token);
    try {
      const session = db.prepare(`
        SELECT u.id, u.full_name, u.email, u.phone_number, u.role
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `).get(tokenHash, Date.now());
      if (session) return session;
    } catch (e) {}
  }
  return null;
}

function getCashfreeCredentials() {
  const appId = (process.env.CASHFREE_APP_ID || process.env.CASHFREE_CLIENT_ID || process.env.CF_APP_ID || process.env.CF_CLIENT_ID || '').trim();
  const secretKey = (process.env.CASHFREE_SECRET_KEY || process.env.CASHFREE_CLIENT_SECRET || process.env.CF_SECRET_KEY || process.env.CF_CLIENT_SECRET || '').trim();
  const rawMode = (process.env.CASHFREE_MODE || process.env.CASHFREE_ENVIRONMENT || process.env.CF_MODE || '').trim().toLowerCase();

  let mode = 'sandbox';
  if (['production', 'prod', 'live'].includes(rawMode)) {
    mode = 'production';
  } else if (['sandbox', 'test', 'stage'].includes(rawMode)) {
    mode = 'sandbox';
  } else if (appId && !appId.startsWith('TEST') && !appId.toLowerCase().includes('sandbox') && !appId.toLowerCase().includes('test') && !appId.includes('placeholder')) {
    // Production keys usually don't have TEST prefix; auto-detect production
    mode = 'production';
  }

  const apiVersion = process.env.CASHFREE_API_VERSION || '2023-08-01';
  return { appId, secretKey, mode, apiVersion };
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
  const { appId, mode } = getCashfreeCredentials();
  const isLive = Boolean(appId && !appId.includes('placeholder') && mode === 'production');

  return res.json({
    success: true,
    appId: appId || 'test_app_placeholder',
    mode,
    isLive,
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
    const { amount, currency = 'INR', orderId: clientOrderId, customer } = req.body || {};

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid payment amount in INR is required.' });
    }

    const { appId, secretKey, mode, apiVersion } = getCashfreeCredentials();

    const rawOrderId = clientOrderId || ('ak_order_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
    const orderId = String(rawOrderId).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45);
    const customerId = (authUser?.id || customer?.userId || ('cust_' + Date.now())).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45);
    const rawPhone = (customer?.phone || authUser?.phone_number || '').replace(/[^0-9]/g, '');
    const customerPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : '9876543210';
    const customerEmail = customer?.email || authUser?.email || 'customer@audioking.co.in';
    const customerName = customer?.name || customer?.fullName || authUser?.full_name || 'Audio Creator';

    // If real credentials are provided, call Cashfree PG API
    if (appId && secretKey && !appId.includes('placeholder')) {
      const endpoint = getCashfreeEndpoint('/orders');
      const orderMeta = {
        return_url: `${SITE_URL}/?order_id={order_id}`
      };
      if (process.env.CASHFREE_WEBHOOK_URL) {
        orderMeta.notify_url = process.env.CASHFREE_WEBHOOK_URL;
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
          'Content-Type': 'application/json'
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

    // --- Sandbox Simulation Mode ---
    // When merchant keys are pending, return synthetic payment session for seamless checkout flow
    console.warn('[CASHFREE] No production keys configured. Falling back to sandbox simulation.');
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
 * Verifies transaction status with Cashfree.
 */
router.post('/verify', async (req, res) => {
  try {
    const { orderId, isMock } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required for payment verification.' });
    }

    const { appId, secretKey, apiVersion } = getCashfreeCredentials();

    if (appId && secretKey && !appId.includes('placeholder') && !isMock) {
      const endpoint = getCashfreeEndpoint(`/orders/${encodeURIComponent(orderId)}`);

      let cfData = null;
      // Poll up to 3 times (1.2s delay) if order status is still processing or active
      for (let attempt = 0; attempt < 3; attempt++) {
        const cfRes = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'x-client-id': appId,
            'x-client-secret': secretKey,
            'x-api-version': apiVersion,
            'Content-Type': 'application/json'
          }
        });

        cfData = await cfRes.json();
        if (cfData && cfData.order_status === 'PAID') break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
      }

      if (!cfData || (cfData.message && !cfData.order_status)) {
        return res.status(400).json({
          success: false,
          error: cfData?.message || 'Could not verify Cashfree order status.'
        });
      }

      const isPaid = cfData.order_status === 'PAID';

      if (isPaid) {
        try {
          db.prepare(`
            UPDATE orders 
            SET status = 'Confirmed', updated_at = ? 
            WHERE (order_number = ? OR id = ?) AND status != 'Cancelled'
          `).run(new Date().toISOString(), cfData.order_id, cfData.order_id);
        } catch (_) {}
      }

      return res.json({
        success: isPaid,
        verified: isPaid,
        orderId: cfData.order_id,
        orderStatus: cfData.order_status,
        amount: cfData.order_amount,
        paymentId: `cf_pay_${cfData.order_id}`,
        isMock: false
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

module.exports = router;
