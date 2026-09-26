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
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

function getCashfreeEndpoint(path) {
  const mode = (process.env.CASHFREE_MODE || 'sandbox').trim().toLowerCase();
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
  const appId = (process.env.CASHFREE_APP_ID || '').trim();
  const mode = (process.env.CASHFREE_MODE || 'sandbox').trim().toLowerCase();
  const isLive = Boolean(appId && !appId.includes('placeholder') && mode === 'production');

  return res.json({
    success: true,
    appId: appId || 'test_app_placeholder',
    mode: mode === 'production' ? 'production' : 'sandbox',
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
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { amount, currency = 'INR', orderId: clientOrderId, customer } = req.body || {};

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid payment amount in INR is required.' });
    }

    const appId = (process.env.CASHFREE_APP_ID || '').trim();
    const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
    const apiVersion = process.env.CASHFREE_API_VERSION || '2023-08-01';
    const mode = (process.env.CASHFREE_MODE || 'sandbox').trim().toLowerCase();

    const orderId = clientOrderId || ('ak_order_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
    const customerId = req.user?.id ? req.user.id.replace(/[^a-zA-Z0-9_-]/g, '_') : ('cust_' + Date.now());
    const customerPhone = (customer?.phone || req.user?.phone_number || '9876543210').replace(/[^0-9]/g, '').slice(-10);
    const customerEmail = customer?.email || req.user?.email || 'customer@audioking.in';
    const customerName = customer?.name || req.user?.fullName || req.user?.display_name || 'Audio Creator';

    // If real credentials are provided, call Cashfree PG API
    if (appId && secretKey && !appId.includes('placeholder')) {
      const endpoint = getCashfreeEndpoint('/orders');
      const payload = {
        order_id: orderId,
        order_amount: Math.round(Number(amount) * 100) / 100,
        order_currency: currency.toUpperCase(),
        customer_details: {
          customer_id: customerId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone.length === 10 ? customerPhone : '9876543210'
        },
        order_meta: {
          return_url: `https://audioking30.github.io/Audio-King-Official/?order_id={order_id}&order_token={order_token}`,
          notify_url: process.env.CASHFREE_WEBHOOK_URL || undefined
        },
        order_note: `AudioKing Pro Audio Equipment Order ${orderId}`
      };

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
        console.error('[CASHFREE CREATE ORDER ERROR]', cfData);
        return res.status(cfRes.status).json({
          error: cfData.message || 'Failed to initiate Cashfree payment session.'
        });
      }

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
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { orderId, isMock } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required for payment verification.' });
    }

    const appId = (process.env.CASHFREE_APP_ID || '').trim();
    const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
    const apiVersion = process.env.CASHFREE_API_VERSION || '2023-08-01';

    if (appId && secretKey && !appId.includes('placeholder') && !isMock) {
      const endpoint = getCashfreeEndpoint(`/orders/${encodeURIComponent(orderId)}`);

      const cfRes = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'x-client-id': appId,
          'x-client-secret': secretKey,
          'x-api-version': apiVersion,
          'Content-Type': 'application/json'
        }
      });

      const cfData = await cfRes.json();

      if (!cfRes.ok) {
        return res.status(cfRes.status).json({
          success: false,
          error: cfData.message || 'Could not verify Cashfree order status.'
        });
      }

      const isPaid = cfData.order_status === 'PAID';

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
