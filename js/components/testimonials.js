/**
 * AudioKing Testimonials — Constant Smooth Infinite Carousel Controller
 * Continuous, smooth linear motion throughout (no initial scroll stalling or freezing).
 * Hardware-accelerated RAF translate3d, seamless multi-set wrap, responsive arrow nudging,
 * dots navigation, and mobile touch swipe support.
 */

export function initTestimonials() {
  const track = document.getElementById('akTCardTrack');
  const viewport = document.getElementById('akTCardViewport');
  const dots = Array.from(document.querySelectorAll('.ak-tcard-dot'));
  const prevBtn = document.getElementById('akTCardPrevBtn');
  const nextBtn = document.getElementById('akTCardNextBtn');

  if (!track || !viewport) return;

  // 1. Identify original cards and clone 2 full sets for seamless infinite continuation
  const originalCards = Array.from(track.querySelectorAll('.ak-tcard:not([data-clone="true"])'));
  const originalCount = originalCards.length || 5;

  // Clean up any existing clones if reinitialized
  track.querySelectorAll('[data-clone="true"]').forEach(el => el.remove());

  // Append 2 complete duplicate sets (Total 15 cards = Set 1 [0..4], Set 2 [5..9], Set 3 [10..14])
  // This guarantees ample track width so no gap or blank boundary is ever visible across all viewports
  for (let s = 0; s < 2; s++) {
    originalCards.forEach(card => {
      const clone = card.cloneNode(true);
      clone.setAttribute('data-clone', 'true');
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
  }

  // Ensure hardware-accelerated transform without CSS transition conflict
  track.style.transition = 'none';
  track.style.willChange = 'transform';

  let currentX = 0;
  let targetNudge = 0;
  let step = 0;
  let loopWidth = 0;
  let lastTimestamp = 0;
  let activeDotIndex = 0;
  let isDragging = false;
  let dragLastX = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let isHorizontalSwiping = false;

  // Constant speed: 38 pixels per second (smooth, elegant, and readable)
  const SPEED_PPS = 38;

  function measure() {
    const allCards = track.querySelectorAll('.ak-tcard');
    if (allCards.length > originalCount) {
      const dist = allCards[originalCount].offsetLeft - allCards[0].offsetLeft;
      if (dist > 0) {
        loopWidth = dist;
        step = loopWidth / originalCount;
      }
    }
    if (loopWidth <= 0 && allCards.length >= 2) {
      const cardStep = allCards[1].offsetLeft - allCards[0].offsetLeft;
      if (cardStep > 0) {
        step = cardStep;
        loopWidth = step * originalCount;
      }
    }
    if (step <= 0 && allCards[0]) {
      const cardRect = allCards[0].getBoundingClientRect();
      const gap = parseFloat(window.getComputedStyle(track).gap) || 20;
      step = cardRect.width + gap;
      loopWidth = step * originalCount;
    }
  }

  // Initial measurement
  measure();

  function updateDots() {
    if (step <= 0 || dots.length === 0) return;
    const effectiveX = currentX + targetNudge;
    let cardIdx = Math.round(effectiveX / step) % originalCount;
    if (cardIdx < 0) cardIdx = (cardIdx + originalCount) % originalCount;

    if (cardIdx !== activeDotIndex) {
      activeDotIndex = cardIdx;
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === activeDotIndex);
      });
    }
  }

  function frame(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;

    // Recalculate measurement if layout was delayed or not ready
    if (step <= 0 || loopWidth <= 0) {
      measure();
    }

    if (!isDragging) {
      // 1. Constant continuous forward movement throughout
      currentX += SPEED_PPS * dt;

      // 2. Smoothly ease navigation nudge (from arrows / dots) into currentX
      if (Math.abs(targetNudge) > 0.2) {
        const easeFactor = Math.min(1, dt * 9);
        const delta = targetNudge * easeFactor;
        currentX += delta;
        targetNudge -= delta;
      } else if (targetNudge !== 0) {
        currentX += targetNudge;
        targetNudge = 0;
      }
    }

    // 3. Seamless infinite wrap
    if (loopWidth > 0) {
      while (currentX >= loopWidth) {
        currentX -= loopWidth;
      }
      while (currentX < 0) {
        currentX += loopWidth;
      }
    }

    // 4. Hardware accelerated transform (sub-pixel precision)
    track.style.transform = `translate3d(-${currentX.toFixed(2)}px, 0, 0)`;

    // 5. Update dots indicator
    updateDots();

    requestAnimationFrame(frame);
  }

  // Start continuous RAF loop immediately — cards are already moving from the very beginning
  requestAnimationFrame(frame);

  // Arrow controls: smoothly advance / rewind by 1 card
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      measure();
      const shift = step || 400;
      targetNudge = Math.min(targetNudge + shift, shift * 3);
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      measure();
      const shift = step || 400;
      targetNudge = Math.max(targetNudge - shift, -shift * 3);
    });
  }

  // Dots navigation: smoothly glide directly to selected testimonial
  dots.forEach((dot, targetIdx) => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      measure();
      const shift = step || 400;
      const curIdx = activeDotIndex;
      let diff = targetIdx - curIdx;
      if (diff > originalCount / 2) diff -= originalCount;
      if (diff < -originalCount / 2) diff += originalCount;
      targetNudge += diff * shift;
    });
  });

  // Touch swipe support (non-intrusive for vertical page scrolling)
  viewport.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches[0]) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    dragLastX = touchStartX;
    isHorizontalSwiping = false;
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!e.touches || !e.touches[0]) return;
    const curX = e.touches[0].clientX;
    const curY = e.touches[0].clientY;
    const dx = curX - touchStartX;
    const dy = curY - touchStartY;

    if (!isHorizontalSwiping) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        isHorizontalSwiping = true;
        isDragging = true;
      }
    }

    if (isHorizontalSwiping && isDragging) {
      const deltaX = curX - dragLastX;
      dragLastX = curX;
      currentX -= deltaX;
    }
  }, { passive: true });

  const endTouch = () => {
    isDragging = false;
    isHorizontalSwiping = false;
  };
  viewport.addEventListener('touchend', endTouch, { passive: true });
  viewport.addEventListener('touchcancel', endTouch, { passive: true });

  // Recalculate dimensions on window resize and orientation change
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      measure();
    }, 60);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Tab visibility handling: reset lastTimestamp to prevent frame jumps after tab switch
  document.addEventListener('visibilitychange', () => {
    lastTimestamp = performance.now();
  });
}
