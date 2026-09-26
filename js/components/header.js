/**
 * AudioKing Header & Search Autocomplete Controller
 */
import { AUDIOKING_PRODUCTS } from '../data/products.js';
import { AUDIOKING_BRANDS } from '../data/brands.js';
import { formatINR } from '../utils/formatters.js';

export function initHeader() {
  const header = document.querySelector('.ak-header');
  const searchInput = document.getElementById('akSearchInput');
  const suggestionsBox = document.getElementById('akSearchSuggestions');
  const searchForm = document.getElementById('akSearchForm');

  // Sticky shadow listener
  window.addEventListener('scroll', () => {
    if (window.scrollY > 24) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  }, { passive: true });

  // Real-time Search Autocomplete
  if (searchInput && suggestionsBox) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (q.length < 2) {
        suggestionsBox.classList.remove('active');
        suggestionsBox.innerHTML = '';
        return;
      }

      // 1. Matching brands
      const matchingBrands = AUDIOKING_BRANDS.filter(b => b.name.toLowerCase().includes(q)).slice(0, 3);

      // 2. Matching categories
      const categories = [...new Set(AUDIOKING_PRODUCTS.map(p => p.category))];
      const matchingCategories = categories.filter(c => c.toLowerCase().includes(q)).slice(0, 3);

      // 3. Matching products
      const matchingProducts = AUDIOKING_PRODUCTS.filter(p => 
        p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
      ).slice(0, 5);

      if (!matchingBrands.length && !matchingCategories.length && !matchingProducts.length) {
        suggestionsBox.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--ak-text-muted); font-size: 13px;">No products or brands found for "${e.target.value}"</div>`;
        suggestionsBox.classList.add('active');
        return;
      }

      let html = '';

      if (matchingBrands.length) {
        html += `<div class="ak-suggestion-header">Matching Brands</div>`;
        matchingBrands.forEach(b => {
          html += `
            <div class="ak-suggestion-item ak-search-brand-click" data-brand="${b.name}">
              <span style="font-weight: 700; color: var(--ak-navy);">${b.name}</span>
              <span class="ak-suggestion-meta">${b.productCount} gear items</span>
            </div>
          `;
        });
      }

      if (matchingCategories.length) {
        html += `<div class="ak-suggestion-header">Categories</div>`;
        matchingCategories.forEach(c => {
          html += `
            <div class="ak-suggestion-item ak-search-cat-click" data-cat="${c}">
              <span>${c}</span>
              <span class="ak-suggestion-meta">Category</span>
            </div>
          `;
        });
      }

      if (matchingProducts.length) {
        html += `<div class="ak-suggestion-header">Matching Gear</div>`;
        matchingProducts.forEach(p => {
          html += `
            <div class="ak-suggestion-item ak-search-prod-click" data-id="${p.id}">
              <div>
                <span style="font-size: 11px; font-weight: 700; color: var(--ak-orange); text-transform: uppercase;">${p.brand}</span>
                <div style="font-weight: 600;">${p.name}</div>
              </div>
              <span class="ak-suggestion-price">${formatINR(p.price)}</span>
            </div>
          `;
        });
      }

      suggestionsBox.innerHTML = html;
      suggestionsBox.classList.add('active');

      // Click handlers for suggestions
      suggestionsBox.querySelectorAll('.ak-search-brand-click').forEach(item => {
        item.addEventListener('click', () => {
          const brand = item.dataset.brand;
          searchInput.value = brand;
          suggestionsBox.classList.remove('active');
          window.dispatchEvent(new CustomEvent('ak:search-brand', { detail: brand }));
        });
      });
      suggestionsBox.querySelectorAll('.ak-search-cat-click').forEach(item => {
        item.addEventListener('click', () => {
          const cat = item.dataset.cat;
          searchInput.value = cat;
          suggestionsBox.classList.remove('active');
          window.dispatchEvent(new CustomEvent('ak:search-cat', { detail: cat }));
        });
      });
      suggestionsBox.querySelectorAll('.ak-search-prod-click').forEach(item => {
        item.addEventListener('click', () => {
          const pId = item.dataset.id;
          suggestionsBox.classList.remove('active');
          window.dispatchEvent(new CustomEvent('ak:search-prod', { detail: pId }));
        });
      });
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
        suggestionsBox.classList.remove('active');
      }
    });
  }

  // Handle form search
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = searchInput?.value.trim();
      if (val) {
        suggestionsBox?.classList.remove('active');
        window.dispatchEvent(new CustomEvent('ak:search-submit', { detail: val }));
      }
    });
  }
}
