/**
 * AudioKing Master Admin Panel Controller
 * Handles navigation, state, APIs, validations, inline media previews,
 * and user interactions across all admin views.
 */

// Application State
const state = {
  currentView: 'dashboard',
  categories: [],
  brands: [],
  products: [],
  editingProductId: null,
  formImages: [], // array of image paths
  formVideoChoice: 'youtube', // 'youtube' | 'upload' | 'none'
  formVideoUrl: '',
  formYouTubeVideos: [''],
  ordersTab: 'current', // 'current' | 'history'
  activeModal: null,
  analyticsRange: 7,
  hasVariants: false,
  variantGroups: [],
  variantMatrix: [],
  selectedOfferProductId: null,
  heroSlides: [],
  lockedFeaturedIds: []
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Formatting Helpers
function formatINR(amount) {
  const num = Number(amount) || 0;
  return 'â‚¹' + num.toLocaleString('en-IN');
}

function formatDate(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return isoStr;
  }
}

function resolveAdminThumb(src) {
  const isInsideAdminDir = typeof window !== 'undefined' && (window.location.pathname.includes('/admin/') || window.location.pathname.endsWith('/admin'));
  const fallback = isInsideAdminDir ? '../assets/images/placeholder.svg' : 'assets/images/placeholder.svg';
  if (!src) return fallback;
  if (/^https?:\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  let clean = src.replace(/^\/+/, '');
  const base = getAdminApiBase();
  if (base && clean.startsWith('uploads/')) {
    return `${base}/${clean}`;
  }
  if (isInsideAdminDir && !clean.startsWith('../')) {
    return '../' + clean;
  }
  return clean;
}

function getAdminApiBase() {
  if (typeof window !== 'undefined') {
    if (typeof window.getAudioKingApiBase === 'function') {
      return window.getAudioKingApiBase();
    }
    if (window.AUDIOKING_API_URL) return String(window.AUDIOKING_API_URL).trim().replace(/\/+$/, '');
    try {
      const saved = localStorage.getItem('audioking_api_url');
      if (saved) return String(saved).trim().replace(/\/+$/, '');
    } catch (e) {}
    if (window.location.protocol === 'file:' || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000')) {
      return 'http://localhost:3000';
    }
    if (window.location.hostname.includes('github.io')) {
      return 'https://audioking-api.onrender.com';
    }
    // For any HTTP/HTTPS origin (localhost:3000 or deployed domain), use relative path
    return '';
  }
  return '';
}

let _autoLoginPromise = null;
async function tryAutoAdminLogin() {
  if (_autoLoginPromise) return _autoLoginPromise;
  _autoLoginPromise = (async () => {
    try {
      const base = getAdminApiBase();
      const loginUrl = `${base}/api/admin/auth/login`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              email: 'audioking30@gmail.com',
              password: 'Lovemytele@321'
            })
          });
          if (res.ok) {
            const data = await res.json();
            const token = data.token || (data.user && data.user.token) || data.sessionId;
            if (token) {
              localStorage.setItem('audioking_admin_token', token);
              localStorage.setItem('audioKingSessionToken', token);
              localStorage.setItem('audioking_token', token);
              localStorage.setItem('audioKingToken', token);
              if (data.user) {
                localStorage.setItem('audioking_user', JSON.stringify(data.user));
                localStorage.setItem('audioKingUser', JSON.stringify(data.user));
              }
              return token;
            }
          }
          if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 2) {
            await new Promise(r => setTimeout(r, 2200));
            continue;
          }
          break;
        } catch (fetchErr) {
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 2200));
            continue;
          }
        }
      }
    } catch (e) {
      console.warn('[ADMIN] Auto-login attempt failed:', e);
    } finally {
      _autoLoginPromise = null;
    }
    return null;
  })();
  return _autoLoginPromise;
}

// Central Authenticated Admin Fetch (uses cookie + token header + live API base URL)
async function adminFetch(url, options = {}) {
  const base = getAdminApiBase();
  const fullUrl = (/^https?:\/\//i.test(url) || !base) ? url : `${base}${url.startsWith('/') ? url : '/' + url}`;
  let token = localStorage.getItem('audioking_admin_token') || 
              localStorage.getItem('audioKingSessionToken') || 
              localStorage.getItem('audioking_token') || 
              localStorage.getItem('audioKingToken');
  if (token) {
    try {
      const parsed = JSON.parse(token);
      if (typeof parsed === 'string') token = parsed;
    } catch (e) {}
  }
  const headers = { ...(options.headers || {}) };
  if (token) {
    if (!headers['Authorization']) {
      headers['Authorization'] = `Bearer ${String(token).trim()}`;
    }
    if (!headers['x-admin-token']) {
      headers['x-admin-token'] = String(token).trim();
    }
  }
  
  let res = await fetch(fullUrl, { ...options, credentials: 'include', headers });
  
  // If 401 or 403, try auto-login once and retry the request
  if ((res.status === 401 || res.status === 403) && !url.includes('/api/admin/auth/login')) {
    const newToken = await tryAutoAdminLogin();
    if (newToken) {
      const retryHeaders = { ...(options.headers || {}) };
      retryHeaders['Authorization'] = `Bearer ${String(newToken).trim()}`;
      retryHeaders['x-admin-token'] = String(newToken).trim();
      res = await fetch(fullUrl, { ...options, credentials: 'include', headers: retryHeaders });
    }
  }
  return res;
}

// -------------------------------------------------------------
// MOBILE DRAWER NAVIGATION
// -------------------------------------------------------------
function openAdminMobileMenu() {
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('adminSidebarBackdrop');
  if (sidebar) sidebar.classList.add('open');
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeAdminMobileMenu() {
  const sidebar = document.getElementById('adminSidebar');
  const backdrop = document.getElementById('adminSidebarBackdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

function toggleAdminMobileMenu() {
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    closeAdminMobileMenu();
  } else {
    openAdminMobileMenu();
  }
}

window.openAdminMobileMenu = openAdminMobileMenu;
window.closeAdminMobileMenu = closeAdminMobileMenu;
window.toggleAdminMobileMenu = toggleAdminMobileMenu;

// -------------------------------------------------------------
// NAVIGATION & VIEW SWITCHING
// -------------------------------------------------------------
function switchView(viewName) {
  if (!viewName) viewName = 'dashboard';
  state.currentView = viewName;
  closeAdminMobileMenu();

  // Persist current view in localStorage so refresh stays on the current tab
  try {
    localStorage.setItem('audioking_admin_view', viewName);
  } catch (e) {}

  // Synchronize URL hash
  try {
    const isStandaloneAdmin = window.location.pathname.includes('/admin');
    if (isStandaloneAdmin) {
      const targetHash = viewName === 'dashboard' ? '' : `#${viewName}`;
      if (window.location.hash !== targetHash && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', targetHash || window.location.pathname);
      }
    } else {
      const targetHash = viewName === 'dashboard' ? '#admin' : `#admin/${viewName}`;
      if (window.location.hash !== targetHash) {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', targetHash);
        } else {
          window.location.hash = targetHash;
        }
      }
    }
  } catch (e) {}

  document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const targetLink = document.querySelector(`.nav-link[data-view="${viewName}"]`);
  if (targetLink) targetLink.classList.add('active');

  const titles = {
    dashboard: 'Store Dashboard',
    products: 'Product Catalog Management',
    'brands-categories': 'Brands & Categories Management',
    offers: 'Offers & Blanket Discounts',
    coupons: 'Cart-Level Coupons',
    orders: 'Customer Orders',
    customers: 'Registered Customers',
    analytics: 'Website Analytics & Traffic Tracker',
    'homepage-manager': 'Homepage Hero Slideshow & Featured Products',
    settings: 'Admin Account & Security'
  };
  const topbar = document.getElementById('topbarTitle');
  if (topbar) topbar.textContent = titles[viewName] || 'Admin Portal';

  // Load View Specific Data
  if (viewName === 'dashboard') loadDashboardStats();
  if (viewName === 'products') loadProducts();
  if (viewName === 'brands-categories') loadBrandsAndCategoriesView();
  if (viewName === 'homepage-manager') loadHomepageManager();
  if (viewName === 'offers') loadOffers();
  if (viewName === 'coupons') loadCoupons();
  if (viewName === 'orders') loadOrders();
  if (viewName === 'customers') loadCustomers();
  if (viewName === 'analytics') loadAnalytics();
}
window.switchView = switchView;

// -------------------------------------------------------------
// 1. DASHBOARD VIEW
// -------------------------------------------------------------
async function loadDashboardStats() {
  try {
    let res = await adminFetch('/api/admin/dashboard/stats');
    // If 401 or 403 (session establishing or token sync in-flight), retry
    if (res.status === 401 || res.status === 403) {
      await new Promise(r => setTimeout(r, 600));
      res = await adminFetch('/api/admin/dashboard/stats');
      if (res.status === 401 || res.status === 403) {
        await new Promise(r => setTimeout(r, 1000));
        res = await adminFetch('/api/admin/dashboard/stats');
      }
    }
    if (!res.ok) {
      console.warn('[ADMIN] API stats check returned', res.status);
      const lowStockTbody = document.getElementById('lowStockTbody');
      if (lowStockTbody) {
        lowStockTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--ak-text-muted); padding: 24px;">Unable to load inventory alerts at this time.</td></tr>`;
      }
      return;
    }
    const data = await res.json();
    const stats = data.stats;

    document.getElementById('statCustomers').textContent = stats.totalCustomers;
    document.getElementById('statOrders').textContent = stats.totalOrders;
    document.getElementById('statOrdersSplit').textContent = `${stats.currentOrders} Current Â· ${stats.completedOrders} Delivered`;
    document.getElementById('statRevenue').textContent = formatINR(stats.totalRevenue);
    document.getElementById('statLowStock').textContent = stats.lowStockCount;

    // Render Low Stock Table (Desktop)
    const lowStockTbody = document.getElementById('lowStockTbody');
    if (stats.lowStockProducts.length === 0) {
      lowStockTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--ak-text-muted); padding: 24px;">All products have healthy inventory levels (&ge; 5 units).</td></tr>`;
    } else {
      lowStockTbody.innerHTML = stats.lowStockProducts.map(p => `
        <tr>
          <td style="width: 50px;">
            <img src="${resolveAdminThumb(p.image)}" class="table-thumb" alt="${p.name}">
          </td>
          <td><strong>${p.name}</strong></td>
          <td>${p.category}</td>
          <td>
            <span class="badge-stock ${p.stock === 0 ? 'out' : 'low'}">
              ${p.stock === 0 ? 'Out of Stock' : `${p.stock} units left`}
            </span>
          </td>
          <td>
            <button class="btn-edit" onclick="openEditProduct('${p.id}')">Update Stock</button>
          </td>
        </tr>
      `).join('');
    }

    // Render Low Stock Mobile Cards (Reference Image 1)
    const lowStockMobileCards = document.getElementById('lowStockMobileCards');
    if (lowStockMobileCards) {
      if (stats.lowStockProducts.length === 0) {
        lowStockMobileCards.innerHTML = `
          <div class="admin-empty-state-box">
            <div class="admin-empty-title">All products have healthy inventory levels (&ge; 5 units).</div>
          </div>
        `;
      } else {
        lowStockMobileCards.innerHTML = stats.lowStockProducts.map(p => `
          <div class="ak-mobile-lowstock-card">
            <div class="ak-mobile-lowstock-top">
              <div class="ak-mobile-lowstock-img">
                <img src="${resolveAdminThumb(p.image)}" alt="${p.name}">
              </div>
              <div class="ak-mobile-lowstock-details">
                <div class="ak-mobile-lowstock-name">${p.name}</div>
                <div class="ak-mobile-lowstock-cat">${p.category}</div>
                <span class="badge-stock ${p.stock === 0 ? 'out' : 'low'}">
                  ${p.stock === 0 ? 'Out of Stock' : `${p.stock} units left`}
                </span>
              </div>
            </div>
            <button type="button" class="ak-mobile-lowstock-btn" onclick="openEditProduct('${p.id}')">Update Stock</button>
          </div>
        `).join('');
      }
    }

    // Load WhatsApp support hotline setting
    loadAdminWhatsAppSetting();
  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
  }
}

async function loadAdminWhatsAppSetting() {
  const input = document.getElementById('adminWhatsAppNumberInput');
  if (!input) return;
  try {
    const res = await adminFetch('/api/admin/settings/whatsapp');
    if (res.ok) {
      const data = await res.json();
      if (data && data.whatsappNumber) {
        input.value = data.whatsappNumber;
      }
    }
  } catch (err) {
    console.warn('Failed to load admin WhatsApp setting:', err);
  }
}

async function handleSaveWhatsAppNumber(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('adminWhatsAppNumberInput');
  const btn = document.getElementById('adminSaveWhatsAppBtn');
  const statusBadge = document.getElementById('adminWhatsAppStatusBadge');
  if (!input || !input.value.trim()) {
    alert('Please enter a valid WhatsApp phone number');
    return;
  }
  const val = input.value.trim();
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const res = await adminFetch('/api/admin/settings/whatsapp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsappNumber: val })
    });
    const data = await res.json();
    if (res.ok) {
      if (statusBadge) {
        statusBadge.style.display = 'inline-block';
        setTimeout(() => { statusBadge.style.display = 'none'; }, 4000);
      }
      try {
        if (typeof window.applyWhatsAppNumberToStorefront === 'function') {
          window.applyWhatsAppNumberToStorefront(data.whatsappNumber, data.whatsappUrl);
        }
      } catch (e) {}
      window.dispatchEvent(new CustomEvent('ak:whatsapp-updated', { detail: data }));
      alert('âœ“ WhatsApp hotline updated successfully to ' + data.whatsappNumber + ' and active live across all storefront pages!');
    } else {
      alert(data.error || 'Failed to update WhatsApp hotline.');
    }
  } catch (err) {
    alert('Network error while saving WhatsApp number: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'ðŸ’¾ Update WhatsApp Hotline';
    }
  }
}

// -------------------------------------------------------------
// 2. PRODUCTS LIST & FILTERING
// -------------------------------------------------------------
async function loadCategoriesAndBrands() {
  try {
    let catData = null;
    let brandData = null;
    try {
      const [catRes, brandRes] = await Promise.all([
        adminFetch('/api/admin/categories'),
        adminFetch('/api/admin/brands')
      ]);
      if (catRes && catRes.ok) catData = await catRes.json().catch(() => null);
      if (brandRes && brandRes.ok) brandData = await brandRes.json().catch(() => null);
    } catch (e) {}

    let cats = (catData && Array.isArray(catData.categories) && catData.categories.length > 0) ? catData.categories : [];
    let brands = (brandData && Array.isArray(brandData.brands) && brandData.brands.length > 0) ? brandData.brands : [];

    // Fallback to public endpoints if admin endpoints returned empty
    if (cats.length === 0 || brands.length === 0) {
      try {
        const base = getAdminApiBase();
        const [pubCatRes, pubProdRes] = await Promise.all([
          fetch(`${base}/api/categories`).catch(() => null),
          fetch(`${base}/api/products?limit=500`).catch(() => null)
        ]);
        if (cats.length === 0 && pubCatRes && pubCatRes.ok) {
          const pubCats = await pubCatRes.json().catch(() => []);
          if (Array.isArray(pubCats) && pubCats.length > 0) {
            cats = pubCats.map((c, i) => typeof c === 'string' ? { id: `cat_${i}`, name: c, section: 'pro-audio' } : c);
          }
        }
        if (pubProdRes && pubProdRes.ok) {
          const prodData = await pubProdRes.json().catch(() => ({}));
          const pList = prodData.products || (Array.isArray(prodData) ? prodData : []);
          if (Array.isArray(pList) && pList.length > 0) {
            if (cats.length === 0) {
              const uniqueCats = [...new Set(pList.map(p => p.category).filter(Boolean))].sort();
              cats = uniqueCats.map((name, i) => ({ id: `cat_${i}`, name, section: 'pro-audio' }));
            }
            if (brands.length === 0) {
              const uniqueBrands = [...new Set(pList.map(p => p.brand).filter(Boolean))].sort();
              brands = uniqueBrands.map((name, i) => ({ id: `brand_${i}`, name }));
            }
          }
        }
      } catch (err) {
        console.warn('[ADMIN] Public catalog fallback failed:', err);
      }
    }

    if (cats.length > 0) state.categories = cats;
    if (brands.length > 0) state.brands = brands;

    // Populate Filters
    const catFilter = document.getElementById('filterProductCategory');
    if (catFilter) {
      catFilter.innerHTML = '<option value="All">All Categories</option>' + 
        state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }

    const brandFilter = document.getElementById('filterProductBrand');
    if (brandFilter) {
      brandFilter.innerHTML = '<option value="All">All Brands</option>' + 
        state.brands.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
    }

    // Populate Coupon Target Selects (Create and Edit forms)
    const populateCouponSelect = (elemId, items) => {
      const el = document.getElementById(elemId);
      if (el && Array.isArray(items) && items.length > 0) {
        const prev = el.value || 'all';
        el.innerHTML = '<option value="all">All</option>' +
          items.map(item => `<option value="${item.name}">${item.name}</option>`).join('');
        el.value = prev;
      }
    };
    populateCouponSelect('couponBrand', state.brands);
    populateCouponSelect('couponCategory', state.categories);
    populateCouponSelect('editCouponBrand', state.brands);
    populateCouponSelect('editCouponCategory', state.categories);

    // Populate Form Selects
    populateFormSelects();
  } catch (e) {
    console.error('[LOAD META ERROR]', e);
  }
}

function populateFormSelects() {
  const secSelect = document.getElementById('productSection');
  const currentSection = secSelect ? secSelect.value : 'pro-audio';

  const catSelect = document.getElementById('productCategory');
  if (catSelect) {
    const currentVal = catSelect.value;
    const matchingCats = state.categories.filter(c => !c.section || c.section === currentSection);
    const otherCats = state.categories.filter(c => c.section && c.section !== currentSection);

    let optionsHtml = `
      <option value="">-- Select Category --</option>
      <option value="__NEW__" style="color: var(--ak-orange); font-weight: 700;">+ Add New Category</option>
    `;

    if (matchingCats.length > 0) {
      optionsHtml += `<optgroup label="${currentSection === 'musical-instruments' ? 'Musical Instruments Categories' : 'Pro Audio Categories'}">` +
        matchingCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('') +
        `</optgroup>`;
    }
    if (otherCats.length > 0) {
      optionsHtml += `<optgroup label="Other Categories">` +
        otherCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('') +
        `</optgroup>`;
    }

    catSelect.innerHTML = optionsHtml;
    if (currentVal && currentVal !== '__NEW__') catSelect.value = currentVal;
  }

  const brandSelect = document.getElementById('productBrand');
  if (brandSelect) {
    const currentVal = brandSelect.value;
    brandSelect.innerHTML = `
      <option value="">-- Select Brand --</option>
      <option value="__NEW__" style="color: var(--ak-orange); font-weight: 700;">+ Add New Brand</option>
      ${state.brands.map(b => `<option value="${b.name}">${b.name}</option>`).join('')}
    `;
    if (currentVal && currentVal !== '__NEW__') brandSelect.value = currentVal;
  }
}

function handleProductSectionChange() {
  populateFormSelects();
}
window.handleProductSectionChange = handleProductSectionChange;

