/**
 * AudioKing Multi-Step Checkout Modal Controller
 * Handles Step 1 (Shipping Address) & Step 2 (Cashfree-ready Payment UI: COD, Cards, UPI, Net Banking).
 */
import { formatINR, formatDate } from '../utils/formatters.js';
import { AUDIOKING_CONFIG } from '../config.js';
import { getStorage, setStorage } from '../utils/storage.js';
import { activePaymentAdapter } from './paymentAdapter.js';
import { getIcon } from '../../assets/icons/icons.js';
import { showToast } from './toast.js';
import { clearCart, getCartSubtotal } from './cart.js';
import { showOrderConfirmation, triggerOrderAnimation } from './orderSuccess.js';
import { getDefaultAddress, getUserAddresses, saveUserAddresses } from './accountSettings.js';
import { ordersService } from '../services/ordersService.js';
import { authService } from '../services/authService.js';
import { apiUrl } from '../services/apiConfig.js';

let currentStep = 1;
let checkoutItems = [];
let savedAddress = null;
let appliedCoupon = null;

function getSavedAddressKey() {
  const user = authService.getUser();
  return user && user.id ? `audioking_saved_address_${user.id}` : null;
}

// Reset checkout state upon signout to guarantee zero cross-account leakage
authService.subscribe((user, status) => {
  if (status === 'unauthenticated') {
    savedAddress = null;
    checkoutItems = [];
    appliedCoupon = null;
  }
});

export function openCheckoutModal(items = []) {
  checkoutItems = items;
  currentStep = 1;
  appliedCoupon = null;
  const key = getSavedAddressKey();
  savedAddress = key ? getStorage(key, null) : null;
  if (!savedAddress) {
    const def = getDefaultAddress();
    if (def) {
      savedAddress = {
        name: def.name || def.recipient_name,
        phone: def.phone,
        line1: def.street,
        city: def.city,
        state: def.state,
        pin: def.pin
      };
    }
  }
  const modal = document.getElementById('akCheckoutModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCheckoutStep();
  }
}

