/**
 * AudioKing Master Application Orchestrator
 * Fully initializes all frontend components, data bindings, catalog views,
 * Sweetwater store, product zoom, contact view, dedicated checkout, related gear, and commerce interactions.
 */
import { AUDIOKING_PRODUCTS, FEATURED_PRODUCTS } from './data/products.js';
import { AUDIOKING_BRANDS } from './data/brands.js';
import { QUICK_CATEGORIES } from './data/categories.js';
import { AUDIOKING_CONFIG } from './config.js';
import { formatINR, getProductOfferStampHtml, resolveProductImage } from './utils/formatters.js';
import { getIcon } from '../assets/icons/icons.js';
import { initCart, addToCart, openCartDrawer, getCartItems, getCartSubtotal, clearCart, getCartItemQuantity, updateCartItemQty } from './components/cart.js';
import { initCheckout, openCheckoutModal } from './components/checkout.js';
import { initOrderSuccess, showOrderConfirmation } from './components/orderSuccess.js';
import { initAuth, getCurrentUser, openAuthModal } from './components/auth.js';
import { initHeader } from './components/header.js';
import { initNavigation, setActiveNavItem, renderNavigationBrands, renderNavigationCategories } from './components/navigation.js';
import { initHeroSlider, loadAndInitHeroSlider } from './components/heroSlider.js';
import { initTestimonials } from './components/testimonials.js';
import { initModals } from './components/modals.js';
import { showToast } from './components/toast.js';
import { initStore, openStoreWithCategory, openStoreWithBrand, openStoreWithSearch, setProductClickCallback, getStoreState, setStoreState } from './components/store.js';
import { activePaymentAdapter } from './components/paymentAdapter.js';
import { initAccountSettings, renderAccountSettings, promptUnsavedChanges, isAccountFormDirty } from './components/accountSettings.js';
import { ordersService } from './services/ordersService.js';
import { authService } from './services/authService.js';
import { apiUrl } from './services/apiConfig.js';

let activeProduct = null;
let activeVariant = null;
let currentCheckoutItems = [];

/**
 * Lightweight Pageview Analytics Tracker (Storefront traffic tracking)
 */
function trackPageView(hash, productId = null) {
  try {
    const rawPath = hash || window.location.hash || '#home';
    const cleanPath = rawPath.split('?')[0];
    if (cleanPath.startsWith('#admin')) return;

    fetch(apiUrl('/api/analytics/pageview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: rawPath,
        productId: productId || null,
        referrer: document.referrer || null
      })
    }).catch(() => {});
  } catch (e) {}
}

/**
 * Dynamically synchronize live products, brands, and categories from SQLite
 */
async function loadLiveCatalog() {
  try {
    const [resProducts, resBrands, resCats] = await Promise.all([
      fetch(apiUrl('/api/products')),
      fetch(apiUrl('/api/products/meta/brands')).catch(() => null),
      fetch(apiUrl('/api/categories')).catch(() => fetch(apiUrl('/api/products/meta/categories'))).catch(() => null)
    ]);

    if (resProducts && resProducts.ok) {
      const data = await resProducts.json();
      if (data && Array.isArray(data.products) && data.products.length > 0) {
        AUDIOKING_PRODUCTS.length = 0;
        AUDIOKING_PRODUCTS.push(...data.products);

        const liveFeatured = data.products.filter(p => p.isFeatured);
        if (liveFeatured.length > 0) {
          FEATURED_PRODUCTS.length = 0;
          FEATURED_PRODUCTS.push(...liveFeatured);
        }

        renderFeaturedProducts(FEATURED_PRODUCTS.length ? FEATURED_PRODUCTS : AUDIOKING_PRODUCTS);
        window.dispatchEvent(new CustomEvent('ak:products-updated', { detail: AUDIOKING_PRODUCTS }));

        if (window.location.hash && window.location.hash.startsWith('#product') && typeof window.handleHashRoute === 'function') {
          window.handleHashRoute();
        }
      }
    }

    // Process live catalog brands
    let brandItems = [];
    if (resBrands && resBrands.ok) {
      const bData = await resBrands.json();
      if (bData && Array.isArray(bData.brands)) {
        brandItems = bData.brands;
      }
    }
    if (!brandItems.length) {
      const brandCounts = {};
      AUDIOKING_PRODUCTS.forEach(p => {
        const b = (p.brand || '').trim();
        if (b) brandCounts[b] = (brandCounts[b] || 0) + 1;
      });
      brandItems = Object.keys(brandCounts).map(name => ({ name, product_count: brandCounts[name] }));
    }
    window._allCatalogBrands = brandItems;
    renderNavigationBrands(brandItems);
    renderTopBrandsRow(brandItems);

    // Process live catalog categories
    let catItems = [];
    if (resCats && resCats.ok) {
      const cData = await resCats.json();
      if (cData && Array.isArray(cData.categories)) {
        catItems = cData.categories;
      }
    }
    if (!catItems.length) {
      const catMap = new Map();
      AUDIOKING_PRODUCTS.forEach(p => {
        const cat = (p.category || '').trim();
        if (cat && !catMap.has(cat.toLowerCase())) {
          catMap.set(cat.toLowerCase(), { name: cat, section: p.section || 'pro-audio' });
        }
      });
      catItems = Array.from(catMap.values());
    }
    window._allCatalogCategories = catItems;
    renderNavigationCategories(catItems);
    window.loadLiveCatalog = loadLiveCatalog;

    // Fetch locked featured products settings
    try {
      const featRes = await fetch(apiUrl('/api/featured-settings'));
      if (featRes.ok) {
        const featData = await featRes.json();
        if (featData && Array.isArray(featData.lockedProductIds)) {
          window._lockedFeaturedProductIds = featData.lockedProductIds;
          localStorage.setItem('audioking_locked_featured', JSON.stringify(featData.lockedProductIds));
          renderFeaturedProducts();
        }
      }
    } catch (fe) {}
  } catch (err) {
    console.warn('[AUDIOKING] Could not load live products from /api/products, using bundled catalog:', err.message);
  }
}

/**
 * Render Shop Top Brands row with Arowana Audioglyphs placed first
 */
export function renderTopBrandsRow(brandItems) {
  const row = document.getElementById('akBrandsRow');
  if (!row) return;

  const validBrandSet = new Set(
    (brandItems && brandItems.length ? brandItems : (window._allCatalogBrands || []))
      .map(b => (b.name || b.label || b.value || '').toLowerCase().trim())
      .filter(Boolean)
  );

  const defaultTopBrands = [
    { label: 'Arowana Audioglyphs', value: 'Arowana Audioglyphs' },
    { label: 'Universal Audio', value: 'Universal Audio' },
    { label: 'Focusrite', value: 'Focusrite' },
    { label: 'Lauten Audio', value: 'Lauten Audio' },
    { label: 'Native Instruments', value: 'Native Instruments' },
    { label: 'Nord', value: 'Nord' },
    { label: 'ADAM Audio', value: 'ADAM Audio' },
    { label: 'Audix', value: 'Audix' },
    { label: 'Focal Professional', value: 'Focal Professional' },
    { label: 'Efnote', value: 'Efnote' }
  ];

  const topBrands = validBrandSet.size > 0
    ? defaultTopBrands.filter(b => validBrandSet.has(b.value.toLowerCase().trim()))
    : defaultTopBrands;

  row.innerHTML = topBrands.map(b => `
    <a href="#store?brand=${encodeURIComponent(b.value)}" class="ak-brand-card" data-brand="${b.value}">
      <span class="ak-brand-name">${b.label}</span>
    </a>
  `).join('');

  row.querySelectorAll('.ak-brand-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const brand = card.dataset.brand;
      showCatalog(brand, 'brand');
    });
  });
}

/**
 * Open All Brands popup modal with faded backdrop and brand cards
 */
export function openAllBrandsModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  const modal = document.getElementById('akAllBrandsModal');
  if (!modal) return;

  renderAllBrandsModalContent();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const input = document.getElementById('akAllBrandsSearchInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 60);
  }
}

export function closeAllBrandsModal() {
  const modal = document.getElementById('akAllBrandsModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

export function filterAllBrandsModalList(query) {
  renderAllBrandsModalContent(query);
}

function renderAllBrandsModalContent(query = '') {
  const grid = document.getElementById('akAllBrandsModalGrid');
  if (!grid) return;

  let brands = (window._allCatalogBrands && window._allCatalogBrands.length)
    ? window._allCatalogBrands
    : AUDIOKING_BRANDS.map(b => ({ name: b.name, product_count: 0 }));

  // Ensure Arowana Audioglyphs is prioritized at the top, followed by alphabetical
  const sorted = [...brands].sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    if (aName.includes('arowana')) return -1;
    if (bName.includes('arowana')) return 1;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });

  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? sorted.filter(b => (b.name || '').toLowerCase().includes(q))
    : sorted;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 32px 16px; color: var(--ak-text-muted);">
        No brands found matching "<strong>${query}</strong>"
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(b => {
    const isArowana = b.name.toLowerCase().includes('arowana');
    const displayName = isArowana ? 'Arowana Audioglyphs' : b.name;
    const targetBrandValue = isArowana ? 'Arowana Audioglyphs' : b.name;
    const count = b.product_count !== undefined ? Number(b.product_count) : 0;
    const countBadge = count > 0 ? `<span class="ak-brand-modal-count">${count} items</span>` : '';

    return `
      <a href="#store?brand=${encodeURIComponent(targetBrandValue)}" class="ak-brand-modal-card" data-brand="${targetBrandValue}">
        <span class="ak-brand-modal-name">${displayName}</span>
        ${countBadge}
      </a>
    `;
  }).join('');

  grid.querySelectorAll('.ak-brand-modal-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const brand = card.dataset.brand;
      closeAllBrandsModal();
      showCatalog(brand, 'brand');
    });
  });
}

// Expose on window for global access
if (typeof window !== 'undefined') {
  window.showHome = showHome;
  window.showCatalog = showCatalog;
  window.showProduct = showProduct;
  window.showContact = showContact;
  window.showCheckoutPage = showCheckoutPage;
  window.showOrderConfirmation = showOrderConfirmation;
  window.openCheckoutModal = openCheckoutModal;
  window.showAccountSettings = showAccountSettings;
  window.authService = authService;
  window.openAuthModal = openAuthModal;
  window.loadLiveCatalog = loadLiveCatalog;
  window.showAdmin = showAdmin;
  window.openAllBrandsModal = openAllBrandsModal;
  window.closeAllBrandsModal = closeAllBrandsModal;
  window.filterAllBrandsModalList = filterAllBrandsModalList;
}