async function loadProducts() {
  const search = document.getElementById('searchProductInput')?.value.trim() || '';
  const category = document.getElementById('filterProductCategory')?.value || 'All';
  const brand = document.getElementById('filterProductBrand')?.value || 'All';
  const stockStatus = document.getElementById('filterProductStock')?.value || 'all';

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category !== 'All') params.set('category', category);
  if (brand !== 'All') params.set('brand', brand);
  if (stockStatus !== 'all') params.set('stockStatus', stockStatus);

  const tbody = document.getElementById('productsTableBody');
  tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 32px; color: var(--ak-text-muted);">Loading products...</td></tr>`;

  try {
    const res = await adminFetch(`/api/admin/products?${params.toString()}`);
    const data = res.ok ? await res.json().catch(() => ({})) : {};
    if (res.ok && Array.isArray(data.products) && data.products.length > 0) {
      state.products = data.products;
    } else {
      // Fallback to public products endpoint
      try {
        const base = getAdminApiBase();
        const pubRes = await fetch(`${base}/api/products?${params.toString()}`);
        if (pubRes.ok) {
          const pubData = await pubRes.json().catch(() => ({}));
          state.products = pubData.products || (Array.isArray(pubData) ? pubData : []);
        }
      } catch (e) {}

      if (!state.products || state.products.length === 0) {
        if (typeof window !== 'undefined' && Array.isArray(window.AUDIOKING_PRODUCTS) && window.AUDIOKING_PRODUCTS.length > 0) {
          state.products = window.AUDIOKING_PRODUCTS;
        } else {
          state.products = data.products || [];
        }
      }

      if (stockStatus !== 'all' && Array.isArray(state.products)) {
        if (stockStatus === 'preorder') {
          state.products = state.products.filter(p => p.isPreOrder || p.stockStatus === 'preorder' || p.in_stock === 2 || (p.badge && p.badge.toLowerCase().includes('pre-order')));
        } else if (stockStatus === 'in') {
          state.products = state.products.filter(p => !p.isPreOrder && p.stockStatus !== 'preorder' && p.in_stock !== 2 && (!p.badge || !p.badge.toLowerCase().includes('pre-order')) && p.inStock && p.stock > 0);
        } else if (stockStatus === 'out') {
          state.products = state.products.filter(p => !p.isPreOrder && p.stockStatus !== 'preorder' && p.in_stock !== 2 && (!p.inStock || p.stock <= 0));
        } else if (stockStatus === 'low') {
          state.products = state.products.filter(p => !p.isPreOrder && p.stockStatus !== 'preorder' && p.in_stock !== 2 && p.stock > 0 && p.stock <= 5);
        }
      }
    }

    document.getElementById('productsCountLabel').textContent = `Showing ${state.products.length} products`;

    if (state.products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 32px; color: var(--ak-text-muted);">No products match your filter criteria.</td></tr>`;
      const mobileContainer = document.getElementById('productsMobileCardsContainer');
      if (mobileContainer) {
        mobileContainer.innerHTML = `
          <div class="admin-empty-state-box">
            <div class="admin-empty-title">No products match your filter criteria.</div>
          </div>
        `;
      }
      return;
    }

    // Desktop Table Rendering
    tbody.innerHTML = state.products.map(p => `
      <tr>
        <td style="width: 48px;">
          <img src="${resolveAdminThumb(p.image)}" class="table-thumb" alt="${p.name}">
        </td>
        <td style="max-width: 220px;">
          <div class="prod-table-name" style="font-weight: 700; color: #0F172A; margin-bottom: 2px; line-height: 1.35;">${p.name}</div>
          <div style="font-size: 11px; color: var(--ak-text-muted);">${p.id}</div>
        </td>
        <td>${p.category}</td>
        <td>${p.brand}</td>
        <td><span class="price-mrp">${formatINR(p.originalPrice)}</span></td>
        <td><span class="price-selling">${formatINR(p.price)}</span></td>
        <td>
          ${p.discountPercent > 0 
            ? `<span class="badge-discount">${p.discountPercent}% OFF</span>` 
            : '<span style="color: var(--ak-text-muted); font-size: 12px;">0%</span>'}
        </td>
        <td><strong>${p.stock}</strong></td>
        <td>
          <span class="badge-stock ${(p.isPreOrder || p.stockStatus === 'preorder' || p.in_stock === 2 || (p.badge && p.badge.toLowerCase().includes('pre-order'))) ? 'preorder' : (p.inStock ? 'in' : 'out')}">
            ${(p.isPreOrder || p.stockStatus === 'preorder' || p.in_stock === 2 || (p.badge && p.badge.toLowerCase().includes('pre-order'))) ? 'Pre-Order' : (p.inStock ? 'In Stock' : 'Out of Stock')}
          </span>
        </td>
        <td style="white-space: nowrap;">
          <button class="btn-edit" onclick="openEditProduct('${p.id}')">Edit</button>
          <button class="btn-danger" style="margin-left: 6px;" onclick="confirmDeleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>
    `).join('');

    // Mobile Product Cards Rendering (Reference Image 2)
    const mobileContainer = document.getElementById('productsMobileCardsContainer');
    if (mobileContainer) {
      mobileContainer.innerHTML = state.products.map(p => `
        <div class="ak-mobile-product-card">
          <div class="ak-mpc-top">
            <div class="ak-mpc-img-wrap">
              <img src="${resolveAdminThumb(p.image)}" alt="${p.name}">
            </div>
            <div class="ak-mpc-title-wrap">
              <div class="ak-mpc-title">${p.name}</div>
            </div>
          </div>
          <div class="ak-mpc-grid">
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">Category</span>
              <span class="ak-mpc-val">${p.category}</span>
            </div>
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">Brand</span>
              <span class="ak-mpc-val">${p.brand}</span>
            </div>
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">MRP</span>
              <span class="ak-mpc-val price-mrp">${formatINR(p.originalPrice)}</span>
            </div>
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">Selling Price</span>
              <span class="ak-mpc-val price-selling">${formatINR(p.price)}</span>
            </div>
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">Discount</span>
              <span class="ak-mpc-val">${p.discountPercent > 0 ? `<span class="badge-discount">${p.discountPercent}% OFF</span>` : '<span style="color:var(--ak-text-muted);font-size:12px;">0%</span>'}</span>
            </div>
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">Stock</span>
              <span class="ak-mpc-val"><strong>${p.stock}</strong></span>
            </div>
            <div class="ak-mpc-row">
              <span class="ak-mpc-label">Status</span>
              <span class="ak-mpc-val"><span class="badge-stock ${(p.isPreOrder || p.stockStatus === 'preorder' || p.in_stock === 2 || (p.badge && p.badge.toLowerCase().includes('pre-order'))) ? 'preorder' : (p.inStock ? 'in' : 'out')}">${(p.isPreOrder || p.stockStatus === 'preorder' || p.in_stock === 2 || (p.badge && p.badge.toLowerCase().includes('pre-order'))) ? 'Pre-Order' : (p.inStock ? 'In Stock' : 'Out of Stock')}</span></span>
            </div>
          </div>
          <div class="ak-mpc-actions">
            <button type="button" class="btn-edit" onclick="openEditProduct('${p.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              <span>Edit</span>
            </button>
            <button type="button" class="btn-danger" onclick="confirmDeleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 32px; color: var(--ak-danger);">Failed to load products.</td></tr>`;
    const mobileContainer = document.getElementById('productsMobileCardsContainer');
    if (mobileContainer) {
      mobileContainer.innerHTML = `<div class="admin-empty-state-box" style="color:var(--ak-danger);">Failed to load products.</div>`;
    }
  }
}

// -------------------------------------------------------------
// 3. ADD / EDIT PRODUCT FORM CONTROLLER
// -------------------------------------------------------------
function resetProductForm() {
  state.editingProductId = null;
  state.formImages = [];
  state.formVideoChoice = 'none';
  state.formVideoUrl = '';
  state.formYouTubeVideos = [''];

  // Reset variant state
  state.hasVariants = false;
  state.variantGroups = [];
  state.variantMatrix = [];
  const variantToggle = document.getElementById('enableVariantsToggle');
  if (variantToggle) variantToggle.checked = false;
  const variantSection = document.getElementById('variantBuilderSection');
  if (variantSection) variantSection.style.display = 'none';
  const variantContainer = document.getElementById('variantMatrixContainer');
  if (variantContainer) variantContainer.style.display = 'none';
  renderVariantGroups();

  document.getElementById('formTitle').textContent = 'Add New Product';
  document.getElementById('productForm').reset();
  document.getElementById('productIdHidden').value = '';
  document.getElementById('productPriceError').style.display = 'none';
  document.getElementById('discountBadgePreview').textContent = '0% OFF';
  document.getElementById('inlineNewCatRow').style.display = 'none';
  document.getElementById('inlineNewBrandRow').style.display = 'none';
  const secSelect = document.getElementById('productSection');
  if (secSelect) secSelect.value = 'pro-audio';
  populateFormSelects();

  setVideoChoice('none');
  renderImagePreviewGrid();
}

function openAddProduct() {
  resetProductForm();
  switchView('product-form');
}

async function openEditProduct(productId) {
  resetProductForm();
  state.editingProductId = productId;
  document.getElementById('formTitle').textContent = 'Edit Product';

  try {
    const res = await adminFetch(`/api/admin/products/${productId}`);
    if (!res.ok) return alert('Failed to fetch product');
    const data = await res.json();
    const p = data.product;

    document.getElementById('productIdHidden').value = p.id;
    document.getElementById('productName').value = p.name;
    if (document.getElementById('productSection')) {
      document.getElementById('productSection').value = p.section || 'pro-audio';
    }
    populateFormSelects();
    document.getElementById('productCategory').value = p.category;
    document.getElementById('productBrand').value = p.brand;
    document.getElementById('productMrp').value = p.originalPrice;
    document.getElementById('productSellingPrice').value = p.price;
    document.getElementById('productStock').value = p.stock;
    const isPre = Boolean(p.isPreOrder || p.stockStatus === 'preorder' || p.in_stock === 2 || (p.badge && p.badge.toLowerCase().includes('pre-order')));
    document.getElementById('productAvailability').value = isPre ? '2' : (p.inStock ? '1' : '0');
    document.getElementById('productDescription').value = p.description || '';

    state.formImages = Array.isArray(p.images) && p.images.length > 0 ? [...p.images] : (p.image ? [p.image] : []);
    renderImagePreviewGrid();

    // Video setup & Multiple YouTube Videos
    const rawYt = Array.isArray(p.youtubeVideos) && p.youtubeVideos.length > 0
      ? p.youtubeVideos.map(v => typeof v === 'string' ? v : (v.url || v.id))
      : (p.youtubeVideoId ? [`https://www.youtube.com/watch?v=${p.youtubeVideoId}`] : (p.videoType === 'youtube' && p.videoUrl ? [p.videoUrl] : []));

    if (rawYt.length > 0) {
      state.formYouTubeVideos = rawYt;
      setVideoChoice('youtube');
    } else if (p.videoUrl && p.videoType === 'upload') {
      state.formYouTubeVideos = [''];
      setVideoChoice('upload');
      const vInput = document.getElementById('productVideoInput');
      if (vInput) vInput.value = p.videoUrl;
      updateInlineVideoPreview('upload', p.videoUrl);
    } else {
      state.formYouTubeVideos = [''];
      setVideoChoice('none');
    }

    // Fetch existing variants
    try {
      const vRes = await adminFetch(`/api/admin/products/${productId}/variants`);
      if (vRes.ok) {
        const vData = await vRes.json();
        if (vData.hasVariants && vData.groups && vData.groups.length > 0) {
          state.hasVariants = true;
          state.variantGroups = vData.groups;
          state.variantMatrix = vData.variants || [];

          const variantToggle = document.getElementById('enableVariantsToggle');
          if (variantToggle) variantToggle.checked = true;
          const variantSection = document.getElementById('variantBuilderSection');
          if (variantSection) variantSection.style.display = 'block';

          // Connect variant 0 MRP & SP with product prices
          if (state.variantMatrix.length > 0 && state.variantMatrix[0]) {
            const v0 = state.variantMatrix[0];
            if (v0.mrp != null && v0.mrp > 0) {
              document.getElementById('productMrp').value = v0.mrp;
            } else if (p.originalPrice) {
              v0.mrp = Number(p.originalPrice);
            }
            if (v0.sellingPrice != null && v0.sellingPrice > 0) {
              document.getElementById('productSellingPrice').value = v0.sellingPrice;
            } else if (p.price) {
              v0.sellingPrice = Number(p.price);
              v0.priceOverride = Number(p.price);
            }
          }

          renderVariantGroups();
          renderVariantMatrix();
          const matrixContainer = document.getElementById('variantMatrixContainer');
          if (matrixContainer) matrixContainer.style.display = 'block';
          const countSpan = document.getElementById('variantMatrixCount');
          if (countSpan) countSpan.textContent = `(${state.variantMatrix.length} combinations)`;
        }
      }
    } catch (ve) {
      console.warn('Could not fetch variants:', ve);
    }

    calculateDiscountAndValidate();
    switchView('product-form');
  } catch (err) {
    alert('Error loading product details.');
  }
}

// Inline Category & Brand Handlers
function handleCategorySelectChange() {
  const sel = document.getElementById('productCategory');
  const inlineRow = document.getElementById('inlineNewCatRow');
  if (sel.value === '__NEW__') {
    inlineRow.style.display = 'flex';
    document.getElementById('inlineNewCatInput').focus();
  } else {
    inlineRow.style.display = 'none';
  }
}

async function saveInlineCategory() {
  const input = document.getElementById('inlineNewCatInput');
  const name = input.value.trim();
  if (!name) return alert('Please enter a category name');
  const section = document.getElementById('productSection')?.value || 'pro-audio';

  try {
    const res = await adminFetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, section })
    });
    const data = await res.json();
    if (res.ok) {
      await loadCategoriesAndBrands();
      document.getElementById('productCategory').value = data.category.name;
      document.getElementById('inlineNewCatRow').style.display = 'none';
      input.value = '';
      if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
      window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
    } else {
      alert(data.error || 'Failed to save category');
    }
  } catch (e) {
    alert('Error saving category');
  }
}

function handleBrandSelectChange() {
  const sel = document.getElementById('productBrand');
  const inlineRow = document.getElementById('inlineNewBrandRow');
  if (sel.value === '__NEW__') {
    inlineRow.style.display = 'flex';
    document.getElementById('inlineNewBrandInput').focus();
  } else {
    inlineRow.style.display = 'none';
  }
}

async function saveInlineBrand() {
  const input = document.getElementById('inlineNewBrandInput');
  const name = input.value.trim();
  if (!name) return alert('Please enter a brand name');

  try {
    const res = await adminFetch('/api/admin/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (res.ok) {
      await loadCategoriesAndBrands();
      document.getElementById('productBrand').value = data.brand.name;
      document.getElementById('inlineNewBrandRow').style.display = 'none';
      input.value = '';
    } else {
      alert(data.error || 'Failed to save brand');
    }
  } catch (e) {
    alert('Error saving brand');
  }
}

// -------------------------------------------------------------
// 2B. BRANDS & CATEGORIES MANAGER VIEW
// -------------------------------------------------------------
async function loadBrandsAndCategoriesView() {
  await loadCategoriesAndBrands();

  // Update counts
  const brandBadge = document.getElementById('adminBrandsCountBadge');
  if (brandBadge) brandBadge.textContent = `${state.brands.length} Brands`;

  const catBadge = document.getElementById('adminCategoriesCountBadge');
  if (catBadge) catBadge.textContent = `${state.categories.length} Categories`;

  // Render Brands Table
  renderAdminBrandsTable(state.brands);

  // Render Categories Table
  renderAdminCategoriesTable(state.categories);
}

