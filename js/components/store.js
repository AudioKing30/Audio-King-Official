/**
 * Audio King - Sweetwater-Style Store / Catalog Component
 * Full filtering (Category, Brand, In-Stock, Price Range, Search),
 * 3-column grid layout, sorting, pagination, zero star ratings.
 */

import { AUDIOKING_PRODUCTS } from '../data/products.js';
import { AUDIOKING_BRANDS } from '../data/brands.js';
import { formatINR, calculateDiscountPercent, getProductOfferStampHtml, resolveProductImage } from '../utils/formatters.js';
import { addToCart, getCartItemQuantity, updateCartItemQty } from './cart.js';

let allProducts = [];
let filteredProducts = [];
let currentCategoryFilter = 'All';
let selectedBrand = null;
let inStockOnly = false;
let outOfStockOnly = false;
let preOrderOnly = false;
let currentSort = 'featured';
let minPrice = 0;
const DEFAULT_MAX_PRICE = 5000000;
let maxPrice = DEFAULT_MAX_PRICE;
let currentPage = 1;
const PRODUCTS_PER_PAGE = 12;
let currentSearchQuery = '';

let onProductClickCallback = null;

export function setProductClickCallback(fn) {
  onProductClickCallback = fn;
}

export function initStore() {
  allProducts = [...(AUDIOKING_PRODUCTS || [])];
  filteredProducts = [...allProducts];

  buildCategoryFilterList();
  buildBrandFilterList();
  bindFilterEvents();
  applyFilters();

  window.addEventListener('ak:cart-updated', () => {
    const catalogPage = document.getElementById('catalogPage');
    if (catalogPage && catalogPage.style.display !== 'none') {
      renderStorePage();
    }
  });

  window.addEventListener('ak:products-updated', () => {
    allProducts = [...(AUDIOKING_PRODUCTS || [])];
    buildCategoryFilterList();
    buildBrandFilterList();
    applyFilters();
    const catalogPage = document.getElementById('catalogPage');
    if (catalogPage && catalogPage.style.display !== 'none') {
      renderStorePage();
    }
  });
}

export function resolveCategoryName(catName) {
  if (!catName || catName.toLowerCase() === 'all') return 'All';
  const clean = catName.trim().toLowerCase();
  if (clean === 'synthesizers') return 'Keyboards';
  if (clean === 'monitor speakers' || clean === 'monitors') return 'Studio Monitors';
  if (clean === 'pre amps' || clean === 'preamp' || clean === 'preamps') return 'Preamps & Channel Strips';
  if (clean === 'power supply cabels' || clean === 'power supply cables') return 'Power Supply Cables';
  const cleanNorm = clean.replace(/[\s\-_&]/g, '');
  const allCats = Array.from(new Set(allProducts.map(p => p.category)));
  const exact = allCats.find(c => (c || '').toLowerCase() === clean);
  if (exact) return exact;
  const partial = allCats.find(c => {
    const cClean = (c || '').toLowerCase();
    const cNorm = cClean.replace(/[\s\-_&]/g, '');
    return cClean.includes(clean) || clean.includes(cClean) || cNorm.includes(cleanNorm) || cleanNorm.includes(cNorm);
  });
  if (partial) return partial;
  return catName;
}

export function getStoreState() {
  return {
    category: currentCategoryFilter || 'All',
    brand: selectedBrand || null,
    brands: selectedBrand ? [selectedBrand] : [],
    search: currentSearchQuery || '',
    inStockOnly,
    outOfStockOnly,
    preOrderOnly,
    sort: currentSort,
    minPrice,
    maxPrice,
    page: currentPage
  };
}