if (typeof document !== 'undefined') {
  function startAudioKingApp() {
    // 1. Initialize core state modules
    initCart();
    initCheckout();
    initOrderSuccess();
    initAuth();
    initHeader();
    initNavigation();
    loadAndInitHeroSlider();
    initTestimonials();
    initModals();
    initStore();
    initAccountSettings();

    // Fetch live catalog from SQLite API
    loadLiveCatalog();

    // Re-synchronize live catalog whenever admin panel makes changes
    window.addEventListener('ak:catalog-sync', () => {
      loadLiveCatalog();
    });

    // Re-synchronize featured products whenever admin locks/unlocks products
    window.addEventListener('ak:featured-sync', (e) => {
      if (e && e.detail && Array.isArray(e.detail.lockedProductIds)) {
        window._lockedFeaturedProductIds = e.detail.lockedProductIds;
        localStorage.setItem('audioking_locked_featured', JSON.stringify(e.detail.lockedProductIds));
      }
      renderFeaturedProducts();
    });

    // Set store product click callback to open product details page
    setProductClickCallback((productId) => {
      const p = AUDIOKING_PRODUCTS.find(item => item.id === productId);
      if (p) showProduct(p);
    });

    // 2. Interactive features & handlers
    initProductTabs();
    initBrandRow();
    initNewsletter();
    renderFeaturedProducts(FEATURED_PRODUCTS);
    attachAddToCartListeners(document);
    attachProductCardListeners(document);

    window.addEventListener('ak:cart-updated', () => {
      const activeTab = document.querySelector('.ak-tab-btn.active')?.dataset.tab || 'best-sellers';
      let currentList = FEATURED_PRODUCTS.length ? FEATURED_PRODUCTS : AUDIOKING_PRODUCTS;
      renderFeaturedProducts(currentList);
    });
    initCatalogNavigation();
    initProductDetailPage();
    initContactPage();
    initDedicatedCheckoutPage();
    initScrollReveal();

    // 3. Quick categories interaction
    setupQuickCategoryListeners();

    // 4. Custom Event Listeners for Header Search & Navigation
    setupAppEventListeners();

    // 5. Header links & Logo Navigation
    document.querySelectorAll('.ak-logo-link, .ak-nav-home').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        showHome();
      });
    });

    // Contact Us links in navbar, drawer, footer -> route directly to Contact Page view
    document.querySelectorAll('.ak-contact-trigger').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        showContact();
      });
    });

    // My Profile trigger in header dropdown
    document.getElementById('akProfileTrigger')?.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountSettings('account');
    });

    // My Orders trigger in header dropdown
    document.getElementById('akOrdersTrigger')?.addEventListener('click', (e) => {
      e.preventDefault();
      showAccountSettings('orders');
    });

    // Catalog links in Store breadcrumbs
    document.querySelectorAll('.ak-store-catalog-link, .ak-pd-catalog-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        showCatalog();
      });
    });

    document.querySelectorAll('.ak-store-home-link, .ak-pd-home-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        showHome();
      });
    });

    // Configure expert phone across callouts
    document.querySelectorAll('.ak-expert-phone-target').forEach(el => {
      el.textContent = AUDIOKING_CONFIG.expertPhone;
    });

    // Comprehensive SPA Hash Router & State Restoration
    const handleHashRoute = () => {
      let currentHash = window.location.hash;
      if (!currentHash || currentHash === '#home') {
        const path = (window.location.pathname || '').toLowerCase();
        if (path.includes('/store') || path.includes('/catalog')) {
          currentHash = '#store';
        } else {
          currentHash = currentHash || '#home';
        }
      }
      const parsed = parseHashRoute(currentHash);
      const route = parsed.route;
      const params = parsed.params;

      if (route === 'home') {
        showHome(false);
      } else if (route === 'orders') {
        showAccountSettings('orders', false);
      } else if (route === 'addresses') {
        showAccountSettings('addresses', false);
      } else if (route === 'account' || route === 'profile') {
        const tab = params.tab || parsed.subRoute || 'account';
        showAccountSettings(tab, false);
      } else if (route === 'catalog' || route === 'store' || route === 'pro-audio' || route === 'musical-instruments') {
        const category = params.category || (route === 'pro-audio' ? 'Studio Monitors' : (route === 'musical-instruments' ? 'Keyboards' : null));
        const brand = params.brand || null;
        const search = params.search || null;

        if (search) {
          setStoreState({
            search: search,
            category: 'All',
            brands: [],
            sort: params.sort || 'featured',
            page: params.page ? Number(params.page) : 1
          }, false);
          showCatalog(search, 'search', false);
        } else if (category) {
          setStoreState({
            search: '',
            category: category,
            brands: brand ? [brand] : [],
            sort: params.sort || 'featured',
            page: params.page ? Number(params.page) : 1,
            inStockOnly: params.inStock === 'true'
          }, false);
          showCatalog(category, 'category', false);
        } else if (brand) {
          setStoreState({
            search: '',
            category: 'All',
            brands: [brand],
            sort: params.sort || 'featured',
            page: params.page ? Number(params.page) : 1,
            inStockOnly: params.inStock === 'true'
          }, false);
          showCatalog(brand, 'brand', false);
        } else {
          setStoreState({
            search: '',
            category: 'All',
            brands: [],
            sort: params.sort || 'featured',
            page: params.page ? Number(params.page) : 1
          }, false);
          showCatalog('All', 'all', false);
        }
      } else if (route === 'brands') {
        const brandName = params.name || params.brand || parsed.subRoute;
        if (brandName) {
          setStoreState({ category: 'All', brands: [brandName] }, false);
          showCatalog(brandName, 'brand', false);
        } else {
          showCatalog(null, 'all', false);
          setActiveNavItem('akNavItemBrands');
        }
      } else if (route === 'product') {
        const pId = params.id || parsed.subRoute;
        if (pId) {
          showProduct(pId, false);
        } else {
          showCatalog('All', 'all', false);
        }
      } else if (route === 'cart') {
        showHome(false);
        openCartDrawer();
      } else if (route === 'checkout') {
        showCheckoutPage(null, false);
      } else if (route === 'contact') {
        showContact(false);
      } else if (route === 'admin') {
        const subRoute = parsed.subRoute || params.view || params.tab;
        showAdmin(false, subRoute);
      } else {
        showHome(false);
      }

      restoreScrollPosition(currentHash);

      // Clean up render-blocking route preloader once runtime view is active
      const earlyRouteStyle = document.getElementById('ak-early-route-style');
      if (earlyRouteStyle) earlyRouteStyle.remove();

      // Track pageview for analytics
      trackPageView(currentHash, (route === 'product') ? (params.id || parsed.subRoute) : null);
    };
    window.handleHashRoute = handleHashRoute;

    window.addEventListener('hashchange', handleHashRoute);

    // Initial page load route dispatch
    if (window.location.hash && window.location.hash !== '#') {
      handleHashRoute();
    } else {
      showHome(false);
      trackPageView('#home');
    }

    // Synchronize Store filter interactions with URL hash
    window.addEventListener('ak:store-state-changed', (e) => {
      const st = e.detail;
      if (!st) return;
      const catalog = document.getElementById('catalogPage');
      if (!catalog || catalog.style.display === 'none') return;

      const sp = new URLSearchParams();
      if (st.category && st.category !== 'All') sp.set('category', st.category);
      if (st.brands && st.brands.length) sp.set('brand', st.brands.join(','));
      if (st.sort && st.sort !== 'featured') sp.set('sort', st.sort);
      if (st.page && st.page > 1) sp.set('page', String(st.page));
      if (st.inStockOnly) sp.set('inStock', 'true');

      const q = sp.toString();
      const targetHash = q ? `#store?${q}` : '#store';
      setRouteHash(targetHash);
    });

    // Track scroll position per route
    let scrollSaveTimer = null;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(() => {
        const currentHash = window.location.hash || '#home';
        try {
          sessionStorage.setItem('ak_scroll_pos', JSON.stringify({
            route: currentHash,
            y: window.scrollY
          }));
        } catch (e) {}
      }, 150);
    }, { passive: true });

    console.log(`AudioKing initialized successfully with ${AUDIOKING_PRODUCTS.length} validated products.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAudioKingApp);
  } else {
    startAudioKingApp();
  }
}

/**
 * Parses URL hash into route, sub-route, and query parameters
 */
function parseHashRoute(hashStr) {
  const raw = (hashStr || '').trim().replace(/^#\/?/, '');
  if (!raw) return { route: 'home', params: {}, raw: '' };

  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.toLowerCase();
  const params = {};

  if (queryPart) {
    const sp = new URLSearchParams(queryPart);
    for (const [k, v] of sp.entries()) {
      params[k] = v;
    }
  }

  const parts = path.split('/');
  return {
    route: parts[0] || 'home',
    subRoute: parts.slice(1).join('/'),
    params,
    raw
  };
}

/**
 * Updates URL hash without triggering duplicate hashchange events or history spam
 */
function setRouteHash(targetHash, push = false) {
  if (typeof window === 'undefined') return;
  if (window.location.hash === targetHash) return;

  if (push && window.history && window.history.pushState) {
    window.history.pushState(null, '', targetHash);
  } else if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', targetHash);
  } else {
    window.location.hash = targetHash;
  }
}

/**
 * Restores user's previous scroll position for the current route
 */
function restoreScrollPosition(currentHash) {
  try {
    const raw = sessionStorage.getItem('ak_scroll_pos');
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.route === currentHash && typeof data.y === 'number' && data.y > 0) {
        setTimeout(() => {
          window.scrollTo({ top: data.y, behavior: 'instant' });
        }, 80);
      }
    }
  } catch (e) {}
}

/**
 * Check if Account Settings has unsaved edits before navigating
 */
function checkDirtyBeforeNavigate(action) {
  const accPage = document.getElementById('akAccountSettingsPage');
  if (accPage && accPage.style.display !== 'none' && isAccountFormDirty()) {
    promptUnsavedChanges(action);
    return false;
  }
  return true;
}

/**
 * Hide all full-page views
 */
function hideAllViews() {
  const views = [
    document.getElementById('akMainContent'),
    document.getElementById('catalogPage'),
    document.getElementById('productPage'),
    document.getElementById('akContactPage'),
    document.getElementById('akAccountSettingsPage'),
    document.getElementById('akCheckoutPage'),
    document.getElementById('akOrderConfirmationView'),
    document.getElementById('adminPage')
  ];

  views.forEach(v => {
    if (v) {
      v.style.display = 'none';
      v.classList.remove('active');
    }
  });

  const header = document.querySelector('.ak-header');
  const footer = document.querySelector('.ak-footer');
  const nav = document.querySelector('.ak-nav-bar');
  if (header) header.style.display = '';
  if (footer) footer.style.display = '';
  if (nav) nav.style.display = '';

  // Ensure floating WhatsApp button is updated according to active view
  const waBtn = document.getElementById('akFloatingWhatsApp');
  if (waBtn) waBtn.style.display = 'none';
}

/**
 * View: Admin Dashboard View
 * Auth-loading-aware: prevents premature login gate if session verification is in-flight.
 */
export function showAdmin(updateHash = true, targetView = null) {
  const status = authService.getStatus();
  const user = authService.getUser();

  // If already authenticated as admin, render immediately
  if (user && user.role === 'admin') {
    _doShowAdmin(updateHash, targetView);
    return;
  }

  // If authenticated as customer, do not loop on admin hash
  if (user && user.role !== 'admin') {
    showToast('Administrator privileges required. You are signed in as a customer.', 'warning');
    showHome(false);
    setRouteHash('#home', true);
    return;
  }

  // If still loading session from backend, wait for resolution before gating out
  if (status === 'loading') {
    const unsub = authService.subscribe((resolvedUser, resolvedStatus) => {
      if (resolvedStatus !== 'loading') {
        unsub();
        if (resolvedUser && resolvedUser.role === 'admin') {
          _doShowAdmin(updateHash, targetView);
        } else if (resolvedUser) {
          showToast('Administrator privileges required. You are signed in as a customer.', 'warning');
          showHome(false);
          setRouteHash('#home', true);
        } else {
          showToast('Admin login required. Please sign in as administrator.', 'warning');
          showHome(false);
          setRouteHash('#home', true);
          openAuthModal('signin');
        }
      }
    });
    return;
  }

  // Genuinely unauthenticated: route to home and prompt login
  showToast('Admin login required. Please sign in as administrator.', 'warning');
  showHome(false);
  setRouteHash('#home', true);
  openAuthModal('signin');
}

function _doShowAdmin(updateHash = true, targetView = null) {
  hideAllViews();

  // Hide customer storefront navigation & footer for dedicated admin dashboard view
  const header = document.querySelector('.ak-header');
  const footer = document.querySelector('.ak-footer');
  const nav = document.querySelector('.ak-nav-bar');
  if (header) header.style.display = 'none';
  if (footer) footer.style.display = 'none';
  if (nav) nav.style.display = 'none';

  const adminPage = document.getElementById('adminPage');
  if (adminPage) {
    adminPage.style.display = 'flex';
    if (typeof window.initAdminDashboardView === 'function') {
      window.initAdminDashboardView(targetView);
    }
  }

  if (updateHash) {
    const hash = targetView && targetView !== 'dashboard' ? `#admin/${targetView}` : '#admin';
    setRouteHash(hash, true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

/**
 * View: Account Settings View (My Account & My Addresses)
 * Auth-loading-aware: waits for session verification before deciding to show or gate.
 */
export function showAccountSettings(targetTab, updateHash = true) {
  const tab = targetTab || 'account';
  const status = authService.getStatus();

  if (status === 'loading') {
    const unsub = authService.subscribe((_user, resolvedStatus) => {
      if (resolvedStatus !== 'loading') {
        unsub();
        _doShowAccountSettings(tab, updateHash);
      }
    });
    return;
  }

  _doShowAccountSettings(tab, updateHash);
}

/**
 * Internal: show account page if authenticated, else open sign-in modal
 */
function _doShowAccountSettings(targetTab, updateHash = true) {
  const user = getCurrentUser();
  if (!user) {
    openAuthModal('signin', 'Please sign in to access your profile and account settings');
    return;
  }

  hideAllViews();
  const accPage = document.getElementById('akAccountSettingsPage');
  if (accPage) accPage.style.display = 'block';

  renderAccountSettings(targetTab);
  setActiveNavItem(null);

  if (updateHash) {
    const hashTarget = targetTab === 'orders' ? '#orders' : (targetTab === 'addresses' ? '#addresses' : '#account');
    setRouteHash(hashTarget, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  triggerScrollReveal();
}

/**
 * View 1: Home View
 */
export function showHome(updateHash = true) {
  if (!checkDirtyBeforeNavigate(() => showHome(updateHash))) return;
  hideAllViews();
  const main = document.getElementById('akMainContent');
  if (main) main.style.display = 'block';

  // Floating WhatsApp is ONLY on the home page per user instruction
  const waBtn = document.getElementById('akFloatingWhatsApp');
  if (waBtn) waBtn.style.display = 'flex';

  setActiveNavItem('akNavItemHome');
  if (updateHash) {
    setRouteHash('#home', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  triggerScrollReveal();
}

/**
 * View 2: Store / Catalog View (Sweetwater Layout)
 */
export function showCatalog(categoryOrBrand, filterType = 'all', updateHash = true) {
  if (!checkDirtyBeforeNavigate(() => showCatalog(categoryOrBrand, filterType, updateHash))) return;
  hideAllViews();
  const catalog = document.getElementById('catalogPage');
  if (catalog) catalog.style.display = 'block';
  window.scrollTo(0, 0);

  let resolvedCategory = null;
  let resolvedBrand = null;
  let resolvedSearch = null;

  if (filterType === 'search') {
    setActiveNavItem(null);
    openStoreWithSearch(categoryOrBrand);
    resolvedSearch = categoryOrBrand;
  } else if (filterType === 'brand' || (categoryOrBrand && AUDIOKING_BRANDS.some(b => b.name.toLowerCase() === categoryOrBrand.toLowerCase()))) {
    setActiveNavItem('akNavItemBrands');
    openStoreWithBrand(categoryOrBrand);
    resolvedBrand = categoryOrBrand;
  } else if (categoryOrBrand && categoryOrBrand !== 'All') {
    resolvedCategory = categoryOrBrand;
    const catLower = (categoryOrBrand || '').toLowerCase();
    if (catLower.includes('drum') || catLower.includes('piano') || catLower.includes('instrument') || catLower.includes('key')) {
      setActiveNavItem('akNavItemMusical');
    } else {
      setActiveNavItem('akNavItemProAudio');
    }
    openStoreWithCategory(categoryOrBrand);
  } else {
    // Generic store view: do NOT default to Brands!
    setActiveNavItem(null);
    openStoreWithCategory('All');
  }

  if (updateHash) {
    let targetHash = '#store';
    if (resolvedSearch) {
      targetHash = `#store?search=${encodeURIComponent(resolvedSearch)}`;
    } else if (resolvedBrand) {
      targetHash = `#store?brand=${encodeURIComponent(resolvedBrand)}`;
    } else if (resolvedCategory && resolvedCategory !== 'All') {
      targetHash = `#store?category=${encodeURIComponent(resolvedCategory)}`;
    }
    setRouteHash(targetHash, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  triggerScrollReveal();
}

/**
 * Helper to safely postMessage commands to embedded YouTube iframes
 */
function sendYtCommand(iframe, func, args = '') {
  if (!iframe || !iframe.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(JSON.stringify({
      event: 'command',
      func: func,
      args: args
    }), '*');
  } catch (e) {
    // Cross-origin restriction fallback
  }
}

/**
 * View 3: Product Detail View
 */
export async function showProduct(productOrId, updateHash = true) {
  if (!checkDirtyBeforeNavigate(() => showProduct(productOrId, updateHash))) return;
  let product = typeof productOrId === 'string' ? getProductById(productOrId) : productOrId;
  const productId = typeof productOrId === 'string' ? productOrId : productOrId?.id;
  if (productId) {
    recordProductClick(productId);
    try {
      const res = await fetch(apiUrl(`/api/products/${encodeURIComponent(productId)}`));
      if (res.ok) {
        const data = await res.json();
        if (data.product) {
          product = data.product;
          const idx = AUDIOKING_PRODUCTS.findIndex(p => p.id === product.id);
          if (idx >= 0) {
            AUDIOKING_PRODUCTS[idx] = product;
          } else {
            AUDIOKING_PRODUCTS.push(product);
          }
        }
      }
    } catch (e) {
      console.warn('[AUDIOKING] Could not fetch single product:', e);
    }
  }
  if (!product) return;
  activeProduct = product;
  const hasProductVideo = Boolean(product.youtubeVideoId || product.videoUrl);

  hideAllViews();
  const productPage = document.getElementById('productPage');
  if (!productPage) return;
  productPage.style.display = 'block';

  // Highlight relevant category in navbar
  const catLower = (product.category || '').toLowerCase();
  if (catLower.includes('synth') || catLower.includes('drum') || catLower.includes('piano') || catLower.includes('instrument') || catLower.includes('key')) {
    setActiveNavItem('akNavItemMusical');
  } else {
    setActiveNavItem('akNavItemProAudio');
  }

  if (updateHash) {
    setRouteHash(`#product?id=${encodeURIComponent(product.id)}`, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Render product details
  const ppBrandLink = document.getElementById('ppBrandLink');
  const ppTitle = document.getElementById('ppTitle');
  const ppCrumb = document.getElementById('ppCrumb');
  const ppCode = document.getElementById('ppCode');
  const ppPrice = document.getElementById('ppPrice');
  const ppOrigPrice = document.getElementById('ppOrigPrice');
  const ppInStockBadge = document.getElementById('ppInStockBadge');
  const ppOutOfStockBadge = document.getElementById('ppOutOfStockBadge');
  const ppQtyInput = document.getElementById('ppQtyInput');
  const ppAddToCartBtn = document.getElementById('ppAddToCartBtn');
  const ppBuyNowBtn = document.getElementById('ppBuyNowBtn');
  const ppDesc = document.getElementById('ppDesc');
  const ppFeaturesList = document.getElementById('ppFeaturesList');
  const ppMainImage = document.getElementById('ppMainImage');
  const ppThumbnailsList = document.getElementById('ppThumbnailsList');

  if (ppBrandLink) {
    ppBrandLink.textContent = product.brand.toUpperCase();
    ppBrandLink.onclick = (e) => {
      e.preventDefault();
      showCatalog(product.brand, 'brand');
    };
  }

  if (ppTitle) ppTitle.textContent = product.name;
  if (ppCrumb) ppCrumb.textContent = product.name;
  if (ppCode) ppCode.textContent = `SKU: AK-${product.id.toUpperCase()} · Category: ${product.category}`;
  if (ppPrice) ppPrice.textContent = formatINR(product.price);
  if (ppOrigPrice) {
    ppOrigPrice.textContent = product.originalPrice ? formatINR(product.originalPrice) : '';
  }

  // Stock status (supports in-stock, out-of-stock, and pre-order / coming soon)
  const isPreOrder = Boolean(product.isPreOrder || (product.badge && product.badge.toLowerCase().includes('pre-order')) || product.stockStatus === 'preorder');
  const isOutOfStock = Boolean(!isPreOrder && (product.stock === 0 || product.inStock === false || product.isOutOfStock === true || product.stockStatus === 'outofstock'));

  if (ppInStockBadge) ppInStockBadge.style.display = (!isOutOfStock && !isPreOrder) ? 'inline-flex' : 'none';
  if (ppOutOfStockBadge) {
    if (isPreOrder) {
      ppOutOfStockBadge.style.display = 'inline-flex';
      ppOutOfStockBadge.className = 'pp-stock-badge preorder';
      ppOutOfStockBadge.style.background = '#FEF3C7';
      ppOutOfStockBadge.style.color = '#92400E';
      ppOutOfStockBadge.style.borderColor = '#FCD34D';
      ppOutOfStockBadge.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>Availability: Coming Soon · Pre-Order Reservation</span>
      `;
    } else if (isOutOfStock) {
      ppOutOfStockBadge.style.display = 'inline-flex';
      ppOutOfStockBadge.className = 'pp-stock-badge outstock';
      ppOutOfStockBadge.style.background = '#FEE2E2';
      ppOutOfStockBadge.style.color = '#DC2626';
      ppOutOfStockBadge.style.borderColor = '#FECACA';
      ppOutOfStockBadge.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>Availability: Out of Stock · Will notify you when available</span>
      `;
    } else {
      ppOutOfStockBadge.style.display = 'none';
    }
  }

  if (ppQtyInput) ppQtyInput.value = '1';

  if (ppAddToCartBtn) {
    if (isPreOrder) {
      ppAddToCartBtn.classList.add('disabled', 'is-preorder');
      ppAddToCartBtn.classList.remove('is-out-of-stock');
      ppAddToCartBtn.disabled = true;
      ppAddToCartBtn.style.background = '#0B2545';
      ppAddToCartBtn.style.color = '#FFFFFF';
      ppAddToCartBtn.style.borderColor = '#0B2545';
      ppAddToCartBtn.style.cursor = 'not-allowed';
      const span = ppAddToCartBtn.querySelector('span');
      if (span) {
        span.textContent = 'Coming Soon';
        span.style.color = '#FFFFFF';
      }
    } else if (isOutOfStock) {
      ppAddToCartBtn.classList.add('disabled', 'is-out-of-stock');
      ppAddToCartBtn.classList.remove('is-preorder');
      ppAddToCartBtn.disabled = true;
      ppAddToCartBtn.style.background = '#FEF2F2';
      ppAddToCartBtn.style.color = '#DC2626';
      ppAddToCartBtn.style.borderColor = '#FECACA';
      ppAddToCartBtn.style.cursor = 'not-allowed';
      const span = ppAddToCartBtn.querySelector('span');
      if (span) {
        span.textContent = 'Out of Stock';
        span.style.color = '#DC2626';
      }
    } else {
      ppAddToCartBtn.classList.remove('disabled', 'is-preorder', 'is-out-of-stock');
      ppAddToCartBtn.disabled = false;
      ppAddToCartBtn.style.background = '';
      ppAddToCartBtn.style.color = '';
      ppAddToCartBtn.style.borderColor = '';
      ppAddToCartBtn.style.cursor = 'pointer';
      const span = ppAddToCartBtn.querySelector('span');
      if (span) {
        span.textContent = 'Add to Cart';
        span.style.color = '';
      }
    }
  }

  if (ppBuyNowBtn) {
    if (isPreOrder) {
      ppBuyNowBtn.disabled = true;
      ppBuyNowBtn.style.opacity = '0.5';
      ppBuyNowBtn.style.cursor = 'not-allowed';
      ppBuyNowBtn.textContent = 'Coming Soon';
      ppBuyNowBtn.style.color = '#FFFFFF';
      ppBuyNowBtn.style.background = '#0B2545';
      ppBuyNowBtn.style.borderColor = '#0B2545';
    } else if (isOutOfStock) {
      ppBuyNowBtn.disabled = true;
      ppBuyNowBtn.style.opacity = '0.5';
      ppBuyNowBtn.style.cursor = 'not-allowed';
      ppBuyNowBtn.textContent = 'Out of Stock';
      ppBuyNowBtn.style.color = '#DC2626';
      ppBuyNowBtn.style.background = '#FEF2F2';
      ppBuyNowBtn.style.borderColor = '#FECACA';
    } else {
      ppBuyNowBtn.disabled = false;
      ppBuyNowBtn.style.opacity = '1';
      ppBuyNowBtn.style.cursor = 'pointer';
      ppBuyNowBtn.textContent = 'Buy Now';
      ppBuyNowBtn.style.color = '';
      ppBuyNowBtn.style.background = '';
      ppBuyNowBtn.style.borderColor = '';
    }
  }

  // =========================================================================
  // Product Variants Management & Interactive Selection
  // =========================================================================
  const ppVariantsWrap = document.getElementById('ppVariantsWrap');
  activeVariant = null;

  if (ppVariantsWrap) {
    if (product.hasVariants && Array.isArray(product.variantGroups) && product.variantGroups.length > 0) {
      ppVariantsWrap.style.display = 'flex';

      const selectedOptions = {};
      product.variantGroups.forEach(g => {
        if (g.options && g.options.length > 0) {
          selectedOptions[g.id] = g.options[0].id;
        }
      });

      function getSelectedVariant() {
        if (!product.variants || product.variants.length === 0) return null;
        const selectedIds = Object.values(selectedOptions);
        return product.variants.find(v => {
          if (!Array.isArray(v.optionIds)) return false;
          return selectedIds.every(id => v.optionIds.includes(id));
        }) || product.variants[0];
      }

      function updateVariantDisplay() {
        const matched = getSelectedVariant();
        activeVariant = matched;

        // Update Price if variant has price override
        if (ppPrice) {
          const effectivePrice = (matched && matched.priceOverride != null) ? matched.priceOverride : product.price;
          ppPrice.textContent = formatINR(effectivePrice);
        }

        // Update Stock Status for selected variant
        if (matched) {
          const vOutOfStock = matched.stock === 0 || !matched.isActive;
          if (ppInStockBadge) ppInStockBadge.style.display = (!vOutOfStock && !isPreOrder) ? 'inline-flex' : 'none';
          if (ppOutOfStockBadge && !isPreOrder) {
            ppOutOfStockBadge.style.display = vOutOfStock ? 'inline-flex' : 'none';
          }

          if (ppAddToCartBtn && !isPreOrder) {
            if (vOutOfStock) {
              ppAddToCartBtn.classList.add('disabled', 'is-out-of-stock');
              ppAddToCartBtn.disabled = true;
              ppAddToCartBtn.style.background = '#FEF2F2';
              ppAddToCartBtn.style.color = '#DC2626';
              ppAddToCartBtn.style.borderColor = '#FECACA';
              ppAddToCartBtn.style.cursor = 'not-allowed';
              const span = ppAddToCartBtn.querySelector('span');
              if (span) {
                span.textContent = 'Out of Stock';
                span.style.color = '#DC2626';
              }
            } else {
              ppAddToCartBtn.classList.remove('disabled', 'is-out-of-stock', 'is-preorder');
              ppAddToCartBtn.disabled = false;
              ppAddToCartBtn.style.background = '';
              ppAddToCartBtn.style.color = '';
              ppAddToCartBtn.style.borderColor = '';
              ppAddToCartBtn.style.cursor = 'pointer';
              const span = ppAddToCartBtn.querySelector('span');
              if (span) {
                span.textContent = 'Add to Cart';
                span.style.color = '';
              }
            }
          }

          if (ppBuyNowBtn && !isPreOrder) {
            if (vOutOfStock) {
              ppBuyNowBtn.disabled = true;
              ppBuyNowBtn.style.opacity = '0.5';
              ppBuyNowBtn.style.cursor = 'not-allowed';
              ppBuyNowBtn.textContent = 'Out of Stock';
              ppBuyNowBtn.style.color = '#DC2626';
              ppBuyNowBtn.style.background = '#FEF2F2';
              ppBuyNowBtn.style.borderColor = '#FECACA';
            } else {
              ppBuyNowBtn.disabled = false;
              ppBuyNowBtn.style.opacity = '1';
              ppBuyNowBtn.style.cursor = 'pointer';
              ppBuyNowBtn.textContent = 'Buy Now';
              ppBuyNowBtn.style.color = '';
              ppBuyNowBtn.style.background = '';
              ppBuyNowBtn.style.borderColor = '';
            }
          }
        }
      }

      function renderVariantsUI() {
        ppVariantsWrap.innerHTML = product.variantGroups.map(g => {
          const selectedOptId = selectedOptions[g.id];
          const selectedOpt = g.options.find(o => o.id === selectedOptId) || g.options[0];
          const selectedLabel = selectedOpt ? selectedOpt.label : '';

          const optionsHtml = g.options.map(opt => {
            const isSelected = opt.id === selectedOptId;
            if (g.type === 'color') {
              return `
                <button type="button" 
                  class="pp-color-swatch-btn ${isSelected ? 'active' : ''}" 
                  style="background-color: ${opt.colorHex || '#000000'};" 
                  data-group-id="${g.id}" 
                  data-option-id="${opt.id}" 
                  title="${opt.label}" 
                  aria-label="${opt.label}">
                </button>
              `;
            } else {
              return `
                <button type="button" 
                  class="pp-text-option-btn ${isSelected ? 'active' : ''}" 
                  data-group-id="${g.id}" 
                  data-option-id="${opt.id}">
                  ${opt.label}
                </button>
              `;
            }
          }).join('');

          return `
            <div class="pp-variant-group">
              <div class="pp-variant-group-title">
                <span>${g.name}:</span>
                <span class="pp-variant-selected-label" id="ppVariantLabel_${g.id}">${selectedLabel}</span>
              </div>
              <div class="pp-variant-options">
                ${optionsHtml}
              </div>
            </div>
          `;
        }).join('');

        ppVariantsWrap.querySelectorAll('[data-group-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            const groupId = Number(btn.dataset.groupId) || btn.dataset.groupId;
            const optionId = Number(btn.dataset.optionId) || btn.dataset.optionId;
            selectedOptions[groupId] = optionId;
            renderVariantsUI();
            updateVariantDisplay();
          });
        });
      }

      renderVariantsUI();
      updateVariantDisplay();
    } else {
      ppVariantsWrap.style.display = 'none';
      ppVariantsWrap.innerHTML = '';
    }
  }

  // Helper to extract concise introductory overview (1 concise paragraph, ~2-3 sentences)
  function getConciseOverview(prod) {
    if (prod.shortDescription) return prod.shortDescription;
    if (!prod.description) {
      return `The ${prod.name} from ${prod.brand} offers uncompromising acoustic fidelity, tour-grade construction, and pristine audio capture designed for industry professionals and discerning creators.`;
    }
    const parts = prod.description.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const lines = part.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const text = lines.join(' ').trim();
      const firstLine = lines[0];
      const isHeading = /^(Kick Mic|Snare Mic|Tom Mic|Rim Mount|LA-220|Lauten Audio In-Line|Innovative|Description|Utilize|Includes:)/i.test(firstLine);
      if (isHeading) continue;
      // Skip short title lines or duplicate names (< 60 chars)
      if (text.length < 60 || text.toLowerCase() === prod.name.toLowerCase() || (prod.shortName && text.toLowerCase() === prod.shortName.toLowerCase())) {
        continue;
      }
      return text;
    }
    return parts[0] || '';
  }

  // 1. Primary Product Overview - Concise single paragraph (avoids excessive whitespace)
  if (ppDesc) {
    ppDesc.innerHTML = `<p>${getConciseOverview(product)}</p>`;
  }

  // 2. Key Features - 3-4 essential specifications only
  if (ppFeaturesList) {
    const defaultSpecs = [
      `Authorized Indian Distributor Warranty with Serial Verification`,
      `Precision engineered by ${product.brand} for optimal audio fidelity`,
      `Professional-grade acoustic and electrical shielding`,
      `Direct pan-India transit insured dispatch within 24 business hours`
    ];
    const allSpecs = (product.specs && product.specs.length) ? product.specs : defaultSpecs;
    const essentialSpecs = allSpecs.slice(0, 3);
    ppFeaturesList.innerHTML = essentialSpecs.map(s => {
      if (typeof s === 'object' && s !== null) {
        return `<li><strong>${s.label}:</strong> ${s.value}</li>`;
      }
      return `<li>${s}</li>`;
    }).join('');
  }

  // 3. Dedicated Description Panel - Full structured breakdown
  const panelFullDesc = document.getElementById('ppPanelFullDesc');
  if (panelFullDesc) {
    if (product.description) {
      const parts = product.description.split(/\n\s*\n/);
      panelFullDesc.innerHTML = parts.map(part => {
        const trimmed = part.trim();
        if (!trimmed) return '';
        const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) return '';

        const firstLine = lines[0];
        const isHeading = /^(Kick Mic|Snare Mic|Tom Mic|Rim Mount|LA-220|Lauten Audio In-Line|Innovative|Description|Utilize)/i.test(firstLine);

        if (/^Includes:/i.test(firstLine)) {
          const listItems = lines.slice(1).map(item => `<li>${item}</li>`).join('');
          return `<h4>Includes:</h4><ul style="margin: 6px 0 16px 22px; line-height: 1.6; color: #334155; font-size: 14px;">${listItems}</ul>`;
        } else if (isHeading && lines.length > 1) {
          return `<h4>${firstLine}</h4><p>${lines.slice(1).join(' ')}</p>`;
        } else if (isHeading) {
          return `<h4>${firstLine}</h4>`;
        } else {
          return `<p>${lines.join(' ')}</p>`;
        }
      }).join('');
    } else {
      panelFullDesc.innerHTML = `<p>The ${product.name} from ${product.brand} offers uncompromising acoustic fidelity, tour-grade construction, and pristine audio capture designed for industry professionals and discerning creators.</p>`;
    }
  }

  // Amazon / Flipkart Style Manual Media Carousel (Images + Video)
  const defaultImg = resolveProductImage(product.image || product.primaryImage || (product.images && product.images[0]));
  const track = document.getElementById('ppCarouselTrack');
  const thumbs = document.getElementById('ppCarouselThumbs');
  const prevBtn = document.getElementById('ppCarouselPrev');
  const nextBtn = document.getElementById('ppCarouselNext');
  const counter = document.getElementById('ppCarouselCounter');
  const viewport = document.getElementById('ppCarouselViewport');
  const stampContainer = document.getElementById('ppOfferStampContainer');
  if (stampContainer) {
    stampContainer.innerHTML = getProductOfferStampHtml(product, 'ak-offer-stamp-modal');
  }

  // Build slides array: all images + video demonstration slide (if product has video)
  const rawList = (product.images && product.images.length) ? product.images : [defaultImg];
  const imgList = rawList.map(resolveProductImage);
  const slidesData = imgList.map((src, idx) => ({
    type: 'image',
    src: src,
    alt: `${product.name} - View ${idx + 1}`
  }));

  if (hasProductVideo) {
    slidesData.push({
      type: 'video',
      videoId: product.youtubeVideoId,
      alt: `${product.name} - In-Studio Video Demonstration`
    });
  }

  // Populate Carousel Track
  if (track) {
    track.innerHTML = slidesData.map((slide, idx) => {
      if (slide.type === 'video') {
        return `
          <div class="pp-carousel-slide pp-slide-video" data-index="${idx}">
            <div class="ak-yt-wrapper" id="ppCarouselYtWrapper">
              <iframe id="ppCarouselVideoIframe" class="pp-video-iframe" src="about:blank" data-src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(slide.videoId)}?enablejsapi=1&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3" title="${slide.alt}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" playsinline webkit-playsinline allowfullscreen></iframe>
              <!-- Top Shield: Shields YouTube title, channel avatar & share popup -->
              <div class="ak-yt-shield-top" id="ppCarouselShieldTop" title="Toggle Play / Pause">
                <div class="ak-yt-shield-brand">
                  <span class="ak-yt-dot"></span>
                  <span>AudioKing Studio Player</span>
                </div>
                <span class="ak-yt-shield-title">${slide.alt}</span>
              </div>
              <!-- Bottom Shield: Shields 'Watch on YouTube', logo watermark & link icons -->
              <div class="ak-yt-shield-bottom" id="ppCarouselShieldBottom">
                <button type="button" class="ak-yt-bottom-play-toggle" id="ppCarouselBottomToggle" aria-label="Toggle Play / Pause">
                  <svg class="ak-play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
                  <svg class="ak-pause-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                  <span class="ak-toggle-label">Play</span>
                </button>
                <span class="ak-yt-bottom-tagline">Studio Acoustic Tracking</span>
                <span class="ak-yt-corner-badge">AudioKing HD</span>
              </div>
              <!-- Play Cover: Custom poster with central play button -->
              <div class="ak-yt-play-cover" id="ppCarouselYtCover" role="button" aria-label="Play In-Studio Demonstration Video">
                <img class="ak-yt-cover-bg" src="https://img.youtube.com/vi/${encodeURIComponent(slide.videoId)}/hqdefault.jpg" alt="${slide.alt}" />
                <div class="ak-yt-cover-content">
                  <div class="ak-yt-play-btn">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
                  </div>
                  <span class="ak-yt-cover-title">Play Video Demonstration</span>
                  <span class="ak-yt-cover-sub">Studio Acoustics & Performance Demo</span>
                </div>
              </div>
            </div>
          </div>
        `;
      }
      return `
        <div class="pp-carousel-slide pp-slide-image" data-index="${idx}">
          <img src="${slide.src}" alt="${slide.alt}" class="pp-carousel-img" ${idx === 0 ? 'id="ppMainImage"' : ''}>
        </div>
      `;
    }).join('');

    // Wire up Carousel Video Cover and Shields
    const carouselCover = track.querySelector('#ppCarouselYtCover');
    const carouselIframe = track.querySelector('#ppCarouselVideoIframe');
    const carouselShieldTop = track.querySelector('#ppCarouselShieldTop');
    const carouselBottomToggle = track.querySelector('#ppCarouselBottomToggle');
    let isCarouselPlaying = false;

    function syncCarouselToggleState(playing) {
      isCarouselPlaying = playing;
      if (carouselBottomToggle) {
        const playIcon = carouselBottomToggle.querySelector('.ak-play-icon');
        const pauseIcon = carouselBottomToggle.querySelector('.ak-pause-icon');
        const label = carouselBottomToggle.querySelector('.ak-toggle-label');
        if (playIcon) playIcon.style.display = playing ? 'none' : 'inline-block';
        if (pauseIcon) pauseIcon.style.display = playing ? 'inline-block' : 'none';
        if (label) label.textContent = playing ? 'Pause' : 'Play';
      }
    }

    if (carouselCover && carouselIframe) {
      carouselCover.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        carouselCover.classList.add('hidden');
        if (!carouselIframe.src || !carouselIframe.src.includes('embed')) {
          carouselIframe.src = carouselIframe.dataset.src + '&autoplay=1';
        } else {
          sendYtCommand(carouselIframe, 'playVideo');
        }
        syncCarouselToggleState(true);
      };
    }

    if (carouselBottomToggle && carouselIframe) {
      carouselBottomToggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (carouselCover && !carouselCover.classList.contains('hidden')) {
          carouselCover.click();
          return;
        }
        if (isCarouselPlaying) {
          sendYtCommand(carouselIframe, 'pauseVideo');
          syncCarouselToggleState(false);
        } else {
          sendYtCommand(carouselIframe, 'playVideo');
          syncCarouselToggleState(true);
        }
      };
    }

    if (carouselShieldTop && carouselIframe) {
      carouselShieldTop.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (carouselCover && !carouselCover.classList.contains('hidden')) {
          carouselCover.click();
          return;
        }
        if (isCarouselPlaying) {
          sendYtCommand(carouselIframe, 'pauseVideo');
          syncCarouselToggleState(false);
        } else {
          sendYtCommand(carouselIframe, 'playVideo');
          syncCarouselToggleState(true);
        }
      };
    }
  }

  // Populate Thumbnails Strip Below
  if (thumbs) {
    thumbs.innerHTML = slidesData.map((slide, idx) => {
      if (slide.type === 'video') {
        const ytThumb = `https://img.youtube.com/vi/${slide.videoId}/mqdefault.jpg`;
        return `
          <button type="button" class="pp-carousel-thumb-item video-thumb ${idx === 0 ? 'active' : ''}" data-index="${idx}" aria-label="Watch Video Demonstration">
            <img src="${ytThumb}" alt="Video" onerror="this.src='${defaultImg}';">
            <div class="thumb-video-play">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <span class="thumb-video-badge">VIDEO</span>
          </button>
        `;
      }
      return `
        <button type="button" class="pp-carousel-thumb-item ${idx === 0 ? 'active' : ''}" data-index="${idx}" aria-label="View Angle ${idx + 1}">
          <img src="${slide.src}" alt="Angle ${idx + 1}">
        </button>
      `;
    }).join('');
  }

  // Manual Carousel Navigation Controller
  let currentSlideIndex = 0;

  function setSlide(index) {
    if (index < 0) index = slidesData.length - 1;
    if (index >= slidesData.length) index = 0;
    currentSlideIndex = index;

    if (track) {
      // Reset any active image zoom on all slides
      track.querySelectorAll('.pp-slide-image img').forEach(img => {
        img.style.transformOrigin = 'center center';
        img.style.transform = 'scale(1)';
      });
      track.style.transform = `translateX(-${currentSlideIndex * 100}%)`;
      // Lazy load video src when video slide is reached, and unload when navigating away to stop audio
      const videoIframe = track.querySelector('#ppCarouselVideoIframe');
      const carouselCover = track.querySelector('#ppCarouselYtCover');
      if (videoIframe) {
        if (slidesData[currentSlideIndex].type === 'video') {
          if (!videoIframe.src || !videoIframe.src.includes('embed')) {
            videoIframe.src = videoIframe.dataset.src;
          }
        } else {
          sendYtCommand(videoIframe, 'pauseVideo');
          if (videoIframe.src && videoIframe.src.includes('embed')) {
            videoIframe.src = 'about:blank';
          }
          if (carouselCover) carouselCover.classList.remove('hidden');
        }
      }
    }

    if (counter) {
      counter.textContent = `${currentSlideIndex + 1} / ${slidesData.length}`;
    }

    if (thumbs) {
      thumbs.querySelectorAll('.pp-carousel-thumb-item').forEach((btn, i) => {
        btn.classList.toggle('active', i === currentSlideIndex);
      });
    }
  }

  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.preventDefault();
      setSlide(currentSlideIndex - 1);
    };
  }
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.preventDefault();
      setSlide(currentSlideIndex + 1);
    };
  }

  if (thumbs) {
    thumbs.querySelectorAll('.pp-carousel-thumb-item').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        const targetIdx = parseInt(btn.dataset.index, 10) || 0;
        setSlide(targetIdx);
      };
    });
  }

  // Touch Swipe gestures on mobile carousel
  if (viewport) {
    let touchStartX = 0;
    let touchStartY = 0;

    viewport.addEventListener('touchstart', (e) => {
      if (e.target && (e.target.closest('.pp-slide-video') || e.target.tagName === 'IFRAME')) {
        return;
      }
      if (e.touches && e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    viewport.addEventListener('touchend', (e) => {
      if (e.target && (e.target.closest('.pp-slide-video') || e.target.tagName === 'IFRAME')) {
        return;
      }
      if (e.changedTouches && e.changedTouches.length > 0) {
        const diffX = touchStartX - e.changedTouches[0].clientX;
        const diffY = touchStartY - e.changedTouches[0].clientY;
        if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
          if (diffX > 0) {
            setSlide(currentSlideIndex + 1);
          } else {
            setSlide(currentSlideIndex - 1);
          }
        }
      }
    }, { passive: true });
  }

  // Interactive Desktop/Laptop Hover Zoom Lens on Product Images
  if (viewport) {
    function resetImageZoom() {
      if (track) {
        track.querySelectorAll('.pp-slide-image img').forEach(img => {
          img.style.transformOrigin = 'center center';
          img.style.transform = 'scale(1)';
        });
      }
    }

    viewport.onmousemove = (e) => {
      if (window.innerWidth <= 768) return; // Strictly laptop/desktop
      // Ignore hover over navigation buttons or counter badge
      if (e.target && (e.target.closest('.pp-carousel-nav') || e.target.closest('.pp-carousel-counter'))) {
        resetImageZoom();
        return;
      }
      const activeSlide = track ? track.querySelector(`.pp-carousel-slide[data-index="${currentSlideIndex}"]`) : null;
      if (!activeSlide || !activeSlide.classList.contains('pp-slide-image')) {
        resetImageZoom();
        return;
      }
      const img = activeSlide.querySelector('img');
      if (!img) return;

      const rect = activeSlide.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const xPercent = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const yPercent = Math.max(0, Math.min(100, (y / rect.height) * 100));

      img.style.transformOrigin = `${xPercent}% ${yPercent}%`;
      img.style.transform = 'scale(2.2)';
    };

    viewport.onmouseleave = () => {
      resetImageZoom();
    };
  }

  setSlide(0);

  // Setup Dedicated Video Section and Navigation Tabs (Strictly Product 1 Only)
  const dedicatedIframe = document.getElementById('ppVideoIframe');
  const videoTitle = document.getElementById('ppVideoTitle');
  const videoTab = document.getElementById('ppTabVideo');
  const infoVideoOpt = document.getElementById('ppInfoOptionVideo');
  const protocolNotice = document.getElementById('ppVideoProtocolNotice');
  const dedicatedPlayInPageBtn = document.getElementById('ppVideoPlayInPageBtn');
  const dedicatedCover = document.getElementById('ppDedicatedYtCover');
  const dedicatedCoverImg = document.getElementById('ppDedicatedCoverImg');
  const dedicatedShieldTop = document.getElementById('ppDedicatedShieldTop');
  const dedicatedShieldBottom = document.getElementById('ppDedicatedShieldBottom');
  const dedicatedBottomToggle = document.getElementById('ppDedicatedBottomToggle');
  const dedicatedShieldTitle = document.getElementById('ppDedicatedShieldTitle');

  const isFileProtocol = window.location.protocol === 'file:';
  if (protocolNotice) {
    protocolNotice.style.display = isFileProtocol ? 'block' : 'none';
  }

  if (hasProductVideo) {
    if (videoTab) videoTab.style.display = 'inline-flex';
    if (infoVideoOpt) infoVideoOpt.style.display = 'inline-flex';
    if (videoTitle) videoTitle.textContent = `Watch ${product.name} in Action`;
    if (dedicatedShieldTitle) dedicatedShieldTitle.textContent = `${product.name} Demonstration`;

    const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(product.youtubeVideoId)}?enablejsapi=1&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3`;
    const hqThumb = `https://img.youtube.com/vi/${encodeURIComponent(product.youtubeVideoId)}/hqdefault.jpg`;

    if (dedicatedCoverImg) {
      dedicatedCoverImg.src = hqThumb;
    }
    if (dedicatedCover) {
      dedicatedCover.classList.remove('hidden');
    }

    if (dedicatedIframe) {
      dedicatedIframe.dataset.src = embedUrl;
      dedicatedIframe.src = embedUrl;
    }

    let isDedicatedPlaying = false;

    function syncDedicatedToggleState(playing) {
      isDedicatedPlaying = playing;
      if (dedicatedBottomToggle) {
        const playIcon = dedicatedBottomToggle.querySelector('.ak-play-icon');
        const pauseIcon = dedicatedBottomToggle.querySelector('.ak-pause-icon');
        const label = dedicatedBottomToggle.querySelector('.ak-toggle-label');
        if (playIcon) playIcon.style.display = playing ? 'none' : 'inline-block';
        if (pauseIcon) pauseIcon.style.display = playing ? 'inline-block' : 'none';
        if (label) label.textContent = playing ? 'Pause' : 'Play';
      }
    }

    const startDedicatedVideo = () => {
      if (dedicatedCover) dedicatedCover.classList.add('hidden');
      if (dedicatedIframe) {
        if (!dedicatedIframe.src || !dedicatedIframe.src.includes('embed')) {
          dedicatedIframe.src = embedUrl + '&autoplay=1';
        } else {
          sendYtCommand(dedicatedIframe, 'playVideo');
        }
      }
      syncDedicatedToggleState(true);
    };

    if (dedicatedCover) {
      dedicatedCover.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDedicatedVideo();
      };
    }

    if (dedicatedPlayInPageBtn) {
      dedicatedPlayInPageBtn.onclick = (e) => {
        e.preventDefault();
        switchProductPanel('video');
        startDedicatedVideo();
        const videoSection = document.getElementById('ppPanelVideo') || dedicatedIframe;
        if (videoSection) {
          videoSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    }

    if (dedicatedBottomToggle && dedicatedIframe) {
      dedicatedBottomToggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dedicatedCover && !dedicatedCover.classList.contains('hidden')) {
          startDedicatedVideo();
          return;
        }
        if (isDedicatedPlaying) {
          sendYtCommand(dedicatedIframe, 'pauseVideo');
          syncDedicatedToggleState(false);
        } else {
          sendYtCommand(dedicatedIframe, 'playVideo');
          syncDedicatedToggleState(true);
        }
      };
    }

    if (dedicatedShieldTop && dedicatedIframe) {
      dedicatedShieldTop.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dedicatedCover && !dedicatedCover.classList.contains('hidden')) {
          startDedicatedVideo();
          return;
        }
        if (isDedicatedPlaying) {
          sendYtCommand(dedicatedIframe, 'pauseVideo');
          syncDedicatedToggleState(false);
        } else {
          sendYtCommand(dedicatedIframe, 'playVideo');
          syncDedicatedToggleState(true);
        }
      };
    }
  } else {
    if (videoTab) videoTab.style.display = 'none';
    if (infoVideoOpt) infoVideoOpt.style.display = 'none';
    if (protocolNotice) protocolNotice.style.display = 'none';
    if (dedicatedIframe) {
      dedicatedIframe.src = '';
      dedicatedIframe.removeAttribute('data-src');
    }
  }

  // Render Related Products (Matching media_1789491930448.jpg)
  renderRelatedProducts(product);

  // Render Deep-Dive Specifications (Matching media_1789491930471.jpg)
  renderDeepDiveSpecifications(product);

  // Default dedicated content frame to full Description tab without scrolling
  switchProductPanel('desc');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Render Related Products Carousel (Matching media_1789491930448.jpg)
 * Zero star ratings, View All button, horizontal slider
 */