function renderAdminBrandsTable(brands) {
  const tbody = document.getElementById('adminBrandsTableBody');
  if (!tbody) return;

  if (!brands || brands.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--ak-text-muted); padding: 18px;">No brands found.</td></tr>';
    return;
  }

  tbody.innerHTML = brands.map(b => {
    const pCount = b.product_count || 0;
    const safeName = (b.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `
      <tr>
        <td style="font-weight: 600; color: var(--ak-text-primary, #0F172A);">
          <span>${b.name}</span>
        </td>
        <td style="text-align: center;">
          <span class="badge" style="background: #F1F5F9; border: 1px solid var(--ak-border, #E2E8F0); border-radius: 4px; color: var(--ak-text-secondary); font-size: 11.5px; padding: 2px 7px;">${pCount} item${pCount === 1 ? '' : 's'}</span>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 6px; justify-content: flex-end;">
            <button type="button" class="btn-secondary" style="padding: 4px 8px; font-size: 11.5px;" onclick="openRenameModal('brand', '${b.id}', '${safeName}')">âœï¸ Rename</button>
            <button type="button" class="btn-danger" style="padding: 4px 8px; font-size: 11.5px;" onclick="confirmDeleteBrand('${b.id}', '${safeName}')">ðŸ—‘ï¸ Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminCategoriesTable(categories) {
  const tbody = document.getElementById('adminCategoriesTableBody');
  if (!tbody) return;

  if (!categories || categories.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--ak-text-muted); padding: 18px;">No categories found.</td></tr>';
    return;
  }

  tbody.innerHTML = categories.map(c => {
    const pCount = c.product_count || 0;
    const safeName = (c.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const isMusical = c.section === 'musical-instruments';
    const sectionBadge = isMusical
      ? `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #C084FC; font-size: 11px; padding: 2px 7px; border: 1px solid rgba(168,85,247,0.3); border-radius: 4px;">ðŸŽ¸ Musical Instruments</span>`
      : `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38BDF8; font-size: 11px; padding: 2px 7px; border: 1px solid rgba(56,189,248,0.3); border-radius: 4px;">ðŸŽ›ï¸ Pro Audio</span>`;

    return `
      <tr>
        <td style="font-weight: 600; color: var(--ak-text-primary, #0F172A);">
          <span>${c.name}</span>
        </td>
        <td>
          ${sectionBadge}
        </td>
        <td style="text-align: center;">
          <span class="badge" style="background: #F1F5F9; border: 1px solid var(--ak-border, #E2E8F0); border-radius: 4px; color: var(--ak-text-secondary); font-size: 11.5px; padding: 2px 7px;">${pCount} item${pCount === 1 ? '' : 's'}</span>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 6px; justify-content: flex-end;">
            <button type="button" class="btn-secondary" style="padding: 4px 8px; font-size: 11.5px;" onclick="openRenameModal('category', '${c.id}', '${safeName}')">âœï¸ Rename</button>
            <button type="button" class="btn-danger" style="padding: 4px 8px; font-size: 11.5px;" onclick="confirmDeleteCategory('${c.id}', '${safeName}')">ðŸ—‘ï¸ Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminBrandsTable() {
  const q = document.getElementById('adminBrandFilterInput')?.value.toLowerCase().trim() || '';
  const filtered = state.brands.filter(b => b.name.toLowerCase().includes(q));
  renderAdminBrandsTable(filtered);
}

function filterAdminCategoriesTable() {
  const q = document.getElementById('adminCategoryFilterInput')?.value.toLowerCase().trim() || '';
  const filtered = state.categories.filter(c => c.name.toLowerCase().includes(q));
  renderAdminCategoriesTable(filtered);
}

async function handleCreateBrandSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('adminNewBrandName');
  const name = input?.value.trim();
  if (!name) return;

  try {
    const res = await adminFetch('/api/admin/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (res.ok) {
      input.value = '';
      await loadBrandsAndCategoriesView();
      if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
      window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
    } else {
      alert(data.error || 'Failed to create brand.');
    }
  } catch (err) {
    alert('Network error while creating brand.');
  }
}

async function handleCreateCategorySubmit(e) {
  e.preventDefault();
  const input = document.getElementById('adminNewCategoryName');
  const sectionSelect = document.getElementById('adminNewCategorySection');
  const name = input?.value.trim();
  const section = sectionSelect?.value || 'pro-audio';
  if (!name) return;

  try {
    const res = await adminFetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, section })
    });
    const data = await res.json();
    if (res.ok) {
      input.value = '';
      await loadBrandsAndCategoriesView();
      if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
      window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
    } else {
      alert(data.error || 'Failed to create category.');
    }
  } catch (err) {
    alert('Network error while creating category.');
  }
}

function openRenameModal(type, id, currentName) {
  document.getElementById('renameMetaType').value = type;
  document.getElementById('renameMetaId').value = id;
  const input = document.getElementById('renameMetaInput');
  input.value = currentName;
  input.dataset.oldName = currentName || '';
  document.getElementById('renameMetaLabel').textContent = `New ${type === 'brand' ? 'Brand' : 'Category'} Name *`;
  document.getElementById('renameMetaModalTitle').textContent = `Rename ${type === 'brand' ? 'Brand' : 'Category'}`;
  openModal('renameMetaModal');
  setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 60);
}

async function handleRenameMetaSubmit(e) {
  e.preventDefault();
  const type = document.getElementById('renameMetaType').value;
  const id = document.getElementById('renameMetaId').value;
  const input = document.getElementById('renameMetaInput');
  const name = input.value.trim();
  const oldName = input.dataset.oldName || '';
  if (!name) return;
  if (oldName && name === oldName) { closeModal(); return; }

  const endpoint = type === 'brand'
    ? `/api/admin/brands/${encodeURIComponent(id)}`
    : `/api/admin/categories/${encodeURIComponent(id)}`;

  const submitBtn = document.getElementById('renameMetaSubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

  try {
    const res = await adminFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, oldName })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      closeModal();
      await loadBrandsAndCategoriesView();
      try { await loadProducts(); } catch (err) {}
      if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
      window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
      try { localStorage.setItem('audioking_catalog_sync', String(Date.now())); } catch (err) {}
      alert(data.message || `${type === 'brand' ? 'Brand' : 'Category'} renamed to "${name}".`);
    } else {
      alert(data.error || 'Failed to rename item.');
    }
  } catch (err) {
    alert('Network error while renaming item.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Save &amp; Update All Products'; }
  }
}
window.openRenameModal = openRenameModal;
window.handleRenameMetaSubmit = handleRenameMetaSubmit;

function confirmDeleteBrand(id, name) {
  document.getElementById('confirmModalTitle').textContent = `Terminate Brand: ${name}?`;
  document.getElementById('confirmModalMessage').innerHTML = `âš ï¸ <strong style="color: var(--ak-danger);">CRITICAL WARNING:</strong> Deleting brand <strong>"${name}"</strong> will <strong>PERMANENTLY TERMINATE</strong> every product, inventory item, blanket offer, and section associated with this brand across the entire store and catalog.<br><br>This cascading deletion cannot be undone. Are you sure you want to proceed?`;
  const actionBtn = document.getElementById('confirmModalActionBtn');
  actionBtn.textContent = 'Terminate Brand & All Products';
  actionBtn.onclick = async () => {
    try {
      const res = await adminFetch(`/api/admin/brands/${id}`, { method: 'DELETE' });
      const data = await res.json();
      closeModal();
      if (res.ok) {
        await loadBrandsAndCategoriesView();
        await loadProducts();
        if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
        window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
        alert(`Brand "${name}" and all associated products were successfully terminated.`);
      } else {
        alert(data.error || 'Failed to delete brand.');
      }
    } catch (err) {
      closeModal();
      alert('Network error while deleting brand.');
    }
  };
  openModal('confirmModal');
}

function confirmDeleteCategory(id, name) {
  document.getElementById('confirmModalTitle').textContent = `Terminate Category: ${name}?`;
  document.getElementById('confirmModalMessage').innerHTML = `âš ï¸ <strong style="color: var(--ak-danger);">CRITICAL WARNING:</strong> Deleting category <strong>"${name}"</strong> will <strong>PERMANENTLY TERMINATE</strong> every product, inventory item, blanket offer, and section associated with this category across the entire store and catalog.<br><br>This cascading deletion cannot be undone. Are you sure you want to proceed?`;
  const actionBtn = document.getElementById('confirmModalActionBtn');
  actionBtn.textContent = 'Terminate Category & All Products';
  actionBtn.onclick = async () => {
    try {
      const res = await adminFetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
      const data = await res.json();
      closeModal();
      if (res.ok) {
        await loadBrandsAndCategoriesView();
        await loadProducts();
        if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
        window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
        alert(`Category "${name}" and all associated products were successfully terminated.`);
      } else {
        alert(data.error || 'Failed to delete category.');
      }
    } catch (err) {
      closeModal();
      alert('Network error while deleting category.');
    }
  };
  openModal('confirmModal');
}

// Image Uploads & Reordering
function renderImagePreviewGrid() {
  const grid = document.getElementById('imagePreviewGrid');
  if (!grid) return;
  if (state.formImages.length === 0) {
    grid.innerHTML = `<span style="font-size: 12px; color: var(--ak-text-muted);">No images uploaded yet. Upload images from your device or paste URLs below.</span>`;
    return;
  }

  grid.innerHTML = state.formImages.map((imgUrl, idx) => `
    <div class="preview-tile ${idx === 0 ? 'cover' : ''}">
      ${idx === 0 ? '<span class="cover-badge">â­ COVER</span>' : ''}
      <img src="${resolveAdminThumb(imgUrl)}" class="preview-img" alt="Product image" onerror="this.onerror=null;this.src='assets/images/placeholder.svg';">
      <div class="preview-tile-actions">
        <button type="button" class="btn-tile-act" title="Move Left" onclick="moveImage(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>&larr;</button>
        <button type="button" class="btn-tile-act" title="Remove" style="color: var(--ak-danger);" onclick="removeImage(${idx})">&times;</button>
        <button type="button" class="btn-tile-act" title="Move Right" onclick="moveImage(${idx}, 1)" ${idx === state.formImages.length - 1 ? 'disabled' : ''}>&rarr;</button>
      </div>
    </div>
  `).join('');
}

function moveImage(index, delta) {
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= state.formImages.length) return;
  const temp = state.formImages[index];
  state.formImages[index] = state.formImages[newIndex];
  state.formImages[newIndex] = temp;
  renderImagePreviewGrid();
}

function removeImage(index) {
  state.formImages.splice(index, 1);
  renderImagePreviewGrid();
}

function addImageUrl() {
  const input = document.getElementById('productImageUrlInput');
  const url = input.value.trim();
  if (!url) return;
  state.formImages.push(url);
  input.value = '';
  renderImagePreviewGrid();
}

async function handleImageFilesUpload(event) {
  const files = event?.dataTransfer ? event.dataTransfer.files : event?.target?.files;
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('images', files[i]);
  }

  const uploadStatus = document.getElementById('imageUploadStatus');
  if (uploadStatus) {
    uploadStatus.textContent = `Uploading ${files.length} image(s)...`;
    uploadStatus.style.display = 'block';
    uploadStatus.style.color = 'var(--ak-orange)';
  }

  try {
    const res = await adminFetch('/api/admin/upload/images', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.urls && Array.isArray(data.urls)) {
      state.formImages.push(...data.urls);
      renderImagePreviewGrid();
      if (uploadStatus) {
        uploadStatus.textContent = `âœ“ ${data.urls.length} image(s) uploaded successfully!`;
        uploadStatus.style.color = 'var(--ak-success, #16A34A)';
        setTimeout(() => { uploadStatus.style.display = 'none'; uploadStatus.style.color = ''; }, 3000);
      }
    } else {
      alert(data.error || 'Image upload failed. Please try again.');
      if (uploadStatus) uploadStatus.style.display = 'none';
    }
  } catch (err) {
    alert('Network error while uploading images.');
    if (uploadStatus) uploadStatus.style.display = 'none';
  } finally {
    if (event?.target) {
      try { event.target.value = ''; } catch (e) {}
    }
  }
}

function initDragAndDropImageUpload() {
  document.querySelectorAll('.upload-dropzone').forEach(zone => {
    ['dragenter', 'dragover'].forEach(eventName => {
      zone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.style.borderColor = 'var(--ak-orange, #EA580C)';
        zone.style.backgroundColor = 'rgba(234, 88, 12, 0.05)';
      });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      zone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.style.borderColor = '';
        zone.style.backgroundColor = '';
      });
    });
    zone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImageFilesUpload({ dataTransfer: e.dataTransfer });
      }
    });
  });
}

// Video Choice & Inline Preview
function setVideoChoice(choice) {
  state.formVideoChoice = choice;
  document.querySelectorAll('.video-choice-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.choice === choice);
  });

  const urlInputGroup = document.getElementById('videoUrlInputGroup');
  const fileUploadGroup = document.getElementById('videoFileUploadGroup');
  const previewBox = document.getElementById('inlineVideoPreview');

  if (choice === 'youtube') {
    urlInputGroup.style.display = 'block';
    fileUploadGroup.style.display = 'none';
    renderYouTubeVideoInputs();
  } else if (choice === 'upload') {
    urlInputGroup.style.display = 'none';
    fileUploadGroup.style.display = 'block';
    const val = document.getElementById('productVideoInput')?.value?.trim();
    if (val) updateInlineVideoPreview('upload', val);
    else if (previewBox) previewBox.style.display = 'none';
  } else {
    urlInputGroup.style.display = 'none';
    fileUploadGroup.style.display = 'none';
    if (previewBox) previewBox.style.display = 'none';
    const vInput = document.getElementById('productVideoInput');
    if (vInput) vInput.value = '';
    state.formYouTubeVideos = [''];
  }
}

function renderYouTubeVideoInputs() {
  const container = document.getElementById('productYouTubeInputsList');
  if (!container) return;

  if (!state.formYouTubeVideos || !Array.isArray(state.formYouTubeVideos) || state.formYouTubeVideos.length === 0) {
    state.formYouTubeVideos = [''];
  }

  container.innerHTML = state.formYouTubeVideos.map((url, idx) => {
    return `
      <div style="display: flex; gap: 8px; align-items: center;" class="yt-video-input-row">
        <span style="font-size: 11.5px; font-weight: 700; color: #64748B; width: 24px; text-align: center;">#${idx + 1}</span>
        <input 
          type="text" 
          class="form-input" 
          value="${escapeHtml(url)}" 
          placeholder="Paste YouTube link or ID (e.g. https://www.youtube.com/watch?v=kYv_3jV8koc)" 
          oninput="handleYouTubeVideoRowChange(${idx}, this.value)"
          style="flex: 1;"
        >
        ${state.formYouTubeVideos.length > 1 ? `
          <button type="button" class="btn-danger" style="padding: 6px 10px; font-size: 12px; font-weight: 700; border-radius: 4px;" onclick="removeYouTubeVideoInputRow(${idx})" title="Remove this video">
            âœ•
          </button>
        ` : ''}
      </div>
    `;
  }).join('');

  updateAllYouTubeVideoPreviews();
}

function addYouTubeVideoInputRow() {
  if (!state.formYouTubeVideos) state.formYouTubeVideos = [];
  state.formYouTubeVideos.push('');
  renderYouTubeVideoInputs();
}

function removeYouTubeVideoInputRow(idx) {
  if (!state.formYouTubeVideos) return;
  state.formYouTubeVideos.splice(idx, 1);
  if (state.formYouTubeVideos.length === 0) state.formYouTubeVideos.push('');
  renderYouTubeVideoInputs();
}

function handleYouTubeVideoRowChange(idx, val) {
  if (!state.formYouTubeVideos) state.formYouTubeVideos = [];
  state.formYouTubeVideos[idx] = val;
  updateAllYouTubeVideoPreviews();
}

function updateAllYouTubeVideoPreviews() {
  const previewBox = document.getElementById('inlineVideoPreview');
  if (!previewBox) return;

  const validVideos = (state.formYouTubeVideos || [])
    .map(url => typeof url === 'string' ? url.trim() : '')
    .filter(Boolean)
    .map(url => ({ raw: url, id: parseYouTubeId(url) }))
    .filter(v => Boolean(v.id));

  if (validVideos.length === 0) {
    previewBox.style.display = 'none';
    previewBox.innerHTML = '';
    return;
  }

  previewBox.style.display = 'block';
  previewBox.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="font-size: 12px; font-weight: 700; color: #0F172A;">
        Connected YouTube Demonstration Videos (${validVideos.length}):
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
        ${validVideos.map((v, i) => `
          <div style="border: 1px solid var(--ak-border); border-radius: 6px; overflow: hidden; background: #0F172A;">
            <div style="padding: 4px 8px; background: #1E293B; color: #FFF; font-size: 11px; font-weight: 700; display: flex; justify-content: space-between;">
              <span>Video #${i + 1}</span>
              <span style="color: #38BDF8;">${v.id}</span>
            </div>
            <iframe 
              src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?playsinline=1&modestbranding=1&rel=0" 
              style="width: 100%; height: 140px; border: none; display: block;" 
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
              allowfullscreen>
            </iframe>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function handleVideoInputChange() {
  const val = document.getElementById('productVideoInput')?.value?.trim();
  if (state.formVideoChoice === 'youtube' && val) {
    if (!state.formYouTubeVideos) state.formYouTubeVideos = [];
    state.formYouTubeVideos[0] = val;
    updateAllYouTubeVideoPreviews();
  }
}

async function handleVideoFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('video', file);

  const statusEl = document.getElementById('videoUploadStatus');
  statusEl.textContent = 'Uploading video file (validating MIME & magic bytes)...';
  statusEl.style.display = 'block';

  try {
    const res = await adminFetch('/api/admin/upload/video', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.url) {
      document.getElementById('productVideoInput').value = data.url;
      updateInlineVideoPreview('upload', data.url);
      statusEl.textContent = 'Video uploaded successfully!';
      statusEl.style.color = 'var(--ak-success)';
      setTimeout(() => { statusEl.style.display = 'none'; statusEl.style.color = ''; }, 3000);
    } else {
      alert(data.error || 'Video upload failed.');
      statusEl.style.display = 'none';
    }
  } catch (err) {
    alert('Network error while uploading video.');
    statusEl.style.display = 'none';
  }
}

function parseYouTubeId(input) {
  if (!input) return null;
  const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(input.trim())) return input.trim();
  return null;
}

function updateInlineVideoPreview(type, source) {
  const previewBox = document.getElementById('inlineVideoPreview');
  if (!source) {
    previewBox.style.display = 'none';
    return;
  }

  if (type === 'youtube') {
    const ytid = parseYouTubeId(source) || source;
    previewBox.innerHTML = `
      <iframe 
        src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytid)}?playsinline=1&modestbranding=1&rel=0" 
        frameborder="0" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
        allowfullscreen>
      </iframe>
    `;
    previewBox.style.display = 'block';
  } else if (type === 'upload') {
    previewBox.innerHTML = `
      <video src="${source}" controls playsinline style="width:100%; height:100%; background:#000;">
        Your browser does not support HTML5 video.
      </video>
    `;
    previewBox.style.display = 'block';
  }
}

// Shared discount calculation helper
function calculateDiscountPercent(mrp, sellingPrice) {
  const m = Number(mrp);
  const s = Number(sellingPrice);
  if (!Number.isFinite(m) || !Number.isFinite(s) || m <= 0 || s <= 0 || s >= m) {
    return 0;
  }
  return Math.round(((m - s) / m) * 100);
}
window.calculateDiscountPercent = calculateDiscountPercent;

// Validation for variant pricing
function validateVariantMatrix() {
  if (!state.hasVariants || !state.variantMatrix || state.variantMatrix.length === 0) {
    return true;
  }

  const parentMrp = parseFloat(document.getElementById('productMrp')?.value) || 0;
  const parentSelling = parseFloat(document.getElementById('productSellingPrice')?.value) || 0;

  for (let i = 0; i < state.variantMatrix.length; i++) {
    const v = state.variantMatrix[i];
    if (v.isActive === false) continue;

    const vMrpVal = (v.mrp != null && v.mrp !== '') ? Number(v.mrp) : null;
    const vSellingVal = (v.sellingPrice != null && v.sellingPrice !== '') ? Number(v.sellingPrice) : null;
    const vOverrideVal = (v.priceOverride != null && v.priceOverride !== '') ? Number(v.priceOverride) : null;

    if (vMrpVal !== null && (!Number.isFinite(vMrpVal) || vMrpVal <= 0)) {
      alert(`Validation Error: Variant "${v.optionLabels}" MRP must be a positive number.`);
      return false;
    }

    if (vSellingVal !== null && (!Number.isFinite(vSellingVal) || vSellingVal <= 0)) {
      alert(`Validation Error: Variant "${v.optionLabels}" Selling Price must be a positive number.`);
      return false;
    }

    if (vOverrideVal !== null && (!Number.isFinite(vOverrideVal) || vOverrideVal <= 0)) {
      alert(`Validation Error: Variant "${v.optionLabels}" Price Override must be a positive number.`);
      return false;
    }

    const effectiveMrp = vMrpVal !== null ? vMrpVal : parentMrp;
    const effectiveSelling = vSellingVal !== null ? vSellingVal : (vOverrideVal !== null ? vOverrideVal : parentSelling);

    if (effectiveMrp > 0 && effectiveSelling > 0 && effectiveSelling > effectiveMrp) {
      alert(`Validation Error: Selling Price (${formatINR(effectiveSelling)}) cannot exceed MRP (${formatINR(effectiveMrp)}) for variant "${v.optionLabels}".`);
      return false;
    }
  }

  return true;
}
window.validateVariantMatrix = validateVariantMatrix;

// Pricing & Auto-Calculated Discount %
function updateProductDiscountDisplay() {
  const mrpInput = document.getElementById('productMrp');
  const sellingInput = document.getElementById('productSellingPrice');
  const errorBanner = document.getElementById('productPriceError');
  const badgePreview = document.getElementById('discountBadgePreview');
  const saveBtn = document.getElementById('saveProductBtn');

  if (!mrpInput || !sellingInput) return true;

  const mrp = parseFloat(mrpInput.value) || 0;
  const selling = parseFloat(sellingInput.value) || 0;

  // Validation: Selling Price cannot exceed MRP
  if (mrp > 0 && selling > mrp) {
    if (errorBanner) {
      errorBanner.textContent = `Validation Error: Selling Price (${formatINR(selling)}) cannot exceed MRP (${formatINR(mrp)}).`;
      errorBanner.style.display = 'block';
    }
    if (badgePreview) {
      badgePreview.textContent = 'Invalid Price';
      badgePreview.style.background = 'var(--ak-danger-soft)';
      badgePreview.style.color = 'var(--ak-danger)';
    }
    if (saveBtn) saveBtn.disabled = true;
    return false;
  }

  if (errorBanner) errorBanner.style.display = 'none';
  if (saveBtn) saveBtn.disabled = false;

  if (badgePreview) {
    if (mrp > 0 && selling > 0 && selling < mrp) {
      const discount = calculateDiscountPercent(mrp, selling);
      badgePreview.textContent = `${discount}% OFF`;
      badgePreview.style.background = 'var(--ak-success-soft)';
      badgePreview.style.color = 'var(--ak-success)';
    } else {
      badgePreview.textContent = '0% OFF';
      badgePreview.style.background = 'var(--ak-card-bg)';
      badgePreview.style.color = 'var(--ak-text-muted)';
    }
  }

  return true;
}
window.updateProductDiscountDisplay = updateProductDiscountDisplay;

function calculateDiscountAndValidate() {
  const valid = updateProductDiscountDisplay();
  if (!valid) return false;

  const mrp = parseFloat(document.getElementById('productMrp')?.value) || 0;
  const selling = parseFloat(document.getElementById('productSellingPrice')?.value) || 0;

  // Auto-connect first variant's MRP and SP to the main product price
  if (state.hasVariants && state.variantMatrix && state.variantMatrix.length > 0) {
    state.variantMatrix[0].mrp = mrp > 0 ? mrp : null;
    state.variantMatrix[0].sellingPrice = selling > 0 ? selling : null;
    state.variantMatrix[0].priceOverride = selling > 0 ? selling : null;

    const firstRowMrpInput = document.getElementById('variantInputMrp_0');
    if (firstRowMrpInput && document.activeElement !== firstRowMrpInput) {
      firstRowMrpInput.value = mrp > 0 ? mrp : '';
    }
    const firstRowSpInput = document.getElementById('variantInputSp_0');
    if (firstRowSpInput && document.activeElement !== firstRowSpInput) {
      firstRowSpInput.value = selling > 0 ? selling : '';
    }
    if (typeof updateVariantRowDisplay === 'function') {
      updateVariantRowDisplay(0);
    }
  }

  return true;
}
window.calculateDiscountAndValidate = calculateDiscountAndValidate;

// Stock input auto-flips availability
function handleStockInputChange() {
  const stockInput = document.getElementById('productStock');
  const availSelect = document.getElementById('productAvailability');
  const stock = parseInt(stockInput.value, 10) || 0;

  if (availSelect.value === '2') {
    // Preserve Pre-Order status
    return;
  }

  if (stock === 0) {
    availSelect.value = '0';
  } else if (availSelect.value === '0' && stock > 0) {
    availSelect.value = '1';
  }
}

// Save / Submit Product Form
async function handleSaveProduct(e) {
  e.preventDefault();

  if (!calculateDiscountAndValidate()) return;
  if (!validateVariantMatrix()) return;

  const name = document.getElementById('productName').value.trim();
  const category = document.getElementById('productCategory').value;
  const brand = document.getElementById('productBrand').value;
  const mrp = parseFloat(document.getElementById('productMrp').value);
  const sellingPrice = parseFloat(document.getElementById('productSellingPrice').value);
  const stock = parseInt(document.getElementById('productStock').value, 10);
  const availVal = document.getElementById('productAvailability').value;
  const inStock = availVal === '2' ? 2 : (availVal === '1' ? 1 : 0);
  const stockStatus = availVal === '2' ? 'preorder' : (availVal === '1' ? 'instock' : 'outofstock');
  const description = document.getElementById('productDescription').value.trim();
  const rawVideoInput = document.getElementById('productVideoInput')?.value?.trim() || '';

  if (!name) return alert('Product name is required');
  if (!category || category === '__NEW__') return alert('Please select or create a valid category');
  if (!brand || brand === '__NEW__') return alert('Please select or create a valid brand');

  const section = document.getElementById('productSection')?.value || 'pro-audio';

  let finalMrp = mrp;
  let finalSellingPrice = sellingPrice;
  if (state.hasVariants && state.variantMatrix && state.variantMatrix.length > 0) {
    const v0 = state.variantMatrix[0];
    if (v0.mrp != null && v0.mrp > 0) finalMrp = Number(v0.mrp);
    if (v0.sellingPrice != null && v0.sellingPrice > 0) finalSellingPrice = Number(v0.sellingPrice);
  }

  const validYouTubeVideos = (state.formYouTubeVideos || [])
    .map(v => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean);

  const videoInput = state.formVideoChoice === 'youtube'
    ? (validYouTubeVideos[0] || '')
    : rawVideoInput;

  const payload = {
    name,
    category,
    section,
    brand,
    mrp: finalMrp,
    sellingPrice: finalSellingPrice,
    stock,
    inStock,
    stockStatus,
    badge: availVal === '2' ? 'Pre-Order' : '',
    description,
    images: state.formImages.length > 0 ? state.formImages : ['assets/images/placeholder.svg'],
    videoChoice: state.formVideoChoice,
    videoInput,
    youtubeVideos: validYouTubeVideos
  };

  const saveBtn = document.getElementById('saveProductBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving Product...';

  try {
    const isEdit = Boolean(state.editingProductId);
    const url = isEdit ? `/api/admin/products/${state.editingProductId}` : '/api/admin/products';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await adminFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok) {
      const savedProductId = isEdit ? state.editingProductId : (data.productId || data.id);

      // Save or clear variants
      if (savedProductId) {
        if (state.hasVariants && state.variantGroups.length > 0) {
          try {
            await adminFetch(`/api/admin/products/${savedProductId}/variants`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                groups: state.variantGroups,
                variants: state.variantMatrix
              })
            });
          } catch (ve) {
            console.error('Failed to save variants:', ve);
          }
        } else if (isEdit && !state.hasVariants) {
          try {
            await adminFetch(`/api/admin/products/${savedProductId}/variants`, { method: 'DELETE' });
          } catch (ve) {}
        }
      }

      alert(isEdit ? 'Product updated successfully!' : 'Product created successfully!');
      if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
      window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
      switchView('products');
    } else {
      alert(data.error || 'Failed to save product');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Product';
    }
  } catch (err) {
    alert('Network error while saving product.');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Product';
  }
}

