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

export function showOrderConfirmation(orderData) {
  const mainView = document.getElementById('akMainContent');
  const catalogView = document.getElementById('catalogPage');
  const productView = document.getElementById('productPage');
  const orderView = document.getElementById('akOrderConfirmationView');

  if (mainView) mainView.style.display = 'none';
  if (catalogView) catalogView.style.display = 'none';
  if (productView) productView.style.display = 'none';

  if (orderView) {
    orderView.style.display = 'block';
    orderView.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const items = (orderData && orderData.items && orderData.items.length) ? orderData.items : [{
      brand: 'SHURE',
      name: 'SM7B Dynamic Vocal Microphone',
      category: 'DYNAMIC MICROPHONES',
      price: 34900,
      qty: 1
    }];

    const isPreOrderOrder = Boolean(orderData?.isPreOrder || items.some(it => it.isPreOrder || (it.badge && it.badge.toLowerCase().includes('pre-order')) || it.stockStatus === 'preorder'));

    // Dynamic title & subtitle for pre-order vs standard orders
    const billTitle = orderView.querySelector('.ak-bill-title');
    const billSubtitle = orderView.querySelector('.ak-bill-subtitle');
    const orderBadge = orderView.querySelector('.ak-order-confirmed-badge');

    if (billTitle) {
      billTitle.textContent = isPreOrderOrder ? 'Pre order has been placed!' : 'Thank you for your order!';
    }
    if (billSubtitle) {
      billSubtitle.textContent = isPreOrderOrder
        ? 'Your Audio King pre-order has been placed successfully. Estimated delivery in 25-30 days.'
        : 'Your Audio King purchase has been placed successfully. This is a demo order confirmation page.';
    }
    if (orderBadge) {
      orderBadge.textContent = isPreOrderOrder ? 'Pre-Order Confirmed' : 'Order Confirmed';
    }

    const orderId = orderData.orderId || generateOrderId();

    const itemsSubtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty || item.quantity) || 1), 0);
    const discount = Number(orderData.discountAmount) || 0;
    const totalAmount = orderData.total != null ? Number(orderData.total) : Math.max(0, itemsSubtotal - discount);

    // 1. Order ID Header
    const orderIdEl = document.getElementById('akOrderIdVal');
    if (orderIdEl) orderIdEl.textContent = orderId;

    // 2. Purchased Items List (Left Column)
    const itemsContainer = document.getElementById('akOrderItemsContainer');
    if (itemsContainer) {
      itemsContainer.innerHTML = items.map(item => {
        const qty = item.qty || item.quantity || 1;
        const linePrice = (Number(item.price) || 0) * qty;
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
    if (dateEl) dateEl.textContent = orderData.date || formatDate();

    const paymentEl = document.getElementById('akOrderPaymentVal');
    if (paymentEl) paymentEl.textContent = orderData.paymentMethod || 'Online / Prepaid (UPI)';

    // 4. Shipping Details Section
    const cust = orderData.customer || {
      name: 'Demo Customer',
      city: 'Mumbai',
      state: 'Maharashtra',
      line1: '123 Audio King Demo Address',
      pin: '400001'
    };

    const custEl = document.getElementById('akOrderCustomerVal');
    if (custEl) custEl.textContent = cust.name;

    const cityEl = document.getElementById('akOrderCityVal');
    if (cityEl) cityEl.textContent = `${cust.city}, ${cust.state || ''}`;

    const addrEl = document.getElementById('akOrderAddressVal');
    if (addrEl) addrEl.textContent = `${cust.line1 || cust.address || ''}${cust.line2 ? ', ' + cust.line2 : ''}${cust.pin || cust.pincode ? ', ' + (cust.pin || cust.pincode) : ''}`;

    // 5. Order Summary Card (Right Column)
    const sumItemsContainer = document.getElementById('akSumItemsContainer');
    if (sumItemsContainer) {
      let linesHtml = items.map(item => {
        const qty = item.qty || item.quantity || 1;
        const linePrice = (Number(item.price) || 0) * qty;
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

export function initOrderSuccess() {
  const continueBtn = document.getElementById('akOrderContinueBtn');
  const printBtn = document.getElementById('akOrderPrintBtn');

  if (continueBtn) {
    continueBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('ak:nav-home'));
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.print();
    });
  }
}
