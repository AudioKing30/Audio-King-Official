/**
 * AudioKing 5-Slide Landscape Hero Carousel
 * Auto-rotates every 5s with pause-on-hover & smooth manual controls.
 */
export function initHeroSlider() {
  const slides = document.querySelectorAll('.ak-hero-slide');
  const dots = document.querySelectorAll('.ak-hero-dot');
  const prevBtn = document.getElementById('akHeroPrevBtn');
  const nextBtn = document.getElementById('akHeroNextBtn');
  const container = document.getElementById('akHeroSection');

  if (!slides.length) return;

  let currentIndex = 0;
  let timer = null;
  const slideInterval = 3000;

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
    timer = setInterval(nextSlide, slideInterval);
  }

  function stopAutoPlay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Events
  if (nextBtn) nextBtn.addEventListener('click', () => { nextSlide(); startAutoPlay(); });
  if (prevBtn) prevBtn.addEventListener('click', () => { prevSlide(); startAutoPlay(); });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
      showSlide(index);
      startAutoPlay();
    });
  });

  // Pause on hover
  if (container) {
    container.addEventListener('mouseenter', stopAutoPlay);
    container.addEventListener('mouseleave', startAutoPlay);

    // Touch swipe support for mobile sliding
    let touchStartX = 0;
    let touchStartY = 0;

    container.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;

        // Check if horizontal swipe exceeds 40px threshold and is dominant
        if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
          if (diffX > 0) {
            nextSlide();
          } else {
            prevSlide();
          }
          startAutoPlay();
        }
      }
    }, { passive: true });
  }

  showSlide(0);
  startAutoPlay();
}