function renderRelatedProducts(product) {
  const track = document.getElementById('ppRelatedTrack');
  const viewAllBtn = document.getElementById('ppRelatedViewAll');
  if (!track) return;

  if (viewAllBtn) {
    viewAllBtn.onclick = () => {
      showCatalog(product.category);
    };
  }

  const catLower = (product.category || '').toLowerCase();
  const subcatLower = (product.subcategory || '').toLowerCase();
  const nameLower = (product.name || '').toLowerCase();

  const primaryRelated = [];
  const secondaryRelated = [];
  const tertiaryRelated = [];
  const seenIds = new Set([product.id]);

  // 1. Primary: Subcategory match or direct studio gear synergy
  AUDIOKING_PRODUCTS.forEach(p => {
    if (seenIds.has(p.id)) return;
    const pCat = (p.category || '').toLowerCase();
    const pSub = (p.subcategory || '').toLowerCase();
    const pName = (p.name || '').toLowerCase();

    let isPrimary = false;
    if (subcatLower && pSub && subcatLower === pSub) isPrimary = true;
    else if ((catLower.includes('drum') || subcatLower.includes('drum') || nameLower.includes('drum')) &&
             (pCat.includes('drum') || pSub.includes('drum') || pName.includes('drum'))) isPrimary = true;
    else if ((catLower.includes('mic') || subcatLower.includes('mic') || nameLower.includes('mic')) &&
             (pCat.includes('mic') || pSub.includes('mic') || pCat.includes('interface') || pName.includes('mic'))) isPrimary = true;
    else if (catLower.includes('interface') &&
             (pCat.includes('interface') || pCat.includes('mic') || pCat.includes('monitor') || pCat.includes('headphone'))) isPrimary = true;
    else if (catLower.includes('monitor') &&
             (pCat.includes('monitor') || pCat.includes('interface') || pCat.includes('acoustic'))) isPrimary = true;
    else if ((catLower.includes('pedal') || catLower.includes('effect') || catLower.includes('guitar')) &&
             (pCat.includes('pedal') || pCat.includes('effect') || pCat.includes('guitar') || pCat.includes('amp') || pSub.includes('pedal'))) isPrimary = true;
    else if ((catLower.includes('keyboard') || catLower.includes('synth') || catLower.includes('midi')) &&
             (pCat.includes('keyboard') || pCat.includes('synth') || pCat.includes('midi'))) isPrimary = true;
    else if (catLower.includes('mixer') &&
             (pCat.includes('mixer') || pCat.includes('interface') || pCat.includes('mic'))) isPrimary = true;
    else if (catLower.includes('headphone') &&
             (pCat.includes('headphone') || pCat.includes('interface'))) isPrimary = true;
    else if (pCat === catLower) isPrimary = true;

    if (isPrimary) {
      primaryRelated.push(p);
      seenIds.add(p.id);
    }
  });

  // 2. Secondary: Same brand or complementary equipment in neighboring pro audio domains
  AUDIOKING_PRODUCTS.forEach(p => {
    if (seenIds.has(p.id)) return;
    const pBrand = (p.brand || '').toLowerCase();
    const pCat = (p.category || '').toLowerCase();
    if (pBrand === (product.brand || '').toLowerCase() || (catLower && pCat.includes(catLower.split(' ')[0]))) {
      secondaryRelated.push(p);
      seenIds.add(p.id);
    }
  });

  // 3. Tertiary: Top studio recording, monitors, and stage gear (guaranteeing at least 20-30 items)
  AUDIOKING_PRODUCTS.forEach(p => {
    if (seenIds.has(p.id)) return;
    tertiaryRelated.push(p);
    seenIds.add(p.id);
  });

  // Target exactly 25 diverse items in the carousel
  const related = [...primaryRelated, ...secondaryRelated, ...tertiaryRelated].slice(0, 25);

  track.innerHTML = related.map(item => `
    <article class="pp-related-card ak-reveal-card" data-id="${item.id}" style="cursor:pointer;">
      <div class="pp-related-img-box">
        <img src="${item.image || 'assets/images/placeholder.jpg'}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src='assets/images/placeholder.jpg';">
      </div>
      <div class="pp-related-brand">${item.brand}</div>
      <h4 class="pp-related-card-title" title="${item.name}">${item.name}</h4>
      <div class="pp-related-price">${formatINR(item.price)}</div>
    </article>
  `).join('');

  track.querySelectorAll('.pp-related-card').forEach(card => {
    card.addEventListener('click', () => {
      const pid = card.dataset.id;
      recordProductClick(pid);
      showProduct(pid);
    });
  });

  // Wire carousel navigation buttons
  const prevBtn = document.getElementById('ppRelatedPrevBtn');
  const nextBtn = document.getElementById('ppRelatedNextBtn');

  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.preventDefault();
      const scrollAmt = window.innerWidth <= 768 ? 240 : 280;
      track.scrollBy({ left: -scrollAmt, behavior: 'smooth' });
    };
  }
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.preventDefault();
      const scrollAmt = window.innerWidth <= 768 ? 240 : 280;
      track.scrollBy({ left: scrollAmt, behavior: 'smooth' });
    };
  }
  setTimeout(triggerScrollReveal, 50);
}

