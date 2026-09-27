/**
 * AudioKing Dynamic Landscape Hero Carousel
 * Auto-rotates every 3s with pause-on-hover & smooth manual / touch controls.
 * Supports dynamic slides configured from Admin Panel.
 */
import { resolveProductImage } from '../utils/formatters.js';

let activeAutoPlayTimer = null;

export function renderHeroSlidesHtml(slides) {
  const track = document.getElementById('akHeroTrack');
  const dotsContainer = document.querySelector('.ak-hero-dots');
  if (!track || !slides || !slides.length) return false;

  track.innerHTML = slides.map((slide, idx) => {
    const bgUrl = resolveProductImage(slide.image_url || slide.imageUrl || 'assets/images/hero/hero-slide-1.png');
    const eyebrowHtml = slide.eyebrow ? `<span class="ak-hero-eyebrow">${slide.eyebrow}</span>` : '';
    const accentHtml = slide.accent_text || slide.accentText ? `<span class="ak-hero-accent">${slide.accent_text || slide.accentText}</span>` : '';
    const subtitleHtml = slide.subtitle ? `<p class="ak-hero-subtitle">${slide.subtitle}</p>` : '';
    const ctaText = slide.cta_text || slide.ctaText || 'Explore Pro Audio';
    const ctaLink = slide.cta_link || slide.ctaLink || '#catalog';

    return `
      <div class="ak-hero-slide ${idx === 0 ? 'active' : ''}" style="background-image: url('${bgUrl}');">
        <div class="ak-hero-overlay"></div>
        <div class="ak-hero-content">
          ${eyebrowHtml}
          <h1 class="ak-hero-title">${slide.title} ${accentHtml}</h1>
          ${subtitleHtml}
          <a href="${ctaLink}" class="ak-hero-cta">${ctaText} <span class="ak-cta-arrow">&rarr;</span></a>
        </div>
      </div>
    `;
  }).join('');

  if (dotsContainer) {
    dotsContainer.innerHTML = slides.map((_, idx) => `
      <div class="ak-hero-dot ${idx === 0 ? 'active' : ''}" data-slide="${idx}"></div>
    `).join('');
  }

  return true;
}

export function initHeroSlider() {
  const slides = document.querySelectorAll('.ak-hero-slide');
  const dots = document.querySelectorAll('.ak-hero-dot');
  const prevBtn = document.getElementById('akHeroPrevBtn');
  const nextBtn = document.getElementById('akHeroNextBtn');
  const container = document.getElementById('akHeroSection');

  if (!slides.length) return;

  if (activeAutoPlayTimer) {
    clearInterval(activeAutoPlayTimer);
    activeAutoPlayTimer = null;
  }

  let currentIndex = 0;
  const slideInterval = 3500;

  function showSlide(index) {
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
    currentIndex = index;
  }

  function nextSlide() {
    const next = (currentIndex + 1) % slides.length;
    showSlide(next);
  }

  function prevSlide() {
    const prev = (currentIndex - 1 + slides.length) % slides.length;
    showSlide(prev);
  }

  function startAutoPlay() {
    stopAutoPlay();
    activeAutoPlayTimer = setInterval(nextSlide, slideInterval);
  }

  function stopAutoPlay() {
    if (activeAutoPlayTimer) {
      clearInterval(activeAutoPlayTimer);
      activeAutoPlayTimer = null;
    }
  }

  // Events
  if (nextBtn) {
    nextBtn.onclick = () => { nextSlide(); startAutoPlay(); };
  }
  if (prevBtn) {
    prevBtn.onclick = () => { prevSlide(); startAutoPlay(); };
  }

  dots.forEach((dot, index) => {
    dot.onclick = () => {
      showSlide(index);
      startAutoPlay();
    };
  });

  // Pause on hover
  if (container) {
    container.onmouseenter = stopAutoPlay;
    container.onmouseleave = startAutoPlay;

    // Touch swipe support for mobile sliding
    let touchStartX = 0;
    let touchStartY = 0;

    container.ontouchstart = (e) => {
      if (e.touches && e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    };

    container.ontouchend = (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;

        if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
          if (diffX > 0) {
            nextSlide();
          } else {
            prevSlide();
          }
          startAutoPlay();
        }
      }
    };
  }

  showSlide(0);
  startAutoPlay();
}

/**
 * Load dynamic hero slides from server/local storage and initialize carousel
 */
export async function loadAndInitHeroSlider() {
  // Try localStorage first for instant rendering
  try {
    const local = localStorage.getItem('audioking_hero_slides');
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed) && parsed.length > 0) {
        renderHeroSlidesHtml(parsed.filter(s => s.is_active !== 0 && s.is_active !== false));
      }
    }
  } catch (e) {}

  initHeroSlider();

  // Then fetch fresh from API
  try {
    const apiBase = typeof window !== 'undefined' && typeof window.getAudioKingApiBase === 'function'
      ? window.getAudioKingApiBase()
      : '';
    const res = await fetch(`${apiBase}/api/hero-slides`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.slides) && data.slides.length > 0) {
        localStorage.setItem('audioking_hero_slides', JSON.stringify(data.slides));
        const rendered = renderHeroSlidesHtml(data.slides.filter(s => s.is_active !== 0 && s.is_active !== false));
        if (rendered) {
          initHeroSlider();
        }
      }
    }
  } catch (err) {
    // Gracefully fallback to static slides in HTML
  }
}

// Global listener for live admin updates
if (typeof window !== 'undefined') {
  window.addEventListener('ak:hero-sync', () => {
    loadAndInitHeroSlider();
  });
}
