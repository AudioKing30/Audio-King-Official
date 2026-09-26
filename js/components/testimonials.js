/**
 * AudioKing Testimonials — Infinite Card Carousel Controller
 * Seamless infinite loop with NO backward rewind.
 * Arrow navigation + dots + auto-scroll with pause on hover.
 */

const AUTO_ADVANCE_DELAY = 2800;

export function initTestimonials() {
  const track = document.getElementById('akTCardTrack');
  const viewport = document.getElementById('akTCardViewport');
  const section = document.getElementById('akTestimonialsSection');
  const dots = document.querySelectorAll('.ak-tcard-dot');
  const prevBtn = document.getElementById('akTCardPrevBtn');
  const nextBtn = document.getElementById('akTCardNextBtn');

  if (!track || !viewport) return;

  // 1. Clone cards for seamless infinite continuation
  const originalCards = Array.from(track.querySelectorAll('.ak-tcard:not([data-clone="true"])'));
  const originalCount = originalCards.length || 5;

  if (!track.querySelector('[data-clone="true"]')) {
    originalCards.forEach(card => {
      const clone = card.cloneNode(true);
      clone.setAttribute('data-clone', 'true');
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
  }

  let currentIndex = 0;
  let isAnimating = false;
  let autoTimer = null;

  function getGap() {
    return 20;
  }

  function getStep() {
    const firstCard = track.querySelector('.ak-tcard');
    if (!firstCard) return 0;
    return firstCard.offsetWidth + getGap();
  }

  function updateDots() {
    const activeDotIndex = currentIndex % originalCount;
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeDotIndex);
    });
  }

  function applyTransform(index, animate = true) {
    const step = getStep();
    if (animate) {
      isAnimating = true;
      track.style.transition = 'transform 0.52s cubic-bezier(0.25, 0.85, 0.4, 1)';
    } else {
      track.style.transition = 'none';
    }
    track.style.transform = `translateX(-${index * step}px)`;
  }

  function next() {
    if (isAnimating) return;
    currentIndex++;
    applyTransform(currentIndex, true);
    updateDots();
  }

  function prev() {
    if (isAnimating) return;
    if (currentIndex <= 0) {
      // Instantly jump to cloned counterpart, then animate backwards
      currentIndex = originalCount;
      applyTransform(currentIndex, false);
      // Force reflow
      void track.offsetHeight;
    }
    currentIndex--;
    applyTransform(currentIndex, true);
    updateDots();
  }

  // Handle transition end to achieve seamless infinite loop
  track.addEventListener('transitionend', () => {
    isAnimating = false;
    // When we scroll past the last original card into the clones:
    if (currentIndex >= originalCount) {
      currentIndex = currentIndex % originalCount;
      applyTransform(currentIndex, false);
    }
    updateDots();
  });

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(next, AUTO_ADVANCE_DELAY);
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  // Controls
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      next();
      startAuto();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      prev();
      startAuto();
    });
  }

  dots.forEach((dot, idx) => {
    dot.addEventListener('click', () => {
      if (isAnimating) return;
      currentIndex = idx;
      applyTransform(currentIndex, true);
      updateDots();
      startAuto();
    });
  });

  // Keep slideshow running indefinitely without pause on hover per user requirement
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      startAuto();
    }
  });

  // Window resize handler
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyTransform(currentIndex, false);
    }, 100);
  });

  // Initial setup
  applyTransform(0, false);
  updateDots();
  startAuto();
}