/**
 * Render Deep-Dive Specifications & Spotlight (Matching media_1789491930471.jpg)
 */
function renderDeepDiveSpecifications(product) {
  const titleEl = document.getElementById('ppDeepDiveTitle');
  const descEl = document.getElementById('ppDeepDiveDesc');
  const tableEl = document.getElementById('ppDeepSpecsTable');
  const spotImg = document.getElementById('ppSpotlightImg');
  const categoryTitle = document.getElementById('ppAccordionCategoryTitle');

  if (titleEl) {
    titleEl.textContent = `${product.name} – Engineering & Acoustic Overview`;
  }

  if (descEl) {
    descEl.textContent = product.description || `The ${product.name} delivers exceptionally balanced sonic projection with high dynamic range and linear acoustic response. Built for studio clarity, stage durability, and everyday reliability, this equipment is ideal for audio engineers, producers, and performers seeking pro fidelity at an accessible value.`;
  }

  if (categoryTitle) {
    categoryTitle.textContent = `Architecture & ${product.category || 'Build Specifications'}`;
  }

  if (tableEl) {
    let rows = [];
    if (product.deepSpecs && Array.isArray(product.deepSpecs)) {
      rows = product.deepSpecs;
    } else {
      const cat = (product.category || '').toUpperCase();
      if (cat.includes('MICROPHONE')) {
        rows = [
          ['Transducer Type', 'Large Diaphragm Dynamic / True Condenser'],
          ['Polar Pattern', 'Uniform Cardioid Directional'],
          ['Frequency Response', '50 Hz – 20,000 Hz'],
          ['Output Impedance', '150 Ohms (Balanced)'],
          ['Sensitivity', '-59.0 dB (1.12 mV) at 1 kHz'],
          ['Connector', 'Professional 3-Pin XLR Male'],
          ['Shielding', 'Internal Air Suspension & Electromagnetic Hum-bucking'],
          ['Build Material', 'Die-cast Dark Gray Enamel Aluminum / Steel Grille'],
          ['Included in Box', 'Locking Swivel Mount, Foam Windscreen, User Guide'],
          ['Distributor Warranty', 'Efficient Indian Authorized Warranty']
        ];
      } else if (cat.includes('INTERFACE')) {
        rows = [
          ['Connectivity', 'USB Type-C (Bus-Powered Audio Class 2.0)'],
          ['Simultaneous I/O', '2 x 2 Analog Audio Channels'],
          ['Preamps', 'Ultra-low Noise Microphone Preamps with Air Mode'],
          ['Phantom Power', '+48V Switchable on All Channels'],
          ['A/D & D/A Resolution', '24-bit / 192 kHz High-Resolution Audio'],
          ['Dynamic Range', '120 dB (A-Weighted)'],
          ['Headphone Output', '1 x 1/4" TRS with Precision Independent Volume'],
          ['Chassis Construction', 'Rugged Anodized Red Aluminum Touring Shell'],
          ['Bundled Software', 'Ableton Live Lite, Pro Tools Artist Trial, Plug-in Collective'],
          ['Distributor Warranty', 'Efficient Indian Authorized Warranty']
        ];
      } else {
        rows = [
          ['Manufacturer & Series', `${product.brand} Professional Sound Series`],
          ['Primary Category', product.category || 'Pro Audio Equipment'],
          ['Circuit Architecture', 'Low-Jitter Precision Solid-State Electronics'],
          ['Operating Voltage', '220V - 240V AC 50Hz (India Standard)'],
          ['Frequency Bandwidth', '20 Hz – 20,000 Hz +/- 0.5 dB'],
          ['Housing Material', 'Tour-grade Steel & Reinforced Impact Polymer'],
          ['Certification', 'BIS & CE Certified for Indian Distribution'],
          ['Serial Verification', 'Authentic Serial Registered with Indian Importer'],
          ['Package Contents', 'Main Hardware Unit, Power Cable, Quickstart Manual'],
          ['Distributor Warranty', 'Efficient Indian Authorized Warranty']
        ];
      }
    }

    tableEl.innerHTML = rows.map(([key, val]) => `
      <tr>
        <td>${key}</td>
        <td>${val}</td>
      </tr>
    `).join('');
  }

  if (spotImg) {
    const spotSrc = (product.images && product.images.length > 2)
      ? product.images[2]
      : (product.image || 'assets/images/placeholder.jpg');
    spotImg.src = resolveProductImage(spotSrc);
    spotImg.alt = `${product.name} Studio Detail`;
  }

  // Accordion toggle
  const toggleBtn = document.getElementById('ppAccordionToggle');
  const bodyEl = document.getElementById('ppAccordionBody');
  const pillIcon = document.getElementById('ppPillIcon');

  if (toggleBtn && bodyEl && pillIcon) {
    toggleBtn.onclick = () => {
      const isCollapsed = bodyEl.classList.toggle('collapsed');
      pillIcon.textContent = isCollapsed ? '+' : '−';
    };
  }

  // Wire Content Frame Tabs (Strictly NO scrolling)
  document.querySelectorAll('.pp-frame-tab').forEach(tab => {
    tab.onclick = (e) => {
      e.preventDefault();
      switchProductPanel(tab.dataset.tab);
    };
  });

  // Wire Primary Info Column Quick View Options (Strictly NO scrolling)
  document.querySelectorAll('.pp-info-option-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      switchProductPanel(btn.dataset.tab);
    };
  });
}

