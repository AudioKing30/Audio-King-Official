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
    brands = AUDIOKING_BRANDS.map(b => (b.name || '').trim()).filter(Boolean);
  }

  // Deduplicate and sort: prioritize Arowana first (if present), then alphabetical
  const uniqueBrands = Array.from(new Set(brands)).sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower.includes('arowana')) return -1;
    if (bLower.includes('arowana')) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

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
 * Categorizes items appropriately into Pro Audio and Musical Instruments
 */
export function renderNavigationCategories(categoriesList) {
  if (!Array.isArray(categoriesList) || categoriesList.length === 0) return;

  // Build map of category names to explicit section if available
  const sectionMap = new Map();
  const rawCats = [];

  categoriesList.forEach(c => {
    let name = '';
    let sec = null;
    if (typeof c === 'string') {
      name = c.trim();
    } else if (c && typeof c === 'object') {
      name = (c.name || '').trim();
      sec = c.section || null;
    }
    if (name.toLowerCase() === 'power supply cabels') name = 'Power Supply Cables';
    if (name) {
      rawCats.push(name);
      if (sec) sectionMap.set(name.toLowerCase(), sec);
    }
  });

  const uniqueCats = Array.from(new Set(rawCats)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  // Musical Instruments categories keywords
  const musicalKeywords = ['keyboard', 'synth', 'piano', 'drum', 'guitar amp', 'amplifier'];
  
  // Specific categories that MUST be in Pro Audio per user requirement (especially Arowana Audioglyphs categories)
  const arowanaProAudioKeywords = [
    'power conditioner',
    'guitar pedal power supply',
    'power supply',
    'power supplies',
    'power cable',
    'power supply cable',
    'cable',
    'cabel',
    'microphone cable',
    'instrument cable'
  ];

  const musicalCats = [];
  const proAudioCats = [];

  uniqueCats.forEach(cat => {
    const lower = cat.toLowerCase();
    const explicitSection = sectionMap.get(lower);

    if (explicitSection === 'musical-instruments') {
      musicalCats.push(cat);
    } else if (explicitSection === 'pro-audio') {
      proAudioCats.push(cat);
    } else if (arowanaProAudioKeywords.some(kw => lower.includes(kw))) {
      proAudioCats.push(cat);
    } else if (musicalKeywords.some(kw => lower.includes(kw))) {
      musicalCats.push(cat);
    } else if (lower.includes('pedal') || lower.includes('effect')) {
      musicalCats.push(cat);
    } else {
      proAudioCats.push(cat);
    }
  });

  const finalProAudio = Array.from(new Set(proAudioCats)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const finalMusical = Array.from(new Set(musicalCats)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  // 1. Desktop Pro Audio Dropdown Grid
  const proAudioGrid = document.getElementById('akProAudioDropdownGrid');
  if (proAudioGrid && finalProAudio.length > 0) {
    const half = Math.ceil(finalProAudio.length / 2);
    const col1 = finalProAudio.slice(0, half);
    const col2 = finalProAudio.slice(half);

    proAudioGrid.innerHTML = `
      <div class="ak-proaudio-col">
        ${col1.map(c => `
          <a href="#store?category=${encodeURIComponent(c)}" class="ak-nav-drop-item ak-cat-filter-link" data-cat="${c}">
            ${c}
          </a>
        `).join('')}
      </div>
      <div class="ak-proaudio-col">
        ${col2.map(c => `
          <a href="#store?category=${encodeURIComponent(c)}" class="ak-nav-drop-item ak-cat-filter-link" data-cat="${c}">
            ${c}
          </a>
        `).join('')}
      </div>
    `;

    proAudioGrid.querySelectorAll('.ak-cat-filter-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const catText = link.dataset.cat || link.textContent.trim();
        const parentNavItem = link.closest('.ak-nav-item');
        if (parentNavItem) {
          dismissDropdown(parentNavItem);
          setActiveNavItem(parentNavItem);
        }
        window.dispatchEvent(new CustomEvent('ak:filter-category', { detail: catText }));
      });
    });
  }

  // 2. Desktop Musical Instruments Dropdown List
  const musicalList = document.getElementById('akMusicalDropdownList');
  if (musicalList && finalMusical.length > 0) {
    musicalList.innerHTML = finalMusical.map(c => `
      <a href="#store?category=${encodeURIComponent(c)}" class="ak-nav-drop-item ak-cat-filter-link" data-cat="${c}">
        ${c}
      </a>
    `).join('');

    musicalList.querySelectorAll('.ak-cat-filter-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const catText = link.dataset.cat || link.textContent.trim();
        const parentNavItem = link.closest('.ak-nav-item');
        if (parentNavItem) {
          dismissDropdown(parentNavItem);
          setActiveNavItem(parentNavItem);
        }
        window.dispatchEvent(new CustomEvent('ak:filter-category', { detail: catText }));
      });
    });
  }

  // 3. Mobile Drawer Pro Audio Accordion
  const mobProAudio = document.getElementById('akMobProAudio');
  if (mobProAudio && finalProAudio.length > 0) {
    mobProAudio.innerHTML = finalProAudio.map(catName => `
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

  // 4. Mobile Drawer Musical Instruments Accordion
  const mobMusical = document.getElementById('akMobMusical');
  if (mobMusical && finalMusical.length > 0) {
    mobMusical.innerHTML = finalMusical.map(catName => `
      <a href="#store?category=${encodeURIComponent(catName)}" class="ak-mobile-sub-link ak-mob-cat-link" data-cat="${catName}">
        ${catName}
      </a>
    `).join('');

    mobMusical.querySelectorAll('.ak-mob-cat-link').forEach(link => {
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

  // Desktop Brands nav dropdown click: redirect to first brand & shut dropdown immediately
  const brandsToggle = document.getElementById('akBrandsNavToggle');
  const brandsItem = document.getElementById('akNavItemBrands') || document.getElementById('akNavBrandsItem');
  if (brandsToggle && brandsItem) {
    brandsToggle.addEventListener('click', (e) => {
      e.preventDefault();
      dismissDropdown(brandsItem);
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      setActiveNavItem(brandsItem);
      const firstBrandEl = brandsItem.querySelector('.ak-brand-filter-link');
      const firstBrandName = firstBrandEl?.dataset?.brand || firstBrandEl?.textContent?.trim() || 'ADAM Audio';
      window.dispatchEvent(new CustomEvent('ak:filter-brand', { detail: firstBrandName }));
    });
  }

  // Desktop Pro Audio nav link click: redirect to Pro Audio & shut dropdown
  const proAudioItem = document.getElementById('akNavItemProAudio');
  const proAudioLink = proAudioItem?.querySelector(':scope > .ak-nav-link');
  if (proAudioLink && proAudioItem) {
    proAudioLink.addEventListener('click', (e) => {
      e.preventDefault();
      dismissDropdown(proAudioItem);
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      setActiveNavItem(proAudioItem);
      window.dispatchEvent(new CustomEvent('ak:filter-category', { detail: 'Audio Interfaces' }));
    });
  }

  // Desktop Musical Instruments nav link click: redirect to first category (Keyboards) & shut dropdown
  const musicalItem = document.getElementById('akNavItemMusical');
  const musicalLink = musicalItem?.querySelector(':scope > .ak-nav-link');
  if (musicalLink && musicalItem) {
    musicalLink.addEventListener('click', (e) => {
      e.preventDefault();
      dismissDropdown(musicalItem);
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      setActiveNavItem(musicalItem);
      const firstMusicalEl = musicalItem.querySelector('.ak-cat-filter-link');
      const firstCatName = firstMusicalEl?.dataset?.cat || firstMusicalEl?.textContent?.trim() || 'Keyboards';
      window.dispatchEvent(new CustomEvent('ak:filter-category', { detail: firstCatName }));
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