// Delete Product
function confirmDeleteProduct(id, name) {
  openConfirmModal(
    'Delete Product',
    `Are you sure you want to permanently delete "${name}" from the store catalog?`,
    async () => {
      try {
        const res = await adminFetch(`/api/admin/products/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
          loadProducts();
          if (typeof window.loadLiveCatalog === 'function') window.loadLiveCatalog();
          window.dispatchEvent(new CustomEvent('ak:catalog-sync'));
          closeModal();
        } else {
          alert(data.error || 'Failed to delete product');
        }
      } catch (e) {
        alert('Error deleting product');
      }
    }
  );
}

// -------------------------------------------------------------
// 4. OFFERS & BLANKET DISCOUNTS
// -------------------------------------------------------------
async function loadOffers() {
  const tbody = document.getElementById('offersTableBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px;">Loading offers...</td></tr>';

  try {
    const res = await adminFetch('/api/admin/offers');
    const data = await res.json();
    const offers = data.offers || [];

    // Populate target select in offer form
    handleOfferTargetTypeChange();

    if (offers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding: 0; border: none;">
        <div class="admin-empty-state-box">
          <svg class="admin-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
          <div class="admin-empty-title">No active blanket offers.</div>
          <div class="admin-empty-sub">Create one above to apply storewide discounts!</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = offers.map(o => `
      <tr>
        <td><strong>${o.title}</strong></td>
        <td><span style="text-transform: capitalize;">${o.target_type}</span></td>
        <td><code>${o.target_id}</code></td>
        <td><span class="badge-discount">${o.discount_percent}% OFF</span></td>
        <td>${o.start_date || 'Immediate'} &rarr; ${o.end_date || 'No Expiry'}</td>
        <td>
          <button class="badge-stock ${o.is_active ? 'in' : 'out'}" style="cursor: pointer; border: none;" onclick="toggleOffer('${o.id}')">
            ${o.is_active ? 'Active' : 'Paused'}
          </button>
        </td>
        <td>
          <button class="btn-danger" onclick="deleteOffer('${o.id}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--ak-danger);">Failed to load offers.</td></tr>';
  }
}

async function ensureAdminProductsLoaded() {
  if (state.products && state.products.length > 0) return state.products;
  try {
    const res = await adminFetch('/api/admin/products');
    const data = await res.json();
    state.products = data.products || [];
  } catch (e) {
    console.error('[OFFER PICKER] Failed to load products:', e);
  }
  return state.products;
}

function handleOfferTargetTypeChange() {
  const type = document.getElementById('offerTargetType')?.value || 'category';
  const catWrap = document.getElementById('offerCategoryTargetWrap');
  const prodWrap = document.getElementById('offerProductTargetWrap');

  if (type === 'category') {
    if (catWrap) catWrap.style.display = 'block';
    if (prodWrap) prodWrap.style.display = 'none';
    populateOfferCategorySelect();
  } else {
    if (catWrap) catWrap.style.display = 'none';
    if (prodWrap) prodWrap.style.display = 'block';
    const searchBox = document.querySelector('.offer-product-search-box');
    const badge = document.getElementById('offerSelectedBadge');
    if (state.selectedOfferProductId && badge) {
      if (searchBox) searchBox.style.display = 'none';
      badge.style.display = 'flex';
    } else {
      if (searchBox) searchBox.style.display = 'flex';
      if (badge) badge.style.display = 'none';
    }
    initOfferProductPicker();
  }
}

function handleOfferCategoryChange() {
  const catSelect = document.getElementById('offerCategoryTargetId');
  const targetId = document.getElementById('offerTargetId');
  if (catSelect && targetId) {
    targetId.value = catSelect.value;
  }
}

function populateOfferCategorySelect() {
  const select = document.getElementById('offerCategoryTargetId');
  const targetId = document.getElementById('offerTargetId');
  if (!select) return;

  const categories = (state.categories && state.categories.length > 0)
    ? state.categories
    : [
        { name: 'Microphones' },
        { name: 'Studio Monitors' },
        { name: 'Audio Interfaces' },
        { name: 'Headphones' },
        { name: 'Mixers' },
        { name: 'Guitar Pedals & Effects' }
      ];

  select.innerHTML = categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  if (targetId) targetId.value = select.value || '';
}

async function initOfferProductPicker() {
  await ensureAdminProductsLoaded();
  const searchInput = document.getElementById('offerProductSearch');
  renderOfferProductList(searchInput ? searchInput.value : '');
  openOfferProductDropdown();
  if (searchInput) searchInput.focus();
}

function openOfferProductDropdown() {
  const list = document.getElementById('offerProductDropdownList');
  if (list) list.classList.add('open');
}

function closeOfferProductDropdown() {
  const list = document.getElementById('offerProductDropdownList');
  if (list) list.classList.remove('open');
}

function toggleOfferProductDropdown() {
  const list = document.getElementById('offerProductDropdownList');
  if (!list) return;
  if (list.classList.contains('open')) {
    closeOfferProductDropdown();
  } else {
    renderOfferProductList(document.getElementById('offerProductSearch')?.value || '');
    openOfferProductDropdown();
  }
}

function filterOfferProducts(query) {
  openOfferProductDropdown();
  renderOfferProductList(query);
}

function renderOfferProductList(filterText = '') {
  const list = document.getElementById('offerProductDropdownList');
  if (!list) return;

  const q = (filterText || '').trim().toLowerCase();
  const prods = (state.products || []).filter(p => {
    if (!q) return true;
    return (p.name && p.name.toLowerCase().includes(q)) ||
           (p.category && p.category.toLowerCase().includes(q)) ||
           (p.brand && p.brand.toLowerCase().includes(q)) ||
           (p.sku && p.sku.toLowerCase().includes(q));
  });

  if (prods.length === 0) {
    list.innerHTML = `<div class="offer-product-empty">No products found matching "${filterText}".</div>`;
    return;
  }

  list.innerHTML = prods.map(p => {
    const isSelected = state.selectedOfferProductId === p.id;
    return `
      <div class="offer-product-item ${isSelected ? 'selected' : ''}" onclick="selectOfferProduct('${p.id}')">
        <img src="${resolveAdminThumb(p.image)}" class="offer-product-item-thumb" alt="${p.name}" loading="lazy">
        <div class="offer-product-item-info">
          <div class="offer-product-item-name" title="${p.name}">${p.name}</div>
          <div class="offer-product-item-meta">${p.brand ? p.brand + ' Â· ' : ''}${p.category}</div>
        </div>
        <div class="offer-product-item-price">${formatINR(p.price)}</div>
      </div>
    `;
  }).join('');
}

function selectOfferProduct(productId) {
  const p = (state.products || []).find(item => item.id === productId);
  if (!p) return;

  state.selectedOfferProductId = p.id;

  const targetId = document.getElementById('offerTargetId');
  if (targetId) targetId.value = p.id;

  const searchInput = document.getElementById('offerProductSearch');
  if (searchInput) searchInput.value = p.name;

  const badge = document.getElementById('offerSelectedBadge');
  const thumb = document.getElementById('offerSelectedThumb');
  const title = document.getElementById('offerSelectedTitle');
  const price = document.getElementById('offerSelectedPrice');
  const searchBox = document.querySelector('.offer-product-search-box');

  if (badge && thumb && title && price) {
    thumb.src = resolveAdminThumb(p.image);
    title.textContent = p.name;
    price.textContent = formatINR(p.price);
    badge.style.display = 'flex';
    if (searchBox) searchBox.style.display = 'none';
  }

  closeOfferProductDropdown();
  renderOfferProductList(searchInput ? searchInput.value : '');
}

function clearSelectedOfferProduct() {
  state.selectedOfferProductId = null;
  const targetId = document.getElementById('offerTargetId');
  if (targetId) targetId.value = '';

  const searchInput = document.getElementById('offerProductSearch');
  if (searchInput) searchInput.value = '';

  const badge = document.getElementById('offerSelectedBadge');
  if (badge) badge.style.display = 'none';

  const searchBox = document.querySelector('.offer-product-search-box');
  if (searchBox) searchBox.style.display = 'flex';

  renderOfferProductList('');
  openOfferProductDropdown();
  if (searchInput) searchInput.focus();
}

async function handleCreateOffer(e) {
  e.preventDefault();
  const title = document.getElementById('offerTitle').value.trim();
  const targetType = document.getElementById('offerTargetType').value;
  const targetId = document.getElementById('offerTargetId').value.trim();
  const discountPercent = parseFloat(document.getElementById('offerDiscountPercent').value);
  const startDate = document.getElementById('offerStartDate').value;
  const endDate = document.getElementById('offerEndDate').value;

  if (!title || !targetId || isNaN(discountPercent)) {
    return alert('Please select a target ' + (targetType === 'category' ? 'category' : 'product') + ' and fill all required fields.');
  }

  try {
    const res = await adminFetch('/api/admin/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, targetType, targetId, discountPercent, startDate, endDate })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Blanket discount applied successfully! Storefront will reflect updated pricing automatically.');
      document.getElementById('offerForm').reset();
      clearSelectedOfferProduct();
      loadOffers();
    } else {
      alert(data.error || 'Failed to create offer.');
    }
  } catch (e) {
    alert('Error creating offer.');
  }
}

async function toggleOffer(id) {
  try {
    await adminFetch(`/api/admin/offers/${id}/toggle`, { method: 'PATCH' });
    loadOffers();
  } catch (e) {}
}

async function deleteOffer(id) {
  if (!confirm('Are you sure you want to remove this blanket offer? Products will revert to base pricing.')) return;
  try {
    await adminFetch(`/api/admin/offers/${id}`, { method: 'DELETE' });
    loadOffers();
  } catch (e) {}
}

// -------------------------------------------------------------
// 5. COUPONS VIEW
// -------------------------------------------------------------
async function loadCoupons() {
  if (!state.brands || !state.brands.length || !state.categories || !state.categories.length) {
    await loadCategoriesAndBrands();
  } else {
    // Make sure dropdowns are populated if currently empty
    const cb = document.getElementById('couponBrand');
    if (cb && cb.options.length <= 1 && state.brands && state.brands.length > 0) {
      cb.innerHTML = '<option value="all">All</option>' + state.brands.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
    }
    const cc = document.getElementById('couponCategory');
    if (cc && cc.options.length <= 1 && state.categories && state.categories.length > 0) {
      cc.innerHTML = '<option value="all">All</option>' + state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }
  }

  try {
    const res = await adminFetch('/api/admin/coupons');
    if (res.ok) {
      const data = await res.json();
      state.coupons = data.coupons || [];
    }
  } catch (err) {
    console.error('Failed to load coupons from API:', err);
  }

  renderCouponsTable();
}

function setCouponFilter(filter) {
  const normFilter = (filter === 'hidden' || filter === 'invisible') ? 'invisible' : (filter || 'all');
  state.couponFilter = normFilter;
  ['all', 'visible', 'invisible'].forEach(f => {
    const btn = document.getElementById('couponFilter' + f.charAt(0).toUpperCase() + f.slice(1));
    if (btn) btn.classList.toggle('active', f === state.couponFilter);
  });
  const hiddenBtn = document.getElementById('couponFilterHidden');
  if (hiddenBtn) hiddenBtn.classList.toggle('active', state.couponFilter === 'invisible');
  renderCouponsTable();
}

function generateRandomCouponCode(inputId = 'couponCode') {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const code = `VIP-${rand}`;
  const el = document.getElementById(inputId);
  if (el) el.value = code;
  return code;
}

function handleCouponVisibilityChange(selectEl, warningElId) {
  const warn = document.getElementById(warningElId);
  if (warn) {
    const val = selectEl?.value;
    warn.style.display = (val === 'hidden' || val === 'invisible') ? 'block' : 'none';
  }
}

function renderCouponsTable() {
  const tbody = document.getElementById('couponsTableBody');
  if (!tbody) return;

  const allCoupons = state.coupons || [];
  const filter = state.couponFilter || 'all';
  const coupons = allCoupons.filter(c => {
    const vis = (c.visibility || 'visible').toLowerCase();
    const isPrivate = (vis === 'hidden' || vis === 'invisible');
    if (filter === 'visible') return !isPrivate;
    if (filter === 'invisible' || filter === 'hidden') return isPrivate;
    return true;
  });

  if (coupons.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="padding: 0; border: none;">
      <div class="admin-empty-state-box">
        <svg class="admin-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
        <div class="admin-empty-title">${allCoupons.length === 0 ? 'No coupons found.' : `No ${filter} coupons found.`}</div>
        <div class="admin-empty-sub">${allCoupons.length === 0 ? 'Create your first coupon code above.' : 'Try changing your visibility filter.'}</div>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = coupons.map(c => {
    const targetBrand = (c.targetBrand || c.target_brand || c.applicable_brand || 'all').trim();
    const targetCategory = (c.targetCategory || c.target_category || c.applicable_category || 'all').trim();

    // Brand display with deleted check
    let brandDisplay;
    if (!targetBrand || targetBrand.toLowerCase() === 'all') {
      brandDisplay = '<span style="color: var(--ak-text-muted); font-size: 12px; font-weight: 500;">All Brands</span>';
    } else {
      const brandExists = (state.brands || []).some(b => b.name && b.name.toLowerCase() === targetBrand.toLowerCase());
      if (brandExists) {
        brandDisplay = `<span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #E0F2FE; color: #0369A1; font-weight: 700;">${escapeHtml(targetBrand)}</span>`;
      } else {
        brandDisplay = `<span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #FEE2E2; color: #DC2626; font-weight: 700;" title="Target brand was deleted from database">âš ï¸ ${escapeHtml(targetBrand)} (Target no longer exists)</span>`;
      }
    }

    // Category display with deleted check
    let categoryDisplay;
    if (!targetCategory || targetCategory.toLowerCase() === 'all') {
      categoryDisplay = '<span style="color: var(--ak-text-muted); font-size: 12px; font-weight: 500;">All Categories</span>';
    } else {
      const catExists = (state.categories || []).some(cat => cat.name && cat.name.toLowerCase() === targetCategory.toLowerCase());
      if (catExists) {
        categoryDisplay = `<span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #F3E8FF; color: #6B21A8; font-weight: 700;">${escapeHtml(targetCategory)}</span>`;
      } else {
        categoryDisplay = `<span style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #FEE2E2; color: #DC2626; font-weight: 700;" title="Target category was deleted from database">âš ï¸ ${escapeHtml(targetCategory)} (Target no longer exists)</span>`;
      }
    }

    const discType = c.discountType || c.discount_type;
    const discVal = c.discountValue != null ? c.discountValue : c.discount_value;
    const minCart = c.minCartValue != null ? c.minCartValue : c.min_cart_value;
    const usedCount = c.usedCount != null ? c.usedCount : (c.used_count || 0);
    const usageLimit = c.usageLimit != null ? c.usageLimit : c.usage_limit;
    const expiresAt = c.expiresAt || c.expires_at;
    const isActive = c.isActive != null ? c.isActive : (c.is_active !== 0 && c.is_active !== false);
    const vis = (c.visibility || 'visible').toLowerCase();
    const isPrivate = (vis === 'hidden' || vis === 'invisible');

    const visBadge = isPrivate
      ? `<span class="badge-visibility invisible" title="Invisible: Private code, works only when typed manually"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg> Invisible</span>`
      : `<span class="badge-visibility visible" title="Visible: Shown to customers at checkout"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> Visible</span>`;

    return `
      <tr>
        <td><strong style="color: var(--ak-orange); font-size: 15px; letter-spacing: 0.5px;">${escapeHtml(c.code)}</strong></td>
        <td>${visBadge}</td>
        <td>${discType === 'flat' ? 'Flat Amount' : 'Percentage'}</td>
        <td><strong>${discType === 'flat' ? formatINR(discVal) : `${discVal}%`}</strong></td>
        <td>${brandDisplay}</td>
        <td>${categoryDisplay}</td>
        <td>${minCart > 0 ? formatINR(minCart) : 'None'}</td>
        <td><strong>${usedCount}</strong> / ${usageLimit || 'âˆž'}</td>
        <td>${expiresAt ? String(expiresAt).slice(0, 10) : 'Never'}</td>
        <td>
          <button class="badge-stock ${isActive ? 'in' : 'out'}" style="cursor: pointer; border: none;" onclick="toggleCoupon('${c.id}')">
            ${isActive ? 'Active' : 'Disabled'}
          </button>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-edit" onclick="openEditCoupon('${c.id}')">Edit</button>
            <button type="button" class="btn-danger" onclick="deleteCoupon('${c.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleCreateCoupon(e) {
  e.preventDefault();
  const code = document.getElementById('couponCode').value.trim().toUpperCase();
  const rawVis = document.getElementById('couponVisibility')?.value || 'visible';
  const visibility = (rawVis === 'invisible' || rawVis === 'hidden') ? 'hidden' : 'visible';
  const discountType = document.getElementById('couponType').value;
  const discountValue = parseFloat(document.getElementById('couponValue').value);
  const minCartValue = parseFloat(document.getElementById('couponMinCart').value) || 0;
  const usageLimit = parseInt(document.getElementById('couponLimit').value, 10) || null;
  const expiresAt = document.getElementById('couponExpiry').value || null;
  const targetBrand = document.getElementById('couponBrand')?.value || 'all';
  const targetCategory = document.getElementById('couponCategory')?.value || 'all';

  if (!code || isNaN(discountValue)) return alert('Please enter code and discount value');

  try {
    const res = await adminFetch('/api/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        visibility,
        discountType,
        discountValue,
        minCartValue,
        usageLimit,
        expiresAt,
        targetBrand,
        targetCategory,
        applicableBrand: targetBrand,
        applicableCategory: targetCategory
      })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Coupon "${code}" created successfully!`);
      document.getElementById('couponForm').reset();
      const visSel = document.getElementById('couponVisibility');
      if (visSel) {
        visSel.value = 'visible';
        handleCouponVisibilityChange(visSel, 'createCouponHiddenWarning');
      }
      const brandSel = document.getElementById('couponBrand');
      if (brandSel) brandSel.value = 'all';
      const catSel = document.getElementById('couponCategory');
      if (catSel) catSel.value = 'all';
      loadCoupons();
    } else {
      alert(data.error || 'Failed to create coupon');
    }
  } catch (e) {
    alert('Error creating coupon.');
  }
}

async function toggleCoupon(id) {
  try {
    await adminFetch(`/api/admin/coupons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    loadCoupons();
  } catch (e) {}
}

async function deleteCoupon(id) {
  if (!confirm('Are you sure you want to delete this coupon?')) return;
  try {
    await adminFetch(`/api/admin/coupons/${id}`, { method: 'DELETE' });
    loadCoupons();
  } catch (e) {}
}

async function openEditCoupon(id) {
  try {
    let coupon = (state.coupons || []).find(c => String(c.id) === String(id));
    if (!coupon) {
      const res = await adminFetch('/api/admin/coupons');
      const data = await res.json();
      state.coupons = data.coupons || [];
      coupon = (state.coupons || []).find(item => String(item.id) === String(id));
    }
    if (!coupon) return alert('Coupon not found');

    const c = coupon;
    document.getElementById('editCouponId').value = c.id;
    document.getElementById('editCouponCode').value = c.code || '';
    document.getElementById('editCouponType').value = c.discountType || c.discount_type || 'flat';
    document.getElementById('editCouponValue').value = c.discountValue != null ? c.discountValue : (c.discount_value != null ? c.discount_value : '');

    const bSelect = document.getElementById('editCouponBrand');
    const cSelect = document.getElementById('editCouponCategory');
    const curBrand = (c.targetBrand || c.target_brand || c.applicable_brand || 'all').trim();
    const curCat = (c.targetCategory || c.target_category || c.applicable_category || 'all').trim();

    if (bSelect) {
      if (!Array.from(bSelect.options).some(o => o.value.toLowerCase() === curBrand.toLowerCase())) {
        const opt = document.createElement('option');
        opt.value = curBrand;
        opt.textContent = curBrand.toLowerCase() === 'all' ? 'All' : `${curBrand} (Target no longer exists)`;
        bSelect.appendChild(opt);
      }
      bSelect.value = curBrand;
    }

    if (cSelect) {
      if (!Array.from(cSelect.options).some(o => o.value.toLowerCase() === curCat.toLowerCase())) {
        const opt = document.createElement('option');
        opt.value = curCat;
        opt.textContent = curCat.toLowerCase() === 'all' ? 'All' : `${curCat} (Target no longer exists)`;
        cSelect.appendChild(opt);
      }
      cSelect.value = curCat;
    }

    document.getElementById('editCouponMinCart').value = c.minCartValue != null ? c.minCartValue : (c.min_cart_value != null ? c.min_cart_value : 0);
    document.getElementById('editCouponLimit').value = c.usageLimit != null ? c.usageLimit : (c.usage_limit != null ? c.usage_limit : '');
    document.getElementById('editCouponPerUserLimit').value = c.perUserLimit != null ? c.perUserLimit : (c.per_user_limit != null ? c.per_user_limit : 1);

    const exp = c.expiresAt || c.expires_at;
    document.getElementById('editCouponExpiry').value = exp ? String(exp).slice(0, 10) : '';

    const editVisEl = document.getElementById('editCouponVisibility');
    if (editVisEl) {
      const vVal = (c.visibility || 'visible').toLowerCase();
      editVisEl.value = (vVal === 'hidden' || vVal === 'invisible') ? 'invisible' : 'visible';
      handleCouponVisibilityChange(editVisEl, 'editCouponHiddenWarning');
    }

    openModal('editCouponModal');
  } catch (err) {
    console.error('Error opening edit coupon modal:', err);
    alert('Failed to load coupon details for editing.');
  }
}

function closeEditCouponModal() {
  const m = document.getElementById('editCouponModal');
  if (m) m.classList.remove('open');
  if (state.activeModal === m) state.activeModal = null;
}

async function handleUpdateCoupon(e) {
  e.preventDefault();
  const id = document.getElementById('editCouponId').value.trim();
  const code = document.getElementById('editCouponCode').value.trim().toUpperCase();
  const rawVis = document.getElementById('editCouponVisibility')?.value || 'visible';
  const visibility = (rawVis === 'invisible' || rawVis === 'hidden') ? 'hidden' : 'visible';
  const discountType = document.getElementById('editCouponType').value;
  const discountValue = parseFloat(document.getElementById('editCouponValue').value);
  const targetBrand = document.getElementById('editCouponBrand')?.value || 'all';
  const targetCategory = document.getElementById('editCouponCategory')?.value || 'all';
  const minCartValue = parseFloat(document.getElementById('editCouponMinCart').value) || 0;
  const usageLimit = parseInt(document.getElementById('editCouponLimit').value, 10) || null;
  const perUserLimit = parseInt(document.getElementById('editCouponPerUserLimit').value, 10) || 1;
  const expiresAt = document.getElementById('editCouponExpiry').value || null;

  if (!id || !code || isNaN(discountValue)) {
    return alert('Please enter code and discount value');
  }

  try {
    const res = await adminFetch(`/api/admin/coupons/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        visibility,
        discountType,
        discountValue,
        targetBrand,
        targetCategory,
        applicableBrand: targetBrand,
        applicableCategory: targetCategory,
        minCartValue,
        usageLimit,
        perUserLimit,
        expiresAt
      })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Coupon "${code}" updated successfully!`);
      closeEditCouponModal();
      loadCoupons();
    } else {
      alert(data.error || 'Failed to update coupon');
    }
  } catch (err) {
    alert('Error updating coupon.');
  }
}

window.loadCoupons = loadCoupons;
window.handleCreateCoupon = handleCreateCoupon;
window.toggleCoupon = toggleCoupon;
window.deleteCoupon = deleteCoupon;
window.openEditCoupon = openEditCoupon;
window.closeEditCouponModal = closeEditCouponModal;
window.handleUpdateCoupon = handleUpdateCoupon;
window.generateRandomCouponCode = generateRandomCouponCode;
window.handleCouponVisibilityChange = handleCouponVisibilityChange;
window.setCouponFilter = setCouponFilter;

// -------------------------------------------------------------
// 6. ORDERS (CURRENT VS HISTORY)
// -------------------------------------------------------------
function setOrdersTab(tab) {
  state.ordersTab = tab;
  document.getElementById('tabCurrentOrders').classList.toggle('active', tab === 'current');
  document.getElementById('tabHistoryOrders').classList.toggle('active', tab === 'history');
  loadOrders();
}

async function loadOrders() {
  const tbody = document.getElementById('ordersTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px;">Loading orders...</td></tr>';

  try {
    const res = await adminFetch(`/api/admin/orders?tab=${state.ordersTab}`);
    if (!res.ok) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color: var(--ak-danger); padding: 24px;">Failed to load orders (${res.status}). Retrying...</td></tr>`;
      return;
    }
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="padding: 0; border: none;">
        <div class="admin-empty-state-box">
          <svg class="admin-empty-icon" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          <div class="admin-empty-title">No ${state.ordersTab === 'current' ? 'active' : 'past'} orders found.</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => {
      let addrStr = 'N/A';
      if (o.shippingAddress) {
        if (typeof o.shippingAddress === 'object') {
          const a = o.shippingAddress;
          addrStr = a.line1 ? `${a.line1}${a.line2 ? ', ' + a.line2 : ''}, ${a.city || ''}, ${a.state || ''} - ${a.pin || a.pincode || ''}` : (a.address || 'Address on file');
        } else {
          addrStr = String(o.shippingAddress);
        }
      }

      return `
      <tr>
        <td><strong>#${o.orderNumber}</strong></td>
        <td>
          <span style="font-size: 11.5px; padding: 4px 8px; font-weight: 700; background: #0F172A; border: 1px solid #334155; color: #38BDF8; border-radius: 4px; display: inline-block;">
            ${o.paymentMethod || 'Prepaid / Online'}
          </span>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--ak-text-primary, #0F172A);">${o.customerName}</div>
          <div style="font-size: 11px; color: var(--ak-text-muted);">${o.customerEmail}</div>
          <div style="font-size: 11px; color: #38BDF8; margin-top: 2px;">ðŸ“ž ${o.customerPhone || 'N/A'}</div>
        </td>
        <td style="max-width: 220px;">
          <div style="font-size: 12px; line-height: 1.4; color: var(--ak-text-secondary); word-break: break-word;">${addrStr}</div>
        </td>
        <td style="max-width: 200px;">
          <div style="font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${o.itemsSummary}">${o.itemsSummary}</div>
          <div style="font-size: 11px; color: var(--ak-text-muted);">${o.itemsCount} product(s)</div>
        </td>
        <td><strong style="color: var(--ak-orange);">${formatINR(o.totalAmount)}</strong></td>
        <td>
          <span class="badge-stock ${o.status === 'Delivered' ? 'in' : (o.status === 'Cancelled' ? 'out' : (o.status === 'Dispatched' ? 'low' : 'pending'))}">
            ${o.status}
          </span>
        </td>
        <td style="font-size: 12px; color: var(--ak-text-secondary);">${formatDate(o.createdAt)}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn-edit" onclick="openOrderDetailModal('${o.id}')">View Details</button>
            ${o.status !== 'Cancelled' && o.status !== 'Delivered' ? `
              <button type="button" class="btn-danger" style="padding: 4px 8px; font-size: 11.5px; background: #EF4444;" onclick="cancelOrderDirect('${o.id}', '${o.orderNumber}')" title="Cancel Order">ðŸš« Cancel</button>
            ` : ''}
          </div>
        </td>
      </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--ak-danger);">Failed to load orders.</td></tr>';
  }
}

async function openOrderDetailModal(orderId) {
  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}`);
    const data = await res.json();
    const ord = data.order;

    let addrText = 'N/A';
    if (ord.shippingAddress) {
      if (typeof ord.shippingAddress === 'string') {
        try {
          const parsed = JSON.parse(ord.shippingAddress);
          addrText = parsed.line1 ? `${parsed.line1}${parsed.line2 ? ', ' + parsed.line2 : ''}, ${parsed.city || ''}, ${parsed.state || ''} - ${parsed.pin || parsed.pincode || ''}` : (parsed.address || ord.shippingAddress);
        } catch(e) {
          addrText = ord.shippingAddress;
        }
      } else if (typeof ord.shippingAddress === 'object') {
        const a = ord.shippingAddress;
        addrText = a.line1 ? `${a.line1}${a.line2 ? ', ' + a.line2 : ''}, ${a.city || ''}, ${a.state || ''} - ${a.pin || a.pincode || ''}` : (a.address || JSON.stringify(a));
      }
    }

    document.getElementById('modalOrderNumber').textContent = ord.orderNumber;
    document.getElementById('modalCustomerName').textContent = ord.customerName;
    document.getElementById('modalCustomerEmail').textContent = ord.customerEmail;
    document.getElementById('modalCustomerPhone').textContent = ord.customerPhone;
    document.getElementById('modalShippingAddr').textContent = addrText;
    document.getElementById('modalPaymentMethod').textContent = ord.paymentMethod;
    document.getElementById('modalTotalAmount').textContent = formatINR(ord.totalAmount);
    document.getElementById('modalCouponDetail').textContent = ord.couponCode ? `${ord.couponCode} (-${formatINR(ord.discountAmount)})` : 'None';

    const statusSelect = document.getElementById('modalOrderStatusSelect');
    statusSelect.value = ord.status;
    statusSelect.dataset.orderId = ord.id;

    // Items list
    const itemsTbody = document.getElementById('modalOrderItemsTbody');
    itemsTbody.innerHTML = ord.items.map(it => `
      <tr>
        <td style="width: 44px;"><img src="${resolveAdminThumb(it.image)}" class="table-thumb" alt=""></td>
        <td>${it.name}</td>
        <td>${it.quantity}</td>
        <td>${formatINR(it.unitPrice)}</td>
        <td><strong>${formatINR(it.subtotal)}</strong></td>
      </tr>
    `).join('');

    openModal('orderDetailModal');
  } catch (err) {
    alert('Failed to load order details');
  }
}

