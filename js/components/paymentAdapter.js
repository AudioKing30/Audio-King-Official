/**
 * AudioKing Payment Adapter Architecture
 * Clean adapter pattern isolating payment gateway integration from frontend checkout state.
 * 
 * Pipeline:
 *   Cart -> Address -> Payment Method Selection -> Demo Payment Processing -> Order Confirmation
 * 
 * Hierarchy:
 *   PaymentAdapter (Base Interface)
 *         ↓
 *   DemoPaymentAdapter (Active Frontend Prototype)
 *         ↓
 *   CashfreePaymentAdapter (Future Backend Gateway Hook)
 */

export class BasePaymentAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Process payment for an order
   * @param {Object} orderData - { items, customer, paymentMethod, total }
   * @returns {Promise<{ success: boolean, transactionId: string, message: string }>}
   */
  async processPayment(orderData) {
    throw new Error('processPayment() must be implemented by concrete adapter subclass.');
  }
}

/**
 * DemoPaymentAdapter
 * Active adapter used for the frontend prototype.
 * Simulates real gateway round-trip latency without claiming real financial transactions.
 */
export class DemoPaymentAdapter extends BasePaymentAdapter {
  constructor() {
    super('DemoPaymentAdapter');
  }

  async processPayment(orderData) {
    return new Promise((resolve) => {
      // Simulate quick gateway handshake
      setTimeout(() => {
        const randTxn = 'DEMO_TXN_' + Math.random().toString(36).substring(2, 9).toUpperCase();
        resolve({
          success: true,
          transactionId: randTxn,
          paymentMethod: orderData.paymentMethod || 'UPI',
          timestamp: new Date().toISOString(),
          message: 'Demo payment simulated successfully. No real charge processed.'
        });
      }, 400);
    });
  }
}

/**
 * CashfreePaymentAdapter
 * Future adapter hook for Cashfree Payments integration once backend API is ready.
 */
export class CashfreePaymentAdapter extends BasePaymentAdapter {
  constructor(apiEndpoint = '/api/cashfree') {
    super('CashfreePaymentAdapter');
    this.apiEndpoint = apiEndpoint;
  }

  async processPayment(orderData) {
    /**
     * Future Implementation Blueprint:
     * 1. POST orderData to client backend: fetch(`${this.apiEndpoint}/create-session`)
     * 2. Receive Cashfree payment_session_id
     * 3. Invoke Cashfree JS SDK checkout:
     *    const cashfree = Cashfree({ mode: "sandbox" | "production" });
     *    await cashfree.checkout({ paymentSessionId, redirectTarget: "_modal" });
     * 4. Verify payment signature on backend
     */
    console.warn('[CashfreeAdapter] Backend API integration pending. Using fallback demo handler.');
    return new DemoPaymentAdapter().processPayment(orderData);
  }
}

import { RazorpayPaymentAdapter } from './razorpayAdapter.js';
export { RazorpayPaymentAdapter };

// Active gateway adapter: Razorpay (auto-detects keys or runs sandbox simulation)
export const activePaymentAdapter = new RazorpayPaymentAdapter();
