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
      paymentMethod: orderData.paymentMethod || 'Cash on Delivery (COD)',
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
      }
    } catch (err) {
      console.warn('[OrdersService] Could not persist to backend directly, saving locally:', err.message);
    }

    // Format local order object
    const finalOrder = serverSavedOrder || {
      id: 'ord_' + Date.now(),
      orderNumber: orderData.orderId || ('AK-' + Date.now()),
      totalAmount: (orderData.items || []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1), 0),
      status: 'Confirmed',
      shippingAddress: orderData.customer || {},
      paymentMethod: orderData.paymentMethod || 'Cash on Delivery (COD)',
      createdAt: new Date().toISOString(),
      items: (orderData.items || []).map(it => ({
        id: 'item_' + Math.random().toString(36).substr(2, 6),
        name: it.name,
        image: it.image || it.img || 'assets/images/logo.jpg',
        quantity: it.qty || it.quantity || 1,
        unitPrice: it.price || 0,
        subtotal: (Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)
      }))
    };

    const currentList = getStorage(localKey, []);
    currentList.unshift(finalOrder);
    setStorage(localKey, currentList);
    this.cachedOrders = currentList;

    return finalOrder;
  }
}

export const ordersService = new OrdersService();