export function closeCheckoutModal() {
  const modal = document.getElementById('akCheckoutModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function renderCheckoutStep() {
  const titleEl = document.getElementById('akCheckoutStepTitle');
  const bodyEl = document.getElementById('akCheckoutBody');
  const pill1 = document.getElementById('akStepPill1');
  const pill2 = document.getElementById('akStepPill2');
  const backBtn = document.getElementById('akModalCheckoutBackBtn') || document.getElementById('akCheckoutBackBtn');
  const submitBtn = document.getElementById('akModalCheckoutSubmitBtn') || document.getElementById('akCheckoutSubmitBtn');

  if (currentStep === 1) {
    if (pill1) pill1.classList.add('active');
    if (pill2) pill2.classList.remove('active');
    if (titleEl) titleEl.textContent = 'Step 1: Shipping Address';
    if (backBtn) backBtn.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Continue to Payment';

    bodyEl.innerHTML = `
      <form id="akAddressForm" class="ak-form-grid" onsubmit="event.preventDefault();">
        <div class="ak-form-group full">
          <label class="ak-form-label">Full Name *</label>
          <input type="text" id="akAddrName" class="ak-form-input" required placeholder="e.g. Rahul Sharma" value="${savedAddress?.name || ''}">
        </div>
        <div class="ak-form-group">
          <label class="ak-form-label">Phone Number *</label>
          <input type="tel" id="akAddrPhone" class="ak-form-input" required placeholder="10-digit mobile number" value="${savedAddress?.phone || ''}">
        </div>
        <div class="ak-form-group">
          <label class="ak-form-label">PIN Code *</label>
          <input type="text" id="akAddrPin" class="ak-form-input" required placeholder="6-digit PIN code" value="${savedAddress?.pin || ''}">
        </div>
        <div class="ak-form-group full">
          <label class="ak-form-label">Address Line 1 (Flat, House no., Building) *</label>
          <input type="text" id="akAddrLine1" class="ak-form-input" required placeholder="Street address or area" value="${savedAddress?.line1 || ''}">
        </div>
        <div class="ak-form-group full">
          <label class="ak-form-label">Address Line 2 (Landmark, Colony)</label>
          <input type="text" id="akAddrLine2" class="ak-form-input" placeholder="Apartment, suite, landmark (optional)" value="${savedAddress?.line2 || ''}">
        </div>
        <div class="ak-form-group">
          <label class="ak-form-label">City *</label>
          <input type="text" id="akAddrCity" class="ak-form-input" required placeholder="City" value="${savedAddress?.city || 'Mumbai'}">
        </div>
        <div class="ak-form-group">
          <label class="ak-form-label">State *</label>
          <input type="text" id="akAddrState" class="ak-form-input" required placeholder="State" value="${savedAddress?.state || 'Maharashtra'}">
        </div>
        <div class="ak-form-group full">
          <label class="ak-form-checkbox">
            <input type="checkbox" id="akSaveAddressCheckbox" checked>
            <span>Save this address for future purchases</span>
          </label>
        </div>
      </form>
    `;
  } else if (currentStep === 2) {
    if (pill1) pill1.classList.remove('active');
    if (pill2) pill2.classList.add('active');
    if (titleEl) titleEl.textContent = 'Step 2: Payment Method';
    if (backBtn) backBtn.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Place Order';

    const subtotal = getCartSubtotal();

    bodyEl.innerHTML = `
      <!-- Cashfree integration badge -->
      <div class="ak-payment-badge-strip">
        ${getIcon('shield-check', '', 20)}
        <span>Secured by Cashfree Payments · 256-Bit Bank-Grade Encryption</span>
      </div>

      <div class="ak-payment-options">
        <!-- 1. Cash on Delivery (COD) -->
        <label class="ak-payment-option selected" data-method="COD">
          <input type="radio" name="akPayment" value="COD" checked class="ak-payment-radio">
          <div class="ak-payment-info" style="width: 100%;">
            <div class="ak-payment-title">Cash on Delivery (COD)</div>
            <div class="ak-payment-desc">Pay upon courier delivery at your doorstep via cash or digital QR</div>
            <div class="ak-method-details" id="akCodDetails" style="margin-top: 10px; font-size: 12px; color: #059669; background: #ECFDF5; padding: 8px 12px; border-radius: 4px; border: 1px solid #A7F3D0;">
              ✓ Free Pan-India Cash on Delivery available for your order.
            </div>
          </div>
        </label>

        <!-- 2. Credit / Debit Cards -->
        <label class="ak-payment-option" data-method="Card">
          <input type="radio" name="akPayment" value="Card" class="ak-payment-radio">
          <div class="ak-payment-info" style="width: 100%;">
            <div class="ak-payment-title">Credit / Debit Cards</div>
            <div class="ak-payment-desc">Visa, Mastercard, RuPay, Maestro &amp; Amex</div>
            <div class="ak-method-details" id="akCardDetails" style="display: none; margin-top: 12px; background: #F8FAFC; padding: 12px; border-radius: 6px; border: 1px solid #E2E8F0;">
              <div style="margin-bottom: 8px;">
                <label style="font-size: 11px; font-weight: 700; color: #64748B; display: block; margin-bottom: 3px;">Card Number</label>
                <input type="text" id="akCardNumber" class="ak-form-input" placeholder="4242 •••• •••• 4242" maxlength="19" value="4242 4242 4242 4242" style="background:#FFF;">
              </div>
              <div style="margin-bottom: 8px;">
                <label style="font-size: 11px; font-weight: 700; color: #64748B; display: block; margin-bottom: 3px;">Cardholder Name</label>
                <input type="text" id="akCardName" class="ak-form-input" placeholder="Name on Card" value="${savedAddress?.name || 'Rahul Sharma'}" style="background:#FFF;">
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                  <label style="font-size: 11px; font-weight: 700; color: #64748B; display: block; margin-bottom: 3px;">Expiry (MM/YY)</label>
                  <input type="text" id="akCardExpiry" class="ak-form-input" placeholder="12/28" maxlength="5" value="12/28" style="background:#FFF;">
                </div>
                <div>
                  <label style="font-size: 11px; font-weight: 700; color: #64748B; display: block; margin-bottom: 3px;">CVV</label>
                  <input type="password" id="akCardCvv" class="ak-form-input" placeholder="•••" maxlength="4" value="123" style="background:#FFF;">
                </div>
              </div>
            </div>
          </div>
        </label>

        <!-- 3. UPI -->
        <label class="ak-payment-option" data-method="UPI">
          <input type="radio" name="akPayment" value="UPI" class="ak-payment-radio">
          <div class="ak-payment-info" style="width: 100%;">
            <div class="ak-payment-title">UPI (Google Pay, PhonePe, Paytm, BHIM)</div>
            <div class="ak-payment-desc">Instant payment via any UPI application or UPI ID</div>
            <div class="ak-method-details" id="akUpiDetails" style="display: none; margin-top: 10px; background: #F8FAFC; padding: 12px; border-radius: 6px; border: 1px solid #E2E8F0;">
              <div style="display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
                <button type="button" class="ak-upi-chip selected" data-upi="Google Pay" style="padding: 5px 12px; font-size: 12px; font-weight: 700; border: 1.5px solid var(--ak-orange); background: #FFF7ED; color: var(--ak-orange); border-radius: 4px; cursor: pointer;">Google Pay</button>
                <button type="button" class="ak-upi-chip" data-upi="PhonePe" style="padding: 5px 12px; font-size: 12px; font-weight: 600; border: 1px solid #CBD5E1; background: #FFF; color: #334155; border-radius: 4px; cursor: pointer;">PhonePe</button>
                <button type="button" class="ak-upi-chip" data-upi="Paytm" style="padding: 5px 12px; font-size: 12px; font-weight: 600; border: 1px solid #CBD5E1; background: #FFF; color: #334155; border-radius: 4px; cursor: pointer;">Paytm</button>
              </div>
              <input type="text" id="akUpiIdInput" class="ak-form-input" placeholder="e.g. mobile@upi or username@okhdfcbank" value="musician@okhdfcbank" style="background:#FFF;">
            </div>
          </div>
        </label>

        <!-- 4. Net Banking -->
        <label class="ak-payment-option" data-method="Net Banking">
          <input type="radio" name="akPayment" value="Net Banking" class="ak-payment-radio">
          <div class="ak-payment-info" style="width: 100%;">
            <div class="ak-payment-title">Net Banking</div>
            <div class="ak-payment-desc">All Indian banks supported (HDFC, ICICI, SBI, Axis, Kotak)</div>
            <div class="ak-method-details" id="akNbDetails" style="display: none; margin-top: 10px; background: #F8FAFC; padding: 12px; border-radius: 6px; border: 1px solid #E2E8F0;">
              <select id="akBankSelect" class="ak-form-input" style="background:#FFF;">
                <option value="HDFC Bank" selected>HDFC Bank</option>
                <option value="ICICI Bank">ICICI Bank</option>
                <option value="State Bank of India">State Bank of India</option>
                <option value="Axis Bank">Axis Bank</option>
                <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
              </select>
            </div>
          </div>
        </label>
      </div>

      <!-- Coupon Promo Code Section -->
      <div class="ak-coupon-box" style="margin-top: 14px; margin-bottom: 14px; background: #FFF; padding: 12px; border-radius: 6px; border: 1px dashed var(--ak-border);">
        <label style="font-size: 12px; font-weight: 700; color: #475569; display: block; margin-bottom: 6px;">Have a Promo Code or Coupon?</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="akCouponInput" class="ak-form-input" placeholder="e.g. PROAUDIO500" style="text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; flex: 1;" value="${appliedCoupon ? appliedCoupon.code : ''}" ${appliedCoupon ? 'disabled' : ''}>
          <button type="button" id="akApplyCouponBtn" class="ak-btn" style="padding: 8px 16px; background: ${appliedCoupon ? '#DC2626' : 'var(--ak-orange)'}; color: #FFF; font-weight: 700; font-size: 13px; border-radius: 4px; border: none; cursor: pointer; white-space: nowrap;">
            ${appliedCoupon ? 'Remove' : 'Apply'}
          </button>
        </div>
        <div id="akCouponMsg" style="margin-top: 6px; font-size: 12px; font-weight: 600; color: ${appliedCoupon ? '#166534' : '#DC2626'}; display: ${appliedCoupon ? 'block' : 'none'};">
          ${appliedCoupon ? `✓ ${appliedCoupon.message || `Coupon "${appliedCoupon.code}" applied!`}` : ''}
        </div>
      </div>

      <div style="background-color: var(--ak-bg); padding: 14px; border-radius: 6px; border: 1px solid var(--ak-border);">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
          <span>Items Total (${checkoutItems.length})</span>
          <strong>${formatINR(subtotal)}</strong>
        </div>
        ${appliedCoupon ? `
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; color: #166534; font-weight: 700;">
          <span>Coupon Discount (${appliedCoupon.code})</span>
          <span>-${formatINR(appliedCoupon.discountAmount)}</span>
        </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
          <span>Delivery</span>
          <span style="color: #166534; font-weight: 700;">FREE</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
          <span>GST / Taxes</span>
          <span style="color: #166534; font-weight: 700;">Included</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; border-top: 1px solid var(--ak-border); padding-top: 8px; margin-top: 8px; color: var(--ak-navy);">
          <span>Amount Payable</span>
          <span>${formatINR(appliedCoupon ? Math.max(0, subtotal - appliedCoupon.discountAmount) : subtotal)}</span>
        </div>
      </div>
    `;

    // Coupon button interaction
    const couponBtn = bodyEl.querySelector('#akApplyCouponBtn');
    const couponInput = bodyEl.querySelector('#akCouponInput');
    const couponMsg = bodyEl.querySelector('#akCouponMsg');

    if (couponBtn) {
      couponBtn.addEventListener('click', async () => {
        if (appliedCoupon) {
          appliedCoupon = null;
          showToast('Coupon removed.', 'info');
          renderCheckoutStep();
          return;
        }

        const codeVal = (couponInput?.value || '').trim();
        if (!codeVal) {
          if (couponMsg) {
            couponMsg.textContent = 'Please enter a coupon code.';
            couponMsg.style.color = '#DC2626';
            couponMsg.style.display = 'block';
          }
          return;
        }

        couponBtn.disabled = true;
        couponBtn.textContent = 'Checking...';

        try {
          const res = await fetch(apiUrl('/api/coupons/validate'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: codeVal, cartTotal: subtotal })
          });
          const data = await res.json();

          if (res.ok && data.valid) {
            appliedCoupon = data;
            showToast(data.message, 'success');
            renderCheckoutStep();
          } else {
            if (couponMsg) {
              couponMsg.textContent = data.message || 'Invalid coupon code.';
              couponMsg.style.color = '#DC2626';
              couponMsg.style.display = 'block';
            }
            showToast(data.message || 'Invalid coupon code.', 'error');
            couponBtn.disabled = false;
            couponBtn.textContent = 'Apply';
          }
        } catch (err) {
          if (couponMsg) {
            couponMsg.textContent = 'Failed to validate coupon. Please try again.';
            couponMsg.style.color = '#DC2626';
            couponMsg.style.display = 'block';
          }
          couponBtn.disabled = false;
          couponBtn.textContent = 'Apply';
        }
      });
    }

    // Radio click & dynamic details toggle
    bodyEl.querySelectorAll('.ak-payment-option').forEach(opt => {
      opt.addEventListener('click', () => {
        bodyEl.querySelectorAll('.ak-payment-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        const radio = opt.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        // Toggle detail subsections
        const method = opt.dataset.method;
        const cardDetails = document.getElementById('akCardDetails');
        const upiDetails = document.getElementById('akUpiDetails');
        const nbDetails = document.getElementById('akNbDetails');
        const codDetails = document.getElementById('akCodDetails');

        if (cardDetails) cardDetails.style.display = method === 'Card' ? 'block' : 'none';
        if (upiDetails) upiDetails.style.display = method === 'UPI' ? 'block' : 'none';
        if (nbDetails) nbDetails.style.display = method === 'Net Banking' ? 'block' : 'none';
        if (codDetails) codDetails.style.display = method === 'COD' ? 'block' : 'none';
      });
    });

    // UPI app chip select
    bodyEl.querySelectorAll('.ak-upi-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        bodyEl.querySelectorAll('.ak-upi-chip').forEach(c => {
          c.style.borderColor = '#CBD5E1';
          c.style.background = '#FFF';
          c.style.color = '#334155';
          c.classList.remove('selected');
        });
        chip.classList.add('selected');
        chip.style.borderColor = 'var(--ak-orange)';
        chip.style.background = '#FFF7ED';
        chip.style.color = 'var(--ak-orange)';
      });
    });
  }
}

export function initCheckout() {
  const modal = document.getElementById('akCheckoutModal');
  const closeBtn = document.getElementById('akCheckoutClose');
  const backBtn = document.getElementById('akModalCheckoutBackBtn') || document.getElementById('akCheckoutBackBtn');
  const submitBtn = document.getElementById('akModalCheckoutSubmitBtn') || document.getElementById('akCheckoutSubmitBtn');

  if (closeBtn) closeBtn.addEventListener('click', closeCheckoutModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCheckoutModal();
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (currentStep === 2) {
        currentStep = 1;
        renderCheckoutStep();
      }
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      if (currentStep === 1) {
        // Validate Address Form
        const name = document.getElementById('akAddrName')?.value.trim();
        const phone = document.getElementById('akAddrPhone')?.value.trim();
        const pin = document.getElementById('akAddrPin')?.value.trim();
        const line1 = document.getElementById('akAddrLine1')?.value.trim();
        const line2 = document.getElementById('akAddrLine2')?.value.trim();
        const city = document.getElementById('akAddrCity')?.value.trim();
        const state = document.getElementById('akAddrState')?.value.trim();
        const saveCheck = document.getElementById('akSaveAddressCheckbox')?.checked;

        if (!name || !phone || !pin || !line1 || !city || !state) {
          showToast('Please fill all required address fields');
          return;
        }

        savedAddress = { name, phone, pin, line1, line2, city, state };
        if (saveCheck) {
          const key = getSavedAddressKey();
          if (key) setStorage(key, savedAddress);
          try {
            const list = getUserAddresses();
            const exists = list.some(a => a.street === line1 && a.pin === pin);
            if (!exists) {
              list.push({
                id: 'addr_' + Date.now(),
                tag: 'Delivery',
                name,
                phone,
                street: line1 + (line2 ? `, ${line2}` : ''),
                city,
                state,
                pin,
                isDefault: list.length === 0
              });
              saveUserAddresses(list);
            }
          } catch (e) {}
        }

        currentStep = 2;
        renderCheckoutStep();
      } else if (currentStep === 2) {
        // Step 2 Submission
        const paymentRadio = document.querySelector('input[name="akPayment"]:checked');
        const methodVal = paymentRadio ? paymentRadio.value : 'COD';
        let paymentMethodLabel = 'Cash on Delivery (COD)';

        if (methodVal === 'Card') {
          const cardNum = document.getElementById('akCardNumber')?.value.trim() || '4242 4242 4242 4242';
          const cardName = document.getElementById('akCardName')?.value.trim();
          const last4 = cardNum.replace(/\s/g, '').slice(-4) || '4242';
          paymentMethodLabel = `Demo Payment - Card ending ${last4}`;
        } else if (methodVal === 'UPI') {
          const selectedChip = document.querySelector('.ak-upi-chip.selected')?.dataset.upi || 'Google Pay';
          paymentMethodLabel = `UPI - ${selectedChip}`;
        } else if (methodVal === 'Net Banking') {
          const selectedBank = document.getElementById('akBankSelect')?.value || 'HDFC Bank';
          paymentMethodLabel = `Net Banking - ${selectedBank}`;
        } else {
          paymentMethodLabel = 'Cash on Delivery (COD)';
        }

        const orderData = {
          items: [...checkoutItems],
          customer: savedAddress || {
            name: 'Demo Customer',
            phone: '+91 98765 43210',
            line1: '123 Audio King Demo Address',
            city: 'Mumbai',
            state: 'Maharashtra',
            pin: '400001'
          },
          paymentMethod: paymentMethodLabel,
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          discountAmount: appliedCoupon ? appliedCoupon.discountAmount : 0,
          total: appliedCoupon ? Math.max(0, getCartSubtotal() - appliedCoupon.discountAmount) : getCartSubtotal(),
          date: formatDate()
        };

        ordersService.createOrder(orderData).catch(e => console.warn('[Checkout] Order persistence notice:', e.message));

        closeCheckoutModal();
        clearCart();

        // Trigger Full Screen Checkmark Animation Overlay -> transitions into Bill
        triggerOrderAnimation(orderData);
      }
    });
  }
}
