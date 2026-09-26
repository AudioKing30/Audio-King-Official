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
  ordersTab: 'current', // 'current' | 'history'
  activeModal: null,
  analyticsRange: 7,
  hasVariants: false,
  variantGroups: [],
  variantMatrix: [],
  selectedOfferProductId: null
};

// Formatting Helpers
function formatINR(amount) {
  const num = Number(amount) || 0;
  return '₹' + num.toLocaleString('en-IN');
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
    if (window.location.hostname.includes('github.io')) {
      return 'https://audioking-api.onrender.com';
    }
    if (window.location.protocol === 'file:' || (window.location.port && window.location.port !== '3000')) {
      return 'http://localhost:3000';
    }
  }
  return '';
}

// Central Authenticated Admin Fetch (uses cookie + token header + live API base URL)
async function adminFetch(url, options = {}) {
  const base = getAdminApiBase();
  const fullUrl = (/^https?:\/\//i.test(url) || !base) ? url : `${base}${url.startsWith('/') ? url : '/' + url}`;
  const token = localStorage.getItem('audioKingSessionToken') || 
                localStorage.getItem('audioking_token') || 
                localStorage.getItem('audioKingToken');
  const headers = { ...(options.headers || {}) };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(fullUrl, { ...options, credentials: 'include', headers });
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
    'product-form': state.editingProductId ? 'Edit Product' : 'Add New Product',
    offers: 'Offers & Blanket Discounts',
    coupons: 'Cart-Level Coupons',
    orders: 'Customer Orders',
    customers: 'Registered Customers',
    analytics: 'Website Analytics & Traffic Tracker',
    settings: 'Admin Account & Security'
  };
  const topbar = document.getElementById('topbarTitle');
  if (topbar) topbar.textContent = titles[viewName] || 'Admin Portal';

  // Load View Specific Data
  if (viewName === 'dashboard') loadDashboardStats();
  if (viewName === 'products') loadProducts();
  if (viewName === 'offers') loadOffers();
  if (viewName === 'coupons') loadCoupons();
  if (viewName === 'orders') loadOrders();
  if (viewName === 'customers') loadCustomers();
  if (viewName === 'analytics') loadAnalytics();
}

// -------------------------------------------------------------
// 1. DASHBOARD VIEW
// -------------------------------------------------------------
async function loadDashboardStats() {
  try {
    const res = await adminFetch('/api/admin/dashboard/stats');
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (window.authService && window.authService.getStatus() === 'loading') {
          return;
        }
        if (typeof window.showHome === 'function') window.showHome();
        else window.location.hash = '#home';
        if (typeof window.openAuthModal === 'function') window.openAuthModal('signin');
      }
      return;
    }
    const data = await res.json();
    const stats = data.stats;

    document.getElementById('statCustomers').textContent = stats.totalCustomers;
    document.getElementById('statOrders').textContent = stats.totalOrders;
    document.getElementById('statOrdersSplit').textContent = `${stats.currentOrders} Current · ${stats.completedOrders} Delivered`;
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
            <img src="${p.image || '/assets/images/logo.jpg'}" class="table-thumb" alt="${p.name}">
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
                <img src="${p.image || '/assets/images/logo.jpg'}" alt="${p.name}">
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
  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
  }
}

// -------------------------------------------------------------
// 2. PRODUCTS LIST & FILTERING
// -------------------------------------------------------------
async function loadCategoriesAndBrands() {
  try {
    const [catRes, brandRes] = await Promise.all([
      adminFetch('/api/admin/categories'),
      adminFetch('/api/admin/brands')
    ]);
    const catData = await catRes.json();
    const brandData = await brandRes.json();

    state.categories = catData.categories || [];
    state.brands = brandData.brands || [];

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

    // Populate Form Selects
    populateFormSelects();
  } catch (e) {
    console.error('[LOAD META ERROR]', e);
  }
}

