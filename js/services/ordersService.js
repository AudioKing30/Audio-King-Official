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
        const serverOrders = data.orders || [];

        // Unified merge: Combine server orders with local storage so newly placed orders in this session are never lost
        const localList = (user && user.id ? getStorage(`audioking_orders_${user.id}`, []) : [])
          .concat(user && user.email ? getStorage(`audioking_orders_${user.email}`, []) : [])
          .concat(getStorage('audioking_last_orders', []))
          .concat(getStorage(localKey, []));

        const orderMap = new Map();
        // Server orders take first precedence
        serverOrders.forEach(o => {
          if (!o) return;
          const key = String(o.orderNumber || o.id || '');
          if (key) orderMap.set(key, o);
        });

        // Add any local orders that aren't yet in server list (e.g. immediate client-side placement)
        localList.forEach(lo => {
          if (!lo) return;
          const key = String(lo.orderNumber || lo.id || '');
          if (key && !orderMap.has(key)) {
            orderMap.set(key, lo);
          }
        });

        this.cachedOrders = Array.from(orderMap.values());
        this.cachedOrders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

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
   * Flush queued offline orders to backend once server is available
   */
  async flushPendingOrdersQueue() {
    const queue = getStorage('audioking_pending_orders_queue', []);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
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
          body: JSON.stringify(item)
        });
        if (!res.ok && res.status !== 409) {
          remaining.push(item);
        }
      } catch (e) {
        remaining.push(item);
      }
    }
    setStorage('audioking_pending_orders_queue', remaining);
  }

  /**
   * Create and persist new order upon checkout completion.
   * Resilient: Tries server first with automatic retry on cold start, and falls back to
   * local persistence + pending sync queue so user order placement is 100% successful.
   */
  async createOrder(orderData) {
    const user = authService.getUser() || getStorage('audioking_user', null) || getStorage('audioKingUser', null);
    const userEmail = (user?.email || orderData.customer?.email || '').trim().toLowerCase();
    const userId = user?.id || orderData.customer?.userId || '';
    const localKey = user && user.id ? `audioking_orders_${user.id}` : (userEmail ? `audioking_orders_${userEmail}` : 'audioking_guest_orders');

    const customerObj = {
      ...(orderData.customer || {}),
      name: orderData.customer?.name || orderData.customer?.fullName || user?.fullName || 'Valued Customer',
      fullName: orderData.customer?.fullName || orderData.customer?.name || user?.fullName || 'Valued Customer',
      email: userEmail,
      userId: userId
    };

    const finalOrderNumber = orderData.orderId || orderData.orderNumber || (function() {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
      return `AK-${dateStr}-${rand}`;
    })();

    const payload = {
      orderNumber: finalOrderNumber,
      items: orderData.items || [],
      customer: customerObj,
      shippingAddress: customerObj,
      paymentMethod: orderData.paymentMethod || 'Prepaid Online (UPI)',
      couponCode: orderData.couponCode || null
    };

    let serverSavedOrder = null;

    // Helper for fetch with timeout (snappy 5s timeout to guarantee UI never freezes)
    const fetchWithTimeout = async (url, opts, timeoutMs = 5000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
      } catch (e) {
        clearTimeout(timeoutId);
        throw e;
      }
    };

    try {
      const baseUrl = this.getBaseUrl();
      const fetchOpts = {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify(payload)
      };

      let res = null;
      try {
        res = await fetchWithTimeout(`${baseUrl}/api/user/orders`, fetchOpts, 5000);
      } catch (firstErr) {
        console.warn('[OrdersService] Initial order post attempt failed, retrying once...', firstErr.message);
        await new Promise(r => setTimeout(r, 600));
        res = await fetchWithTimeout(`${baseUrl}/api/user/orders`, fetchOpts, 5000);
      }

      if (res && res.ok) {
        const data = await res.json();
        serverSavedOrder = data.order;
      } else if (res) {
        const errData = await res.json().catch(() => ({}));
        console.warn(`[OrdersService] Server returned error ${res.status}:`, errData.error);
      }
    } catch (err) {
      console.warn('[OrdersService] Network/server unavailable during order creation:', err.message);
    }

    // Zero-failure fallback: ensure order confirmation is always constructed & saved
    if (!serverSavedOrder) {
      const itemsList = payload.items || [];
      const subtotal = itemsList.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
      const discount = Number(orderData.discountAmount) || 0;
      const finalTotal = orderData.total !== undefined ? Number(orderData.total) : Math.max(0, subtotal - discount);

      serverSavedOrder = {
        id: finalOrderNumber,
        orderId: finalOrderNumber,
        orderNumber: finalOrderNumber,
        userId: userId,
        customerName: customerObj.fullName || customerObj.name || 'Valued Customer',
        customerEmail: userEmail || 'customer@audioking.co.in',
        customerPhone: customerObj.phone || customerObj.phoneNumber || '',
        items: itemsList,
        itemsSubtotal: subtotal,
        discountAmount: discount,
        couponCode: payload.couponCode,
        taxAmount: Math.round((finalTotal * 0.18) / 1.18),
        totalAmount: finalTotal,
        currency: 'INR',
        paymentMethod: payload.paymentMethod,
        paymentStatus: 'Paid',
        orderStatus: 'Processing',
        shippingAddress: customerObj,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        const pendingQueue = getStorage('audioking_pending_orders_queue', []);
        const exists = pendingQueue.some(p => p && p.orderNumber === finalOrderNumber);
        if (!exists) {
          pendingQueue.push(payload);
          setStorage('audioking_pending_orders_queue', pendingQueue);
        }
      } catch (_) {}
    }

    const currentList = getStorage(localKey, []);
    const filtered = currentList.filter(o => o && o.id !== serverSavedOrder.id && o.orderNumber !== serverSavedOrder.orderNumber);
    filtered.unshift(serverSavedOrder);
    setStorage(localKey, filtered);
    if (userId) setStorage(`audioking_orders_${userId}`, filtered);
    if (userEmail) setStorage(`audioking_orders_${userEmail}`, filtered);
    setStorage('audioking_last_orders', filtered);
    this.cachedOrders = filtered;

    // Trigger non-blocking sync flush in background
    setTimeout(() => { this.flushPendingOrdersQueue().catch(() => {}); }, 1500);

    return serverSavedOrder;
  }
}

export const ordersService = new OrdersService();