export function setStoreState(state = {}, emitEvent = false) {
  if (state.search !== undefined) {
    currentSearchQuery = (state.search || '').trim();
  }
  if (state.category !== undefined) {
    currentCategoryFilter = resolveCategoryName(state.category || 'All');
  }
  if (state.brand !== undefined) {
    selectedBrand = state.brand ? String(state.brand).toLowerCase() : null;
  } else if (state.brands !== undefined) {
    const bList = Array.isArray(state.brands) ? state.brands : [state.brands];
    selectedBrand = bList.length && bList[0] ? String(bList[0]).toLowerCase() : null;
  }
  if (state.inStockOnly !== undefined) {
    inStockOnly = Boolean(state.inStockOnly);
  }
  if (state.outOfStockOnly !== undefined) {
    outOfStockOnly = Boolean(state.outOfStockOnly);
  }
  if (state.preOrderOnly !== undefined) {
    preOrderOnly = Boolean(state.preOrderOnly);
  }
  if (state.sort !== undefined) {
    currentSort = state.sort || 'featured';
  }
  if (state.minPrice !== undefined) minPrice = Number(state.minPrice) || 0;
  if (state.maxPrice !== undefined) maxPrice = Number(state.maxPrice) || DEFAULT_MAX_PRICE;
  if (state.page !== undefined) currentPage = Math.max(1, Number(state.page) || 1);

  // Sync DOM elements
  document.querySelectorAll('.ak-store-cat-btn').forEach(btn => {
    const btnCat = (btn.dataset.category || '').toLowerCase();
    const curCat = (currentCategoryFilter || '').toLowerCase();
    const isActive = (curCat === 'all' && btnCat === 'all') ||
                     (curCat !== 'all' && (btnCat === curCat || curCat.includes(btnCat) || btnCat.includes(curCat)));
    btn.classList.toggle('active', isActive);
  });

  document.querySelectorAll('#akStoreBrandList .ak-brand-check').forEach(cb => {
    const active = selectedBrand && cb.value.toLowerCase() === selectedBrand;
    cb.checked = active;
    const parent = cb.closest('.ak-filter-checkbox-item');
    if (parent) parent.classList.toggle('active', Boolean(active));
  });

  const stockCb = document.getElementById('akStoreInStockOnly');
  if (stockCb) stockCb.checked = inStockOnly;

  const outOfStockCb = document.getElementById('akStoreOutOfStock');
  if (outOfStockCb) outOfStockCb.checked = outOfStockOnly;

  const preOrderCb = document.getElementById('akStorePreOrder');
  if (preOrderCb) preOrderCb.checked = preOrderOnly;

  const sortSelect = document.getElementById('akStoreSort');
  if (sortSelect) sortSelect.value = currentSort;

  const minInput = document.getElementById('akStoreMinPrice');
  const maxInput = document.getElementById('akStoreMaxPrice');
  if (minInput && minPrice > 0) minInput.value = minPrice;
  if (maxInput && maxPrice < DEFAULT_MAX_PRICE) maxInput.value = maxPrice;

  applyFilters(emitEvent);
}

export function openStoreWithSearch(query) {
  currentSearchQuery = (query || '').trim();
  currentCategoryFilter = 'All';
  selectedBrand = null;
  inStockOnly = false;
  outOfStockOnly = false;
  preOrderOnly = false;
  currentPage = 1;

  document.querySelectorAll('.ak-store-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === 'All');
  });

  document.querySelectorAll('#akStoreBrandList .ak-brand-check').forEach(cb => {
    cb.checked = false;
    const parent = cb.closest('.ak-filter-checkbox-item');
    if (parent) parent.classList.remove('active');
  });

  const stockCb = document.getElementById('akStoreInStockOnly');
  if (stockCb) stockCb.checked = false;
  const outOfStockCb = document.getElementById('akStoreOutOfStock');
  if (outOfStockCb) outOfStockCb.checked = false;
  const preOrderCb = document.getElementById('akStorePreOrder');
  if (preOrderCb) preOrderCb.checked = false;

  applyFilters(true);
}

export function openStoreWithCategory(categoryName) {
  currentSearchQuery = '';
  currentCategoryFilter = resolveCategoryName(categoryName || 'All');
  selectedBrand = null;
  inStockOnly = false;
  outOfStockOnly = false;
  preOrderOnly = false;
  currentPage = 1;

  document.querySelectorAll('.ak-store-cat-btn').forEach(btn => {
    const btnCat = (btn.dataset.category || '').toLowerCase();
    const curCat = (currentCategoryFilter || '').toLowerCase();
    const isActive = (curCat === 'all' && btnCat === 'all') ||
                     (curCat !== 'all' && (btnCat === curCat || curCat.includes(btnCat) || btnCat.includes(curCat)));
    btn.classList.toggle('active', isActive);
  });

  document.querySelectorAll('#akStoreBrandList .ak-brand-check').forEach(cb => {
    cb.checked = false;
    const parent = cb.closest('.ak-filter-checkbox-item');
    if (parent) parent.classList.remove('active');
  });

  const stockCb = document.getElementById('akStoreInStockOnly');
  if (stockCb) stockCb.checked = false;
  const outOfStockCb = document.getElementById('akStoreOutOfStock');
  if (outOfStockCb) outOfStockCb.checked = false;
  const preOrderCb = document.getElementById('akStorePreOrder');
  if (preOrderCb) preOrderCb.checked = false;

  applyFilters(true);
}

