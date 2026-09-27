/**
 * AudioKing Navigation Bar & Mobile Accordion Controller
 */
import { AUDIOKING_BRANDS } from '../data/brands.js';

export function setActiveNavItem(targetIdOrElement) {
  document.querySelectorAll('.ak-nav-item').forEach(item => {
    item.classList.remove('active');
  });

  let targetEl = null;
  if (typeof targetIdOrElement === 'string') {
    targetEl = document.getElementById(targetIdOrElement) ||
               document.getElementById(`akNavItem${targetIdOrElement.charAt(0).toUpperCase() + targetIdOrElement.slice(1)}`);
  } else if (targetIdOrElement && targetIdOrElement.closest) {
    targetEl = targetIdOrElement.closest('.ak-nav-item');
  }

  if (targetEl) {
    targetEl.classList.add('active');
  }
}

function dismissDropdown(navItem) {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  if (!navItem) return;
  navItem.classList.add('dropdown-closed');
  navItem.classList.remove('dropdown-open');

  const onMouseLeave = () => {
    navItem.classList.remove('dropdown-closed');
    navItem.removeEventListener('mouseleave', onMouseLeave);
  };
  navItem.addEventListener('mouseleave', onMouseLeave);

  setTimeout(() => {
    navItem.classList.remove('dropdown-closed');
  }, 450);
}

/**
 * Dynamically render brands in both desktop navbar dropdown and mobile drawer
 */
export function renderNavigationBrands(brandsList) {
  let brands = [];
  if (Array.isArray(brandsList) && brandsList.length > 0) {
    brands = brandsList.map(b => (typeof b === 'string' ? b : (b.name || '')).trim()).filter(Boolean);
  } else {
    brands = AUDIOKING_BRANDS.map(b => b.name);
  }

  // Deduplicate and sort alphabetically case-insensitively
  const uniqueBrands = Array.from(new Set(brands)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  // 1. Desktop Brands Dropdown
  const brandsGrid = document.getElementById('akBrandsDropdownGrid');
  if (brandsGrid && uniqueBrands.length > 0) {
    const chunkSize = 10;
    const cols = [];
    for (let i = 0; i < uniqueBrands.length; i += chunkSize) {
      cols.push(uniqueBrands.slice(i, i + chunkSize));
    }

    brandsGrid.innerHTML = cols.map(col => `
      <div class="ak-brands-col">
        ${col.map(brandName => `
          <a href="#store?brand=${encodeURIComponent(brandName)}" class="ak-nav-drop-item ak-brand-filter-link" data-brand="${brandName}">
            ${brandName}
          </a>
        `).join('')}
      </div>
    `).join('');

    brandsGrid.querySelectorAll('.ak-brand-filter-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const brandName = link.dataset.brand;
        const brandsItem = document.getElementById('akNavItemBrands') || document.getElementById('akNavBrandsItem');
        if (brandsItem) {
          dismissDropdown(brandsItem);
          setActiveNavItem(brandsItem);
        }
        window.dispatchEvent(new CustomEvent('ak:filter-brand', { detail: brandName }));
      });
    });
  }

  // 2. Mobile Drawer Brands Accordion
  const mobBrandsContainer = document.getElementById('akMobBrands');
  if (mobBrandsContainer && uniqueBrands.length > 0) {
    mobBrandsContainer.innerHTML = uniqueBrands.map(brandName => `
      <a href="#store?brand=${encodeURIComponent(brandName)}" class="ak-mobile-sub-link ak-mob-brand-link" data-brand="${brandName}">
        ${brandName}
      </a>
    `).join('');

    mobBrandsContainer.querySelectorAll('.ak-mob-brand-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const brandName = link.dataset.brand;
        const mobileDrawer = document.getElementById('akMobileDrawer');
        if (mobileDrawer) {
          mobileDrawer.classList.remove('open');
          document.body.style.overflow = '';
        }
        const brandsItem = document.getElementById('akNavItemBrands') || document.getElementById('akNavBrandsItem');
        if (brandsItem) {
          setActiveNavItem(brandsItem);
        }
        window.dispatchEvent(new CustomEvent('ak:filter-brand', { detail: brandName }));
      });
    });
  }
}

/**
 * Dynamically render categories in mobile drawer and desktop navigation
 */