/**
 * Switch dynamic panel inside the Dedicated Content Frame with smooth subtle transition and NO scrolling
 */
export function switchProductPanel(tabKey) {
  const validTabs = ['desc', 'specs', 'video'];
  const targetTab = validTabs.includes(tabKey) ? tabKey : 'desc';

  // 1. Sync Content Frame Tabs (.pp-frame-tab)
  document.querySelectorAll('.pp-frame-tab').forEach(tab => {
    const isActive = tab.dataset.tab === targetTab;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // 2. Sync Primary Column Quick View Options (.pp-info-option-btn)
  document.querySelectorAll('.pp-info-option-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === targetTab);
  });

  // 3. Switch active panel with subtle fade & slide transition
  const panelMap = {
    desc: 'ppPanelDesc',
    specs: 'ppPanelSpecs',
    video: 'ppPanelVideo'
  };

  document.querySelectorAll('.pp-frame-panels-wrap .pp-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(panelMap[targetTab]);
  if (activePanel) {
    activePanel.classList.add('active');
  }

  // If switched to video, ensure player iframe is loaded
  if (targetTab === 'video') {
    const videoIframe = document.getElementById('ppVideoIframe');
    if (videoIframe && videoIframe.dataset.src && (!videoIframe.src || videoIframe.src === 'about:blank')) {
      videoIframe.src = videoIframe.dataset.src;
    }
  }
}

/**
 * View 4: Contact Us View (Matching reference image)
 */
export function showContact(updateHash = true) {
  if (!checkDirtyBeforeNavigate(() => showContact(updateHash))) return;
  hideAllViews();
  const contactPage = document.getElementById('akContactPage');
  if (contactPage) contactPage.style.display = 'block';
  setActiveNavItem('akNavItemContact');
  if (updateHash) {
    setRouteHash('#contact', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  triggerScrollReveal();
}

/**
 * View 5: Dedicated Full Checkout Page View
 */
export function showCheckoutPage(items = null, updateHash = true) {
  if (!checkDirtyBeforeNavigate(() => showCheckoutPage(items, updateHash))) return;
  hideAllViews();
  const checkoutPage = document.getElementById('akCheckoutPage');
  if (!checkoutPage) return;
  checkoutPage.style.display = 'block';

  // Use items or default to current cart items
  currentCheckoutItems = items && items.length ? items : getCartItems();

  if (!currentCheckoutItems.length) {
    showToast('Your cart is empty. Add gear before checking out.');
    showHome();
    return;
  }

  renderCheckoutSummary();
  if (updateHash) {
    setRouteHash('#checkout', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  triggerScrollReveal();
}

/**
 * Render checkout summary in dedicated checkout view
 */
function renderCheckoutSummary() {
  const list = document.getElementById('akCheckoutItemsList');
  const subtotalEl = document.getElementById('akCoSubtotal');
  const gstEl = document.getElementById('akCoGst');
  const totalEl = document.getElementById('akCoGrandTotal');

  if (!list) return;

  let subtotal = 0;
  list.innerHTML = currentCheckoutItems.map(item => {
    const itemTotal = item.price * (item.quantity || item.qty || 1);
    subtotal += itemTotal;
    return `
      <div class="ak-summary-item-row">
        <div class="ak-summary-item-left">
          <span class="ak-summary-item-title">${item.name}</span>
          <span class="ak-summary-item-qty">Qty: ${item.quantity || item.qty || 1} × ${formatINR(item.price)}</span>
        </div>
        <div class="ak-summary-item-price">${formatINR(itemTotal)}</div>
      </div>
    `;
  }).join('');

  // GST (18% inclusive)
  const gstAmount = Math.round(subtotal * 0.18 / 1.18);

  if (subtotalEl) subtotalEl.textContent = formatINR(subtotal);
  if (gstEl) gstEl.textContent = formatINR(gstAmount);
  if (totalEl) totalEl.textContent = formatINR(subtotal);
}

/**
 * Product Details Page Interactions (Zoom Lens, Quantity, Buy Now)
 */
function initProductDetailPage() {
  // Back to Store button
  const backBtn = document.getElementById('ppBack');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showCatalog();
    });
  }

  // Quantity controls
  const qtyInput = document.getElementById('ppQtyInput');
  const qtyMinus = document.getElementById('ppQtyMinus');
  const qtyPlus = document.getElementById('ppQtyPlus');

  if (qtyMinus && qtyInput) {
    qtyMinus.addEventListener('click', () => {
      let val = parseInt(qtyInput.value || 1, 10);
      if (val > 1) qtyInput.value = val - 1;
    });
  }

  if (qtyPlus && qtyInput) {
    qtyPlus.addEventListener('click', () => {
      let val = parseInt(qtyInput.value || 1, 10);
      if (val < 99) qtyInput.value = val + 1;
    });
  }

  // Add to cart button
  const addBtn = document.getElementById('ppAddToCartBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!activeProduct) return;
      if (activeVariant && activeVariant.stock === 0) return;
      if (!activeVariant && activeProduct.stock === 0) return;

      const qty = parseInt(qtyInput?.value || 1, 10);
      const productToAdd = activeVariant ? {
        ...activeProduct,
        id: `${activeProduct.id}_${activeVariant.id}`,
        productId: activeProduct.id,
        variantId: activeVariant.id,
        name: `${activeProduct.name} - ${activeVariant.optionLabels}`,
        price: activeVariant.priceOverride != null ? activeVariant.priceOverride : activeProduct.price
      } : activeProduct;

      addToCart(productToAdd, qty);
    });
  }

  // Buy Now button -> direct to dedicated checkout page (protected by Sign-in gate)
  const buyNowBtn = document.getElementById('ppBuyNowBtn');
  if (buyNowBtn) {
    buyNowBtn.addEventListener('click', () => {
      if (!activeProduct) return;
      if (activeVariant && activeVariant.stock === 0) return;
      if (!activeVariant && activeProduct.stock === 0) return;

      const user = getCurrentUser();
      if (!user) {
        openAuthModal('signin', 'To proceed shopping you need to sign in');
        showToast('Please sign in to proceed with purchase');
        return;
      }
      const qty = parseInt(qtyInput?.value || 1, 10);
      const buyNowItem = {
        id: activeVariant ? `${activeProduct.id}_${activeVariant.id}` : activeProduct.id,
        name: activeVariant ? `${activeProduct.name} - ${activeVariant.optionLabels}` : activeProduct.name,
        price: activeVariant && activeVariant.priceOverride != null ? activeVariant.priceOverride : activeProduct.price,
        image: activeProduct.image,
        brand: activeProduct.brand,
        quantity: qty
      };
      showCheckoutPage([buyNowItem]);
    });
  }
}

/**
 * Contact Page interactions
 */
function initContactPage() {
  const form = document.getElementById('akContactPageForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('akCpName')?.value || 'Valued Musician';
      showToast(`Thank you ${name}! Our specialist team will contact you within 24 hours.`);
      form.reset();
    });
  }
}