function populateFormSelects() {
  const catSelect = document.getElementById('productCategory');
  if (catSelect) {
    const currentVal = catSelect.value;
    catSelect.innerHTML = `
      <option value="">-- Select Category --</option>
      <option value="__NEW__" style="color: var(--ak-orange); font-weight: 700;">+ Add New Category</option>
      ${state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
    `;
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
    const data = await res.json();
    state.products = data.products || [];

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
          <img src="${p.image || '/assets/images/logo.jpg'}" class="table-thumb" alt="${p.name}">
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
          <span class="badge-stock ${p.inStock ? 'in' : 'out'}">
            ${p.inStock ? 'In Stock' : 'Out of Stock'}
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
              <img src="${p.image || '/assets/images/logo.jpg'}" alt="${p.name}">
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
              <span class="ak-mpc-val"><span class="badge-stock ${p.inStock ? 'in' : 'out'}">${p.inStock ? 'In Stock' : 'Out of Stock'}</span></span>
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
    document.getElementById('productCategory').value = p.category;
    document.getElementById('productBrand').value = p.brand;
    document.getElementById('productMrp').value = p.originalPrice;
    document.getElementById('productSellingPrice').value = p.price;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productAvailability').value = p.inStock ? '1' : '0';
    document.getElementById('productDescription').value = p.description || '';

    state.formImages = Array.isArray(p.images) && p.images.length > 0 ? [...p.images] : (p.image ? [p.image] : []);
    renderImagePreviewGrid();

    // Video setup
    if (p.youtubeVideoId) {
      setVideoChoice('youtube');
      document.getElementById('productVideoInput').value = p.youtubeVideoId;
      updateInlineVideoPreview('youtube', p.youtubeVideoId);
    } else if (p.videoUrl) {
      if (p.videoType === 'youtube') {
        setVideoChoice('youtube');
        document.getElementById('productVideoInput').value = p.videoUrl;
        updateInlineVideoPreview('youtube', p.videoUrl);
      } else {
        setVideoChoice('upload');
        document.getElementById('productVideoInput').value = p.videoUrl;
        updateInlineVideoPreview('upload', p.videoUrl);
      }
    } else {
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

  try {
    const res = await adminFetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (res.ok) {
      await loadCategoriesAndBrands();
      document.getElementById('productCategory').value = data.category.name;
      document.getElementById('inlineNewCatRow').style.display = 'none';
      input.value = '';
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

// Image Uploads & Reordering
function renderImagePreviewGrid() {
  const grid = document.getElementById('imagePreviewGrid');
  if (state.formImages.length === 0) {
    grid.innerHTML = `<span style="font-size: 12px; color: var(--ak-text-muted);">No images uploaded yet. Upload images or paste URLs below.</span>`;
    return;
  }

  grid.innerHTML = state.formImages.map((imgUrl, idx) => `
    <div class="preview-tile ${idx === 0 ? 'cover' : ''}">
      ${idx === 0 ? '<span class="cover-badge">⭐ COVER</span>' : ''}
      <img src="${imgUrl}" class="preview-img" alt="Product image">
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
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('images', files[i]);
  }

  const uploadStatus = document.getElementById('imageUploadStatus');
  uploadStatus.textContent = 'Uploading and verifying images...';
  uploadStatus.style.display = 'block';

  try {
    const res = await adminFetch('/api/admin/upload/images', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.urls) {
      state.formImages.push(...data.urls);
      renderImagePreviewGrid();
      uploadStatus.textContent = 'Upload successful!';
      uploadStatus.style.color = 'var(--ak-success)';
      setTimeout(() => { uploadStatus.style.display = 'none'; uploadStatus.style.color = ''; }, 3000);
    } else {
      alert(data.error || 'Image upload failed');
      uploadStatus.style.display = 'none';
    }
  } catch (err) {
    alert('Network error while uploading images.');
    uploadStatus.style.display = 'none';
  }
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
    const val = document.getElementById('productVideoInput').value.trim();
    if (val) updateInlineVideoPreview('youtube', val);
    else previewBox.style.display = 'none';
  } else if (choice === 'upload') {
    urlInputGroup.style.display = 'none';
    fileUploadGroup.style.display = 'block';
    const val = document.getElementById('productVideoInput').value.trim();
    if (val) updateInlineVideoPreview('upload', val);
    else previewBox.style.display = 'none';
  } else {
    urlInputGroup.style.display = 'none';
    fileUploadGroup.style.display = 'none';
    previewBox.style.display = 'none';
    document.getElementById('productVideoInput').value = '';
  }
}

function handleVideoInputChange() {
  const val = document.getElementById('productVideoInput').value.trim();
  if (state.formVideoChoice === 'youtube' && val) {
    updateInlineVideoPreview('youtube', val);
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

// Pricing & Auto-Calculated Discount %
function calculateDiscountAndValidate() {
  const mrpInput = document.getElementById('productMrp');
  const sellingInput = document.getElementById('productSellingPrice');
  const errorBanner = document.getElementById('productPriceError');
  const badgePreview = document.getElementById('discountBadgePreview');
  const saveBtn = document.getElementById('saveProductBtn');

  const mrp = parseFloat(mrpInput.value) || 0;
  const selling = parseFloat(sellingInput.value) || 0;

  // Validation: Selling Price cannot exceed MRP
  if (mrp > 0 && selling > mrp) {
    errorBanner.textContent = `Validation Error: Selling Price (${formatINR(selling)}) cannot exceed MRP (${formatINR(mrp)}).`;
    errorBanner.style.display = 'block';
    badgePreview.textContent = 'Invalid Price';
    badgePreview.style.background = 'var(--ak-danger-soft)';
    badgePreview.style.color = 'var(--ak-danger)';
    saveBtn.disabled = true;
    return false;
  }

  errorBanner.style.display = 'none';
  saveBtn.disabled = false;

  if (mrp > 0 && selling > 0 && selling < mrp) {
    const discount = Math.round(((mrp - selling) / mrp) * 100);
    badgePreview.textContent = `${discount}% OFF`;
    badgePreview.style.background = 'var(--ak-success-soft)';
    badgePreview.style.color = 'var(--ak-success)';
  } else {
    badgePreview.textContent = '0% OFF';
    badgePreview.style.background = 'var(--ak-card-bg)';
    badgePreview.style.color = 'var(--ak-text-muted)';
  }

  return true;
}

// Stock input auto-flips availability
function handleStockInputChange() {
  const stockInput = document.getElementById('productStock');
  const availSelect = document.getElementById('productAvailability');
  const stock = parseInt(stockInput.value, 10) || 0;

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

  const name = document.getElementById('productName').value.trim();
  const category = document.getElementById('productCategory').value;
  const brand = document.getElementById('productBrand').value;
  const mrp = parseFloat(document.getElementById('productMrp').value);
  const sellingPrice = parseFloat(document.getElementById('productSellingPrice').value);
  const stock = parseInt(document.getElementById('productStock').value, 10);
  const inStock = document.getElementById('productAvailability').value === '1';
  const description = document.getElementById('productDescription').value.trim();
  const videoInput = document.getElementById('productVideoInput').value.trim();

  if (!name) return alert('Product name is required');
  if (!category || category === '__NEW__') return alert('Please select or create a valid category');
  if (!brand || brand === '__NEW__') return alert('Please select or create a valid brand');

  const payload = {
    name,
    category,
    brand,
    mrp,
    sellingPrice,
    stock,
    inStock,
    description,
    images: state.formImages.length > 0 ? state.formImages : ['assets/images/logo.jpg'],
    videoChoice: state.formVideoChoice,
    videoInput
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
        <img src="${p.image || '/assets/images/logo.jpg'}" class="offer-product-item-thumb" alt="${p.name}" loading="lazy">
        <div class="offer-product-item-info">
          <div class="offer-product-item-name" title="${p.name}">${p.name}</div>
          <div class="offer-product-item-meta">${p.brand ? p.brand + ' · ' : ''}${p.category}</div>
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
    thumb.src = p.image || '/assets/images/logo.jpg';
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
  const tbody = document.getElementById('couponsTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px;">Loading coupons...</td></tr>';

  try {
    const res = await adminFetch('/api/admin/coupons');
    const data = await res.json();
    const coupons = data.coupons || [];

    if (coupons.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding: 0; border: none;">
        <div class="admin-empty-state-box">
          <svg class="admin-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
          <div class="admin-empty-title">No coupons found.</div>
          <div class="admin-empty-sub">Create your first coupon code above.</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = coupons.map(c => `
      <tr>
        <td><strong style="color: var(--ak-orange); font-size: 15px; letter-spacing: 0.5px;">${c.code}</strong></td>
        <td>${c.discount_type === 'flat' ? 'Flat Amount' : 'Percentage'}</td>
        <td><strong>${c.discount_type === 'flat' ? formatINR(c.discount_value) : `${c.discount_value}%`}</strong></td>
        <td>${c.min_cart_value > 0 ? formatINR(c.min_cart_value) : 'None'}</td>
        <td><strong>${c.used_count}</strong> / ${c.usage_limit || '∞'}</td>
        <td>${c.expires_at || 'Never'}</td>
        <td>
          <button class="badge-stock ${c.is_active ? 'in' : 'out'}" style="cursor: pointer; border: none;" onclick="toggleCoupon('${c.id}')">
            ${c.is_active ? 'Active' : 'Disabled'}
          </button>
        </td>
        <td>
          <button class="btn-danger" onclick="deleteCoupon('${c.id}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--ak-danger);">Failed to load coupons.</td></tr>';
  }
}

async function handleCreateCoupon(e) {
  e.preventDefault();
  const code = document.getElementById('couponCode').value.trim().toUpperCase();
  const discountType = document.getElementById('couponType').value;
  const discountValue = parseFloat(document.getElementById('couponValue').value);
  const minCartValue = parseFloat(document.getElementById('couponMinCart').value) || 0;
  const usageLimit = parseInt(document.getElementById('couponLimit').value, 10) || null;
  const expiresAt = document.getElementById('couponExpiry').value || null;

  if (!code || isNaN(discountValue)) return alert('Please enter code and discount value');

  try {
    const res = await adminFetch('/api/admin/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, discountType, discountValue, minCartValue, usageLimit, expiresAt })
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Coupon "${code}" created successfully!`);
      document.getElementById('couponForm').reset();
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
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding: 0; border: none;">
        <div class="admin-empty-state-box">
          <svg class="admin-empty-icon" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          <div class="admin-empty-title">No ${state.ordersTab === 'current' ? 'current' : 'past'} orders found.</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><strong>${o.orderNumber}</strong></td>
        <td>
          <div>${o.customerName}</div>
          <div style="font-size: 11px; color: var(--ak-text-muted);">${o.customerEmail}</div>
        </td>
        <td style="max-width: 250px;">
          <div style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${o.itemsSummary}</div>
          <div style="font-size: 11px; color: var(--ak-text-muted);">${o.itemsCount} unique product(s)</div>
        </td>
        <td><strong>${formatINR(o.totalAmount)}</strong></td>
        <td>
          ${o.couponCode 
            ? `<span class="badge-discount">${o.couponCode} (-${formatINR(o.discountAmount)})</span>` 
            : '<span style="color: var(--ak-text-muted); font-size: 12px;">None</span>'}
        </td>
        <td>
          <span class="badge-stock ${o.status === 'Delivered' ? 'in' : (o.status === 'Cancelled' ? 'out' : 'low')}">
            ${o.status}
          </span>
        </td>
        <td style="font-size: 13px; color: var(--ak-text-secondary);">${formatDate(o.createdAt)}</td>
        <td>
          <button class="btn-edit" onclick="openOrderDetailModal('${o.id}')">View Details</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--ak-danger);">Failed to load orders.</td></tr>';
  }
}

async function openOrderDetailModal(orderId) {
  try {
    const res = await adminFetch(`/api/admin/orders/${orderId}`);
    const data = await res.json();
    const ord = data.order;

    document.getElementById('modalOrderNumber').textContent = ord.orderNumber;
    document.getElementById('modalCustomerName').textContent = ord.customerName;
    document.getElementById('modalCustomerEmail').textContent = ord.customerEmail;
    document.getElementById('modalCustomerPhone').textContent = ord.customerPhone;
    document.getElementById('modalShippingAddr').textContent = ord.shippingAddress ? (ord.shippingAddress.line1 ? `${ord.shippingAddress.line1}, ${ord.shippingAddress.city}, ${ord.shippingAddress.state} - ${ord.shippingAddress.pin}` : JSON.stringify(ord.shippingAddress)) : 'N/A';
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
        <td style="width: 44px;"><img src="${it.image}" class="table-thumb" alt=""></td>
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

// -------------------------------------------------------------
// 7. CUSTOMERS VIEW
// -------------------------------------------------------------
async function loadCustomers() {
  const tbody = document.getElementById('customersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px;">Loading registered customer accounts...</td></tr>';

  try {
    const res = await adminFetch('/api/admin/customers');
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
    document.getElementById('modalCustomerHistorySub').textContent = `${customer.email} · ${customer.phone}`;

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

// Logout
async function handleLogout() {
  if (!confirm('Sign out of the admin panel?')) return;
  try {
    if (window.authService && typeof window.authService.logout === 'function') {
      await window.authService.logout();
    } else {
      await adminFetch('/api/admin/auth/logout', { method: 'POST' });
    }
    if (typeof window.showToast === 'function') window.showToast('Signed out of admin panel.');
    if (typeof window.showHome === 'function') window.showHome();
    else window.location.hash = '#home';
  } catch (e) {
    if (typeof window.showHome === 'function') window.showHome();
    else window.location.hash = '#home';
  }
}
window.handleAdminLogout = handleLogout;

function initAdminDashboardView(targetView) {
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
  if (!viewToOpen) {
    try {
      viewToOpen = localStorage.getItem('audioking_admin_view');
    } catch (e) {}
  }
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
            <td><img src="${p.image || 'assets/images/logo.jpg'}" class="table-thumb" alt=""></td>
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

  state.variantMatrix = combinations.map(combo => {
    const labelStr = combo.map(c => c.label).join(' / ');
    const existing = existingMap.get(labelStr);

    return {
      skuSuffix: existing?.skuSuffix || '',
      optionIds: combo.map(c => c.id),
      optionLabels: labelStr,
      priceOverride: existing?.priceOverride != null ? existing.priceOverride : null,
      stock: existing?.stock != null ? existing.stock : 10,
      isActive: existing?.isActive !== false
    };
  });

  if (countSpan) countSpan.textContent = `(${state.variantMatrix.length} combinations)`;
  renderVariantMatrix();
  syncVariantStockToProduct();
}
window.generateVariantMatrix = generateVariantMatrix;

function renderVariantMatrix() {
  const tbody = document.getElementById('variantMatrixTbody');
  if (!tbody) return;

  tbody.innerHTML = state.variantMatrix.map((v, idx) => `
    <tr>
      <td><strong>${v.optionLabels}</strong></td>
      <td>
        <input type="text" class="form-input" style="height: 30px; font-size: 12px; width: 110px;" value="${v.skuSuffix || ''}" placeholder="e.g. -BLK" onchange="state.variantMatrix[${idx}].skuSuffix = this.value.trim();">
      </td>
      <td>
        <input type="number" class="form-input" style="height: 30px; font-size: 12px; width: 110px;" value="${v.priceOverride != null ? v.priceOverride : ''}" placeholder="Standard" min="1" step="1" onchange="state.variantMatrix[${idx}].priceOverride = this.value ? parseFloat(this.value) : null;">
      </td>
      <td>
        <input type="number" class="form-input" style="height: 30px; font-size: 12px; width: 85px;" value="${v.stock}" min="0" step="1" oninput="updateVariantStock(${idx}, this.value)">
      </td>
      <td>
        <input type="checkbox" ${v.isActive ? 'checked' : ''} onchange="state.variantMatrix[${idx}].isActive = this.checked; syncVariantStockToProduct();">
      </td>
    </tr>
  `).join('');
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
  if (availSelect) availSelect.value = totalStock > 0 ? '1' : '0';
}
window.syncVariantStockToProduct = syncVariantStockToProduct;

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
  });

  // If directly accessing standalone admin page (/admin or /admin/index.html)
  if (window.location.pathname.includes('/admin')) {
    initAdminDashboardView();
  }
});
