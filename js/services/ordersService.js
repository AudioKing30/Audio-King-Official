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
    const token = authService.getToken();
    const user = authService.getUser() || getStorage('audioking_user', null) || getStorage('audioKingUser', null);
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Session-Token'] = token;
    }
    if (user && user.email) {
      headers['X-User-Email'] = user.email;
    }
    if (user && user.id) {
      headers['X-User-Id'] = user.id;
    }
    return headers;
  }

  /**
   * Fetch all orders belonging to authenticated user
   */
  async getOrders() {
    const user = authService.getUser() || getStorage('audioking_user', null) || getStorage('audioKingUser', null);
    const localKey = user && user.id ? `audioking_orders_${user.id}` : (user && user.email ? `audioking_orders_${user.email}` : 'audioking_guest_orders');

    try {
      const baseUrl = this.getBaseUrl();
      const headers = {
        'Accept': 'application/json',
        ...this.getAuthHeaders()
      };
      const queryParams = [];
      if (user && user.email) queryParams.push(`email=${encodeURIComponent(user.email)}`);
      if (user && user.id) queryParams.push(`userId=${encodeURIComponent(user.id)}`);
      const queryString = queryParams.length ? `?${queryParams.join('&')}` : '';

      const res = await fetch(`${baseUrl}/api/user/orders${queryString}`, {
        method: 'GET',
        credentials: 'include',
        headers
      });

      if (res.ok) {
        const data = await res.json();
        this.cachedOrders = data.orders || [];
        if (user && user.id) setStorage(`audioking_orders_${user.id}`, this.cachedOrders);
        if (user && user.email) setStorage(`audioking_orders_${user.email}`, this.cachedOrders);
        setStorage(localKey, this.cachedOrders);
        setStorage('audioking_last_orders', this.cachedOrders);
        return this.cachedOrders;
      }
    } catch (err) {
      console.warn('[OrdersService] Server fetch unavailable, loading from local mirror:', err.message);
    }

    // Fallback to local storage mirror
    const cached = (user && user.id ? getStorage(`audioking_orders_${user.id}`, null) : null) ||
                   (user && user.email ? getStorage(`audioking_orders_${user.email}`, null) : null) ||
                   getStorage(localKey, null) || 
                   getStorage('audioking_last_orders', []);
    this.cachedOrders = cached || [];
    return this.cachedOrders;
  }

  /**
   * Create and persist new order upon checkout completion
   */
  async createOrder(orderData) {
    const user = authService.getUser() || getStorage('audioking_user', null) || getStorage('audioKingUser', null);
    const userEmail = (user?.email || orderData.customer?.email || '').trim().toLowerCase();
    const userId = user?.id || orderData.customer?.userId || '';
    const localKey = user && user.id ? `audioking_orders_${user.id}` : (userEmail ? `audioking_orders_${userEmail}` : 'audioking_guest_orders');

    const customerObj = {
      ...(orderData.customer || {}),
      email: userEmail,
      userId: userId
    };

    const payload = {
      orderNumber: orderData.orderId || orderData.orderNumber,
      items: orderData.items || [],
      customer: customerObj,
      shippingAddress: customerObj,
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
    const exists = currentList.some(o => o.id === serverSavedOrder.id || o.orderNumber === serverSavedOrder.orderNumber);
    if (!exists) {
      currentList.unshift(serverSavedOrder);
      setStorage(localKey, currentList);
      if (userId) setStorage(`audioking_orders_${userId}`, currentList);
      if (userEmail) setStorage(`audioking_orders_${userEmail}`, currentList);
      setStorage('audioking_last_orders', currentList);
    }
    this.cachedOrders = currentList;

    return serverSavedOrder;
  }
}

export const ordersService = new OrdersService();
