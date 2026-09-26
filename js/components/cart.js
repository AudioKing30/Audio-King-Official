/**
 * AudioKing Reactive Cart State & Drawer Controller
 */
import { AUDIOKING_CONFIG } from '../config.js';
import { formatINR } from '../utils/formatters.js';
import { getStorage, setStorage } from '../utils/storage.js';
import { getIcon } from '../../assets/icons/icons.js';
import { showToast } from './toast.js';
import { openCheckoutModal } from './checkout.js';
import { getCurrentUser, openAuthModal } from './auth.js';
import { AUDIOKING_PRODUCTS } from '../data/products.js';
import { authService } from '../services/authService.js';

const STORAGE_KEY = AUDIOKING_CONFIG.cartStorageKey;
let cart = [];

const loaded = getStorage(STORAGE_KEY, []);
cart = Array.isArray(loaded) ? loaded : [];

let syncDebounceTimer = null;
function syncCartWithBackend() {
  if (!authService.isAuthenticated()) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    const payload = cart.map(item => ({
      id: item.id,
      productId: item.id,
      qty: item.qty,
      quantity: item.qty
    }));
    authService.safeFetch('/api/user/cart', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload })
    }).catch(e => console.warn('[Cart Sync]', e));
  }, 300);
}

function saveCart(sync = true) {
  setStorage(STORAGE_KEY, cart);
  updateCartBadge();
  renderCartDrawer();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ak:cart-updated', { detail: cart }));
  }
  if (sync) {
    syncCartWithBackend();
  }
}

export async function hydrateCartFromServer() {
  if (!authService.isAuthenticated()) return;
  try {
    if (cart.length > 0) {
      const mergePayload = cart.map(i => ({ productId: i.id, qty: i.qty }));
      const mergeRes = await authService.safeFetch('/api/user/cart/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: mergePayload })
      });
      if (mergeRes.ok && Array.isArray(mergeRes.data?.cart)) {
        hydrateFromList(mergeRes.data.cart);
        return;
      }
    }

    const res = await authService.safeFetch('/api/user/cart', { method: 'GET' });
    if (res.ok && Array.isArray(res.data?.cart)) {
      hydrateFromList(res.data.cart);
    }
  } catch (e) {
    console.warn('[Hydrate Cart]', e);
  }
}

function hydrateFromList(serverItems) {
  const newCart = [];
  serverItems.forEach(it => {
    const pId = it.productId || it.id;
    const prod = (AUDIOKING_PRODUCTS || []).find(p => p.id === pId);
    if (prod) {
      newCart.push({
        id: prod.id,
        brand: prod.brand,
        name: prod.name,
        category: prod.category,
        price: prod.price,
        image: prod.image,
        qty: Number(it.qty || it.quantity) || 1
      });
    }
  });
  cart = newCart;
  setStorage(STORAGE_KEY, cart);
  updateCartBadge();
  renderCartDrawer();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ak:cart-updated', { detail: cart }));
  }
}

export function handleLogoutCartReset() {
  cart = [];
  setStorage(STORAGE_KEY, []);
  updateCartBadge();
  renderCartDrawer();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ak:cart-updated', { detail: [] }));
  }
}

export function getCartItems() {
  return [...cart];
}

export function getCartItemQuantity(productId) {
  const item = cart.find(i => i.id === productId);
  return item ? (Number(item.qty) || 0) : 0;
}

export function getCartCount() {
  return cart.reduce((total, item) => total + (Number(item.qty) || 1), 0);
}

export function getCartSubtotal() {
  return cart.reduce((total, item) => total + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);
}

export function animateCartButton() {
  const trigger = document.getElementById('akCartTrigger');
  const badges = document.querySelectorAll('.ak-cart-badge, #akCartCount');
  if (trigger) {
    trigger.classList.remove('ak-cart-animating');
    void trigger.offsetWidth;
    trigger.classList.add('ak-cart-animating');
    setTimeout(() => {
      trigger.classList.remove('ak-cart-animating');
    }, 600);
  }
  badges.forEach(badge => {
    badge.classList.remove('ak-cart-badge-animating');
    void badge.offsetWidth;
    badge.classList.add('ak-cart-badge-animating');
    setTimeout(() => {
      badge.classList.remove('ak-cart-badge-animating');
    }, 650);
  });
}

if (typeof window !== 'undefined') {
  window.animateCartButton = animateCartButton;
}

export function addToCart(product, qty = 1, silent = false) {
  const user = getCurrentUser();
  if (!user) {
    openAuthModal('signin', 'To proceed shopping you need to sign in');
    showToast('Please sign in to add items to your cart');
    return false;
  }

  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id,
      brand: product.brand,
      name: product.name,
      category: product.category,
      price: product.price,
      image: product.image,
      qty: qty
    });
  }
  saveCart();
  animateCartButton();
  if (!silent) {
    showToast(`Added ${product.name.substring(0, 26)}... to cart`, getIcon('check', '', 18));
  }
}

