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

export function initNavigation() {
  // Populate Brands dropdown (10 items per column, shifting overflow to new right columns)
  const brandsGrid = document.getElementById('akBrandsDropdownGrid');
  if (brandsGrid) {
    const chunkSize = 10;
    const cols = [];
    for (let i = 0; i < AUDIOKING_BRANDS.length; i += chunkSize) {
      cols.push(AUDIOKING_BRANDS.slice(i, i + chunkSize));
    }

    brandsGrid.innerHTML = cols.map(col => `
      <div class="ak-brands-col">
        ${col.map(b => `
          <a href="#catalog" class="ak-nav-drop-item ak-brand-filter-link" data-brand="${b.name}">
            ${b.name}
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

  // Mobile drawer links: Brand filtering
  document.querySelectorAll('.ak-mob-brand-link').forEach(link => {
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

  // Mobile drawer links: Category filtering
  document.querySelectorAll('.ak-mob-cat-link').forEach(link => {
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
