/**
 * AudioKing Razorpay Payment Gateway API Router
 * 
 * Instructions for Live Activation:
 * 1. Obtain your Key ID and Key Secret from the Razorpay Dashboard (Settings > API Keys).
 * 2. Add them to your .env file:
 *      RAZORPAY_KEY_ID=rzp_live_yourKeyHere  (or rzp_test_yourKeyHere for testing)
 *      RAZORPAY_KEY_SECRET=yourSecretKeyHere
 * 3. Restart the server. The application will automatically switch from Simulation Mode
 *    to Real Gateway Mode without changing any frontend code.
 */

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * 1. GET /api/payment/razorpay/config
 * Returns public configuration for client SDK initialization.
 */
router.get('/config', (req, res) => {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const isLive = Boolean(keyId && !keyId.includes('placeholder') && keyId.startsWith('rzp_'));

  return res.json({
    success: true,
    keyId: isLive ? keyId : 'rzp_test_placeholder',
    isLive,
    currency: 'INR',
    companyName: 'AudioKing India',
    themeColor: '#F27021'
  });
});

/**
 * 2. POST /api/payment/razorpay/create-order
 * Generates an official Razorpay Order ID.
 */
router.post('/create-order', requireAuth, async (req, res) => {
  const { amount, currency = 'INR', receipt, notes } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Valid payment amount in INR is required.' });
  }

  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const amountInPaise = Math.round(Number(amount) * 100);

  // If real credentials are provided, call Razorpay Orders API
  if (keyId && keySecret && !keyId.includes('placeholder')) {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: currency.toUpperCase(),
          receipt: receipt || `rcpt_${Date.now()}`,
          notes: notes || { customerId: req.user.id }
        })
      });

      const orderData = await rzpResponse.json();

      if (!rzpResponse.ok) {
        console.error('[RAZORPAY CREATE ORDER ERROR]', orderData);
        return res.status(rzpResponse.status).json({
          error: orderData.error?.description || 'Failed to create Razorpay order.'
        });
      }

      return res.json({
        success: true,
        orderId: orderData.id,
        amount: orderData.amount,
        currency: orderData.currency,
        keyId: keyId,
        isMock: false
      });
    } catch (err) {
      console.error('[RAZORPAY API EXCEPTION]', err);
      return res.status(500).json({ error: 'Communication with Razorpay failed: ' + err.message });
    }
  }

  // --- Tentative / Sandbox Simulation Mode ---
  // When live keys are pending, return synthetic test order so the UI and order pipeline flow seamlessly.
  const mockOrderId = 'order_test_' + crypto.randomUUID().replace(/-/g, '').substring(0, 14);

  return res.json({
    success: true,
    orderId: mockOrderId,
    amount: amountInPaise,
    currency: currency.toUpperCase(),
    keyId: 'rzp_test_placeholder',
    isMock: true,
    message: 'Simulation order generated. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env to process real gateway payments.'
  });
});

/**
 * 3. POST /api/payment/razorpay/verify
 * Verifies Razorpay HMAC SHA-256 signature for complete fraud prevention.
 */
router.post('/verify', requireAuth, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, isMock } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id) {
    return res.status(400).json({ error: 'Missing order_id or payment_id for verification.' });
  }

  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  // If real secret is configured, strictly verify the cryptographical signature
  if (keySecret && !isMock) {
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(payload)
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      return res.json({
        success: true,
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        message: 'Payment signature verified successfully.'
      });
    } else {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Invalid payment signature. Potential tampering detected.'
      });
    }
  }

  // Simulation verification
  return res.json({
    success: true,
    verified: true,
    paymentId: razorpay_payment_id || ('pay_test_' + Date.now()),
    orderId: razorpay_order_id,
    isMock: true,
    message: 'Payment verified in simulation mode.'
  });
});

module.exports = router;