async function updateOrderStatusFromModal() {
  const select = document.getElementById('modalOrderStatusSelect');
  const orderId = select.dataset.orderId;
  const status = select.value;

  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      alert(`Order status updated to "${status}"!`);
      closeModal();
      loadOrders();
    } else {
      alert('Failed to update status.');
    }
  } catch (e) {
    alert('Error updating status.');
  }
}

async function cancelOrderFromModal() {
  const select = document.getElementById('modalOrderStatusSelect');
  const orderId = select ? select.dataset.orderId : null;
  if (!orderId) return alert('Order ID not found.');

  const confirmed = confirm('Are you sure you want to cancel this order? The status will immediately be updated to "Cancelled" and the customer will receive an official cancellation notification email with the website store link.');
  if (!confirmed) return;

  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Cancelled' })
    });
    if (res.ok) {
      alert('Order has been cancelled successfully and the customer has been notified via email.');
      closeModal();
      loadOrders();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to cancel order.');
    }
  } catch (e) {
    alert('Error cancelling order: ' + e.message);
  }
}

async function cancelOrderDirect(orderId, orderNumber) {
  if (!orderId) return;
  const confirmed = confirm(`Are you sure you want to cancel order #${orderNumber}? The status will immediately be updated to "Cancelled" and the customer will receive an official cancellation email.`);
  if (!confirmed) return;

  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Cancelled' })
    });
    if (res.ok) {
      alert(`Order #${orderNumber} cancelled successfully and customer notified via email.`);
      loadOrders();
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to cancel order.');
    }
  } catch (e) {
    alert('Error cancelling order: ' + e.message);
  }
}

window.cancelOrderFromModal = cancelOrderFromModal;
window.cancelOrderDirect = cancelOrderDirect;

