/**
 * AudioKing Testimonials — Discrete 3-Block Infinite Carousel
 * Every 1.5s, 1 block smoothly advances to the left.
 * Seamless infinite loop with cloned cards, safe transition reset, arrow controls & dots.
 */

const ADVANCE_INTERVAL = 7000; // 7s per block move (slowed down from 1.5s)
const TRANSITION_DURATION = 520; // 0.52s smooth cubic-bezier slide

export function initTestimonials() {
  const track = document.getElementById('akTCardTrack');
  const viewport = document.getElementById('akTCardViewport');
  const dots = Array.from(document.querySelectorAll('.ak-tcard-dot'));
  const prevBtn = document.getElementById('akTCardPrevBtn');
  const nextBtn = document.getElementById('akTCardNextBtn');

  if (!track || !viewport) return;

  // Clean up any existing clones
  track.querySelectorAll('[data-clone="true"]').forEach(el => el.remove());

  // Original cards
  const originalCards = Array.from(track.querySelectorAll('.ak-tcard:not([data-clone="true"])'));
  const originalCount = originalCards.length || 5;

  // Clone original cards once for seamless infinite continuation
  originalCards.forEach(card => {
    const clone = card.cloneNode(true);
    clone.setAttribute('data-clone', 'true');
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
  });

  let currentIndex = 0;
  let isAnimating = false;
  let autoTimer = null;
  let safetyTimeout = null;

  function getStep() {
    const allCards = track.querySelectorAll('.ak-tcard');
    if (allCards.length >= 2) {
      const dist = allCards[1].offsetLeft - allCards[0].offsetLeft;
      if (dist > 0) return dist;
    }
    const firstCard = track.querySelector('.ak-tcard');
    if (firstCard) {
      const w = firstCard.getBoundingClientRect().width || firstCard.offsetWidth;
      const gap = parseFloat(window.getComputedStyle(track).gap) || 20;
      if (w > 0) return w + gap;
    }
    if (viewport && viewport.offsetWidth > 0) {
      return ((viewport.offsetWidth - 40) / 3) + 20;
    }
    return 400;
  }

  function updateDots() {
    const activeDotIndex = ((currentIndex % originalCount) + originalCount) % originalCount;
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === activeDotIndex);
    });
  }

  function applyTransform(index, animate = true) {
    const step = getStep();
    clearTimeout(safetyTimeout);

    if (animate) {
      isAnimating = true;
      track.style.transition = `transform ${TRANSITION_DURATION}ms cubic-bezier(0.25, 0.85, 0.4, 1)`;
      track.style.transform = `translateX(-${index * step}px)`;

      // Safety timeout: guarantees isAnimating NEVER gets stuck even if transitionend is swallowed
      safetyTimeout = setTimeout(() => {
        onTransitionDone();
      }, TRANSITION_DURATION + 60);
    } else {
      track.style.transition = 'none';
      track.style.transform = `translateX(-${index * step}px)`;
      void track.offsetHeight; // Force reflow
      isAnimating = false;
    }
  }

  function onTransitionDone() {
    clearTimeout(safetyTimeout);
    isAnimating = false;

    // Seamless loop: when sliding past last original card into clones, instantly jump back
    if (currentIndex >= originalCount) {
      currentIndex = currentIndex % originalCount;
      applyTransform(currentIndex, false);
    } else if (currentIndex < 0) {
      currentIndex = originalCount + (currentIndex % originalCount);
      applyTransform(currentIndex, false);
    }
    updateDots();
  }

  track.addEventListener('transitionend', (e) => {
    if (e.target === track && isAnimating) {
      onTransitionDone();
    }
  });

  function next() {
    if (isAnimating) return;
    currentIndex++;
    applyTransform(currentIndex, true);
    updateDots();
  }

  function prev() {
    if (isAnimating) return;
    if (currentIndex <= 0) {
      // Jump to clone position instantly, then animate backward
      currentIndex = originalCount;
      applyTransform(currentIndex, false);
    }
    currentIndex--;
    applyTransform(currentIndex, true);
    updateDots();
  }

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(next, ADVANCE_INTERVAL);
  }

  function stopAuto() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  // Arrow navigation
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      next();
      startAuto();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      prev();
      startAuto();
    });
  }

  // Dots navigation
  dots.forEach((dot, idx) => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      if (isAnimating) return;
      currentIndex = idx;
      applyTransform(currentIndex, true);
      updateDots();
      startAuto();
    });
  });

  // Re-sync on window resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyTransform(currentIndex, false);
    }, 100);
  });

  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      startAuto();
    } else {
      stopAuto();
    }
  });

  // Start immediately so it's already actively advancing as user scrolls
  applyTransform(0, false);
  updateDots();
  startAuto();
}
