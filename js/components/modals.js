/**
 * AudioKing Legal & Contact Modals Controller
 * Unified reusable modal implementation for all 4 legal policies:
 * - Terms & Conditions
 * - Privacy Policy
 * - Shipping & Delivery
 * - Returns & Refunds
 * Features smooth open/close animations, scroll lock, focus restoration, and ESC dismissal.
 */
import { LEGAL_DOCUMENTS } from '../data/legal.js';
import { AUDIOKING_CONFIG } from '../config.js';
import { showToast } from './toast.js';

let lastActiveTrigger = null;
let isAnimatingClose = false;
let livePolicies = null;

/**
 * Formats a timestamp into exact Day, Date, and Time string
 * Example: "Sunday, 11 October 2026 at 01:15:00 AM"
 */
export function formatExactDateDayTime(isoOrDateStr) {
  if (!isoOrDateStr) return 'Recently Updated';
  try {
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return isoOrDateStr;
    const weekday = d.toLocaleDateString('en-IN', { weekday: 'long' });
    const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    return `${weekday}, ${day} at ${time}`;
  } catch (e) {
    return isoOrDateStr;
  }
}

/**
 * Fetches live legal policies from server
 */
export async function fetchLivePolicies() {
  try {
    const res = await fetch(`/api/policies?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.policies) {
        livePolicies = data.policies;
        if (data.policies.returns) {
          livePolicies.cancellation = data.policies.returns;
        }
        if (data.policies.terms) {
          livePolicies.warranty = data.policies.terms;
        }
        Object.keys(livePolicies).forEach(k => {
          LEGAL_DOCUMENTS[k] = livePolicies[k];
        });
        return livePolicies;
      }
    }
  } catch (e) {
    // Keep local fallback
  }
  return null;
}

/**
 * Open unified reusable legal modal
 * @param {string} docKey - 'terms' | 'privacy' | 'shipping' | 'returns' | 'cancellation' | 'warranty'
 * @param {HTMLElement} [triggerEl] - Link/button that triggered the modal
 */
export async function openLegalModal(docKey, triggerEl = null) {
  // Always fetch latest live policies from server so digital timestamp is guaranteed latest
  try {
    await fetchLivePolicies();
  } catch (_) {}

  let key = (docKey || 'terms').toLowerCase();
  if (key === 'cancellation') key = 'returns';
  if (key === 'warranty') key = 'terms';

  const doc = (livePolicies && (livePolicies[key] || livePolicies[docKey])) || LEGAL_DOCUMENTS[key] || LEGAL_DOCUMENTS[docKey];
  if (!doc) {
    console.warn(`[LegalModal] Unknown document key "${docKey}"`);
    return;
  }

  const modal = document.getElementById('akLegalModal');
  const title = document.getElementById('akLegalModalTitle');
  const subtitle = document.getElementById('akLegalModalSub');
  const body = document.getElementById('akLegalModalBody');
  const closeBtn = document.getElementById('akLegalClose');

  if (!modal || !body) return;

  // Remember trigger element to restore keyboard focus on close
  lastActiveTrigger = triggerEl || document.activeElement;

  if (title) title.textContent = doc.title;
  if (subtitle) subtitle.textContent = doc.subtitle || 'AudioKing';

  const exactTimeStr = formatExactDateDayTime(doc.updated_at || doc.updatedAt || doc.lastUpdated);

  // Build semantic content with exact timestamp
  let contentHtml = `
    <div class="ak-legal-meta-strip">
      <span class="ak-legal-timestamp"><strong>🕒 Last Updated:</strong> ${exactTimeStr}</span>
      <span class="ak-legal-dot">&bull;</span>
      <span class="ak-legal-badge">${doc.badge || 'Official Policy'}</span>
    </div>
    <div class="ak-legal-intro">
      ${doc.intro || ''}
    </div>
  `;

  if (Array.isArray(doc.sections)) {
    contentHtml += doc.sections.map(s => `
      <div class="ak-legal-section">
        <h3>${s.number ? s.number + '. ' : ''}${s.heading}</h3>
        ${s.body}
      </div>
    `).join('');
  }

  body.innerHTML = contentHtml;
  body.scrollTop = 0;

  // Lock background scrolling
  document.body.style.overflow = 'hidden';

  // Open with smooth animation
  modal.classList.remove('closing');
  modal.classList.add('open');

  // Set focus to close button
  setTimeout(() => {
    if (closeBtn) closeBtn.focus();
  }, 100);
}

/**
 * Close legal modal with smooth 220ms ease-in exit animation
 */
export function closeLegalModal() {
  const modal = document.getElementById('akLegalModal');
  if (!modal || isAnimatingClose || !modal.classList.contains('open')) return;

  isAnimatingClose = true;
  modal.classList.add('closing');
  modal.classList.remove('open');

  setTimeout(() => {
    modal.classList.remove('closing');
    document.body.style.overflow = '';
    isAnimatingClose = false;

    // Restore focus to triggering footer link
    if (lastActiveTrigger && typeof lastActiveTrigger.focus === 'function') {
      try {
        lastActiveTrigger.focus();
      } catch (e) {}
    }
  }, 220);
}

export function openContactModal() {
  const modal = document.getElementById('akContactModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

export function closeContactModal() {
  const modal = document.getElementById('akContactModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

export function initModals() {
  // Preload live policies immediately on startup
  fetchLivePolicies();

  // 1. Attach document-level delegation to all legal modal triggers (footer links & inline links)
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-legal-modal]');
    if (link) {
      e.preventDefault();
      const docKey = link.dataset.legalModal;
      openLegalModal(docKey, link);
    }
  });

  const legalClose = document.getElementById('akLegalClose');
  const legalModal = document.getElementById('akLegalModal');

  if (legalClose) {
    legalClose.addEventListener('click', (e) => {
      e.preventDefault();
      closeLegalModal();
    });
  }

  if (legalModal) {
    legalModal.addEventListener('click', (e) => {
      if (e.target === legalModal) {
        closeLegalModal();
      }
    });
  }

  // 2. Contact Modal controls (for explicit modal buttons if any)

  const contactClose = document.getElementById('akContactClose');
  const contactModal = document.getElementById('akContactModal');
  if (contactClose) contactClose.addEventListener('click', closeContactModal);
  if (contactModal) {
    contactModal.addEventListener('click', (e) => {
      if (e.target === contactModal) closeContactModal();
    });
  }

  // 3. Contact Form Submission -> WhatsApp
  const contactForm = document.getElementById('akContactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('akContactName')?.value.trim();
      const phone = document.getElementById('akContactPhone')?.value.trim();
      const subject = document.getElementById('akContactSubject')?.value.trim();
      const message = document.getElementById('akContactMessage')?.value.trim();

      const text = encodeURIComponent(`Hello AudioKing,\n\nName: ${name}\nPhone: ${phone}\nSubject: ${subject}\nMessage: ${message}`);
      const cleanPhone = AUDIOKING_CONFIG.whatsappNumber.replace(/[^0-9]/g, '');
      const waUrl = `https://wa.me/${cleanPhone}?text=${text}`;
      
      closeContactModal();
      showToast('Connecting with pro audio specialist on WhatsApp...');
      window.open(waUrl, '_blank');
    });
  }

  // 4. Global ESC Key Dismissal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLegalModal();
      closeContactModal();
      document.getElementById('akAuthModal')?.classList.remove('open');
      document.getElementById('akCheckoutModal')?.classList.remove('open');
      document.getElementById('akCartBackdrop')?.classList.remove('open');
      document.getElementById('akMobileDrawer')?.classList.remove('open');
      document.getElementById('akProfileModal')?.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  // 5. Live Policy Sync Listener
  window.addEventListener('ak:policy-updated', () => {
    fetchLivePolicies();
  });
}

if (typeof window !== 'undefined') {
  window.openLegalModal = openLegalModal;
  window.closeLegalModal = closeLegalModal;
  window.fetchLivePolicies = fetchLivePolicies;
  window.formatExactDateDayTime = formatExactDateDayTime;
}