export function renderNavigationCategories(categoriesList) {
  if (!Array.isArray(categoriesList) || categoriesList.length === 0) return;

  const cats = categoriesList.map(c => (typeof c === 'string' ? c : (c.name || '')).trim()).filter(Boolean);
  const uniqueCats = Array.from(new Set(cats)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  // Mobile Drawer Pro Audio Categories
  const mobProAudio = document.getElementById('akMobProAudio');
  if (mobProAudio && uniqueCats.length > 0) {
    mobProAudio.innerHTML = uniqueCats.map(catName => `
      <a href="#store?category=${encodeURIComponent(catName)}" class="ak-mobile-sub-link ak-mob-cat-link" data-cat="${catName}">
        ${catName}
      </a>
    `).join('');

    mobProAudio.querySelectorAll('.ak-mob-cat-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const catText = link.dataset.cat || link.textContent.trim();
        const mobileDrawer = document.getElementById('akMobileDrawer');
        if (mobileDrawer) {
          mobileDrawer.classList.remove('open');
          document.body.style.overflow = '';
        }
        window.dispatchEvent(new CustomEvent('ak:filter-category', { detail: catText }));
      });
    });
  }
}

export function initNavigation() {
  // Populate initial Brands dropdown & Mobile brands
  renderNavigationBrands(AUDIOKING_BRANDS);

  // Re-sync navigation whenever products or catalog meta changes
  window.addEventListener('ak:products-updated', (e) => {
    const products = e.detail;
    if (Array.isArray(products) && products.length > 0) {
      const liveBrands = Array.from(new Set(products.map(p => (p.brand || '').trim()).filter(Boolean)));
      const liveCategories = Array.from(new Set(products.map(p => (p.category || '').trim()).filter(Boolean)));
      renderNavigationBrands(liveBrands);
      renderNavigationCategories(liveCategories);
    }
  });

  // Mobile drawer links: Home navigation
  document.querySelectorAll('.ak-mobile-home-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const mobileDrawer = document.getElementById('akMobileDrawer');
      if (mobileDrawer) {
        mobileDrawer.classList.remove('open');
        document.body.style.overflow = '';
      }
      setActiveNavItem('akNavItemHome');
      if (typeof window.showHome === 'function') {
        window.showHome();
      } else {
        window.location.hash = '#home';
      }
    });
  });

  // Mobile drawer links: Account / Orders
  document.getElementById('akMobProfileTrigger')?.addEventListener('click', (e) => {
    e.preventDefault();
    const mobileDrawer = document.getElementById('akMobileDrawer');
    if (mobileDrawer) {
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (typeof window.showAccountSettings === 'function') {
      window.showAccountSettings('account');
    } else {
      window.location.hash = '#account';
    }
  });

  // Desktop Category navigation dropdown links
  document.querySelectorAll('.ak-navbar .ak-nav-dropdown a.ak-nav-drop-item:not(.ak-brand-filter-link)').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const catText = link.textContent.trim();
      const parentNavItem = link.closest('.ak-nav-item');
      if (parentNavItem) {
        dismissDropdown(parentNavItem);
        setActiveNavItem(parentNavItem);
      }
      window.dispatchEvent(new CustomEvent('ak:filter-category', { detail: catText }));
    });
  });

  // Top level nav link click tracking to highlight active option
  document.querySelectorAll('.ak-navbar .ak-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const parentItem = link.closest('.ak-nav-item');
      if (parentItem) {
        setActiveNavItem(parentItem);
      }
    });
  });

  // Desktop Brands nav dropdown click toggle
  const brandsToggle = document.getElementById('akBrandsNavToggle');
  const brandsItem = document.getElementById('akNavItemBrands') || document.getElementById('akNavBrandsItem');
  if (brandsToggle && brandsItem) {
    brandsToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      brandsItem.classList.remove('dropdown-closed');
      brandsItem.classList.toggle('dropdown-open');
    });

    document.addEventListener('click', (e) => {
      if (!brandsItem.contains(e.target)) {
        brandsItem.classList.remove('dropdown-open');
      }
    });
  }

  // Mobile drawer menu open / close
  const mobileBtn = document.getElementById('akMobileMenuBtn');
  const mobileDrawer = document.getElementById('akMobileDrawer');
  const mobileClose = document.getElementById('akMobileDrawerClose');

  if (mobileBtn && mobileDrawer) {
    mobileBtn.addEventListener('click', () => {
      mobileDrawer.classList.add('open');
      document.body.style.overflow = 'hidden';
      const content = mobileDrawer.querySelector('.ak-mobile-drawer-content');
      if (content) content.scrollTop = 0;
    });
  }
  if (mobileClose && mobileDrawer) {
    mobileClose.addEventListener('click', () => {
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
  if (mobileDrawer) {
    mobileDrawer.addEventListener('click', (e) => {
      if (e.target === mobileDrawer) {
        mobileDrawer.classList.remove('open');
        document.body.style.overflow = '';
      }
    });

    mobileDrawer.querySelectorAll('.ak-mobile-sub-link, .ak-drawer-nav-link, .ak-contact-trigger').forEach(link => {
      link.addEventListener('click', () => {
        mobileDrawer.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // Mobile Accordions
  document.querySelectorAll('.ak-mobile-accordion-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = toggle.dataset.target;
      const body = document.getElementById(targetId);
      if (body) {
        body.classList.toggle('open');
      }
    });
  });
}
