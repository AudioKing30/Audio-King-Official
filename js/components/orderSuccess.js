/**
 * AudioKing Order Confirmation & Bill Controller
 * Faithfully matches user's uploaded receipt reference image (media_1789423751815.jpg)
 * and plays the standalone checkmark animation sequence.
 */
import { formatINR, generateOrderId, formatDate, resolveProductImage } from '../utils/formatters.js';

export function triggerOrderAnimation(orderData) {
  const overlay = document.getElementById('akOrderAnimOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');

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

    const orderId = orderData.orderId || generateOrderId();
    const items = (orderData.items && orderData.items.length) ? orderData.items : [{
      brand: 'SHURE',
      name: 'SM7B Dynamic Vocal Microphone',
      category: 'DYNAMIC MICROPHONES',
      price: 34900,
      qty: 1
    }];

    const totalAmount = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);

    // 1. Order ID Header
    const orderIdEl = document.getElementById('akOrderIdVal');
    if (orderIdEl) orderIdEl.textContent = orderId;

    // 2. Purchased Items List (Left Column)
    const itemsContainer = document.getElementById('akOrderItemsContainer');
    if (itemsContainer) {
      itemsContainer.innerHTML = items.map(item => {
        const qty = item.qty || 1;
        const linePrice = (Number(item.price) || 0) * qty;
        return `
          <div class="ak-order-item-row">
            <div class="ak-order-item-thumb">
              ${item.image ? `<img src="${resolveProductImage(item.image)}" alt="${item.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">` : ''}
              <div class="ak-order-thumb-placeholder" style="${item.image ? 'display:none;' : 'display:block;'}">AK</div>
            </div>
            <div class="ak-order-item-info">
              <span class="ak-order-item-brand">${item.brand}</span>
              <h3 class="ak-order-item-name">${item.name}</h3>
              <div class="ak-order-item-meta">${item.category} · Qty ${qty}</div>
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
    if (paymentEl) paymentEl.textContent = orderData.paymentMethod || 'Cash on Delivery (COD)';

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
    if (addrEl) addrEl.textContent = `${cust.line1}${cust.line2 ? ', ' + cust.line2 : ''}${cust.pin ? ', ' + cust.pin : ''}`;

    // 5. Order Summary Card (Right Column)
    const sumItemsContainer = document.getElementById('akSumItemsContainer');
    if (sumItemsContainer) {
      sumItemsContainer.innerHTML = items.map(item => {
        const qty = item.qty || 1;
        const linePrice = (Number(item.price) || 0) * qty;
        return `
          <div class="ak-sum-line">
            <span>${item.name} × ${qty}</span>
            <strong>${formatINR(linePrice)}</strong>
          </div>
        `;
      }).join('');
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