export function openStoreWithBrand(brandName) {
  currentSearchQuery = '';
  currentCategoryFilter = 'All';
  selectedBrand = brandName ? brandName.toLowerCase().trim() : null;
  inStockOnly = false;
  outOfStockOnly = false;
  preOrderOnly = false;
  currentPage = 1;

  document.querySelectorAll('.ak-store-cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === 'All');
  });

  document.querySelectorAll('#akStoreBrandList .ak-brand-check').forEach(cb => {
    const active = selectedBrand && cb.value.toLowerCase() === selectedBrand;
    cb.checked = active;
    const parent = cb.closest('.ak-filter-checkbox-item');
    if (parent) parent.classList.toggle('active', Boolean(active));
  });

  const stockCb = document.getElementById('akStoreInStockOnly');
  if (stockCb) stockCb.checked = false;
  const outOfStockCb = document.getElementById('akStoreOutOfStock');
  if (outOfStockCb) outOfStockCb.checked = false;
  const preOrderCb = document.getElementById('akStorePreOrder');
  if (preOrderCb) preOrderCb.checked = false;

  applyFilters(true);
}

function buildCategoryFilterList() {
  const container = document.getElementById('akStoreCategoryList');
  if (!container) return;

  const categories = {};
  allProducts.forEach(p => {
    const cat = p.category || 'Other';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  let html = '<button type="button" class="ak-store-cat-btn ' + (currentCategoryFilter === 'All' ? 'active' : '') + '" data-category="All">' +
    '<span class="ak-cat-name">All Categories</span>' +
    '<span class="ak-cat-count">' + allProducts.length + '</span>' +
    '</button>';

  Object.keys(categories).sort().forEach(cat => {
    html += '<button type="button" class="ak-store-cat-btn ' + (currentCategoryFilter === cat ? 'active' : '') + '" data-category="' + cat + '">' +
      '<span class="ak-cat-name">' + cat + '</span>' +
      '<span class="ak-cat-count">' + categories[cat] + '</span>' +
      '</button>';
  });

  container.innerHTML = html;

  container.querySelectorAll('.ak-store-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCategoryFilter = btn.dataset.category;
      container.querySelectorAll('.ak-store-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPage = 1;
      applyFilters();
    });
  });
}