export function updateCartItemQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  saveCart();
}

export function removeCartItem(productId) {
  cart = cart.filter(i => i.id !== productId);
  saveCart();
  showToast('Item removed from cart');
}

export function clearCart() {
  cart = [];
  saveCart(false);
  if (authService.isAuthenticated()) {
    authService.safeFetch('/api/user/cart', { method: 'DELETE' }).catch(() => {});
  }
}

export function openCartDrawer(updateHash = true) {
  const backdrop = document.getElementById('akCartBackdrop');
  if (backdrop) {
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCartDrawer();
  }
  if (updateHash && typeof window !== 'undefined' && window.location.hash !== '#cart') {
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', '#cart');
    }
  }
}

export function closeCartDrawer() {
  const backdrop = document.getElementById('akCartBackdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }
  if (typeof window !== 'undefined' && window.location.hash === '#cart') {
    if (window.history && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.hash = '#home';
    }
  }
}

export function updateCartBadge() {
  const badge = document.getElementById('akCartBadge');
  const count = getCartCount();
  if (badge) {
    badge.textContent = count;
  }
}

export function renderCartDrawer() {
  const container = document.getElementById('akCartItemsList');
  const subtotalEl = document.getElementById('akCartSubtotal');
  const totalEl = document.getElementById('akCartTotal');
  const checkoutBtn = document.getElementById('akProceedCheckoutBtn');
  
  if (!container) return;

  const subtotal = getCartSubtotal();
  if (subtotalEl) subtotalEl.textContent = formatINR(subtotal);
  if (totalEl) totalEl.textContent = formatINR(subtotal);

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="ak-cart-empty">
        <div class="ak-cart-empty-icon">${getIcon('cart', '', 32)}</div>
        <h4 style="font-size: 16px; color: var(--ak-navy); margin-bottom: 6px;">Your cart is empty</h4>
        <p style="font-size: 13px;">Discover our collection of pro-audio equipment and instruments.</p>
      </div>
    `;
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  if (checkoutBtn) checkoutBtn.disabled = false;

  container.innerHTML = cart.map(item => `
    <div class="ak-cart-item" data-id="${item.id}">
      <div class="ak-cart-item-img">
        ${item.image ? `<img src="${item.image}" alt="${item.name}" onerror="this.src=''; this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
        <div class="ak-placeholder-thumb" style="${item.image ? 'display:none;' : 'display:flex;'}">
          <span style="font-size: 10px; font-weight:800; color:var(--ak-orange);">${item.brand.substring(0, 6)}</span>
        </div>
      </div>
      <div class="ak-cart-item-body">
        <span class="ak-cart-item-brand">${item.brand}</span>
        <h4 class="ak-cart-item-title">${item.name}</h4>
        <div class="ak-cart-item-price">${formatINR(item.price * item.qty)}</div>
        <div class="ak-cart-item-actions">
          <div class="ak-qty-stepper">
            <button class="ak-qty-btn ak-qty-minus" data-id="${item.id}" aria-label="Decrease quantity">−</button>
            <span class="ak-qty-val">${item.qty}</span>
            <button class="ak-qty-btn ak-qty-plus" data-id="${item.id}" aria-label="Increase quantity">+</button>
          </div>
          <span class="ak-cart-item-remove" data-id="${item.id}">Remove</span>
        </div>
      </div>
    </div>
  `).join('');

  // Attach item control listeners
  container.querySelectorAll('.ak-qty-minus').forEach(btn => {
    btn.addEventListener('click', () => updateCartItemQty(btn.dataset.id, -1));
  });
  container.querySelectorAll('.ak-qty-plus').forEach(btn => {
    btn.addEventListener('click', () => updateCartItemQty(btn.dataset.id, 1));
  });
  container.querySelectorAll('.ak-cart-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeCartItem(btn.dataset.id));
  });
}

export function initCart() {
  updateCartBadge();
  const trigger = document.getElementById('akCartTrigger');
  const closeBtn = document.getElementById('akCartClose');
  const backdrop = document.getElementById('akCartBackdrop');
  const checkoutBtn = document.getElementById('akProceedCheckoutBtn');

  if (trigger) trigger.addEventListener('click', openCartDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeCartDrawer);
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeCartDrawer();
    });
  }
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      if (cart.length === 0) return;
      closeCartDrawer();
      openCheckoutModal(getCartItems());
    });
  }

  // Subscribe to auth state to restore / isolate customer cart
  let lastAuthUserId = null;
  authService.subscribe((user, status) => {
    if (status === 'authenticated' && user) {
      if (lastAuthUserId !== user.id) {
        lastAuthUserId = user.id;
        hydrateCartFromServer();
      }
    } else if (status === 'unauthenticated') {
      if (lastAuthUserId) {
        lastAuthUserId = null;
        handleLogoutCartReset();
      }
    }
  });
}