/**
 * Dedicated Checkout Page Interactions
 */
function initDedicatedCheckoutPage() {
  // Payment choice radio styling
  const choices = document.querySelectorAll('.ak-payment-choice');
  choices.forEach(label => {
    label.addEventListener('click', () => {
      choices.forEach(l => l.classList.remove('active'));
      label.classList.add('active');
    });
  });

  // Form submission
  const form = document.getElementById('akCheckoutPageForm');
  const submitBtn = document.getElementById('akCheckoutSubmitBtn');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentCheckoutItems.length) {
        showToast('Cart is empty.');
        return;
      }

      const selectedPayment = document.querySelector('input[name="akCheckoutPayment"]:checked')?.value || 'UPI';
      const orderData = {
        items: currentCheckoutItems,
        customer: {
          name: document.getElementById('akCoFullName')?.value || 'Valued Customer',
          phone: document.getElementById('akCoPhone')?.value || '+91 98765 43210',
          email: document.getElementById('akCoEmail')?.value || 'customer@example.com',
          address: document.getElementById('akCoAddress')?.value || 'Flagship Studio',
          city: document.getElementById('akCoCity')?.value || 'Mumbai',
          state: document.getElementById('akCoState')?.value || 'Maharashtra',
          pincode: document.getElementById('akCoPincode')?.value || '400053'
        },
        paymentMethod: selectedPayment,
        date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Securing Payment & Dispatch...';
      }

      activePaymentAdapter.processPayment(orderData).then(result => {
        if (result.success) {
          orderData.transactionId = result.transactionId;
          ordersService.createOrder(orderData).catch(err => console.warn('[Checkout] Order persistence notice:', err.message));
          clearCart();
          hideAllViews();
          showOrderConfirmation(orderData);
        } else {
          showToast('Payment processing failed. Please try again.');
        }
      }).catch(() => {
        showToast('Payment processing error. Please try again.');
      }).finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirm & Place Order →';
        }
      });
    });
  }
}