// -------------------------------------------------------------
// 7. CUSTOMERS VIEW
// -------------------------------------------------------------
async function loadCustomers() {
  const tbody = document.getElementById('customersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px;">Loading registered customer accounts...</td></tr>';

  try {
    const res = await adminFetch('/api/admin/customers');
    if (!res.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--ak-danger); padding: 24px;">Failed to load customers (${res.status}). Retrying...</td></tr>`;
      return;
    }
    const data = await res.json();
    const customers = data.customers || [];

    if (!tbody) return;

    if (customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--ak-text-muted); padding: 24px;">No registered customers yet.</td></tr>';
      return;
    }

    tbody.innerHTML = customers.map(c => `
      <tr>
        <td><strong>${c.name}</strong></td>
        <td>${c.email}</td>
        <td>
          <span class="provider-badge ${c.provider === 'Google Account' ? 'google' : 'email'}">
            ${c.provider}
          </span>
        </td>
        <td>${formatDate(c.joinedAt)}</td>
        <td><strong>${c.ordersCount}</strong></td>
        <td><strong style="color: var(--ak-orange);">${formatINR(c.totalSpent)}</strong></td>
        <td>
          <button class="btn-edit" onclick="openCustomerHistoryModal('${c.id}')">View Orders</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--ak-danger);">Failed to load customers.</td></tr>';
  }
}

async function openCustomerHistoryModal(customerId) {
  try {
    const res = await adminFetch(`/api/admin/customers/${customerId}/orders`);
    const data = await res.json();
    const customer = data.customer;
    const orders = data.orders || [];

    document.getElementById('modalCustomerHistoryTitle').textContent = `Order History: ${customer.name}`;
    document.getElementById('modalCustomerHistorySub').textContent = `${customer.email} Â· ${customer.phone}`;

    const tbody = document.getElementById('modalCustomerOrdersTbody');
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--ak-text-muted); padding: 20px;">This customer has not placed any orders yet.</td></tr>';
    } else {
      tbody.innerHTML = orders.map(o => `
        <tr>
          <td><strong>${o.order_number}</strong></td>
          <td>${formatDate(o.created_at)}</td>
          <td>${formatINR(o.total_amount)}</td>
          <td>${o.coupon_code || 'None'}</td>
          <td><span class="badge-stock ${o.status === 'Delivered' ? 'in' : 'low'}">${o.status}</span></td>
        </tr>
      `).join('');
    }

    openModal('customerHistoryModal');
  } catch (err) {
    alert('Failed to load customer orders.');
  }
}

// -------------------------------------------------------------
// 8. SETTINGS VIEW (CHANGE PASSWORD)
// -------------------------------------------------------------
async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const alertEl = document.getElementById('passwordChangeAlert');

  if (newPassword !== confirmPassword) {
    alertEl.textContent = 'New passwords do not match.';
    alertEl.className = 'error-banner';
    alertEl.style.display = 'block';
    return;
  }

  try {
    const res = await adminFetch('/api/admin/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.textContent = data.message;
      alertEl.className = 'success-banner';
      alertEl.style.display = 'block';
      document.getElementById('changePasswordForm').reset();
    } else {
      alertEl.textContent = data.error || 'Failed to update password.';
      alertEl.className = 'error-banner';
      alertEl.style.display = 'block';
    }
  } catch (err) {
    alertEl.textContent = 'Network error while updating password.';
    alertEl.className = 'error-banner';
    alertEl.style.display = 'block';
  }
}

// -------------------------------------------------------------
// MODALS & CONFIRM DIALOGS
// -------------------------------------------------------------
function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) {
    m.classList.add('open');
    state.activeModal = m;
  }
}

function closeModal() {
  if (state.activeModal) {
    state.activeModal.classList.remove('open');
    state.activeModal = null;
  }
}

function openConfirmModal(title, message, onConfirm) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;
  const btn = document.getElementById('confirmModalActionBtn');
  btn.onclick = onConfirm;
  openModal('confirmModal');
}

// -------------------------------------------------------------
// DATABASE PERSISTENCE & DATA BACKUP / RESTORE
// -------------------------------------------------------------
async function handleExportDataBackup() {
  try {
    const res = await adminFetch('/api/admin/backup/export');
    if (!res.ok) throw new Error('Backup generation failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audioking_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Database backup downloaded successfully!');
  } catch (err) {
    alert('Failed to export backup: ' + err.message);
  }
}
window.handleExportDataBackup = handleExportDataBackup;

async function handleImportDataBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!confirm(`Are you sure you want to restore data from "${file.name}"? This will synchronize all customers, orders, and coupons.`)) {
    event.target.value = '';
    return;
  }
  const msgEl = document.getElementById('backupStatusMsg') || document.getElementById('backupStatusMsgIndex');
  if (msgEl) {
    msgEl.textContent = 'Restoring and synchronizing database...';
    msgEl.style.color = 'var(--ak-orange)';
    msgEl.style.display = 'block';
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await adminFetch('/api/admin/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to restore');
    if (msgEl) {
      msgEl.textContent = 'Data successfully restored and synchronized!';
      msgEl.style.color = '#16A34A';
    }
    alert('Data backup successfully restored! Refreshing views...');
    loadDashboardStats();
    loadCustomers();
    loadOrders();
    loadCoupons();
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Restore failed: ' + err.message;
      msgEl.style.color = '#EF4444';
    }
    alert('Failed to restore backup: ' + err.message);
  } finally {
    event.target.value = '';
  }
}
window.handleImportDataBackup = handleImportDataBackup;

// Logout
async function handleLogout() {
  if (!confirm('Sign out of the admin panel?')) return;
  try {
    // Always call admin-specific logout to clear admin session cookie
    await adminFetch('/api/admin/auth/logout', { method: 'POST' });
    // Also call regular auth logout to clear all session cookies
    if (window.authService && typeof window.authService.logout === 'function') {
      await window.authService.logout();
    }
  } catch (e) {}
  localStorage.removeItem('audioKingSessionToken');
  localStorage.removeItem('audioking_token');
  localStorage.removeItem('audioKingToken');
  localStorage.removeItem('audioKingUser');
  localStorage.removeItem('audioking_user');
  localStorage.removeItem('audioking_admin_view');
  if (typeof window.showToast === 'function') window.showToast('Signed out of admin panel.');
  if (typeof window.showHome === 'function') window.showHome();
  else window.location.hash = '#home';
}
window.handleAdminLogout = handleLogout;

function updateAdminUserDisplay() {
  try {
    let user = null;
    if (window.authService && typeof window.authService.getUser === 'function') {
      user = window.authService.getUser();
    }
    if (!user) {
      try {
        const raw = localStorage.getItem('audioKingUser') || localStorage.getItem('audioking_user');
        if (raw) user = JSON.parse(raw);
      } catch (e) {}
    }
    if (user && user.role === 'admin') {
      const name = user.fullName || user.displayName || 'Administrator';
      const email = user.email || 'audioking30@gmail.com';
      document.querySelectorAll('#adminSidebarName').forEach(el => { el.textContent = name; });
      document.querySelectorAll('#adminSidebarRole').forEach(el => { el.textContent = email; });
      const ownerName = document.getElementById('adminSettingsOwnerName');
      if (ownerName) ownerName.textContent = name;
      const ownerEmail = document.getElementById('adminSettingsOwnerEmail');
      if (ownerEmail) ownerEmail.textContent = email;
    }
  } catch (e) {}
}

function initAdminDashboardView(targetView) {
  updateAdminUserDisplay();
  loadCategoriesAndBrands();

  // Determine target view in order of precedence:
  // 1. targetView parameter passed in (from router)
  // 2. Hash in URL: #admin/offers -> 'offers' or #offers -> 'offers'
  // 3. localStorage 'audioking_admin_view'
  // 4. Default 'dashboard'
  let viewToOpen = targetView;
  if (!viewToOpen) {
    const hash = window.location.hash || '';
    if (hash.startsWith('#admin/')) {
      viewToOpen = hash.replace('#admin/', '').split('?')[0];
    } else if (window.location.pathname.includes('/admin') && hash.startsWith('#')) {
      viewToOpen = hash.replace('#', '').split('?')[0];
    }
  }
  // Default strictly to 'dashboard' when returning to Admin Portal
  if (!viewToOpen || !document.getElementById(`view-${viewToOpen}`)) {
    viewToOpen = 'dashboard';
  }

  switchView(viewToOpen);
}
window.initAdminDashboardView = initAdminDashboardView;

// -------------------------------------------------------------
// ANALYTICS & TRAFFIC CONTROLLER
// -------------------------------------------------------------
function setAnalyticsRange(days) {
  state.analyticsRange = days;
  document.querySelectorAll('#view-analytics .tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`analyticsRange${days}`);
  if (btn) btn.classList.add('active');
  loadAnalytics();
}
window.setAnalyticsRange = setAnalyticsRange;

async function loadAnalytics() {
  const barsWrap = document.getElementById('analyticsBarsWrap');
  const productsBody = document.getElementById('analyticsTopProductsBody');
  const sourcesWrap = document.getElementById('analyticsTrafficSourcesWrap');
  const pagesBody = document.getElementById('analyticsTopPagesBody');

  try {
    const res = await adminFetch(`/api/admin/analytics/summary?range=${state.analyticsRange}`);
    if (!res.ok) throw new Error('Failed to load analytics');
    const data = await res.json();
    const a = data.analytics || {};

    // Update KPIs
    const elToday = document.getElementById('analyticsTodayViews');
    const elUnique = document.getElementById('analyticsTodayUnique');
    const elTotal = document.getElementById('analyticsTotalViews');
    const elUsers = document.getElementById('analyticsTotalUsers');
    if (elToday) elToday.textContent = (a.todayViews || 0).toLocaleString();
    if (elUnique) elUnique.textContent = (a.todayUnique || 0).toLocaleString();
    if (elTotal) elTotal.textContent = (a.totalViews || 0).toLocaleString();
    if (elUsers) elUsers.textContent = (a.totalUsers || 0).toLocaleString();

    // Daily Trend Chart
    const trend = a.dailyTrend || [];
    if (barsWrap) {
      if (trend.length === 0) {
        barsWrap.innerHTML = '<div style="text-align: center; color: var(--ak-text-muted); padding: 40px; width: 100%;">No traffic recorded in this date range. Page views will appear automatically as customers browse.</div>';
      } else {
        const maxViews = Math.max(...trend.map(t => t.views), 1);
        barsWrap.innerHTML = trend.map(t => {
          const heightPct = Math.max(Math.round((t.views / maxViews) * 100), 5);
          const dayLabel = new Date(t.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          return `
            <div class="analytics-bar-col">
              <div class="analytics-bar-tooltip">${t.views} views (${dayLabel})</div>
              <div class="analytics-bar-track">
                <div class="analytics-bar-fill" style="height: ${heightPct}%;"></div>
              </div>
              <div class="analytics-bar-label">${dayLabel}</div>
            </div>
          `;
        }).join('');
      }
    }

    // Top Products
    if (productsBody) {
      const prods = a.topProducts || [];
      if (prods.length === 0) {
        productsBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--ak-text-muted); padding: 20px;">No product views recorded yet.</td></tr>';
      } else {
        productsBody.innerHTML = prods.map(p => `
          <tr>
            <td><img src="${resolveAdminThumb(p.image)}" class="table-thumb" alt=""></td>
            <td><strong>${p.name || p.product_id}</strong></td>
            <td style="text-align: right;"><strong style="color: var(--ak-orange);">${p.views}</strong></td>
          </tr>
        `).join('');
      }
    }

    // Traffic Sources
    if (sourcesWrap) {
      const src = a.trafficSources || { Direct: 0, Google: 0, Social: 0, Other: 0 };
      const totalSrcViews = Object.values(src).reduce((acc, v) => acc + v, 0) || 1;
      const srcConfig = [
        { key: 'Direct', label: 'Direct / Store Links', color: '#10B981' },
        { key: 'Google', label: 'Google Organic / Search', color: '#3B82F6' },
        { key: 'Social', label: 'Social Networks', color: '#EC4899' },
        { key: 'Other', label: 'Other Referrals', color: '#F59E0B' }
      ];

      sourcesWrap.innerHTML = srcConfig.map(s => {
        const count = src[s.key] || 0;
        const pct = Math.round((count / totalSrcViews) * 100);
        return `
          <div class="traffic-source-item">
            <div class="traffic-source-meta">
              <span style="font-weight: 600; color: var(--ak-text-primary); display: flex; align-items: center; gap: 8px;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${s.color}; display: inline-block;"></span>
                ${s.label}
              </span>
              <span style="color: var(--ak-text-secondary); font-size: 12px;"><strong>${count}</strong> (${pct}%)</span>
            </div>
            <div class="traffic-source-bar-bg">
              <div class="traffic-source-bar-fill" style="width: ${pct}%; background: ${s.color};"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Top Pages
    if (pagesBody) {
      const pages = a.topPages || [];
      if (pages.length === 0) {
        pagesBody.innerHTML = '<tr><td colspan="2" style="text-align: center; color: var(--ak-text-muted); padding: 16px;">No page views yet.</td></tr>';
      } else {
        pagesBody.innerHTML = pages.map(p => `
          <tr>
            <td><code style="color: var(--ak-orange); font-size: 12px;">${p.path}</code></td>
            <td style="text-align: right;"><strong>${p.views}</strong></td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('[LOAD ANALYTICS ERROR]', err);
    if (barsWrap) {
      barsWrap.innerHTML = '<div style="text-align: center; color: var(--ak-danger); padding: 40px; width: 100%;">Failed to load traffic analytics.</div>';
    }
  }
}
window.loadAnalytics = loadAnalytics;

// -------------------------------------------------------------
// PRODUCT VARIANTS CONTROLLER
// -------------------------------------------------------------
function handleVariantToggleChange(checked) {
  state.hasVariants = checked;
  const section = document.getElementById('variantBuilderSection');
  if (section) section.style.display = checked ? 'block' : 'none';

  if (checked && state.variantGroups.length === 0) {
    addVariantGroup('Color', 'color');
  }
}
window.handleVariantToggleChange = handleVariantToggleChange;

function addVariantGroup(defaultName = 'Color', type = 'text') {
  const newGroup = {
    tempId: Date.now() + Math.random(),
    name: defaultName,
    type: type, // 'color' | 'text'
    sortOrder: state.variantGroups.length,
    options: []
  };
  state.variantGroups.push(newGroup);
  renderVariantGroups();
  generateVariantMatrix();
}
window.addVariantGroup = addVariantGroup;

function removeVariantGroup(groupIndex) {
  state.variantGroups.splice(groupIndex, 1);
  renderVariantGroups();
  generateVariantMatrix();
}
window.removeVariantGroup = removeVariantGroup;

function addVariantOption(groupIndex) {
  const group = state.variantGroups[groupIndex];
  if (!group) return;

  const input = document.getElementById(`optInput_${groupIndex}`);
  const label = input ? input.value.trim() : '';
  if (!label) return;

  let colorHex = null;
  if (group.type === 'color') {
    const colorInput = document.getElementById(`optColor_${groupIndex}`);
    colorHex = colorInput ? colorInput.value : '#000000';
  }

  // Prevent duplicate labels in same group
  if (group.options.some(o => o.label.toLowerCase() === label.toLowerCase())) {
    alert(`Option "${label}" already exists in this group.`);
    return;
  }

  group.options.push({
    tempId: Date.now() + Math.random(),
    label,
    colorHex,
    sortOrder: group.options.length
  });

  if (input) input.value = '';
  renderVariantGroups();
  generateVariantMatrix();
}
window.addVariantOption = addVariantOption;

function removeVariantOption(groupIndex, optionIndex) {
  const group = state.variantGroups[groupIndex];
  if (!group) return;
  group.options.splice(optionIndex, 1);
  renderVariantGroups();
  generateVariantMatrix();
}
window.removeVariantOption = removeVariantOption;

function renderVariantGroups() {
  const container = document.getElementById('variantGroupsList');
  if (!container) return;

  if (state.variantGroups.length === 0) {
    container.innerHTML = '<div style="color: var(--ak-text-muted); font-size: 13px; text-align: center; padding: 12px;">No variant groups defined yet. Click a button above to add Color or Size options.</div>';
    return;
  }

  container.innerHTML = state.variantGroups.map((g, gIdx) => `
    <div class="variant-group-card">
      <div class="variant-group-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="text" class="form-input" style="height: 32px; font-weight: 700; width: 140px; font-size: 13px;" value="${g.name}" onchange="state.variantGroups[${gIdx}].name = this.value; generateVariantMatrix();">
          <span style="font-size: 11px; color: var(--ak-text-muted); text-transform: uppercase; letter-spacing: 0.5px;">(${g.type === 'color' ? 'Color Swatches' : 'Text / Sizing'})</span>
        </div>
        <button type="button" class="btn-danger" style="padding: 4px 10px; font-size: 11px;" onclick="removeVariantGroup(${gIdx})">Remove Group</button>
      </div>

      <!-- Option Chips -->
      <div class="variant-chip-list">
        ${g.options.length === 0 ? '<span style="font-size: 12px; color: var(--ak-text-muted);">No options added yet.</span>' : ''}
        ${g.options.map((opt, oIdx) => `
          <div class="variant-chip">
            ${g.type === 'color' && opt.colorHex ? `<span class="variant-color-dot" style="background: ${opt.colorHex};"></span>` : ''}
            <span>${opt.label}</span>
            <button type="button" class="variant-chip-remove" onclick="removeVariantOption(${gIdx}, ${oIdx})" title="Remove option">&times;</button>
          </div>
        `).join('')}
      </div>

      <!-- Add Option Inline Form -->
      <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
        ${g.type === 'color' ? `<input type="color" id="optColor_${gIdx}" value="#1A1A1A" class="variant-color-input" title="Choose swatch color">` : ''}
        <input type="text" id="optInput_${gIdx}" class="form-input" style="height: 32px; font-size: 12px; flex: 1; max-width: 260px;" placeholder="${g.type === 'color' ? 'Color name (e.g. Matte Black)' : 'Size label (e.g. 3/4 Size, 7A)'}" onkeydown="if (event.key === 'Enter') { event.preventDefault(); addVariantOption(${gIdx}); }">
        <button type="button" class="btn-secondary" style="height: 32px; padding: 0 12px; font-size: 12px;" onclick="addVariantOption(${gIdx})">Add</button>
      </div>
    </div>
  `).join('');
}
window.renderVariantGroups = renderVariantGroups;

function generateVariantMatrix() {
  const container = document.getElementById('variantMatrixContainer');
  const countSpan = document.getElementById('variantMatrixCount');
  if (!container) return;

  const activeGroups = state.variantGroups.filter(g => g.options && g.options.length > 0);

  if (activeGroups.length === 0) {
    container.style.display = 'none';
    state.variantMatrix = [];
    return;
  }

  container.style.display = 'block';

  function cartesian(arrays) {
    return arrays.reduce((acc, curr) => {
      const res = [];
      acc.forEach(a => {
        curr.forEach(b => {
          res.push(a.concat([b]));
        });
      });
      return res;
    }, [[]]);
  }

  const optionArrays = activeGroups.map(g => g.options.map(opt => ({
    id: opt.id || opt.tempId,
    label: opt.label,
    groupName: g.name
  })));

  const combinations = cartesian(optionArrays);

  const existingMap = new Map();
  state.variantMatrix.forEach(v => {
    existingMap.set(v.optionLabels, v);
  });

  const parentMrp = parseFloat(document.getElementById('productMrp')?.value) || null;
  const parentSelling = parseFloat(document.getElementById('productSellingPrice')?.value) || null;

  state.variantMatrix = combinations.map((combo, idx) => {
    const labelStr = combo.map(c => c.label).join(' / ');
    const existing = existingMap.get(labelStr);

    let mrpVal = existing?.mrp != null ? existing.mrp : null;
    let sellingVal = existing?.sellingPrice != null ? existing.sellingPrice : (existing?.priceOverride != null ? existing.priceOverride : null);

    if (idx === 0) {
      if (mrpVal == null && parentMrp) mrpVal = parentMrp;
      if (sellingVal == null && parentSelling) sellingVal = parentSelling;
    }

    return {
      skuSuffix: existing?.skuSuffix || '',
      optionIds: combo.map(c => c.id),
      optionLabels: labelStr,
      mrp: mrpVal,
      sellingPrice: sellingVal,
      priceOverride: sellingVal,
      stock: existing?.stock != null ? existing.stock : 10,
      isActive: existing?.isActive !== false
    };
  });

  if (countSpan) countSpan.textContent = `(${state.variantMatrix.length} combinations)`;
  renderVariantMatrix();
  syncVariantStockToProduct();
}
window.generateVariantMatrix = generateVariantMatrix;

function updateVariantRowDisplay(index) {
  const v = state.variantMatrix[index];
  if (!v) return;

  const parentMrp = parseFloat(document.getElementById('productMrp')?.value) || 0;
  const parentSelling = parseFloat(document.getElementById('productSellingPrice')?.value) || 0;

  const effectiveMrp = (v.mrp != null && v.mrp !== '') ? Number(v.mrp) : parentMrp;
  const effectiveSelling = (v.sellingPrice != null && v.sellingPrice !== '') ? Number(v.sellingPrice) : ((v.priceOverride != null && v.priceOverride !== '') ? Number(v.priceOverride) : parentSelling);

  const hasError = effectiveMrp > 0 && effectiveSelling > 0 && effectiveSelling > effectiveMrp;
  const discountPct = calculateDiscountPercent(effectiveMrp, effectiveSelling);

  const badgeEl = document.getElementById(`variantDiscount_${index}`);
  if (badgeEl) {
    if (hasError) {
      badgeEl.innerHTML = '<span class="badge-discount" style="background:#FEE2E2; color:#DC2626; font-size:11px; padding:2px 6px; font-weight:700;">Invalid</span>';
    } else if (discountPct > 0) {
      badgeEl.innerHTML = `<span class="badge-discount" style="background:var(--ak-success-soft); color:var(--ak-success); font-size:11px; padding:2px 6px; font-weight:700;">${discountPct}% OFF</span>`;
    } else {
      badgeEl.innerHTML = '<span style="color:var(--ak-text-muted); font-size:11px;">â€”</span>';
    }
  }

  const errEl = document.getElementById(`variantError_${index}`);
  if (errEl) {
    errEl.innerHTML = hasError ? '<div style="color:#DC2626; font-size:11px; font-weight:600; margin-top:3px;">Selling price exceeds MRP</div>' : '';
  }

  const rowEl = document.getElementById(`variantRow_${index}`);
  if (rowEl) {
    rowEl.style.background = hasError ? '#FEF2F2' : '';
    if (hasError) {
      rowEl.classList.add('variant-row-error');
    } else {
      rowEl.classList.remove('variant-row-error');
    }
  }
}
window.updateVariantRowDisplay = updateVariantRowDisplay;

function handleVariantFieldChange(index, field, value) {
  if (!state.variantMatrix[index]) return;
  const trimmed = typeof value === 'string' ? value.trim() : value;
  const num = (trimmed !== '' && !isNaN(parseFloat(trimmed))) ? parseFloat(trimmed) : null;
  state.variantMatrix[index][field] = num;

  if (field === 'sellingPrice') {
    state.variantMatrix[index].priceOverride = num;
  }

  // Auto-connect first variant's MRP and Selling Price directly to parent product
  if (index === 0) {
    if (field === 'mrp') {
      const pMrp = document.getElementById('productMrp');
      if (pMrp) pMrp.value = num != null ? num : '';
    } else if (field === 'sellingPrice') {
      const pSelling = document.getElementById('productSellingPrice');
      if (pSelling) pSelling.value = num != null ? num : '';
    }
    if (typeof updateProductDiscountDisplay === 'function') {
      updateProductDiscountDisplay();
    }
  }

  updateVariantRowDisplay(index);
}
window.handleVariantFieldChange = handleVariantFieldChange;

function renderVariantMatrix() {
  const tbody = document.getElementById('variantMatrixTbody');
  if (!tbody) return;

  const parentMrp = parseFloat(document.getElementById('productMrp')?.value) || 0;
  const parentSelling = parseFloat(document.getElementById('productSellingPrice')?.value) || 0;

  tbody.innerHTML = state.variantMatrix.map((v, idx) => {
    const effectiveMrp = (v.mrp != null && v.mrp !== '') ? Number(v.mrp) : parentMrp;
    const effectiveSelling = (v.sellingPrice != null && v.sellingPrice !== '') ? Number(v.sellingPrice) : ((v.priceOverride != null && v.priceOverride !== '') ? Number(v.priceOverride) : parentSelling);

    const hasError = effectiveMrp > 0 && effectiveSelling > 0 && effectiveSelling > effectiveMrp;
    const discountPct = calculateDiscountPercent(effectiveMrp, effectiveSelling);

    let discountBadgeHtml = '<span style="color:var(--ak-text-muted); font-size:11px;">â€”</span>';
    if (hasError) {
      discountBadgeHtml = '<span class="badge-discount" style="background:#FEE2E2; color:#DC2626; font-size:11px; padding:2px 6px; font-weight:700;">Invalid</span>';
    } else if (discountPct > 0) {
      discountBadgeHtml = `<span class="badge-discount" style="background:var(--ak-success-soft); color:var(--ak-success); font-size:11px; padding:2px 6px; font-weight:700;">${discountPct}% OFF</span>`;
    }

    const rowErrorHtml = `<div id="variantError_${idx}">${hasError ? '<div style="color:#DC2626; font-size:11px; font-weight:600; margin-top:3px;">Selling price exceeds MRP</div>' : ''}</div>`;

    return `
    <tr id="variantRow_${idx}" class="${hasError ? 'variant-row-error' : ''}" style="${hasError ? 'background: #FEF2F2;' : ''}">
      <td>
        <strong>${escapeHtml(v.optionLabels)}</strong>
        ${idx === 0 ? '<span style="display:inline-block; font-size:10px; background:#EFF6FF; color:#1D4ED8; padding:2px 6px; border-radius:3px; margin-left:6px; font-weight:700; border: 1px solid #BFDBFE;">Default / Main Product</span>' : ''}
        ${rowErrorHtml}
      </td>
      <td>
        <input type="text" class="form-input" style="height: 30px; font-size: 12px; width: 90px;" value="${v.skuSuffix || ''}" placeholder="e.g. -BLK" onchange="state.variantMatrix[${idx}].skuSuffix = this.value.trim();">
      </td>
      <td>
        <input type="number" id="variantInputMrp_${idx}" class="form-input" style="height: 30px; font-size: 12px; width: 110px; ${hasError ? 'border-color:#DC2626; background:#FFF1F2;' : ''}" value="${v.mrp != null ? v.mrp : ''}" placeholder="${parentMrp ? 'â‚¹' + parentMrp : 'MRP'}" min="1" step="1" oninput="handleVariantFieldChange(${idx}, 'mrp', this.value)">
      </td>
      <td>
        <input type="number" id="variantInputSp_${idx}" class="form-input" style="height: 30px; font-size: 12px; width: 110px; ${hasError ? 'border-color:#DC2626; background:#FFF1F2;' : ''}" value="${v.sellingPrice != null ? v.sellingPrice : ''}" placeholder="${parentSelling ? 'â‚¹' + parentSelling : 'Selling'}" min="1" step="1" oninput="handleVariantFieldChange(${idx}, 'sellingPrice', this.value)">
      </td>
      <td id="variantDiscount_${idx}" style="text-align: center; vertical-align: middle;">
        ${discountBadgeHtml}
      </td>
      <td>
        <input type="number" class="form-input" style="height: 30px; font-size: 12px; width: 75px;" value="${v.stock}" min="0" step="1" oninput="updateVariantStock(${idx}, this.value)">
      </td>
      <td style="text-align: center; vertical-align: middle;">
        <input type="checkbox" ${v.isActive ? 'checked' : ''} onchange="state.variantMatrix[${idx}].isActive = this.checked; syncVariantStockToProduct();">
      </td>
    </tr>
  `;
  }).join('');
}
window.renderVariantMatrix = renderVariantMatrix;

function updateVariantStock(index, value) {
  if (state.variantMatrix[index]) {
    state.variantMatrix[index].stock = Math.max(0, parseInt(value, 10) || 0);
    syncVariantStockToProduct();
  }
}
window.updateVariantStock = updateVariantStock;

function applyBulkVariantStock() {
  const bulkInput = document.getElementById('bulkVariantStockInput');
  const val = Math.max(0, parseInt(bulkInput?.value, 10) || 0);
  state.variantMatrix.forEach(v => { v.stock = val; });
  renderVariantMatrix();
  syncVariantStockToProduct();
}
window.applyBulkVariantStock = applyBulkVariantStock;

function syncVariantStockToProduct() {
  if (!state.hasVariants) return;
  const totalStock = state.variantMatrix.reduce((acc, v) => acc + (v.isActive ? v.stock : 0), 0);
  const stockInput = document.getElementById('productStock');
  const availSelect = document.getElementById('productAvailability');
  if (stockInput) stockInput.value = totalStock;
  if (availSelect && availSelect.value !== '2') availSelect.value = totalStock > 0 ? '1' : '0';
}
window.syncVariantStockToProduct = syncVariantStockToProduct;

// -------------------------------------------------------------
// HOMEPAGE HERO SLIDESHOW & FEATURED PRODUCTS CONTROLLER
// -------------------------------------------------------------
async function loadHomepageManager() {
  const slidesContainer = document.getElementById('heroSlidesListContainer');
  if (slidesContainer) {
    slidesContainer.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--ak-text-muted);">Loading hero slides...</div>';
  }

  // 1. Fetch Hero Slides
  try {
    const res = await adminFetch('/api/hero-slides');
    if (res.ok) {
      const data = await res.json();
      state.heroSlides = data.slides || [];
    } else {
      const local = localStorage.getItem('audioking_hero_slides');
      if (local) state.heroSlides = JSON.parse(local);
    }
  } catch (e) {
    console.warn('Failed to load hero slides from API:', e);
    const local = localStorage.getItem('audioking_hero_slides');
    if (local) {
      try { state.heroSlides = JSON.parse(local); } catch (err) {}
    }
  }

  // 2. Fetch Featured Settings (Locked Product IDs)
  try {
    const res = await adminFetch('/api/featured-settings');
    if (res.ok) {
      const data = await res.json();
      state.lockedFeaturedIds = (data.lockedProductIds || data.locked_product_ids || []).map(String);
    } else {
      const local = localStorage.getItem('audioking_locked_featured');
      if (local) state.lockedFeaturedIds = JSON.parse(local).map(String);
    }
  } catch (e) {
    console.warn('Failed to load featured settings from API:', e);
    const local = localStorage.getItem('audioking_locked_featured');
    if (local) {
      try { state.lockedFeaturedIds = JSON.parse(local).map(String); } catch (err) {}
    }
  }

  // 3. Ensure Products are loaded for featured manager
  if (!state.products || state.products.length === 0) {
    try {
      const pRes = await adminFetch('/api/admin/products');
      if (pRes.ok) {
        const pData = await pRes.json();
        state.products = Array.isArray(pData.products) ? pData.products : (Array.isArray(pData) ? pData : []);
      }
    } catch (e) {}

    if (!state.products || state.products.length === 0) {
      try {
        const base = getAdminApiBase();
        const pubRes = await fetch(`${base}/api/products?limit=500`);
        if (pubRes.ok) {
          const pubData = await pubRes.json().catch(() => ({}));
          state.products = pubData.products || (Array.isArray(pubData) ? pubData : []);
        }
      } catch (e) {}
    }
  }

  // Render both sections
  renderHeroSlidesAdmin();
  loadFeaturedManager();
}

function renderHeroSlidesAdmin() {
  const container = document.getElementById('heroSlidesListContainer');
  const countBadge = document.getElementById('heroSlidesCountBadge');
  if (!container) return;

  const slides = state.heroSlides || [];
  if (countBadge) {
    countBadge.textContent = `${slides.length} Slide${slides.length === 1 ? '' : 's'}`;
  }

  if (slides.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px; background: var(--ak-card-sub); border-radius: var(--ak-radius); border: 1px dashed var(--ak-border);">
        <p style="color: var(--ak-text-muted); margin-bottom: 12px; font-size: 14px;">No hero slides found. Add your first slide to display on the storefront!</p>
        <button type="button" class="btn-primary" onclick="openAddHeroSlideModal()">+ Add First Slide</button>
      </div>
    `;
    return;
  }

  container.innerHTML = slides.map((slide, index) => {
    const thumbUrl = resolveAdminThumb(slide.image_url);
    const isActive = slide.is_active !== 0 && slide.is_active !== false && slide.is_active !== '0';
    const isFirst = index === 0;
    const isLast = index === slides.length - 1;

    return `
      <div class="hero-slide-admin-card" data-slide-id="${slide.id}">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding-right: 6px;">
          <button type="button" class="btn-secondary" style="padding: 3px 6px; font-size: 11px; min-width: 28px;" ${isFirst ? 'disabled' : ''} onclick="moveHeroSlide('${slide.id}', -1)" title="Move slide up">â–²</button>
          <span style="font-size: 11px; font-weight: 700; color: var(--ak-text-muted);">#${index + 1}</span>
          <button type="button" class="btn-secondary" style="padding: 3px 6px; font-size: 11px; min-width: 28px;" ${isLast ? 'disabled' : ''} onclick="moveHeroSlide('${slide.id}', 1)" title="Move slide down">â–¼</button>
        </div>

        <div class="hero-slide-admin-thumb" style="background-image: url('${thumbUrl}');">
          ${!isActive ? '<span style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); color: #FFF; font-size: 9.5px; font-weight: 700; padding: 2px 5px; border-radius: 4px;">INACTIVE</span>' : ''}
        </div>

        <div class="hero-slide-admin-info">
          ${slide.eyebrow ? `<div class="hero-slide-admin-eyebrow">${escapeHtml(slide.eyebrow)}</div>` : ''}
          <div class="hero-slide-admin-title">
            <span>${escapeHtml(slide.title || 'Untitled Slide')}</span>
            ${slide.accent_text ? `<span style="color: var(--ak-orange); margin-left: 6px;">${escapeHtml(slide.accent_text)}</span>` : ''}
          </div>
          ${slide.subtitle ? `<div class="hero-slide-admin-sub">${escapeHtml(slide.subtitle)}</div>` : ''}
          <div style="font-size: 11px; color: var(--ak-text-muted); margin-top: 6px; display: flex; gap: 12px; flex-wrap: wrap;">
            <span><strong>Button:</strong> ${escapeHtml(slide.cta_text || 'None')}</span>
            <span><strong>Link:</strong> <code>${escapeHtml(slide.cta_link || '#')}</code></span>
            <span><strong>Status:</strong> ${isActive ? '<span style="color: var(--ak-success); font-weight: 600;">Active on Storefront</span>' : '<span style="color: var(--ak-text-muted);">Hidden</span>'}</span>
          </div>
        </div>

        <div class="hero-slide-admin-actions">
          <button type="button" class="btn-secondary" style="padding: 6px 12px; font-size: 12.5px;" onclick="openEditHeroSlideModal('${slide.id}')">âœï¸ Edit</button>
          <button type="button" class="btn-danger" style="padding: 6px 10px; font-size: 12.5px;" onclick="deleteHeroSlide('${slide.id}')">ðŸ—‘ï¸ Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateHeroSlidePreview() {
  const urlInput = document.getElementById('heroSlideImageUrl');
  const preview = document.getElementById('heroSlideImagePreview');
  if (!preview) return;
  const val = urlInput ? urlInput.value.trim() : '';
  if (val) {
    const resolved = resolveAdminThumb(val);
    preview.style.backgroundImage = `url('${resolved}')`;
    preview.innerHTML = '';
  } else {
    preview.style.backgroundImage = 'none';
    preview.innerHTML = '<span>No image selected</span>';
  }
}

function openAddHeroSlideModal() {
  const form = document.getElementById('heroSlideForm');
  if (form) form.reset();
  const idInput = document.getElementById('heroSlideId');
  if (idInput) idInput.value = '';
  const titleEl = document.getElementById('heroSlideModalTitle');
  if (titleEl) titleEl.textContent = 'Add New Hero Slide';
  const activeCheck = document.getElementById('heroSlideIsActive');
  if (activeCheck) activeCheck.checked = true;
  const saveBtn = document.getElementById('heroSlideSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Save Slide';
  updateHeroSlidePreview();
  openModal('heroSlideModal');
}

function openEditHeroSlideModal(slideId) {
  const slide = (state.heroSlides || []).find(s => String(s.id) === String(slideId));
  if (!slide) return alert('Slide not found');

  document.getElementById('heroSlideId').value = slide.id;
  document.getElementById('heroSlideImageUrl').value = slide.image_url || '';
  document.getElementById('heroSlideEyebrow').value = slide.eyebrow || '';
  document.getElementById('heroSlideAccent').value = slide.accent_text || '';
  document.getElementById('heroSlideTitle').value = slide.title || '';
  document.getElementById('heroSlideSubtitle').value = slide.subtitle || '';
  document.getElementById('heroSlideCtaText').value = slide.cta_text || '';
  document.getElementById('heroSlideCtaLink').value = slide.cta_link || '';
  document.getElementById('heroSlideIsActive').checked = slide.is_active !== 0 && slide.is_active !== false && slide.is_active !== '0';
  document.getElementById('heroSlideModalTitle').textContent = 'Edit Hero Slide';
  document.getElementById('heroSlideSaveBtn').textContent = 'Update Slide';

  updateHeroSlidePreview();
  openModal('heroSlideModal');
}

function closeHeroSlideModal() {
  const m = document.getElementById('heroSlideModal');
  if (m) m.classList.remove('open');
  if (state.activeModal === m) state.activeModal = null;
}

async function handleHeroSlideFileUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('images', file);

  const preview = document.getElementById('heroSlideImagePreview');
  if (preview) preview.innerHTML = '<span>Uploading image...</span>';

  try {
    const res = await adminFetch('/api/admin/upload/images', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.urls && data.urls.length > 0) {
      document.getElementById('heroSlideImageUrl').value = data.urls[0];
      updateHeroSlidePreview();
    } else {
      alert(data.error || 'Failed to upload hero slide image');
      updateHeroSlidePreview();
    }
  } catch (err) {
    alert('Network error while uploading image.');
    updateHeroSlidePreview();
  }
}

async function handleHeroSlideFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('heroSlideId').value.trim();
  const imageUrl = document.getElementById('heroSlideImageUrl').value.trim();
  const eyebrow = document.getElementById('heroSlideEyebrow').value.trim();
  const accentText = document.getElementById('heroSlideAccent').value.trim();
  const title = document.getElementById('heroSlideTitle').value.trim();
  const subtitle = document.getElementById('heroSlideSubtitle').value.trim();
  const ctaText = document.getElementById('heroSlideCtaText').value.trim();
  const ctaLink = document.getElementById('heroSlideCtaLink').value.trim();
  const isActive = document.getElementById('heroSlideIsActive').checked ? 1 : 0;

  if (!imageUrl || !title) {
    return alert('Please provide an image URL and a headline title.');
  }

  const payload = {
    image_url: imageUrl,
    eyebrow,
    accent_text: accentText,
    title,
    subtitle,
    cta_text: ctaText,
    cta_link: ctaLink,
    is_active: isActive
  };

  const saveBtn = document.getElementById('heroSlideSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    let res;
    if (id) {
      res = await adminFetch(`/api/admin/hero-slides/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await adminFetch('/api/admin/hero-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok) {
      closeHeroSlideModal();
      await loadHomepageManager();
      try {
        localStorage.setItem('audioking_hero_slides', JSON.stringify(state.heroSlides));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:hero-sync'));
    } else {
      alert(data.error || 'Failed to save hero slide');
    }
  } catch (err) {
    alert('Network error while saving hero slide');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = id ? 'Update Slide' : 'Save Slide'; }
  }
}

async function deleteHeroSlide(slideId) {
  if (!confirm('Are you sure you want to delete this hero slide?')) return;
  try {
    const res = await adminFetch(`/api/admin/hero-slides/${slideId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      await loadHomepageManager();
      try {
        localStorage.setItem('audioking_hero_slides', JSON.stringify(state.heroSlides));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:hero-sync'));
    } else {
      alert(data.error || 'Failed to delete hero slide');
    }
  } catch (err) {
    alert('Network error while deleting hero slide');
  }
}

async function moveHeroSlide(slideId, delta) {
  const slides = [...(state.heroSlides || [])];
  const idx = slides.findIndex(s => String(s.id) === String(slideId));
  if (idx < 0) return;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= slides.length) return;

  const temp = slides[idx];
  slides[idx] = slides[targetIdx];
  slides[targetIdx] = temp;

  const slideIds = slides.map(s => s.id);

  try {
    const res = await adminFetch('/api/admin/hero-slides/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideIds })
    });
    if (res.ok) {
      state.heroSlides = slides;
      renderHeroSlidesAdmin();
      try {
        localStorage.setItem('audioking_hero_slides', JSON.stringify(state.heroSlides));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:hero-sync'));
    } else {
      alert('Failed to reorder hero slides');
    }
  } catch (err) {
    alert('Network error while reordering hero slides');
  }
}

// -------------------------------------------------------------
// FEATURED PRODUCTS & LOCKING MANAGER
// -------------------------------------------------------------
function loadFeaturedManager() {
  renderActiveHomepageFeaturedProducts();
  renderLockedFeaturedProducts();
  renderPopularFeaturedProducts();
  populateFeaturedCatalogDropdown();
}

const MAX_FEATURED_SLOTS = 10;

function getFeaturedAutoCandidates(excludeSet) {
  const allProducts = state.products || [];
  const candidates = allProducts.filter(p => !excludeSet.has(String(p.id)));
  candidates.sort((a, b) => {
    const aScore = (Number(a.clicks) || 0) * 3 + (Number(a.views || a.impressions) || 0);
    const bScore = (Number(b.clicks) || 0) * 3 + (Number(b.views || b.impressions) || 0);
    return bScore - aScore;
  });
  return candidates;
}

/**
 * Computes exactly what the storefront shows in its 10 featured slots:
 * pinned products first (in admin order), then popularity auto-fill.
 */
function getFeaturedSlotItems() {
  const allProducts = state.products || [];
  const prodMap = new Map();
  allProducts.forEach(p => prodMap.set(String(p.id), p));

  const lockedIds = (state.lockedFeaturedIds || []).map(String).filter(id => prodMap.has(id)).slice(0, MAX_FEATURED_SLOTS);
  const items = lockedIds.map(id => ({ product: prodMap.get(id), isLocked: true }));
  const remaining = MAX_FEATURED_SLOTS - items.length;
  if (remaining > 0) {
    getFeaturedAutoCandidates(new Set(lockedIds)).slice(0, remaining).forEach(p => items.push({ product: p, isLocked: false }));
  }
  return items;
}

async function persistFeaturedList(list) {
  const clean = [];
  list.map(String).forEach(id => { if (id && !clean.includes(id)) clean.push(id); });
  const finalList = clean.slice(0, MAX_FEATURED_SLOTS);
  try {
    const res = await adminFetch('/api/admin/featured-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedProductIds: finalList })
    });
    if (!res.ok) {
      alert('Failed to update featured products.');
      return false;
    }
    state.lockedFeaturedIds = finalList;
    try { localStorage.setItem('audioking_locked_featured', JSON.stringify(finalList)); } catch (err) {}
    window.dispatchEvent(new CustomEvent('ak:featured-sync', { detail: { lockedProductIds: finalList } }));
    loadFeaturedManager();
    return true;
  } catch (err) {
    alert('Network error while updating featured products: ' + err.message);
    return false;
  }
}

/** Current visible slot order as product ids (pins every slot so admin has full control). */
function materializeFeaturedSlotIds() {
  return getFeaturedSlotItems().map(it => String(it.product.id));
}

async function moveFeaturedSlot(productId, delta) {
  const list = materializeFeaturedSlotIds();
  const idx = list.indexOf(String(productId));
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= list.length) return;
  [list[idx], list[target]] = [list[target], list[idx]];
  await persistFeaturedList(list);
}

async function setFeaturedSlotPosition(productId, newPos) {
  const list = materializeFeaturedSlotIds();
  const idx = list.indexOf(String(productId));
  const pos = parseInt(newPos, 10);
  if (idx < 0 || isNaN(pos)) { renderActiveHomepageFeaturedProducts(); return; }
  const target = Math.min(Math.max(pos - 1, 0), list.length - 1);
  if (target === idx) { renderActiveHomepageFeaturedProducts(); return; }
  const [item] = list.splice(idx, 1);
  list.splice(target, 0, item);
  await persistFeaturedList(list);
}

async function removeFeaturedSlot(productId) {
  const pid = String(productId);
  const prod = (state.products || []).find(p => String(p.id) === pid);
  if (!confirm(`Remove "${prod ? prod.name : pid}" from the homepage featured products?`)) return;
  const list = materializeFeaturedSlotIds().filter(id => id !== pid);
  // Fill the freed slot with the next most popular product (never the one just removed)
  const exclude = new Set([...list, pid]);
  const next = getFeaturedAutoCandidates(exclude)[0];
  if (next) list.push(String(next.id));
  await persistFeaturedList(list);
}

async function pinFeaturedSlot(productId) {
  // Pin every slot up to and including this one, preserving current order
  const list = materializeFeaturedSlotIds();
  const idx = list.indexOf(String(productId));
  if (idx < 0) return;
  const locked = (state.lockedFeaturedIds || []).map(String);
  const newList = [...new Set([...locked, ...list.slice(0, idx + 1)])];
  await persistFeaturedList(newList);
}

async function autoFillFeaturedSlots() {
  const list = materializeFeaturedSlotIds();
  if (!list.length) { alert('No products available in catalog.'); return; }
  const ok = await persistFeaturedList(list);
  if (ok) alert(`âœ“ All ${list.length} featured slots are now pinned in the current order.`);
}

async function clearFeaturedPins() {
  if (!confirm('Clear all pinned featured products? The homepage will fall back to the most popular products automatically.')) return;
  await persistFeaturedList([]);
}

function openFeaturedSlotPicker(slotNo) {
  const seq = document.getElementById('adminNewFeaturedSequence');
  if (seq) seq.value = slotNo;
  const dd = document.getElementById('adminFeaturedCatalogDropdown');
  if (dd) {
    dd.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => dd.focus(), 300);
  }
}

function renderActiveHomepageFeaturedProducts() {
  const container = document.getElementById('activeHomepageFeaturedContainer');
  const slotsBadge = document.getElementById('activeFeaturedSlotsBadge');
  if (!container) return;

  const items = getFeaturedSlotItems();
  const pinnedCount = items.filter(i => i.isLocked).length;

  if (slotsBadge) {
    slotsBadge.textContent = `${items.length} / ${MAX_FEATURED_SLOTS} Slots (${pinnedCount} Pinned, ${items.length - pinnedCount} Auto-filled)`;
  }

  const toolbar = `
    <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 10px 12px; background: #F8FAFC; border: 1px dashed var(--ak-border); border-radius: 8px;">
      <span style="font-size: 12px; color: var(--ak-text-secondary); flex: 1; min-width: 220px;">
        Change a slot number, use â–²/â–¼ to re-sequence, or ðŸ—‘ï¸ to remove. Up to <strong>${MAX_FEATURED_SLOTS}</strong> products are shown on the homepage at a time.
      </span>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="btn-primary" style="padding: 6px 12px; font-size: 12px; background: #2563EB;" onclick="autoFillFeaturedSlots()">âš¡ Auto-Fill &amp; Pin All 10 Slots</button>
        <button type="button" class="btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="clearFeaturedPins()" ${pinnedCount === 0 ? 'disabled' : ''}>ðŸ§¹ Clear All Pins</button>
      </div>
    </div>`;

  const rows = [];
  for (let i = 0; i < MAX_FEATURED_SLOTS; i++) {
    const item = items[i];
    const slotNo = i + 1;
    if (!item) {
      rows.push(`
        <div class="locked-product-item featured-slot-empty" style="background: #FFFFFF; border: 1.5px dashed #CBD5E1; justify-content: space-between;">
          <span style="font-size: 13px; font-weight: 800; color: #94A3B8;">Slot #${slotNo} â€” Empty</span>
          <button type="button" class="btn-secondary" style="padding: 5px 10px; font-size: 11.5px;" onclick="openFeaturedSlotPicker(${slotNo})">+ Select Product</button>
        </div>`);
      continue;
    }
    const prod = item.product;
    const pid = String(prod.id).replace(/'/g, "\\'");
    const isLocked = item.isLocked;
    const thumb = resolveAdminThumb(prod.image || (prod.images && prod.images[0]));
    const clicks = Number(prod.clicks) || 0;
    const impressions = Number(prod.views || prod.impressions) || 0;
    rows.push(`
      <div class="locked-product-item featured-slot-row" style="background: ${isLocked ? '#F0FDF4' : '#F8FAFC'}; border: 1px solid ${isLocked ? '#BBF7D0' : 'var(--ak-border)'};">
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <button type="button" class="btn-secondary" style="padding: 1px 6px; font-size: 10px; line-height: 1.2;" ${i === 0 ? 'disabled' : ''} onclick="moveFeaturedSlot('${pid}', -1)" title="Move up">â–²</button>
            <div style="display: flex; align-items: center; gap: 2px;" title="Set slot position (1 to ${items.length})">
              <span style="font-size: 11px; font-weight: 700; color: #475569;">#</span>
              <input type="number" min="1" max="${items.length}" value="${slotNo}" onchange="setFeaturedSlotPosition('${pid}', this.value)" style="width: 40px; text-align: center; font-weight: 800; font-size: 12px; border: 1.5px solid #CBD5E1; border-radius: 4px; padding: 2px 0; color: #1E40AF; background: #EFF6FF;">
            </div>
            <button type="button" class="btn-secondary" style="padding: 1px 6px; font-size: 10px; line-height: 1.2;" ${i === items.length - 1 ? 'disabled' : ''} onclick="moveFeaturedSlot('${pid}', 1)" title="Move down">â–¼</button>
          </div>
          <img src="${thumb}" alt="${escapeHtml(prod.name)}" class="locked-product-thumb" onerror="this.src='${resolveAdminThumb('')}'">
        </div>

        <div class="locked-product-info">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px; flex-wrap: wrap;">
            <span class="locked-product-title" title="${escapeHtml(prod.name)}" style="margin-bottom:0;">${escapeHtml(prod.name)}</span>
            ${isLocked
              ? `<span style="background: #DCFCE7; color: #166534; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 4px; border: 1px solid #86EFAC;">ðŸ”’ PINNED</span>`
              : `<span style="background: #E0F2FE; color: #0369A1; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1px solid #BAE6FD;">ðŸ”¥ AUTO-FILL</span>`}
          </div>
          <div class="locked-product-meta">
            ${prod.brand ? `<span>${escapeHtml(prod.brand)}</span> â€¢ ` : ''}
            <span>${formatINR(prod.price)}</span> â€¢
            <span style="color: var(--ak-orange);">${clicks} clicks / ${impressions} views</span>
          </div>
        </div>

        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          ${isLocked ? '' : `<button type="button" class="btn-primary" style="padding: 5px 10px; font-size: 11.5px; white-space: nowrap; background: #2563EB;" onclick="pinFeaturedSlot('${pid}')" title="Pin this product in this slot">ðŸ“Œ Pin</button>`}
          <button type="button" class="btn-danger" style="padding: 5px 10px; font-size: 11.5px; white-space: nowrap;" onclick="removeFeaturedSlot('${pid}')" title="Remove from featured">ðŸ—‘ï¸ Remove</button>
        </div>
      </div>`);
  }

  container.innerHTML = `${toolbar}<div style="display: flex; flex-direction: column; gap: 8px;">${rows.join('')}</div>`;
}

function renderLockedFeaturedProducts() {
  const container = document.getElementById('lockedProductsListContainer');
  const countBadge = document.getElementById('lockedFeaturedCountBadge');
  if (!container) return;

  const lockedIds = (state.lockedFeaturedIds || []).map(String);
  if (countBadge) {
    countBadge.textContent = `${lockedIds.length} / ${MAX_FEATURED_SLOTS} Pinned`;
  }

  if (lockedIds.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--ak-text-muted); font-size: 13px;">
        ðŸ”’ No products currently locked.<br>
        <span style="font-size: 12px;">Search above or click "+ Lock / Pin" on any popular item to lock it to the top of the homepage carousel.</span>
      </div>
    `;
    return;
  }

  const allProducts = state.products || [];
  const prodMap = new Map();
  allProducts.forEach(p => prodMap.set(String(p.id), p));

  container.innerHTML = lockedIds.map((pid, idx) => {
    const product = prodMap.get(String(pid)) || { id: pid, name: `Product #${pid}`, brand: '', price: 0, image: '' };
    const thumb = resolveAdminThumb(product.image || (product.images && product.images[0]));
    const isFirst = idx === 0;
    const isLast = idx === lockedIds.length - 1;

    return `
      <div class="locked-product-item">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 48px; flex-shrink: 0;">
          <button type="button" class="btn-secondary" style="padding: 2px 6px; font-size: 10px; line-height: 1;" ${isFirst ? 'disabled' : ''} onclick="moveLockedProduct('${pid}', -1)" title="Move up priority">â–²</button>
          <div style="display: flex; align-items: center; gap: 2px;" title="Set exact sequence position (1 to ${lockedIds.length})">
            <span style="font-size: 11px; font-weight: 700; color: #475569;">#</span>
            <input type="number" min="1" max="${lockedIds.length}" value="${idx + 1}" onchange="changeFeaturedSequence('${pid}', this.value)" style="width: 40px; text-align: center; font-weight: 800; font-size: 12px; border: 1.5px solid #CBD5E1; border-radius: 4px; padding: 2px 0; color: #1E40AF; background: #EFF6FF;">
          </div>
          <button type="button" class="btn-secondary" style="padding: 2px 6px; font-size: 10px; line-height: 1;" ${isLast ? 'disabled' : ''} onclick="moveLockedProduct('${pid}', 1)" title="Move down priority">â–¼</button>
        </div>

        <img src="${thumb}" alt="${escapeHtml(product.name)}" class="locked-product-thumb" onerror="this.src='${resolveAdminThumb('')}'">

        <div class="locked-product-info">
          <div class="locked-product-title" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</div>
          <div class="locked-product-meta">
            ${product.brand ? `<span>${escapeHtml(product.brand)}</span> â€¢ ` : ''}
            <span>${formatINR(product.price)}</span>
          </div>
        </div>

        <button type="button" class="btn-danger" style="padding: 6px 12px; font-size: 12px; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" onclick="unlockFeaturedProduct('${pid}')" title="Remove product from featured">
          ðŸ—‘ï¸ Remove
        </button>
      </div>
    `;
  }).join('');
}

function renderPopularFeaturedProducts() {
  const container = document.getElementById('impressionProductsListContainer');
  if (!container) return;

  const lockedSet = new Set((state.lockedFeaturedIds || []).map(String));
  const allProducts = state.products || [];

  const unlocked = allProducts.filter(p => !lockedSet.has(String(p.id)));

  unlocked.sort((a, b) => {
    const aScore = (Number(a.clicks) || 0) * 3 + (Number(a.views || a.impressions) || 0);
    const bScore = (Number(b.clicks) || 0) * 3 + (Number(b.views || b.impressions) || 0);
    return bScore - aScore;
  });

  const topCandidates = unlocked.slice(0, 10);

  if (topCandidates.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--ak-text-muted); font-size: 13px;">All products are already pinned!</div>';
    return;
  }

  container.innerHTML = topCandidates.map((product, idx) => {
    const thumb = resolveAdminThumb(product.image || (product.images && product.images[0]));
    const impressions = Number(product.views || product.impressions) || 0;
    const clicks = Number(product.clicks) || 0;

    return `
      <div class="locked-product-item" style="background: #FAFAFA;">
        <span style="font-size: 12px; font-weight: 700; color: var(--ak-text-muted); width: 22px; text-align: center;">${idx + 1}</span>
        <img src="${thumb}" alt="${escapeHtml(product.name)}" class="locked-product-thumb" onerror="this.src='${resolveAdminThumb('')}'">

        <div class="locked-product-info">
          <div class="locked-product-title" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</div>
          <div class="locked-product-meta">
            ${product.brand ? `<span>${escapeHtml(product.brand)}</span> â€¢ ` : ''}
            <span>${formatINR(product.price)}</span> â€¢ 
            <span style="color: var(--ak-orange);">${clicks} clicks / ${impressions} views</span>
          </div>
        </div>

        <button type="button" class="btn-primary" style="padding: 5px 10px; font-size: 11.5px; white-space: nowrap; background: #2563EB;" onclick="lockFeaturedProduct('${product.id}')" title="Pin this product to featured carousel">
          ðŸ”’ Lock / Pin
        </button>
      </div>
    `;
  }).join('');
}

function handleFeaturedSearchInput(e) {
  const query = (e.target.value || '').trim().toLowerCase();
  const dropdown = document.getElementById('featuredProductSearchResults');
  if (!dropdown) return;

  if (!query) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }

  const allProducts = state.products || [];
  const lockedSet = new Set((state.lockedFeaturedIds || []).map(String));

  const matches = allProducts.filter(p => {
    const nameMatch = (p.name || '').toLowerCase().includes(query);
    const brandMatch = (p.brand || '').toLowerCase().includes(query);
    const skuMatch = (p.sku || '').toLowerCase().includes(query);
    return nameMatch || brandMatch || skuMatch;
  }).slice(0, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div style="padding: 12px 16px; font-size: 13px; color: var(--ak-text-muted); text-align: center;">No matching products found</div>`;
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = matches.map(product => {
    const isLocked = lockedSet.has(String(product.id));
    const thumb = resolveAdminThumb(product.image || (product.images && product.images[0]));

    return `
      <div class="featured-search-item" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--ak-border); cursor: pointer;" onclick="${isLocked ? `unlockFeaturedProduct('${product.id}')` : `lockFeaturedProduct('${product.id}')`}">
        <img src="${thumb}" alt="${escapeHtml(product.name)}" style="width: 36px; height: 36px; object-fit: contain; background: #FFF; border-radius: 4px; border: 1px solid var(--ak-border-subtle);">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(product.name)}</div>
          <div style="font-size: 11.5px; color: var(--ak-text-muted);">${escapeHtml(product.brand || '')} â€¢ ${formatINR(product.price)}</div>
        </div>
        ${isLocked ? `
          <span style="font-size: 11px; font-weight: 700; color: #2563EB; background: #EFF6FF; border: 1px solid #BFDBFE; padding: 3px 8px; border-radius: 4px;">ðŸ”’ Already Locked (Click to Unlock)</span>
        ` : `
          <span style="font-size: 11px; font-weight: 700; color: #16A34A; background: #F0FDF4; border: 1px solid #BBF7D0; padding: 3px 8px; border-radius: 4px;">+ Click to Lock</span>
        `}
      </div>
    `;
  }).join('');
  dropdown.style.display = 'block';
}

function clearFeaturedProductSearch() {
  const input = document.getElementById('featuredProductSearchInput');
  if (input) input.value = '';
  const dropdown = document.getElementById('featuredProductSearchResults');
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}

async function lockFeaturedProduct(productId) {
  const current = [...(state.lockedFeaturedIds || [])].map(String);
  if (current.includes(String(productId))) return;
  if (current.length >= MAX_FEATURED_SLOTS) {
    alert(`All ${MAX_FEATURED_SLOTS} featured slots are already pinned. Remove a product first, or use "Add to Featured" with a position to replace one.`);
    return;
  }

  current.push(String(productId));

  try {
    const res = await adminFetch('/api/admin/featured-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedProductIds: current })
    });
    if (res.ok) {
      state.lockedFeaturedIds = current;
      try {
        localStorage.setItem('audioking_locked_featured', JSON.stringify(current));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:featured-sync'));
      clearFeaturedProductSearch();
      loadFeaturedManager();
    } else {
      alert('Failed to update featured settings');
    }
  } catch (err) {
    alert('Network error while locking featured product');
  }
}

async function unlockFeaturedProduct(productId) {
  const current = (state.lockedFeaturedIds || []).map(String).filter(id => id !== String(productId));

  try {
    const res = await adminFetch('/api/admin/featured-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedProductIds: current })
    });
    if (res.ok) {
      state.lockedFeaturedIds = current;
      try {
        localStorage.setItem('audioking_locked_featured', JSON.stringify(current));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:featured-sync'));
      clearFeaturedProductSearch();
      loadFeaturedManager();
    } else {
      alert('Failed to update featured settings');
    }
  } catch (err) {
    alert('Network error while unlocking featured product');
  }
}

async function moveLockedProduct(productId, delta) {
  const list = [...(state.lockedFeaturedIds || [])].map(String);
  const idx = list.findIndex(id => id === String(productId));
  if (idx < 0) return;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= list.length) return;

  const temp = list[idx];
  list[idx] = list[targetIdx];
  list[targetIdx] = temp;

  try {
    const res = await adminFetch('/api/admin/featured-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedProductIds: list })
    });
    if (res.ok) {
      state.lockedFeaturedIds = list;
      try {
        localStorage.setItem('audioking_locked_featured', JSON.stringify(list));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:featured-sync'));
      loadFeaturedManager();
    } else {
      alert('Failed to reorder locked products');
    }
  } catch (err) {
    alert('Network error while reordering locked products');
  }
}

async function changeFeaturedSequence(productId, newRank) {
  const targetRank = parseInt(newRank, 10);
  if (isNaN(targetRank) || targetRank < 1) {
    renderLockedFeaturedProducts();
    return;
  }
  const list = [...(state.lockedFeaturedIds || [])].map(String);
  const currentIdx = list.findIndex(id => id === String(productId));
  if (currentIdx < 0) return;

  const targetIdx = Math.min(Math.max(targetRank - 1, 0), list.length - 1);
  if (targetIdx === currentIdx) {
    renderLockedFeaturedProducts();
    return;
  }

  // Remove from current position and insert at target position
  const [item] = list.splice(currentIdx, 1);
  list.splice(targetIdx, 0, item);

  try {
    const res = await adminFetch('/api/admin/featured-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedProductIds: list })
    });
    if (res.ok) {
      state.lockedFeaturedIds = list;
      try {
        localStorage.setItem('audioking_locked_featured', JSON.stringify(list));
      } catch (err) {}
      window.dispatchEvent(new CustomEvent('ak:featured-sync', { detail: { lockedProductIds: list } }));
      loadFeaturedManager();
    } else {
      alert('Failed to update sequence order');
      renderLockedFeaturedProducts();
    }
  } catch (err) {
    alert('Network error while updating sequence order');
    renderLockedFeaturedProducts();
  }
}

function populateFeaturedCatalogDropdown() {
  const dropdown = document.getElementById('adminFeaturedCatalogDropdown');
  if (!dropdown) return;
  const allProducts = state.products || [];
  const lockedSet = new Set((state.lockedFeaturedIds || []).map(String));
  
  let html = '<option value="">-- Select a product from catalog to add --</option>';
  allProducts.forEach(p => {
    const isLocked = lockedSet.has(String(p.id));
    html += `<option value="${p.id}" ${isLocked ? 'disabled' : ''}>${escapeHtml(p.name)} (${p.brand || 'No Brand'}) - â‚¹${p.price} ${isLocked ? '[Already in Featured]' : ''}</option>`;
  });
  dropdown.innerHTML = html;
}

async function handleAddSelectedFeaturedProduct() {
  const dropdown = document.getElementById('adminFeaturedCatalogDropdown');
  const seqInput = document.getElementById('adminNewFeaturedSequence');
  if (!dropdown || !dropdown.value) {
    alert('Please select a product from the dropdown first.');
    return;
  }
  const productId = String(dropdown.value);
  const targetSeq = seqInput ? parseInt(seqInput.value, 10) : 1;
  await addFeaturedProductAtSequence(productId, targetSeq);
}

async function addFeaturedProductAtSequence(productId, targetSeq) {
  const pid = String(productId);
  const visible = materializeFeaturedSlotIds().filter(id => id !== pid);
  const pinnedSet = new Set((state.lockedFeaturedIds || []).map(String));
  const insertIdx = isNaN(targetSeq) ? visible.length : Math.min(Math.max(targetSeq - 1, 0), visible.length);
  visible.splice(insertIdx, 0, pid);

  if (visible.length > MAX_FEATURED_SLOTS) {
    const droppedId = visible[MAX_FEATURED_SLOTS];
    if (pinnedSet.has(droppedId)) {
      const dropped = (state.products || []).find(p => String(p.id) === droppedId);
      if (!confirm(`All ${MAX_FEATURED_SLOTS} slots are full. "${dropped ? dropped.name : droppedId}" (slot #${MAX_FEATURED_SLOTS}) will be removed from featured. Continue?`)) return;
    }
  }

  // Pin everything up to the inserted slot so the new product holds its exact position
  const pinned = visible.filter((id, i) => i <= insertIdx || pinnedSet.has(id)).slice(0, MAX_FEATURED_SLOTS);
  const ok = await persistFeaturedList(pinned);
  if (ok) {
    clearFeaturedProductSearch();
    const dd = document.getElementById('adminFeaturedCatalogDropdown');
    if (dd) dd.value = '';
  }
}

async function saveFeaturedSettingsToServer() {
  const list = [...(state.lockedFeaturedIds || [])].map(String);
  const btn = document.getElementById('saveFeaturedSettingsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const res = await adminFetch('/api/admin/featured-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lockedProductIds: list })
    });
    if (res.ok) {
      try { localStorage.setItem('audioking_locked_featured', JSON.stringify(list)); } catch (e) {}
      window.dispatchEvent(new CustomEvent('ak:featured-sync', { detail: { lockedProductIds: list } }));
      loadFeaturedManager();
      alert('âœ“ Featured products settings successfully saved and updated on homepage!');
    } else {
      alert('Failed to save featured settings.');
    }
  } catch (err) {
    alert('Network error while saving featured settings: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>ðŸ’¾ Save Featured Changes</span>';
    }
  }
}

