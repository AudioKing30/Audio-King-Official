/**
 * AudioKing Reactive Cart State & Drawer Controller
 * Fully backed by real SQLite database with immediate writes for adds, removes, and quantity updates.
 * Guest cart seamlessly merges into customer DB cart upon signin without duplicating items.
 */
import { AUDIOKING_CONFIG } from '../config.js';
import { formatINR, resolveProductImage } from '../utils/formatters.js';
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

function saveCart(syncWithServer = false) {
  setStorage(STORAGE_KEY, cart);
  updateCartBadge();
  renderCartDrawer();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ak:cart-updated', { detail: cart }));
  }
}

/**
 * Hydrates customer cart straight from SQLite database.
 * Merges any anonymous guest cart items without duplicating.
 */
export async function hydrateCartFromServer() {
  if (!authService.isAuthenticated()) return;
  try {
    if (cart.length > 0) {
      const mergePayload = cart.map(i => ({ productId: i.id || i.productId, qty: i.qty || i.quantity || 1 }));
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
    console.warn('[Hydrate Cart Error]', e);
  }
}

function hydrateFromList(serverItems) {
  const newCart = [];
  serverItems.forEach(it => {
    const pId = it.productId || it.id;
    // Prefer server-joined live product details
    if (it.name && it.price !== undefined) {
      newCart.push({
        id: pId,
        productId: it.productId || (String(pId).includes('_') ? String(pId).split('_')[0] : pId),
        variantId: it.variantId || (String(pId).includes('_') ? String(pId).split('_')[1] : null),
        optionLabels: it.optionLabels || '',
        brand: it.brand || 'Pro Audio',
        name: it.name,
        category: it.category || 'Pro Audio',
        price: Number(it.price) || 0,
        originalPrice: Number(it.originalPrice) || 0,
        image: it.image || 'assets/images/placeholder.svg',
        qty: Number(it.qty || it.quantity) || 1,
        isPreOrder: Boolean(it.isPreOrder || it.is_preorder || it.stockStatus === 'preorder' || (it.badge && String(it.badge).toLowerCase().includes('pre-order')))
      });
      return;
    }
    // Fallback to searching live/static catalog
    const allProds = window._liveCatalogProducts || AUDIOKING_PRODUCTS || [];
    const prod = allProds.find(p => p && String(p.id) === String(pId));
    if (prod) {
      newCart.push({
        id: prod.id,
        brand: prod.brand,
        name: prod.name,
        category: prod.category,
        price: prod.price,
        originalPrice: prod.originalPrice || 0,
        image: prod.image || 'assets/images/placeholder.svg',
        qty: Number(it.qty || it.quantity) || 1,
        isPreOrder: Boolean(prod.isPreOrder || prod.stockStatus === 'preorder' || (prod.badge && String(prod.badge).toLowerCase().includes('pre-order')))
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

/**
 * Reset local browser session cart on logout.
 * Note: Database records are NEVER deleted on logout!
 */
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
  const sId = String(productId);
  const item = cart.find(i => String(i.id) === sId);
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

/**
 * Add product to cart.
 * Writes immediately to SQLite database when user is authenticated.
 */
export async function addToCart(product, qty = 1, silent = false) {
  if (!product) return false;

  // Strict Sign-In Gate: Users must be authenticated before adding items to cart
  if (!authService.isAuthenticated()) {
    showToast('Please sign in to add products to your cart', 'error');
    openAuthModal('signin', 'Please sign in to add items to your cart.');
    return false;
  }

  const pId = String(product.id);
  const quantity = Math.max(1, Number(qty) || 1);

  // Update in-memory state
  const existing = cart.find(item => String(item.id) === pId);
  if (existing) {
    existing.qty += quantity;
  } else {
    cart.push({
      id: product.id,
      productId: product.productId || product.id,
      variantId: product.variantId || null,
      optionLabels: product.optionLabels || '',
      brand: product.brand,
      name: product.name,
      category: product.category,
      price: Number(product.price) || 0,
      originalPrice: product.originalPrice ? Number(product.originalPrice) : 0,
      image: product.image || 'assets/images/placeholder.svg',
      qty: quantity,
      isPreOrder: Boolean(product.isPreOrder || product.stockStatus === 'preorder' || (product.badge && String(product.badge).toLowerCase().includes('pre-order')))
    });
  }
  saveCart(false);
  animateCartButton();
  if (!silent) {
    showToast(`Added ${product.name.substring(0, 26)}... to cart`, getIcon('check', '', 18));
  }

  // If authenticated, persist immediately to database
  if (authService.isAuthenticated()) {
    try {
      const res = await authService.safeFetch('/api/user/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: pId, qty: quantity })
      });
      if (res.ok && Array.isArray(res.data?.cart)) {
        hydrateFromList(res.data.cart);
      } else if (!res.ok) {
        showToast('Failed to save cart to server. Please check your connection.', 'error');
      }
    } catch (e) {
      showToast('Failed to save cart to server.', 'error');
    }
  }
  return true;
}

/**
 * Increment or decrement item quantity.
 * Writes immediately to SQLite database when user is authenticated.
 */
export async function updateCartItemQty(productId, delta) {
  if (!authService.isAuthenticated()) {
    showToast('Please sign in to manage your cart.', 'error');
    openAuthModal('signin', 'Please sign in to manage your cart.');
    return;
  }
  const pId = String(productId);
  const item = cart.find(i => String(i.id) === pId);
  if (!item) return;

  const newQty = item.qty + delta;
  if (newQty <= 0) {
    cart = cart.filter(i => String(i.id) !== pId);
  } else {
    item.qty = newQty;
  }
  saveCart(false);

  if (authService.isAuthenticated()) {
    try {
      let res;
      if (newQty <= 0) {
        res = await authService.safeFetch(`/api/user/cart/items/${encodeURIComponent(pId)}`, {
          method: 'DELETE'
        });
      } else {
        res = await authService.safeFetch(`/api/user/cart/items/${encodeURIComponent(pId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qty: newQty })
        });
      }
      if (res.ok && Array.isArray(res.data?.cart)) {
        hydrateFromList(res.data.cart);
      } else if (!res.ok) {
        showToast('Failed to update cart on server.', 'error');
      }
    } catch (e) {
      showToast('Failed to update cart on server.', 'error');
    }
  }
}

/**
 * Remove an item completely from cart.
 * Writes immediately to SQLite database when user is authenticated.
 */
export async function removeCartItem(productId) {
  const pId = String(productId);
  cart = cart.filter(i => String(i.id) !== pId);
  saveCart(false);
  showToast('Item removed from cart');

  if (authService.isAuthenticated()) {
    try {
      const res = await authService.safeFetch(`/api/user/cart/items/${encodeURIComponent(pId)}`, {
        method: 'DELETE'
      });
      if (res.ok && Array.isArray(res.data?.cart)) {
        hydrateFromList(res.data.cart);
      } else if (!res.ok) {
        showToast('Failed to remove item from server cart.', 'error');
      }
    } catch (e) {
      showToast('Failed to remove item from server cart.', 'error');
    }
  }
}

/**
 * Clear the cart (e.g. after order placement)
 */
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
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } else {
        window.location.hash = '';
      }
    } catch (_) {}
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

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="ak-cart-empty">
        <svg class="ak-cart-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
        <p class="ak-cart-empty-title">Your cart is empty</p>
        <p class="ak-cart-empty-sub">Explore our studio pro audio gear and add products to your setup.</p>
        <a href="#store" class="ak-cart-empty-btn" onclick="closeCartDrawer()">Start Shopping</a>
      </div>
    `;
    if (subtotalEl) subtotalEl.textContent = formatINR(0);
    if (totalEl) totalEl.textContent = formatINR(0);
    if (checkoutBtn) {
      checkoutBtn.disabled = true;
      checkoutBtn.style.opacity = '0.5';
      checkoutBtn.style.cursor = 'not-allowed';
    }
    return;
  }

  if (checkoutBtn) {
    checkoutBtn.disabled = false;
    checkoutBtn.style.opacity = '1';
    checkoutBtn.style.cursor = 'pointer';
  }

  container.innerHTML = cart.map(item => `
    <div class="ak-cart-item" data-id="${item.id}">
      <div class="ak-cart-item-img">
        <img src="${resolveProductImage(item.image)}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src='assets/images/placeholder.svg';">
      </div>
      <div class="ak-cart-item-details">
        <span class="ak-cart-item-brand">${item.brand || 'Pro Audio'}</span>
        <h4 class="ak-cart-item-title">${item.name}</h4>
        ${item.optionLabels ? `<div style="font-size: 11px; color: var(--ak-orange); font-weight: 600; margin-top: 2px;">Variant: ${item.optionLabels}</div>` : ''}
        <div class="ak-cart-item-price">
          ${formatINR(item.price)}
          ${(item.originalPrice && item.originalPrice > item.price) ? `<span style="text-decoration: line-through; color: #94A3B8; font-size: 11px; margin-left: 6px;">${formatINR(item.originalPrice)}</span>` : ''}
        </div>
        <div class="ak-cart-item-actions">
          <div class="ak-cart-stepper">
            <button type="button" class="ak-stepper-btn ak-cart-minus" data-id="${item.id}" aria-label="Decrease quantity">−</button>
            <span class="ak-stepper-val">${item.qty}</span>
            <button type="button" class="ak-stepper-btn ak-cart-plus" data-id="${item.id}" aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="ak-cart-item-remove" data-id="${item.id}" aria-label="Remove item">Remove</button>
        </div>
      </div>
    </div>
  `).join('');

  const subtotal = getCartSubtotal();
  if (subtotalEl) subtotalEl.textContent = formatINR(subtotal);
  if (totalEl) totalEl.textContent = formatINR(subtotal);

  // Bind cart item buttons
  container.querySelectorAll('.ak-cart-minus').forEach(btn => {
    btn.onclick = () => updateCartItemQty(btn.dataset.id, -1);
  });
  container.querySelectorAll('.ak-cart-plus').forEach(btn => {
    btn.onclick = () => updateCartItemQty(btn.dataset.id, 1);
  });
  container.querySelectorAll('.ak-cart-item-remove').forEach(btn => {
    btn.onclick = () => removeCartItem(btn.dataset.id);
  });
}

export function initCart() {
  updateCartBadge();
  const trigger = document.getElementById('akCartTrigger');
  const closeBtn = document.getElementById('akCartClose') || document.getElementById('akCartCloseBtn');
  const backdrop = document.getElementById('akCartBackdrop');
  const checkoutBtn = document.getElementById('akProceedCheckoutBtn');

  if (trigger) trigger.addEventListener('click', () => openCartDrawer(true));
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeCartDrawer();
    });
  }

  // Delegated click handler guarantees [X] button or child SVG closes the drawer
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest('#akCartClose, #akCartCloseBtn, .ak-cart-close');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      closeCartDrawer();
    }
  });

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

  // On initial page load: if authenticated, hydrate directly from server
  if (authService.isAuthenticated()) {
    hydrateCartFromServer();
  }
}
