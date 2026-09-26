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

import { CashfreePaymentAdapter } from './cashfreeAdapter.js';
import { RazorpayPaymentAdapter } from './razorpayAdapter.js';

export { CashfreePaymentAdapter, RazorpayPaymentAdapter };

// Active gateway adapter: Cashfree Payments (v3 SDK with Sandbox / Production support)
export const activePaymentAdapter = new CashfreePaymentAdapter();