// Expose YouTube Video APIs to Window
window.addYouTubeVideoInputRow = addYouTubeVideoInputRow;
window.removeYouTubeVideoInputRow = removeYouTubeVideoInputRow;
window.handleYouTubeVideoRowChange = handleYouTubeVideoRowChange;
window.updateAllYouTubeVideoPreviews = updateAllYouTubeVideoPreviews;

// Expose Homepage & Featured APIs to Window
window.loadHomepageManager = loadHomepageManager;
window.renderHeroSlidesAdmin = renderHeroSlidesAdmin;
window.openAddHeroSlideModal = openAddHeroSlideModal;
window.openEditHeroSlideModal = openEditHeroSlideModal;
window.closeHeroSlideModal = closeHeroSlideModal;
window.updateHeroSlidePreview = updateHeroSlidePreview;
window.handleHeroSlideFileUpload = handleHeroSlideFileUpload;
window.handleHeroSlideFormSubmit = handleHeroSlideFormSubmit;
window.deleteHeroSlide = deleteHeroSlide;
window.moveHeroSlide = moveHeroSlide;

window.loadFeaturedManager = loadFeaturedManager;
window.renderActiveHomepageFeaturedProducts = renderActiveHomepageFeaturedProducts;
window.renderLockedFeaturedProducts = renderLockedFeaturedProducts;
window.renderPopularFeaturedProducts = renderPopularFeaturedProducts;
window.handleFeaturedSearchInput = handleFeaturedSearchInput;
window.clearFeaturedProductSearch = clearFeaturedProductSearch;
window.lockFeaturedProduct = lockFeaturedProduct;
window.unlockFeaturedProduct = unlockFeaturedProduct;
window.moveLockedProduct = moveLockedProduct;
window.changeFeaturedSequence = changeFeaturedSequence;
window.populateFeaturedCatalogDropdown = populateFeaturedCatalogDropdown;
window.handleAddSelectedFeaturedProduct = handleAddSelectedFeaturedProduct;
window.addFeaturedProductAtSequence = addFeaturedProductAtSequence;
window.saveFeaturedSettingsToServer = saveFeaturedSettingsToServer;
window.moveFeaturedSlot = moveFeaturedSlot;
window.setFeaturedSlotPosition = setFeaturedSlotPosition;
window.removeFeaturedSlot = removeFeaturedSlot;
window.pinFeaturedSlot = pinFeaturedSlot;
window.autoFillFeaturedSlots = autoFillFeaturedSlots;
window.clearFeaturedPins = clearFeaturedPins;
window.openFeaturedSlotPicker = openFeaturedSlotPicker;
window.renderActiveHomepageFeaturedProducts = renderActiveHomepageFeaturedProducts;
window.loadAdminWhatsAppSetting = loadAdminWhatsAppSetting;
window.handleSaveWhatsAppNumber = handleSaveWhatsAppNumber;

