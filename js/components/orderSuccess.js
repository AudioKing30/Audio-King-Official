import { openTaxInvoiceModal } from './taxInvoice.js';
/**
 * AudioKing Order Confirmation & Bill Controller
 * Faithfully matches user's uploaded receipt reference image (media_1789423751815.jpg)
 * and plays the standalone checkmark animation sequence.
 */
import { formatINR, generateOrderId, formatDate, resolveProductImage } from '../utils/formatters.js';

export function triggerOrderAnimation(orderData) {
  const overlay = document.getElementById('akOrderAnimOverlay');
  const items = (orderData && orderData.items && orderData.items.length) ? orderData.items : [];
  const isPreOrderOrder = Boolean(orderData?.isPreOrder || items.some(it => it.isPreOrder || (it.badge && it.badge.toLowerCase().includes('pre-order')) || it.stockStatus === 'preorder'));

  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');

    const animTitle = overlay.querySelector('.ak-anim-title');
    const animSub = overlay.querySelector('.ak-anim-sub');
    if (animTitle) {
      animTitle.textContent = isPreOrderOrder ? 'Pre order has been placed!' : 'Order Confirmed!';
    }
    if (animSub) {
      animSub.textContent = isPreOrderOrder ? 'Your pre-order has been registered with AudioKing...' : 'Generating your official receipt...';
    }

    // Reset checkmark SVG animation
    const checkmark = overlay.querySelector('.checkmark');
    const circle = overlay.querySelector('.checkmark-circle');
    const check = overlay.querySelector('.checkmark-check');

    if (checkmark) {
      checkmark.style.animation = 'none';
      checkmark.offsetHeight; // force reflow
      checkmark.style.animation = '';
    }
    if (circle) {
      circle.style.animation = 'none';
      circle.offsetHeight; // force reflow
      circle.style.animation = '';
    }
    if (check) {
      check.style.animation = 'none';
      check.offsetHeight; // force reflow
      check.style.animation = '';
    }

    // After ~1.3s animation sequence, dissolve overlay into the bill
    setTimeout(() => {
      overlay.classList.add('fade-out');
      showOrderConfirmation(orderData);

      setTimeout(() => {
        overlay.style.display = 'none';
      }, 450);
    }, 1300);
  } else {
    showOrderConfirmation(orderData);
  }
}

let lastOrderData = null;

