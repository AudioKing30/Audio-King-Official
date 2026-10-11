/**
 * AudioKing Testimonials — Discrete 3-Block Infinite Carousel
 * Every 1.5s, 1 block smoothly advances to the left.
 * Seamless infinite loop with cloned cards, safe transition reset, arrow controls & dots.
 */

const ADVANCE_INTERVAL = 7000; // 7s per block move (slowed down from 1.5s)
const TRANSITION_DURATION = 520; // 0.52s smooth cubic-bezier slide

const avatarGradients = [
  ['#0F172A', '#1E3A8A'],
  ['#4C0519', '#9D174D'],
  ['#064E3B', '#047857'],
  ['#78350F', '#C2410C'],
  ['#1E1B4B', '#4338CA']
];

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function initTestimonials() {
  const track = document.getElementById('akTCardTrack');
  const viewport = document.getElementById('akTCardViewport');
  const prevBtn = document.getElementById('akTCardPrevBtn');
  const nextBtn = document.getElementById('akTCardNextBtn');
  const dotsContainer = document.getElementById('akTCardDots');

  if (!track || !viewport) return;

  // Try to load live active testimonials from backend
  try {
    const res = await fetch('/api/testimonials');
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.testimonials) && data.testimonials.length > 0) {
        track.innerHTML = data.testimonials.map((t, idx) => {
          const stars = '★'.repeat(t.rating || 5) + '☆'.repeat(5 - (t.rating || 5));
          const grad = avatarGradients[idx % avatarGradients.length];
          const hasCustomImg = Boolean(t.image && t.image.trim());
          const photoHtml = hasCustomImg
            ? `<img src="${escapeHtml(t.image)}" alt="${escapeHtml(t.name)}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.onerror=null; this.src='assets/images/logo.png';">`
            : `
              <svg viewBox="0 0 115 130" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
                <defs>
                  <linearGradient id="akAvatarDyn${idx}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${grad[0]}"/>
                    <stop offset="100%" stop-color="${grad[1]}"/>
                  </linearGradient>
                </defs>
                <rect width="115" height="130" fill="url(#akAvatarDyn${idx})"/>
                <circle cx="57.5" cy="48" r="22" fill="#FFFFFF" fill-opacity="0.88"/>
                <path d="M24 114 C24 90, 38 80, 57.5 80 C77 80, 91 90, 91 114 Z" fill="#FFFFFF" fill-opacity="0.88"/>
              </svg>
            `;

          return `
            <div class="ak-tcard">
              <div class="ak-tcard-photo-col">
                <div class="ak-tcard-photo-wrap">
                  ${photoHtml}
                </div>
                <div class="ak-tcard-name">${escapeHtml(t.name)}</div>
              </div>
              <div class="ak-tcard-review-col">
                <div class="ak-tcard-stars">${stars}</div>
                <blockquote class="ak-tcard-quote">${escapeHtml(t.caption)}</blockquote>
              </div>
            </div>
          `;
        }).join('');

        if (dotsContainer) {
          dotsContainer.innerHTML = data.testimonials.map((_, idx) => `
            <button class="ak-tcard-dot ${idx === 0 ? 'active' : ''}" data-slide="${idx}" aria-label="Review ${idx + 1}"></button>
          `).join('');
        }
      }
    }
  } catch (_) {}

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

  const dots = Array.from(document.querySelectorAll('.ak-tcard-dot'));

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