// Expose Blanket Offer Picker APIs to Window
window.handleOfferTargetTypeChange = handleOfferTargetTypeChange;
window.handleOfferCategoryChange = handleOfferCategoryChange;
window.openOfferProductDropdown = openOfferProductDropdown;
window.closeOfferProductDropdown = closeOfferProductDropdown;
window.toggleOfferProductDropdown = toggleOfferProductDropdown;
window.filterOfferProducts = filterOfferProducts;
window.selectOfferProduct = selectOfferProduct;
window.clearSelectedOfferProduct = clearSelectedOfferProduct;

// Global Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Search input debounce for products
  const searchInput = document.getElementById('searchProductInput');
  if (searchInput) {
    let timeout = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => loadProducts(), 300);
    });
  }

  // Close modals on escape key or backdrop click
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  });

  // Close offer product dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('offerProductTargetWrap');
    if (wrap && !wrap.contains(e.target)) {
      closeOfferProductDropdown();
    }
    const searchInput = document.getElementById('featuredProductSearchInput');
    const searchDropdown = document.getElementById('featuredProductSearchResults');
    if (searchDropdown && searchInput && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
      searchDropdown.style.display = 'none';
    }
  });

  // Password Show / Hide Toggle in Admin Views
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ak-password-toggle-btn');
    if (!btn) return;
    e.preventDefault();

    const targetId = btn.getAttribute('data-target');
    let input = targetId ? document.getElementById(targetId) : null;
    if (!input) {
      input = btn.closest('.ak-password-wrapper')?.querySelector('input');
    }
    if (!input) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    btn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');

    const eyeSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeOffSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    btn.innerHTML = isPassword ? eyeOffSvg : eyeSvg;
  });

  // If directly accessing standalone admin page (/admin or /admin/index.html)
  if (window.location.pathname.includes('/admin')) {
    initAdminDashboardView();
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash || '';
      let target = '';
      if (hash.startsWith('#admin/')) {
        target = hash.replace('#admin/', '').split('?')[0];
      } else if (hash.startsWith('#')) {
        target = hash.replace('#', '').split('?')[0];
      }
      if (target && document.getElementById(`view-${target}`)) {
        switchView(target);
      }
    });
  }
});