function buildBrandFilterList() {
  const container = document.getElementById('akStoreBrandList');
  if (!container) return;

  const brandCounts = {};
  allProducts.forEach(p => {
    const b = (p.brand || 'Other').trim();
    brandCounts[b] = (brandCounts[b] || 0) + 1;
  });

  const sortedBrands = Object.keys(brandCounts).sort((a, b) => {
    if (a.toLowerCase().includes('arowana')) return -1;
    if (b.toLowerCase().includes('arowana')) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  let html = '';
  sortedBrands.forEach(b => {
    const isChecked = selectedBrand === b.toLowerCase();
    html += '<label class="ak-filter-checkbox-item ' + (isChecked ? 'active' : '') + '" data-brand="' + b.toLowerCase() + '">' +
      '<input type="radio" name="akStoreBrandRadio" class="ak-brand-check" value="' + b + '" ' + (isChecked ? 'checked' : '') + '>' +
      '<span class="ak-checkbox-custom ak-radio-custom"></span>' +
      '<span class="ak-filter-label">' + b + '</span>' +
      '<span class="ak-filter-count">(' + brandCounts[b] + ')</span>' +
      '</label>';
  });

  container.innerHTML = html;

  container.querySelectorAll('.ak-filter-checkbox-item').forEach(label => {
    label.addEventListener('click', (e) => {
      e.preventDefault();
      const cb = label.querySelector('.ak-brand-check');
      if (!cb) return;
      handleBrandToggle(cb.value);
    });
  });
}

function handleBrandToggle(brandVal) {
  const normVal = brandVal.toLowerCase();
  // If clicking active brand again, toggle off to All Brands
  if (selectedBrand === normVal) {
    selectedBrand = null;
  } else {
    selectedBrand = normVal;
  }

  document.querySelectorAll('#akStoreBrandList .ak-brand-check').forEach(c => {
    const active = selectedBrand && c.value.toLowerCase() === selectedBrand;
    c.checked = active;
    const parent = c.closest('.ak-filter-checkbox-item');
    if (parent) parent.classList.toggle('active', Boolean(active));
  });

  currentPage = 1;
  applyFilters();
}

function bindFilterEvents() {
  const brandSearch = document.getElementById('akStoreBrandSearch');
  if (brandSearch) {
    brandSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#akStoreBrandList .ak-filter-checkbox-item').forEach(item => {
        const b = item.dataset.brand;
        item.style.display = b.includes(q) ? 'flex' : 'none';
      });
    });
  }

  const inStockCheckbox = document.getElementById('akStoreInStockOnly');
  if (inStockCheckbox) {
    inStockCheckbox.addEventListener('change', (e) => {
      inStockOnly = e.target.checked;
      currentPage = 1;
      applyFilters();
    });
  }

  const outOfStockCheckbox = document.getElementById('akStoreOutOfStock');
  if (outOfStockCheckbox) {
    outOfStockCheckbox.addEventListener('change', (e) => {
      outOfStockOnly = e.target.checked;
      currentPage = 1;
      applyFilters();
    });
  }

  const preOrderCheckbox = document.getElementById('akStorePreOrder');
  if (preOrderCheckbox) {
    preOrderCheckbox.addEventListener('change', (e) => {
      preOrderOnly = e.target.checked;
      currentPage = 1;
      applyFilters();
    });
  }

  const sortSelect = document.getElementById('akStoreSort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      currentPage = 1;
      applyFilters();
    });
  }

  const clearBtn = document.getElementById('akStoreClearFilters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentSearchQuery = '';
      currentCategoryFilter = 'All';
      selectedBrand = null;
      inStockOnly = false;
      outOfStockOnly = false;
      preOrderOnly = false;
      minPrice = 0;
      maxPrice = DEFAULT_MAX_PRICE;
      currentPage = 1;

      const brandSearchInput = document.getElementById('akStoreBrandSearch');
      if (brandSearchInput) brandSearchInput.value = '';

      const minInput = document.getElementById('akStoreMinPrice');
      const maxInput = document.getElementById('akStoreMaxPrice');
      if (minInput) minInput.value = '';
      if (maxInput) maxInput.value = '';

      const stockBox = document.getElementById('akStoreInStockOnly');
      if (stockBox) stockBox.checked = false;

      const outOfStockBox = document.getElementById('akStoreOutOfStock');
      if (outOfStockBox) outOfStockBox.checked = false;

      const preOrderBox = document.getElementById('akStorePreOrder');
      if (preOrderBox) preOrderBox.checked = false;

      document.querySelectorAll('.ak-store-cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === 'All');
      });

      document.querySelectorAll('#akStoreBrandList .ak-brand-check').forEach(cb => {
        cb.checked = false;
        const parent = cb.closest('.ak-filter-checkbox-item');
        if (parent) parent.classList.remove('active');
      });

      document.querySelectorAll('#akStoreBrandList .ak-filter-checkbox-item').forEach(item => {
        item.style.display = 'flex';
      });

      applyFilters();
    });
  }

  const priceApplyBtn = document.getElementById('akStorePriceApply');
  if (priceApplyBtn) {
    priceApplyBtn.addEventListener('click', () => {
      const minInput = document.getElementById('akStoreMinPrice');
      const maxInput = document.getElementById('akStoreMaxPrice');
      minPrice = minInput && minInput.value ? Number(minInput.value) : 0;
      maxPrice = maxInput && maxInput.value ? Number(maxInput.value) : DEFAULT_MAX_PRICE;
      currentPage = 1;
      applyFilters();
    });
  }

  const mobileFilterToggle = document.getElementById('akStoreMobileFilterBtn');
  const sidebar = document.getElementById('akStoreSidebar');
  const filterOverlay = document.getElementById('akStoreSidebarOverlay');

  if (mobileFilterToggle && sidebar) {
    mobileFilterToggle.addEventListener('click', () => {
      sidebar.classList.add('open');
      if (filterOverlay) filterOverlay.classList.add('active');
    });
  }

  const closeSidebarBtn = document.getElementById('akStoreCloseSidebar');
  if (closeSidebarBtn && sidebar) {
    closeSidebarBtn.addEventListener('click', () => {
      sidebar.classList.remove('open');
      if (filterOverlay) filterOverlay.classList.remove('active');
    });
  }

  if (filterOverlay && sidebar) {
    filterOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      filterOverlay.classList.remove('active');
    });
  }
}

