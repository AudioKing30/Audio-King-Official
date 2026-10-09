/**
 * AudioKing Orders Client Service
 * Interacts with /api/user/orders to fetch and create database-persisted orders.
 * Strictly scoped to authenticated backend user session.
 */

import { authService } from './authService.js';
import { getStorage, setStorage } from '../utils/storage.js';
import { getApiBaseUrl } from './apiConfig.js';

class OrdersService {
  constructor() {
    this.cachedOrders = [];
    authService.subscribe((user, status) => {
      if (status === 'unauthenticated') {
        this.cachedOrders = [];
      }
    });
  }

  getBaseUrl() {
    return getApiBaseUrl();
  }

  getAuthHeaders() {
    const token = getStorage('audioKingSessionToken', null) || 
                  getStorage('audioking_token', null) || 
                  getStorage('audioKingToken', null);
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  /**
   * Fetch all orders belonging to authenticated user
   */
  async getOrders() {
    const user = authService.getUser();
    const localKey = user ? `audioking_orders_${user.id}` : 'audioking_guest_orders';

    try {
      const baseUrl = this.getBaseUrl();
      const res = await fetch(`${baseUrl}/api/user/orders`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          ...this.getAuthHeaders()
        }
      });

      if (res.ok) {
        const data = await res.json();
        this.cachedOrders = data.orders || [];
        setStorage(localKey, this.cachedOrders);
        return this.cachedOrders;
      }
    } catch (err) {
      console.warn('[OrdersService] Server fetch unavailable, loading from local mirror:', err.message);
    }

    // Fallback to local storage mirror
    this.cachedOrders = getStorage(localKey, []);
    return this.cachedOrders;
  }

  /**
   * Create and persist new order upon checkout completion
   */
  async createOrder(orderData) {
    const user = authService.getUser();
    const localKey = user ? `audioking_orders_${user.id}` : 'audioking_guest_orders';

    const payload = {
      orderNumber: orderData.orderId,
      items: orderData.items || [],
      customer: orderData.customer || {},
      shippingAddress: orderData.customer || {},
      paymentMethod: orderData.paymentMethod || 'Prepaid Online (UPI)',
      couponCode: orderData.couponCode || null
    };

    let serverSavedOrder = null;

    try {
      const baseUrl = this.getBaseUrl();
      const res = await fetch(`${baseUrl}/api/user/orders`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        serverSavedOrder = data.order;
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned error (${res.status}) while creating order.`);
      }
    } catch (err) {
      console.error('[OrdersService] Failed to persist order to database:', err);
      throw err;
    }

    if (!serverSavedOrder) {
      throw new Error('Order could not be saved to server database.');
    }

    const currentList = getStorage(localKey, []);
    const exists = currentList.some(o => o.id === serverSavedOrder.id);
    if (!exists) {
      currentList.unshift(serverSavedOrder);
      setStorage(localKey, currentList);
    }
    this.cachedOrders = currentList;

    return serverSavedOrder;
  }
}

export const ordersService = new OrdersService();