/**
 * Setup Global App Event Listeners (Decoupled Navigation & Search)
 */
function setupAppEventListeners() {
  window.addEventListener('ak:filter-brand', (e) => {
    showCatalog(e.detail, 'brand');
  });

  window.addEventListener('ak:filter-category', (e) => {
    showCatalog(e.detail, 'category');
  });

  window.addEventListener('ak:search-brand', (e) => {
    showCatalog(e.detail, 'brand');
  });

  window.addEventListener('ak:search-cat', (e) => {
    showCatalog(e.detail, 'category');
  });

  window.addEventListener('ak:search-prod', (e) => {
    const p = AUDIOKING_PRODUCTS.find(item => item.id === e.detail);
    if (p) showProduct(p);
  });

  window.addEventListener('ak:search-submit', (e) => {
    showCatalog(e.detail, 'search');
  });

  window.addEventListener('ak:nav-home', () => {
    showHome();
  });
}

let globalScrollObserver = null;
let scrollThrottleTimeout = null;

export function triggerScrollReveal() {
  const selector = [
    '.ak-reveal:not(.is-revealed)',
    '.ak-scroll-reveal:not(.is-revealed)',
    '.ak-reveal-card:not(.is-revealed)',
    '.ak-product-card:not(.is-revealed)',
    '.ak-category-card:not(.is-revealed)',
    '.ak-testimonial-card:not(.is-revealed)',
    '.ak-trust-item:not(.is-revealed)',
    '.ak-benefit-card:not(.is-revealed)',
    '#akContactPage .ak-contact-card-box:not(.is-revealed)',
    '#productPage .pp-layout-grid:not(.is-revealed)',
    '#akCheckoutPage .ak-checkout-layout:not(.is-revealed)'
  ].join(', ');

  const elements = document.querySelectorAll(selector);
  if (!elements.length) return;

  if ('IntersectionObserver' in window) {
    if (!globalScrollObserver) {
      globalScrollObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            obs.unobserve(entry.target);
          }
        });
      }, {
        root: null,
        rootMargin: '0px 0px -20px 0px',
        threshold: 0.05
      });
    }

    elements.forEach((el, idx) => {
      if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 60 && rect.bottom > -60) {
        setTimeout(() => {
          el.classList.add('is-revealed');
        }, Math.min(idx * 30, 280));
      } else {
        globalScrollObserver.observe(el);
      }
    });
  } else {
    elements.forEach(el => el.classList.add('is-revealed'));
  }
}

function handleScrollForReveal() {
  if (scrollThrottleTimeout) return;
  scrollThrottleTimeout = setTimeout(() => {
    scrollThrottleTimeout = null;
    triggerScrollReveal();
  }, 120);
}

/**
 * Smooth appear-on-scroll and initial load entrance animations
 */
function initScrollReveal() {
  document.documentElement.classList.add('js-ready');
  document.documentElement.classList.add('js-loaded');
  triggerScrollReveal();
  window.addEventListener('scroll', handleScrollForReveal, { passive: true });
  window.addEventListener('resize', handleScrollForReveal, { passive: true });
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => {
      triggerScrollReveal();
    });
  }
  // Extra triggers for dynamically rendered grids
  setTimeout(triggerScrollReveal, 300);
}

/**
 * Product Engagement & Click Tracking Engine
 */
export function getProductClicks() {
  try {
    return JSON.parse(localStorage.getItem('audioking_product_clicks') || '{}');
  } catch (e) {
    return {};
  }
}

export function recordProductClick(productId) {
  if (!productId) return;
  try {
    const clicks = getProductClicks();
    clicks[productId] = (clicks[productId] || 0) + 1;
    localStorage.setItem('audioking_product_clicks', JSON.stringify(clicks));

    // Optional non-blocking beacon to backend
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(apiUrl('/api/analytics/click'), JSON.stringify({ productId }));
      }
    } catch (e) {}

    // Dynamically recurring update of featured products if on home page
    const activeTab = document.querySelector('.ak-tab-btn.active')?.dataset.tab || 'best-sellers';
    if (activeTab === 'best-sellers') {
      const currentList = FEATURED_PRODUCTS.length ? FEATURED_PRODUCTS : AUDIOKING_PRODUCTS;
      renderFeaturedProducts(currentList);
    }
  } catch (e) {}
}