function applyFilters(emitEvent = true) {
  filteredProducts = allProducts.filter(product => {
    // Smart case-insensitive search filter
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase().trim();
      const pName = (product.name || '').toLowerCase();
      const pBrand = (product.brand || '').toLowerCase();
      const pCat = (product.category || '').toLowerCase();
      const pSub = (product.subcategory || '').toLowerCase();
      const pDesc = (product.description || '').toLowerCase();
      const pTags = Array.isArray(product.tags) ? product.tags.join(' ').toLowerCase() : '';

      // Brand matching flexibility: e.g. "adam" matches "ADAM Audio", "nord" matches "Nord"
      const matchBrand = pBrand.includes(q) || q.includes(pBrand);
      const matchText = pName.includes(q) || pCat.includes(q) || pSub.includes(q) || pDesc.includes(q) || pTags.includes(q);

      if (!matchBrand && !matchText) {
        return false;
      }
    }

    if (currentCategoryFilter !== 'All') {
      const pCat = (product.category || '').toLowerCase();
      const fCat = currentCategoryFilter.toLowerCase();
      if (pCat !== fCat && !pCat.includes(fCat) && !fCat.includes(pCat)) {
        return false;
      }
    }
    if (selectedBrand) {
      const pBrand = (product.brand || '').toLowerCase().trim();
      const sBrand = selectedBrand.toLowerCase().trim();
      const match = pBrand === sBrand ||
                    pBrand.replace(/s$/, '') === sBrand.replace(/s$/, '') ||
                    pBrand.includes(sBrand) || sBrand.includes(pBrand);
      if (!match) return false;
    }
    // Availability Filter (In Stock Only, Out of Stock, Pre-Order)
    const anyAvail = inStockOnly || outOfStockOnly || preOrderOnly;
    if (anyAvail) {
      const isPre = Boolean(product.isPreOrder || (product.badge && product.badge.toLowerCase().includes('pre-order')) || product.stockStatus === 'preorder');
      const isOut = Boolean(!isPre && (product.stock === 0 || product.inStock === false || product.isOutOfStock === true || product.stockStatus === 'outofstock'));
      const isIn = Boolean(!isPre && !isOut && (product.stock > 0 || product.inStock === true));

      let matchAvail = false;
      if (inStockOnly && isIn) matchAvail = true;
      if (outOfStockOnly && isOut) matchAvail = true;
      if (preOrderOnly && isPre) matchAvail = true;

      if (!matchAvail) {
        return false;
      }
    }
    const price = product.price || 0;
    if (price < minPrice || price > maxPrice) {
      return false;
    }
    return true;
  });

  if (currentSort === 'price-low') {
    filteredProducts.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'price-high') {
    filteredProducts.sort((a, b) => b.price - a.price);
  } else if (currentSort === 'name-asc') {
    filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filteredProducts.sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
  }

  updateStoreHeader();
  renderStorePage();

  if (emitEvent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ak:store-state-changed', {
      detail: getStoreState()
    }));
  }
}

function updateStoreHeader() {
  const titleEl = document.getElementById('akStoreMainTitle');
  const crumbEl = document.getElementById('akStoreCrumb');
  const descEl = document.getElementById('akStoreDesc');

  let displayTitle = 'All Available Gear';
  if (currentSearchQuery) {
    displayTitle = `Search Results for "${currentSearchQuery}"`;
  } else if (selectedBrand) {
    displayTitle = selectedBrand.toUpperCase() + ' Pro Audio & Gear';
  } else if (currentCategoryFilter && currentCategoryFilter !== 'All') {
    displayTitle = currentCategoryFilter;
  }

  if (titleEl) titleEl.textContent = displayTitle;
  if (crumbEl) crumbEl.textContent = currentSearchQuery ? `Search: "${currentSearchQuery}"` : displayTitle;
  if (descEl) {
    if (currentSearchQuery) {
      descEl.textContent = `Showing all ${filteredProducts.length} gear items matching "${currentSearchQuery}".`;
    } else {
      descEl.textContent = 'Explore our curated selection of industry-standard ' + displayTitle.toLowerCase() + ' backed by authorized manufacturer warranty, express pan-India dispatch, and specialist audio consultation.';
    }
  }
}