export function showOrderConfirmation(orderData) {
  lastOrderData = orderData;

  // Cleanly hide all other views
  const viewsToHide = [
    'akMainContent',
    'catalogPage',
    'productPage',
    'akCheckoutPage',
    'akContactPage',
    'akAccountSettingsPage',
    'adminPage'
  ];
  viewsToHide.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  });

  // Ensure modal is closed and scroll unlocked
  const checkoutModal = document.getElementById('akCheckoutModal');
  if (checkoutModal) checkoutModal.classList.remove('open');
  document.body.style.overflow = '';

  const orderView = document.getElementById('akOrderConfirmationView');

  if (orderView) {
    orderView.style.display = 'block';
    orderView.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      try {
        window.history.replaceState(null, '', window.location.pathname + '#order-confirmed');
      } catch (_) {}
    }

    const items = (orderData && orderData.items && orderData.items.length) ? orderData.items : [{
      brand: 'SHURE',
      name: 'SM7B Dynamic Vocal Microphone',
      category: 'DYNAMIC MICROPHONES',
      price: 34900,
      qty: 1
    }];

    const isPreOrderOrder = Boolean(orderData?.isPreOrder || items.some(it => it.isPreOrder || (it.badge && it.badge.toLowerCase().includes('pre-order')) || it.stockStatus === 'preorder'));

    const rawStatus = String(orderData?.status || '').trim();
    const isCancelled = /cancel/i.test(rawStatus);
    const isDispatched = /dispatch|shipped/i.test(rawStatus);
    const isDelivered = /deliver/i.test(rawStatus);

    const iconWrap = orderView.querySelector('.ak-bill-icon-wrap');
    if (iconWrap) {
      if (isCancelled) {
        iconWrap.style.background = '#FEF2F2';
        iconWrap.style.borderColor = 'rgba(220, 38, 38, 0.3)';
        iconWrap.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
      } else {
        iconWrap.style.background = '';
        iconWrap.style.borderColor = '';
        iconWrap.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
      }
    }

    // Dynamic title & subtitle for status
    const billTitle = orderView.querySelector('.ak-bill-title');
    const billSubtitle = orderView.querySelector('.ak-bill-subtitle');
    const orderBadge = orderView.querySelector('.ak-order-confirmed-badge');

    if (billTitle) {
      if (isCancelled) {
        billTitle.textContent = 'Order Canceled';
      } else if (isDelivered) {
        billTitle.textContent = 'Order Delivered!';
      } else if (isDispatched) {
        billTitle.textContent = 'Order Dispatched!';
      } else {
        billTitle.textContent = isPreOrderOrder ? 'Pre order has been placed!' : 'Order Confirmed!';
      }
    }
    if (billSubtitle) {
      if (isCancelled) {
        billSubtitle.textContent = 'This order has been canceled. Please reach out to AudioKing support if you need any assistance.';
      } else if (isDelivered) {
        billSubtitle.textContent = 'This order has been successfully delivered to your shipping address.';
      } else if (isDispatched) {
        billSubtitle.textContent = 'Your order is currently in transit with full pan-India transit insurance.';
      } else if (isPreOrderOrder) {
        billSubtitle.textContent = 'Your Audio King pre-order has been placed successfully. Estimated delivery in 25-30 days.';
      } else {
        billSubtitle.textContent = 'Your official Audio King order receipt and invoice details.';
      }
    }
    if (orderBadge) {
      if (isCancelled) {
        orderBadge.textContent = 'Order Canceled';
        orderBadge.style.background = '#FEF2F2';
        orderBadge.style.color = '#DC2626';
        orderBadge.style.borderColor = 'rgba(220, 38, 38, 0.3)';
      } else if (isDelivered) {
        orderBadge.textContent = 'Delivered';
        orderBadge.style.background = '#ECFDF5';
        orderBadge.style.color = '#047857';
        orderBadge.style.borderColor = 'rgba(5, 150, 105, 0.3)';
      } else if (isDispatched) {
        orderBadge.textContent = 'Dispatched';
        orderBadge.style.background = '#EFF6FF';
        orderBadge.style.color = '#1D4ED8';
        orderBadge.style.borderColor = 'rgba(59, 130, 246, 0.3)';
      } else {
        orderBadge.textContent = isPreOrderOrder ? 'Pre-Order Confirmed' : 'Order Confirmed';
        orderBadge.style.background = '';
        orderBadge.style.color = '';
        orderBadge.style.borderColor = '';
      }
    }

    const orderId = orderData.orderId || orderData.orderNumber || generateOrderId();

    const itemsSubtotal = items.reduce((sum, item) => sum + (Number(item.price != null ? item.price : item.unitPrice) || 0) * (Number(item.qty || item.quantity) || 1), 0);
    const discount = Number(orderData.discountAmount) || 0;
    const totalAmount = orderData.total != null ? Number(orderData.total) : (orderData.totalAmount != null ? Number(orderData.totalAmount) : Math.max(0, itemsSubtotal - discount));

    // 1. Order ID Header
    const orderIdEl = document.getElementById('akOrderIdVal');
    if (orderIdEl) orderIdEl.textContent = orderId;

    // 2. Purchased Items List (Left Column)
    const itemsContainer = document.getElementById('akOrderItemsContainer');
    if (itemsContainer) {
      itemsContainer.innerHTML = items.map(item => {
        const qty = item.qty || item.quantity || 1;
        const unitP = Number(item.price != null ? item.price : item.unitPrice) || 0;
        const linePrice = unitP * qty;
        return `
          <div class="ak-order-item-row">
            <div class="ak-order-item-thumb">
              ${item.image ? `<img src="${resolveProductImage(item.image)}" alt="${item.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` : ''}
              <div class="ak-order-thumb-placeholder" style="${item.image ? 'display:none;' : 'display:block;'}">AK</div>
            </div>
            <div class="ak-order-item-info">
              <span class="ak-order-item-brand">${item.brand || 'Pro Audio'}</span>
              <h3 class="ak-order-item-name">${item.name}</h3>
              <div class="ak-order-item-meta">${item.category || 'Gear'} · Qty ${qty}</div>
              <div class="ak-order-item-price">${formatINR(linePrice)}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 3. Order Details Section
    const dateEl = document.getElementById('akOrderDateVal');
    if (dateEl) {
      dateEl.textContent = orderData.date || (orderData.createdAt ? new Date(orderData.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : formatDate());
    }

    const paymentEl = document.getElementById('akOrderPaymentVal');
    if (paymentEl) paymentEl.textContent = orderData.paymentMethod || 'Online / Prepaid (UPI)';

    // 4. Shipping Details Section
    const cust = orderData.customer || (typeof orderData.shippingAddress === 'object' && orderData.shippingAddress !== null ? orderData.shippingAddress : null) || {
      name: 'Valued Customer',
      city: 'Mumbai',
      state: 'Maharashtra',
      line1: '123 Audio King Demo Address',
      pin: '400001'
    };

    const custEl = document.getElementById('akOrderCustomerVal');
    if (custEl) custEl.textContent = cust.name || cust.fullName || 'Valued Customer';

    const cityEl = document.getElementById('akOrderCityVal');
    if (cityEl) cityEl.textContent = cust.city ? `${cust.city}${cust.state ? ', ' + cust.state : ''}` : '';

    const addrEl = document.getElementById('akOrderAddressVal');
    if (addrEl) {
      const parts = [
        cust.line1 || cust.address || '',
        cust.line2 || '',
        cust.pin || cust.pincode ? String(cust.pin || cust.pincode) : ''
      ].filter(Boolean);
      addrEl.textContent = parts.length ? parts.join(', ') : (cust.city || 'Address provided at checkout');
    }

    const disclaimerBox = orderView.querySelector('.ak-order-disclaimer-box');
    if (disclaimerBox) {
      disclaimerBox.style.display = 'none';
    }

    // 5. Order Summary Card (Right Column)
    const sumItemsContainer = document.getElementById('akSumItemsContainer');
    if (sumItemsContainer) {
      let linesHtml = items.map(item => {
        const qty = item.qty || item.quantity || 1;
        const unitP = Number(item.price != null ? item.price : item.unitPrice) || 0;
        const linePrice = unitP * qty;
        return `
          <div class="ak-sum-line">
            <span>${item.name} × ${qty}</span>
            <strong>${formatINR(linePrice)}</strong>
          </div>
        `;
      }).join('');

      if (discount > 0) {
        linesHtml += `
          <div class="ak-sum-line" style="color: #10B981; font-weight: 600;">
            <span>Coupon Discount (${orderData.couponCode || 'APPLIED'})</span>
            <strong>-${formatINR(discount)}</strong>
          </div>
        `;
      }
      sumItemsContainer.innerHTML = linesHtml;
    }

    const totalEl = document.getElementById('akSumTotalVal');
    if (totalEl) totalEl.textContent = formatINR(totalAmount);
  }
}

if (typeof window !== 'undefined') {
  window.showOrderConfirmation = showOrderConfirmation;
}

export function initOrderSuccess() {
  const continueBtn = document.getElementById('akOrderContinueBtn');
  const printBtn = document.getElementById('akOrderPrintBtn');
  const invoiceBtn = document.getElementById('akOrderInvoiceBtn');

  if (invoiceBtn) {
    invoiceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (lastOrderData) {
        openTaxInvoiceModal(lastOrderData);
      }
    });
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('ak:nav-store'));
      if (typeof window.showCatalog === 'function') {
        window.showCatalog('All', 'all');
      } else {
        window.location.hash = '#store';
      }
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', (e) => {
      e.preventDefault();
      document.body.classList.remove('ak-tax-invoice-open');
      window.print();
    });
  }
}