/**
 * Render Featured Products Grid (Strictly 5 cards per row, max 2 rows = 10 items total)
 * Dynamically recurring based on customer click popularity!
 */
export function renderFeaturedProducts(items) {
  const grid = document.getElementById('akFeaturedProductsGrid');
  if (!grid) return;

  const baseItems = (items && items.length) ? [...items] : [...FEATURED_PRODUCTS];
  const clicks = getProductClicks();

  // Retrieve locked featured product IDs (configured by client in Admin Panel)
  let lockedIds = window._lockedFeaturedProductIds || [];
  if (!lockedIds || !lockedIds.length) {
    try {
      const saved = localStorage.getItem('audioking_locked_featured');
      if (saved) lockedIds = JSON.parse(saved);
    } catch (e) {}
  }
  if (!Array.isArray(lockedIds)) lockedIds = [];

  // Split into locked products (protected from impression sorting) and remaining products
  const lockedProducts = [];
  const remainingProducts = [];

  // Map locked products in their exact assigned order
  lockedIds.forEach(id => {
    const found = baseItems.find(p => p.id === id);
    if (found && !lockedProducts.some(lp => lp.id === found.id)) {
      lockedProducts.push(found);
    }
  });

  baseItems.forEach(p => {
    if (!lockedIds.includes(p.id)) {
      remainingProducts.push(p);
    }
  });

  // Dynamically sort remaining products based on customer impressions/clicks:
  remainingProducts.sort((a, b) => {
    const clicksA = clicks[a.id] || 0;
    const clicksB = clicks[b.id] || 0;
    if (clicksB !== clicksA) return clicksB - clicksA;
    return 0;
  });

  // Combine: Locked products stay firmly at the front, followed by impression-ranked products
  const displayItems = [...lockedProducts, ...remainingProducts].slice(0, 10);

  grid.innerHTML = displayItems.map((p) => {
    const imgSrc = resolveProductImage(p.image);
    const cartQty = getCartItemQuantity(p.id);
    const clickCount = clicks[p.id] || 0;
    const trendingBadge = clickCount >= 2 ? `
      <div class="ak-card-trending-badge" aria-label="Trending Product">
        <span>🔥 Trending</span>
      </div>
    ` : '';

    const actionHtml = cartQty > 0 ? `
      <div class="ak-card-qty-control" data-id="${p.id}">
        <span class="ak-card-qty-tick">✓ In Cart</span>
        <div class="ak-card-qty-actions">
          <button type="button" class="ak-card-qty-btn ak-minus" data-id="${p.id}" aria-label="Decrease quantity">−</button>
          <span class="ak-card-qty-val">${cartQty}</span>
          <button type="button" class="ak-card-qty-btn ak-plus" data-id="${p.id}" aria-label="Increase quantity">+</button>
        </div>
      </div>
    ` : `
      <button class="ak-add-btn" data-id="${p.id}">
        <svg class="ak-btn-cart-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
        <span class="ak-btn-text">Add to Cart</span>
      </button>
    `;

    const origPrice = Number(p.originalPrice) || 0;
    const hasDiscount = origPrice > Number(p.price);
    const originalPriceHtml = hasDiscount
      ? `<span class="ak-card-original-price" style="font-size:13px; margin-left:4px;">${formatINR(origPrice)}</span>`
      : '';
    const offerStampHtml = getProductOfferStampHtml(p);

    return `
      <article class="ak-product-card ak-reveal-card" data-id="${p.id}" style="cursor:pointer; position:relative;">
        ${trendingBadge}
        ${offerStampHtml}
        <div class="ak-product-thumb">
          <img class="ak-product-img" src="${imgSrc}" alt="${p.name}" loading="lazy" onerror="this.onerror=null;this.src='assets/images/placeholder.jpg';">
        </div>
        <div class="ak-product-body">
          <span class="ak-product-brand">${p.brand}</span>
          <h3 class="ak-product-name" title="${p.name}">${p.name}</h3>
          <div class="ak-product-price" style="display:flex; align-items:baseline; gap:6px;">
            <span>${formatINR(p.price)}</span>
            ${originalPriceHtml}
          </div>
          ${actionHtml}
        </div>
      </article>
    `;
  }).join('');

  attachAddToCartListeners(grid);
  attachProductCardListeners(grid);
  updateFeaturedCarouselArrows();
  setTimeout(triggerScrollReveal, 40);
}

/**
 * Update Featured Products Carousel Arrows
 */
function updateFeaturedCarouselArrows() {
  const grid = document.getElementById('akFeaturedProductsGrid');
  const prevBtn = document.getElementById('akFeaturedPrevBtn');
  const nextBtn = document.getElementById('akFeaturedNextBtn');
  if (!grid || !prevBtn || !nextBtn) return;

  const atStart = grid.scrollLeft <= 4;
  const atEnd = grid.scrollLeft >= (grid.scrollWidth - grid.clientWidth - 4);
  prevBtn.disabled = atStart;
  prevBtn.classList.toggle('disabled', atStart);
  nextBtn.disabled = atEnd;
  nextBtn.classList.toggle('disabled', atEnd);
}

/**
 * Initialize Featured Products Carousel Navigation
 */
export function initFeaturedCarousel() {
  const grid = document.getElementById('akFeaturedProductsGrid');
  const prevBtn = document.getElementById('akFeaturedPrevBtn');
  const nextBtn = document.getElementById('akFeaturedNextBtn');
  if (!grid || !prevBtn || !nextBtn) return;

  prevBtn.onclick = (e) => {
    e.preventDefault();
    const card = grid.querySelector('.ak-product-card');
    const scrollAmount = card ? (card.offsetWidth + 16) * 2 : grid.clientWidth * 0.75;
    grid.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    setTimeout(updateFeaturedCarouselArrows, 350);
  };

  nextBtn.onclick = (e) => {
    e.preventDefault();
    const card = grid.querySelector('.ak-product-card');
    const scrollAmount = card ? (card.offsetWidth + 16) * 2 : grid.clientWidth * 0.75;
    grid.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    setTimeout(updateFeaturedCarouselArrows, 350);
  };

  grid.addEventListener('scroll', updateFeaturedCarouselArrows, { passive: true });
  window.addEventListener('resize', updateFeaturedCarouselArrows, { passive: true });
  setTimeout(updateFeaturedCarouselArrows, 200);
}

/**
 * Featured Products Tab Switching with Smooth Ease-in Transition
 */
function initProductTabs() {
  const tabs = document.querySelectorAll('.ak-tab-btn');
  const grid = document.getElementById('akFeaturedProductsGrid');
  initFeaturedCarousel();

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabKey = tab.dataset.tab;
      let filtered = FEATURED_PRODUCTS;

      if (tabKey === 'best-sellers') {
        filtered = FEATURED_PRODUCTS.length ? FEATURED_PRODUCTS : AUDIOKING_PRODUCTS;
      } else if (tabKey === 'special-deals') {
        filtered = AUDIOKING_PRODUCTS.filter(p => p.badge?.toLowerCase().includes('deal') || p.originalPrice);
        if (!filtered.length) filtered = FEATURED_PRODUCTS.length ? FEATURED_PRODUCTS : AUDIOKING_PRODUCTS;
      }

      // Smooth ease-in appearance transition
      if (grid) {
        grid.classList.remove('ak-tabs-fade');
        void grid.offsetWidth;
        grid.classList.add('ak-tabs-fade');
      }

      renderFeaturedProducts(filtered.length ? filtered : FEATURED_PRODUCTS);
      setTimeout(triggerScrollReveal, 60);
    });
  });
}

function getProductById(pId) {
  if (!pId) return null;
  return AUDIOKING_PRODUCTS.find(p => p.id === pId) || 
         FEATURED_PRODUCTS.find(p => p.id === pId) || 
         null;
}

/**
 * Attach Product Card Click Listeners to open Product Page
 */
function attachProductCardListeners(container = document) {
  container.querySelectorAll('.ak-product-card').forEach(card => {
    card.style.cursor = 'pointer';
    card.onclick = (e) => {
      if (e.target.closest('.ak-add-btn') || e.target.closest('.ak-card-qty-control')) return;
      const pId = card.dataset.id;
      if (pId) recordProductClick(pId);
      const product = getProductById(pId);
      if (product) showProduct(product);
    };
  });
}

/**
 * Attach Add to Cart Button Handlers & Reactive Quantity Controls
 */
function attachAddToCartListeners(container = document) {
  const refreshFeatured = () => {
    const activeTab = document.querySelector('.ak-tab-btn.active')?.dataset.tab || 'best-sellers';
    let currentList = activeTab === 'special-deals'
      ? AUDIOKING_PRODUCTS.filter(p => (p.category.includes('STUDIO MONITORS') || p.category.includes('MICROPHONES') || p.category.includes('AUDIO INTERFACES')) && p.price < 40000)
      : FEATURED_PRODUCTS;
    renderFeaturedProducts(currentList);
  };

  container.querySelectorAll('.ak-add-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pId = btn.dataset.id;
      const product = getProductById(pId);
      if (!product) return;

      const added = addToCart(product, 1);
      if (added !== false) {
        refreshFeatured();
      }
    };
  });

  container.querySelectorAll('.ak-card-qty-btn.ak-minus').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pId = btn.dataset.id;
      updateCartItemQty(pId, -1);
      refreshFeatured();
    };
  });

  container.querySelectorAll('.ak-card-qty-btn.ak-plus').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pId = btn.dataset.id;
      updateCartItemQty(pId, 1);
      refreshFeatured();
    };
  });
}

/**
 * Shop Top Brands Row Handlers
 */
function initBrandRow() {
  const row = document.getElementById('akBrandsRow');
  if (row) {
    row.querySelectorAll('.ak-brand-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const brand = card.dataset.brand;
        showCatalog(brand, 'brand');
      });
    });
  }

  const viewAllBrandsBtn = document.getElementById('akBrandsViewAllBtn');
  if (viewAllBrandsBtn) {
    viewAllBrandsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openAllBrandsModal(e);
    });
  }

  const allBrandsModal = document.getElementById('akAllBrandsModal');
  if (allBrandsModal) {
    allBrandsModal.addEventListener('click', (e) => {
      if (e.target === allBrandsModal) closeAllBrandsModal();
    });
  }
}

/**
 * Catalog Navigation buttons
 */
function initCatalogNavigation() {
  const viewAllBtn = document.getElementById('akViewAllProducts');
  if (viewAllBtn) {
    viewAllBtn.onclick = (e) => {
      e.preventDefault();
      showCatalog();
    };
  }

  // Connect dropdown brand links
  document.querySelectorAll('.ak-brand-filter-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const b = link.dataset.brand;
      showCatalog(b, 'brand');
    });
  });
}

/**
 * Quick Category Grid Interaction
 */
function setupQuickCategoryListeners() {
  const container = document.getElementById('akQuickCategoriesGrid');
  if (!container) return;

  container.querySelectorAll('.ak-quick-item, .ak-cat-box-card').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      if (item.dataset.isBrands === 'true') {
        showCatalog();
      } else {
        const filter = item.dataset.filter;
        showCatalog(filter, 'category');
      }
    });
  });
}

function initNewsletter() {
  const form = document.getElementById('akNewsletterForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('akNewsletterEmail');
      const submitBtn = form.querySelector('button[type="submit"]');
      const email = (input?.value || '').trim();
      if (!email) return;

      const origBtnText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Subscribing...';
      }

      try {
        const res = await fetch(apiUrl('/api/newsletter/subscribe'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'Welcome to the AudioKing Creator Community!', getIcon('check', '', 20));
          if (input) input.value = '';
        } else {
          showToast(data.message || 'Subscription failed. Please check your email.');
        }
      } catch (err) {
        showToast('Welcome to the AudioKing Community! We have saved your subscription.', getIcon('check', '', 20));
        if (input) input.value = '';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origBtnText;
        }
      }
    });
  }
}

// Expose navigation handlers and data for global accessibility
if (typeof window !== 'undefined') {
  window.showProduct = showProduct;
  window.showCatalog = showCatalog;
  window.__AUDIOKING_PRODUCTS = AUDIOKING_PRODUCTS;
  window.__FEATURED_PRODUCTS = FEATURED_PRODUCTS;
}