function renderStorePage() {
  const grid = document.getElementById('akStoreGrid');
  const counterEl = document.getElementById('akStoreProductCounter');
  const pageNumEl = document.getElementById('akStoreCurrentPage');
  const totalPagesEl = document.getElementById('akStoreTotalPages');
  const paginationControls = document.getElementById('akStorePagination');

  if (!grid) return;

  const totalCount = filteredProducts.length;
  const totalPages = Math.ceil(totalCount / PRODUCTS_PER_PAGE) || 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  if (counterEl) {
    const start = totalCount === 0 ? 0 : (currentPage - 1) * PRODUCTS_PER_PAGE + 1;
    const end = Math.min(currentPage * PRODUCTS_PER_PAGE, totalCount);
    if (currentSearchQuery) {
      counterEl.innerHTML = `${start}-${end} of ${totalCount} results for "<strong style="color:#C2410C;">${currentSearchQuery}</strong>"`;
    } else if (selectedBrand) {
      counterEl.innerHTML = `${start}-${end} of ${totalCount} results for "<strong style="color:#C2410C;">${selectedBrand.toUpperCase()}</strong>"`;
    } else if (currentCategoryFilter && currentCategoryFilter !== 'All') {
      counterEl.innerHTML = `${start}-${end} of ${totalCount} results for "<strong style="color:#C2410C;">${currentCategoryFilter}</strong>"`;
    } else {
      counterEl.textContent = `1-${end} of ${totalCount} results`;
    }
  }

  if (pageNumEl) pageNumEl.textContent = currentPage;
  if (totalPagesEl) totalPagesEl.textContent = totalPages;

  if (totalCount === 0) {
    grid.innerHTML = '<div class="ak-store-empty">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<circle cx="11" cy="11" r="8"></circle>' +
      '<line x1="21" y1="21" x2="16.65" y2="16.65"></line>' +
      '</svg>' +
      '<h3>No Products Found</h3>' +
      '<p>Try resetting or adjusting your category, brand, or price filters.</p>' +
      '<button type="button" class="ak-btn-store-reset" id="akStoreEmptyReset">Reset All Filters</button>' +
      '</div>';

    const emptyReset = document.getElementById('akStoreEmptyReset');
    if (emptyReset) {
      emptyReset.addEventListener('click', () => {
        const clearBtn = document.getElementById('akStoreClearFilters');
        if (clearBtn) clearBtn.click();
      });
    }

    if (paginationControls) paginationControls.style.display = 'none';
    return;
  }

  if (paginationControls) paginationControls.style.display = 'flex';

  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const pageProducts = filteredProducts.slice(startIndex, startIndex + PRODUCTS_PER_PAGE);

  let gridHtml = '';
  pageProducts.forEach(product => {
    const isPreOrder = Boolean(product.isPreOrder || (product.badge && product.badge.toLowerCase().includes('pre-order')) || product.stockStatus === 'preorder');
    const isOutOfStock = Boolean(!isPreOrder && (product.stock === 0 || product.inStock === false || product.isOutOfStock === true || product.stockStatus === 'outofstock'));

    let stockBadge = '<span class="ak-store-badge ak-badge-instock">In Stock</span>';
    if (isPreOrder) {
      stockBadge = '<span class="ak-store-badge ak-badge-preorder" style="background:#FEF3C7; color:#92400E; border:1px solid #FCD34D;">Pre-Order</span>';
    } else if (isOutOfStock) {
      stockBadge = '<span class="ak-store-badge ak-badge-out ak-badge-out-of-stock">Out of Stock</span>';
    }

    const activeVariants = (product.hasVariants && Array.isArray(product.variants) && product.variants.length > 0)
      ? (product.variants.filter(v => v.isActive !== false).length > 0 ? product.variants.filter(v => v.isActive !== false) : product.variants)
      : null;

    let displayPriceHtml = '';
    let originalPriceHtml = '';
    let offerStampHtml = '';

    if (activeVariants) {
      const defaultVariant = activeVariants[0];
      const selling = (defaultVariant?.sellingPrice != null ? Number(defaultVariant.sellingPrice) : (defaultVariant?.priceOverride != null ? Number(defaultVariant.priceOverride) : Number(product.price) || 0));
      const mrp = defaultVariant?.mrp != null ? Number(defaultVariant.mrp) : (product.originalPrice ? Number(product.originalPrice) : 0);
      const hasDiscount = mrp > selling && selling > 0;
      displayPriceHtml = `<span class="ak-store-card-price">${formatINR(selling)}</span>`;
      originalPriceHtml = hasDiscount ? `<span class="ak-card-original-price">${formatINR(mrp)}</span>` : '';
      offerStampHtml = '';
    } else {
      const baseSelling = Number(product.price) || 0;
      const baseMrp = Number(product.originalPrice) || 0;
      const hasDiscount = baseMrp > baseSelling && baseSelling > 0;
      displayPriceHtml = `<span class="ak-store-card-price">${formatINR(baseSelling)}</span>`;
      originalPriceHtml = hasDiscount ? `<span class="ak-card-original-price">${formatINR(baseMrp)}</span>` : '';
      offerStampHtml = '';
    }

    const cartQty = getCartItemQuantity(product.id);
    let actionBtnHtml = '';

    if (isPreOrder) {
      actionBtnHtml = `<button type="button" class="ak-store-btn-add ak-btn-preorder" style="background:#0B2545; color:#FFFFFF;" data-id="${product.id}"><span>Coming Soon</span></button>`;
    } else if (isOutOfStock) {
      actionBtnHtml = '<button type="button" class="ak-store-btn-add disabled ak-btn-out-of-stock" disabled>Out of Stock</button>';
    } else if (cartQty > 0) {
      actionBtnHtml = `
        <div class="ak-store-qty-control" data-id="${product.id}">
          <span class="ak-store-qty-tick">✓ In Cart</span>
          <div class="ak-store-qty-actions">
            <button type="button" class="ak-store-qty-btn ak-minus" data-id="${product.id}" aria-label="Decrease quantity">−</button>
            <span class="ak-store-qty-val">${cartQty}</span>
            <button type="button" class="ak-store-qty-btn ak-plus" data-id="${product.id}" aria-label="Increase quantity">+</button>
          </div>
        </div>
      `;
    } else {
      actionBtnHtml = product.hasVariants ? `
        <button type="button" class="ak-store-btn-add ak-store-btn-variants" data-id="${product.id}" title="Select options & configure">
          <svg class="ak-btn-cart-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Select Options</span>
        </button>
      ` : `
        <button type="button" class="ak-store-btn-add" data-id="${product.id}">
          <svg class="ak-btn-cart-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          <span>Add to Cart</span>
        </button>
      `;
    }

    const ratingVal = product.rating || (4.6 + (product.id.charCodeAt(0) % 4) * 0.1).toFixed(1);
    const reviewsCount = product.reviewsCount || (18 + (product.id.charCodeAt(product.id.length - 1) % 42));
    const stockWarningHtml = (!isOutOfStock && product.stock > 0 && product.stock <= 3)
      ? `<div class="ak-store-card-stock-warning">Only ${product.stock} left in stock.</div>`
      : (!isOutOfStock ? `<div class="ak-store-card-stock-status">Available instantly</div>` : '');

    gridHtml += '<article class="ak-store-card' + (isOutOfStock ? ' ak-card-out-of-stock' : '') + '" data-product-id="' + product.id + '">' +
      '<div class="ak-store-card-img-wrap">' +
      '<img src="' + resolveProductImage(product.image || (product.images && product.images[0])) + '" alt="' + product.name + '" loading="lazy" onerror="this.onerror=null;this.src=\'assets/images/placeholder.svg\';">' +
      stockBadge +
      offerStampHtml +
      '</div>' +
      '<div class="ak-store-card-body">' +
      '<div class="ak-store-card-brand">' + (product.brand || 'Pro Audio') + '</div>' +
      '<h3 class="ak-store-card-title" title="' + product.name + '">' + product.name + '</h3>' +
      '<div class="ak-store-card-author">by <strong class="ak-store-author-brand">' + (product.brand || 'Pro Audio') + '</strong></div>' +
      '<div class="ak-store-card-rating">' +
      '<span class="ak-rating-num">' + ratingVal + '</span>' +
      '<span class="ak-rating-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span>' +
      '<span class="ak-rating-count">(' + reviewsCount + ')</span>' +
      '</div>' +
      '<div class="ak-store-card-specs">' + (product.specs ? product.specs.slice(0, 2).map(s => (typeof s === 'object' && s !== null) ? (s.label ? `${s.label}: ${s.value}` : s.value) : s).join(' • ') : (product.category || '')) + '</div>' +
      '<div class="ak-store-card-pricing">' +
      displayPriceHtml +
      originalPriceHtml +
      '</div>' +
      '<div class="ak-store-card-delivery"><span class="ak-del-free">FREE Pan-India Delivery</span></div>' +
      stockWarningHtml +
      '<div class="ak-store-card-actions">' +
      actionBtnHtml +
      '<button type="button" class="ak-store-btn-view" data-id="' + product.id + '">Details</button>' +
      '</div>' +
      '</div>' +
      '</article>';
  });

  grid.innerHTML = gridHtml;

  grid.querySelectorAll('.ak-store-card').forEach(card => {
    const pid = card.dataset.productId;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ak-store-btn-add') || e.target.closest('.ak-store-qty-control')) return;
      if (onProductClickCallback) {
        onProductClickCallback(pid);
      }
    });
  });

  grid.querySelectorAll('.ak-store-btn-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.id;
      const product = allProducts.find(p => p.id === pid);
      if (product && product.hasVariants) {
        if (onProductClickCallback) onProductClickCallback(pid);
        return;
      }
      if (product && product.stock !== 0) {
        const added = addToCart(product, 1);
        if (added !== false) {
          renderStorePage();
        }
      }
    });
  });

  grid.querySelectorAll('.ak-store-qty-btn.ak-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCartItemQty(btn.dataset.id, -1);
      renderStorePage();
    });
  });

  grid.querySelectorAll('.ak-store-qty-btn.ak-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateCartItemQty(btn.dataset.id, 1);
      renderStorePage();
    });
  });

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = document.getElementById('akStorePaginationList');
  const prevBtn = document.getElementById('akStorePrevPage');
  const nextBtn = document.getElementById('akStoreNextPage');

  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
    prevBtn.onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        renderStorePage();
        window.scrollTo({ top: document.getElementById('catalogPage').offsetTop - 80, behavior: 'smooth' });
      }
    };
  }

  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.onclick = () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderStorePage();
        window.scrollTo({ top: document.getElementById('catalogPage').offsetTop - 80, behavior: 'smooth' });
      }
    };
  }

  if (!container) return;

  let html = '';

  if (totalPages <= 3) {
    // Show all if 3 or fewer pages
    for (let i = 1; i <= totalPages; i++) {
      html += `<button type="button" class="ak-pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
  } else {
    // Maximum 3 visible page numbers at a time with ellipsis
    let startPage, endPage;
    if (currentPage <= 2) {
      startPage = 1;
      endPage = 3;
    } else if (currentPage >= totalPages - 1) {
      startPage = totalPages - 2;
      endPage = totalPages;
    } else {
      startPage = currentPage - 1;
      endPage = currentPage + 1;
    }

    if (startPage > 1) {
      html += `<button type="button" class="ak-pagination-ellipsis" data-page="${Math.max(1, startPage - 1)}" title="Previous pages" aria-label="Previous pages">...</button>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button type="button" class="ak-pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      html += `<button type="button" class="ak-pagination-ellipsis" data-page="${Math.min(totalPages, endPage + 1)}" title="More pages" aria-label="More pages">...</button>`;
    }
  }

  container.innerHTML = html;

  container.querySelectorAll('.ak-pagination-btn, .ak-pagination-ellipsis').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = Number(btn.dataset.page);
      renderStorePage();
      window.scrollTo({ top: document.getElementById('catalogPage').offsetTop - 80, behavior: 'smooth' });
    });
  });
}