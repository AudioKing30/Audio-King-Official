/**
 * AudioKing Account Settings & Address Management Controller
 * Manages Display Info, Personal Info, Profile Image Upload, Show/Hide Password,
 * In-App Change Password, Multiple Saved Addresses backed by Real SQLite DB,
 * and Unsaved Changes Navigation Interceptor.
 */

import { AUDIOKING_CONFIG } from '../config.js';
import { setStorage } from '../utils/storage.js';
import { getCurrentUser, updateHeaderAccountState } from './auth.js';
import { authService } from '../services/authService.js';
import { showToast } from './toast.js';
import { getIcon } from '../../assets/icons/icons.js';
import { ordersService } from '../services/ordersService.js';

let isFormDirty = false;
let initialFormData = {};
let pendingNavigationAction = null;
let cachedAddresses = [];

/**
 * Get saved addresses from cache or database
 */
export function getUserAddresses() {
  return cachedAddresses;
}

/**
 * Get default address for checkout
 */
export function getDefaultAddress() {
  return cachedAddresses.find(a => a.isDefault || a.is_default) || cachedAddresses[0] || null;
}

// Clear in-memory address cache on signout to prevent account data leakage
authService.subscribe((user, status) => {
  if (status === 'unauthenticated') {
    cachedAddresses = [];
  }
});

/**
 * Save user addresses to memory and localStorage for checkout sync
 */
export function saveUserAddresses(addresses) {
  cachedAddresses = addresses;
  const user = authService.getUser();
  const def = addresses.find(a => a.isDefault || a.is_default) || addresses[0];
  if (def && user && user.id) {
    setStorage(`audioking_saved_address_${user.id}`, {
      name: def.recipient_name || def.name,
      phone: def.phone,
      line1: def.street,
      city: def.city,
      state: def.state,
      pin: def.pin
    });
  }
}

/**
 * Check if the profile form has unsaved edits
 */
export function isAccountFormDirty() {
  return isFormDirty;
}

/**
 * Set dirty state and update banner/buttons
 */
function setDirty(dirty) {
  isFormDirty = dirty;
  const banner = document.getElementById('akAccDirtyBanner');
  if (banner) {
    banner.classList.toggle('active', dirty);
  }
}

/**
 * Snapshot current form inputs
 */
function captureFormSnapshot() {
  initialFormData = {
    displayName: document.getElementById('akAccDisplayName')?.value || '',
    title: document.getElementById('akAccTitle')?.value || '',
    firstName: document.getElementById('akAccFirstName')?.value || '',
    lastName: document.getElementById('akAccLastName')?.value || '',
    email: document.getElementById('akAccEmail')?.value || '',
    phone: document.getElementById('akAccPhone')?.value || ''
  };
  setDirty(false);
}

/**
 * Compare current form with initial snapshot
 */
function checkFormAgainstSnapshot() {
  const current = {
    displayName: document.getElementById('akAccDisplayName')?.value || '',
    title: document.getElementById('akAccTitle')?.value || '',
    firstName: document.getElementById('akAccFirstName')?.value || '',
    lastName: document.getElementById('akAccLastName')?.value || '',
    email: document.getElementById('akAccEmail')?.value || '',
    phone: document.getElementById('akAccPhone')?.value || ''
  };

  const changed = Object.keys(initialFormData).some(key => initialFormData[key] !== current[key]);
  setDirty(changed);
}

/**
 * Render and populate Account Settings form from real authenticated user
 */
export async function renderAccountSettings(targetTab = 'account') {
  const user = getCurrentUser() || {
    firstName: 'Musician',
    lastName: '',
    email: '',
    phone: '',
    displayName: '',
    title: 'Pro Audio Specialist',
    profileImage: 'assets/images/logo.jpg'
  };

  const displayNameEl = document.getElementById('akAccDisplayName');
  const titleEl = document.getElementById('akAccTitle');
  const firstNameEl = document.getElementById('akAccFirstName');
  const lastNameEl = document.getElementById('akAccLastName');
  const emailEl = document.getElementById('akAccEmail');
  const phoneEl = document.getElementById('akAccPhone');
  const passwordEl = document.getElementById('akAccPassword');

  if (displayNameEl) displayNameEl.value = user.displayName || user.firstName || '';
  if (titleEl) titleEl.value = user.title || 'Pro Audio Specialist';
  if (firstNameEl) firstNameEl.value = user.firstName || '';
  if (lastNameEl) lastNameEl.value = user.lastName || '';
  if (emailEl) emailEl.value = user.email || '';
  if (phoneEl) phoneEl.value = user.phone || user.phone_number || '';
  if (passwordEl) {
    passwordEl.value = '••••••••';
    passwordEl.type = 'password';
  }

  // Reset change password panel
  const passPanel = document.getElementById('akAccChangePassPanel');
  if (passPanel) passPanel.style.display = 'none';

  // Snapshot initial values
  captureFormSnapshot();

  // Load and render real addresses from database
  await renderAddressesList();

  // Activate requested tab
  const tabAccount = document.getElementById('akAccTabBtnAccount');
  const tabAddresses = document.getElementById('akAccTabBtnAddresses');
  const tabOrders = document.getElementById('akAccTabBtnOrders');
  const panelAccount = document.getElementById('akAccPanelAccount');
  const panelAddresses = document.getElementById('akAccPanelAddresses');
  const panelOrders = document.getElementById('akAccPanelOrders');

  [tabAccount, tabAddresses, tabOrders].forEach(t => {
    t?.classList.remove('active');
    t?.setAttribute('aria-selected', 'false');
  });
  [panelAccount, panelAddresses, panelOrders].forEach(p => {
    p?.classList.remove('active');
  });

  if (targetTab === 'orders') {
    tabOrders?.classList.add('active');
    tabOrders?.setAttribute('aria-selected', 'true');
    panelOrders?.classList.add('active');
    await renderOrdersList();
  } else if (targetTab === 'addresses') {
    tabAddresses?.classList.add('active');
    tabAddresses?.setAttribute('aria-selected', 'true');
    panelAddresses?.classList.add('active');
  } else {
    tabAccount?.classList.add('active');
    tabAccount?.setAttribute('aria-selected', 'true');
    panelAccount?.classList.add('active');
  }
}

/**
 * Save profile changes to SQLite database via authService
 */
export async function saveAccountChanges() {
  const firstName = document.getElementById('akAccFirstName')?.value.trim();
  const lastName = document.getElementById('akAccLastName')?.value.trim();
  const email = document.getElementById('akAccEmail')?.value.trim();
  const phone = document.getElementById('akAccPhone')?.value.trim();
  const displayName = document.getElementById('akAccDisplayName')?.value.trim();
  const title = document.getElementById('akAccTitle')?.value.trim();

  if (!firstName || !email) {
    showToast('Please fill in required fields (first name and email).');
    return false;
  }

  try {
    const fullName = `${firstName} ${lastName || ''}`.trim();
    await authService.updateProfile({
      full_name: fullName,
      display_name: displayName,
      title: title,
      phone_number: phone
    });

    updateHeaderAccountState();
    captureFormSnapshot();
    showToast('Profile updated and saved to database!', getIcon('check', '', 18));
    return true;
  } catch (err) {
    showToast(err.message || 'Failed to update profile.');
    return false;
  }
}

/**
 * Discard changes and revert form
 */
export function discardAccountChanges() {
  if (initialFormData) {
    if (document.getElementById('akAccDisplayName')) document.getElementById('akAccDisplayName').value = initialFormData.displayName;
    if (document.getElementById('akAccTitle')) document.getElementById('akAccTitle').value = initialFormData.title;
    if (document.getElementById('akAccFirstName')) document.getElementById('akAccFirstName').value = initialFormData.firstName;
    if (document.getElementById('akAccLastName')) document.getElementById('akAccLastName').value = initialFormData.lastName;
    if (document.getElementById('akAccEmail')) document.getElementById('akAccEmail').value = initialFormData.email;
    if (document.getElementById('akAccPhone')) document.getElementById('akAccPhone').value = initialFormData.phone;
  }
  setDirty(false);
  showToast('Changes discarded.');
}

/**
 * Prompt user before leaving if form is dirty
 */
export function promptUnsavedChanges(onConfirmLeave) {
  if (!isFormDirty) {
    if (typeof onConfirmLeave === 'function') onConfirmLeave();
    return;
  }

  pendingNavigationAction = onConfirmLeave;
  const modal = document.getElementById('akUnsavedChangesModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeUnsavedChangesModal() {
  const modal = document.getElementById('akUnsavedChangesModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

/**
 * Render My Addresses List from SQLite database
 */
export async function renderAddressesList() {
  const container = document.getElementById('akAccAddressesList');
  if (!container) return;

  try {
    cachedAddresses = await authService.getAddresses();
  } catch (err) {
    console.warn('[Addresses] Failed to fetch:', err.message);
  }

  // Format addresses normalizing property names
  const normalized = cachedAddresses.map(a => ({
    id: a.id,
    tag: a.tag || 'Studio',
    name: a.recipient_name || a.name || 'Pro Musician',
    phone: a.phone || '',
    street: a.street || '',
    city: a.city || 'Mumbai',
    state: a.state || 'Maharashtra',
    pin: a.pin || '',
    isDefault: Boolean(a.is_default ?? a.isDefault)
  }));

  // Sync default address with checkout
  const def = normalized.find(a => a.isDefault) || normalized[0];
  if (def) {
    setStorage(AUDIOKING_CONFIG.addressStorageKey, {
      name: def.name,
      phone: def.phone,
      line1: def.street,
      city: def.city,
      state: def.state,
      pin: def.pin
    });
  }

  if (normalized.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; background: #F9FAFB; border: 1px dashed var(--ak-border-strong); border-radius: 8px;">
        <p style="font-size: 14px; color: var(--ak-text-muted); margin-bottom: 12px;">No addresses saved yet.</p>
        <button type="button" class="ak-acc-btn-add-addr" id="akAccEmptyAddBtn" style="margin: 0 auto;">
          + Add Your First Address
        </button>
      </div>
    `;
    document.getElementById('akAccEmptyAddBtn')?.addEventListener('click', () => openAddressModal(null));
    return;
  }

  container.innerHTML = normalized.map(addr => `
    <div class="ak-addr-card ${addr.isDefault ? 'is-default' : ''}" data-id="${addr.id}">
      <div>
        <div class="ak-addr-card-head">
          <span class="ak-addr-type-tag">${addr.tag}</span>
          ${addr.isDefault ? '<span class="ak-addr-default-badge">✓ Default Address</span>' : ''}
        </div>
        <h3 class="ak-addr-recipient">${addr.name}</h3>
        <div class="ak-addr-phone">${addr.phone}</div>
        <p class="ak-addr-text">${addr.street}, ${addr.city}, ${addr.state} - <strong>${addr.pin}</strong></p>
      </div>
      <div class="ak-addr-actions">
        <button type="button" class="ak-addr-btn-edit" data-id="${addr.id}">Edit</button>
        ${!addr.isDefault ? `<button type="button" class="ak-addr-btn-del" data-id="${addr.id}">Delete</button>` : ''}
        ${!addr.isDefault ? `<button type="button" class="ak-addr-btn-default" data-id="${addr.id}">Set as Default</button>` : ''}
      </div>
    </div>
  `).join('');

  // Wire buttons
  container.querySelectorAll('.ak-addr-btn-edit').forEach(btn => {
    btn.onclick = () => openAddressModal(btn.dataset.id);
  });

  container.querySelectorAll('.ak-addr-btn-del').forEach(btn => {
    btn.onclick = async () => {
      try {
        await authService.deleteAddress(btn.dataset.id);
        await renderAddressesList();
        showToast('Address deleted successfully.');
      } catch (err) {
        showToast(err.message || 'Failed to delete address.');
      }
    };
  });

  container.querySelectorAll('.ak-addr-btn-default').forEach(btn => {
    btn.onclick = async () => {
      try {
        await authService.setDefaultAddress(btn.dataset.id);
        await renderAddressesList();
        showToast('Default delivery address updated.');
      } catch (err) {
        showToast(err.message || 'Failed to update default address.');
      }
    };
  });
}

/**
 * Open Address Add/Edit Modal
 */
export function openAddressModal(editId = null) {
  const modal = document.getElementById('akAccAddressModal');
  const title = document.getElementById('akAccAddrModalTitle');
  const form = document.getElementById('akAccAddrForm');
  if (!modal || !form) return;

  const idInput = document.getElementById('akAddrFormId');
  const nameInput = document.getElementById('akAddrFormName');
  const phoneInput = document.getElementById('akAddrFormPhone');
  const streetInput = document.getElementById('akAddrFormStreet');
  const cityInput = document.getElementById('akAddrFormCity');
  const stateInput = document.getElementById('akAddrFormState');
  const pinInput = document.getElementById('akAddrFormPin');
  const defInput = document.getElementById('akAddrFormDefault');

  if (editId) {
    title.textContent = 'Edit Address';
    const addr = cachedAddresses.find(a => a.id === editId);
    if (addr) {
      idInput.value = addr.id;
      nameInput.value = addr.recipient_name || addr.name || '';
      phoneInput.value = addr.phone || '';
      streetInput.value = addr.street || '';
      cityInput.value = addr.city || '';
      stateInput.value = addr.state || '';
      pinInput.value = addr.pin || '';
      defInput.checked = Boolean(addr.is_default ?? addr.isDefault);

      const tagRadio = form.querySelector(`input[name="akAddrTag"][value="${addr.tag || 'Studio'}"]`);
      if (tagRadio) tagRadio.checked = true;
    }
  } else {
    title.textContent = 'Add New Address';
    idInput.value = '';
    const user = getCurrentUser();
    nameInput.value = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
    phoneInput.value = user ? user.phone || user.phone_number || '' : '';
    streetInput.value = '';
    cityInput.value = 'Mumbai';
    stateInput.value = 'Maharashtra';
    pinInput.value = '';
    defInput.checked = cachedAddresses.length === 0;
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeAddressModal() {
  const modal = document.getElementById('akAccAddressModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

/**
 * Render My Orders List from SQLite database
 */
export async function renderOrdersList() {
  const container = document.getElementById('akAccOrdersList');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 40px 20px;">
      <div class="ak-orders-loading-spinner" style="display:inline-block; width:32px; height:32px; border:3px solid rgba(242,112,33,0.2); border-top-color:var(--ak-orange); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <p style="color: var(--ak-text-muted); font-size: 14px; margin-top: 12px;">Loading your order history...</p>
    </div>
  `;

  let orders = [];
  try {
    orders = await ordersService.getOrders();
  } catch (e) {
    orders = [];
  }

  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div class="ak-orders-empty-state">
        <div class="ak-orders-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
        </div>
        <h3 class="ak-orders-empty-title">No Orders Placed Yet</h3>
        <p class="ak-orders-empty-desc">
          You haven't placed any orders yet. Explore our pro audio catalog to start shopping.
        </p>
        <button type="button" class="ak-orders-shop-btn" id="akOrdersShopNowBtn">
          <span>Start Shopping</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
      </div>
    `;

    document.getElementById('akOrdersShopNowBtn')?.addEventListener('click', () => {
      if (typeof window !== 'undefined' && window.showCatalog) {
        window.showCatalog();
      } else {
        const settingsPage = document.getElementById('akAccountSettingsPage');
        const catalogPage = document.getElementById('catalogPage');
        const mainContent = document.getElementById('akMainContent');
        if (settingsPage) settingsPage.style.display = 'none';
        if (mainContent) mainContent.style.display = 'none';
        if (catalogPage) {
          catalogPage.style.display = 'block';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      window.location.hash = '#catalog';
    });
    return;
  }

  container.innerHTML = orders.map(order => {
    const d = new Date(order.createdAt || Date.now());
    const dateFormatted = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const items = order.items || [];
    const totalAmount = Number(order.totalAmount || 0);

    return `
      <div class="ak-order-history-card">
        <div class="ak-order-card-header">
          <div class="ak-order-meta-col">
            <span class="ak-order-number">ORDER #${order.orderNumber}</span>
            <span class="ak-order-date">Placed on ${dateFormatted}</span>
          </div>
          <div class="ak-order-status-badge">
            <span class="ak-status-dot"></span>
            <span>${order.status || 'Confirmed'} · Preparing for Dispatch</span>
          </div>
        </div>

        <div class="ak-order-card-items">
          ${items.map(item => `
            <div class="ak-order-card-item-row" data-product-id="${item.productId || item.id || ''}" style="cursor: pointer;" title="Click to view product details">
              <div class="ak-order-item-img-box">
                <img src="${item.image || 'assets/images/placeholder.svg'}" alt="${item.name}">
              </div>
              <div class="ak-order-item-info">
                <h4 class="ak-order-item-name">${item.name}</h4>
                <div class="ak-order-item-pricing">Qty: ${item.quantity} · ₹${Number(item.unitPrice || 0).toLocaleString('en-IN')}</div>
              </div>
              <div class="ak-order-item-subtotal">₹${Number(item.subtotal || 0).toLocaleString('en-IN')}</div>
            </div>
          `).join('')}
        </div>

        <div class="ak-order-card-footer">
          <div class="ak-order-footer-details">
            <span>Payment: <strong>${order.paymentMethod || 'Cash on Delivery (COD)'}</strong></span>
            ${order.shippingAddress?.city ? `<span>Ship to: <strong>${order.shippingAddress.name || ''} (${order.shippingAddress.city}, ${order.shippingAddress.state || ''})</strong></span>` : ''}
          </div>
          <div class="ak-order-footer-total">
            <span class="ak-total-label">Total Amount:</span>
            <span class="ak-total-value">₹${totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Wire direct click navigation on each product row
  container.querySelectorAll('.ak-order-card-item-row').forEach(row => {
    row.addEventListener('click', () => {
      const pid = row.dataset.productId;
      if (pid) {
        const settingsPage = document.getElementById('akAccountSettingsPage');
        if (settingsPage) settingsPage.style.display = 'none';
        if (typeof window !== 'undefined' && window.showProduct) {
          window.showProduct(pid);
        } else {
          window.location.hash = `#product?id=${encodeURIComponent(pid)}`;
        }
      }
    });
  });
}

/**
 * Initialize all Account Settings event handlers
 */
export function initAccountSettings() {
  // 1. Tab Switching with Unsaved Changes Guard
  const tabAccount = document.getElementById('akAccTabBtnAccount');
  const tabAddresses = document.getElementById('akAccTabBtnAddresses');
  const tabOrders = document.getElementById('akAccTabBtnOrders');
  const panelAccount = document.getElementById('akAccPanelAccount');
  const panelAddresses = document.getElementById('akAccPanelAddresses');
  const panelOrders = document.getElementById('akAccPanelOrders');

  const switchTab = (targetTab) => {
    [tabAccount, tabAddresses, tabOrders].forEach(t => {
      t?.classList.remove('active');
      t?.setAttribute('aria-selected', 'false');
    });
    [panelAccount, panelAddresses, panelOrders].forEach(p => {
      p?.classList.remove('active');
    });

    const hashTarget = targetTab === 'orders' ? '#orders' : (targetTab === 'addresses' ? '#addresses' : '#account');
    if (typeof window !== 'undefined' && window.location.hash !== hashTarget) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', hashTarget);
      } else {
        window.location.hash = hashTarget;
      }
    }

    if (targetTab === 'account') {
      tabAccount?.classList.add('active');
      tabAccount?.setAttribute('aria-selected', 'true');
      panelAccount?.classList.add('active');
    } else if (targetTab === 'addresses') {
      tabAddresses?.classList.add('active');
      tabAddresses?.setAttribute('aria-selected', 'true');
      panelAddresses?.classList.add('active');
      renderAddressesList();
    } else if (targetTab === 'orders') {
      tabOrders?.classList.add('active');
      tabOrders?.setAttribute('aria-selected', 'true');
      panelOrders?.classList.add('active');
      renderOrdersList();
    }
  };

  tabAccount?.addEventListener('click', () => {
    if (tabAccount.classList.contains('active')) return;
    switchTab('account');
  });

  tabAddresses?.addEventListener('click', () => {
    if (tabAddresses.classList.contains('active')) return;
    if (isFormDirty) {
      promptUnsavedChanges(() => switchTab('addresses'));
    } else {
      switchTab('addresses');
    }
  });

  tabOrders?.addEventListener('click', () => {
    if (tabOrders.classList.contains('active')) return;
    if (isFormDirty) {
      promptUnsavedChanges(() => switchTab('orders'));
    } else {
      switchTab('orders');
    }
  });

  // 2. Change Tracking on inputs
  const inputs = [
    'akAccDisplayName', 'akAccTitle', 'akAccFirstName', 'akAccLastName',
    'akAccEmail', 'akAccPhone'
  ];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', checkFormAgainstSnapshot);
      el.addEventListener('change', checkFormAgainstSnapshot);
    }
  });

  // 3. Save & Discard Buttons
  document.getElementById('akAccSaveBtnTop')?.addEventListener('click', saveAccountChanges);
  document.getElementById('akAccSaveBtnBottom')?.addEventListener('click', saveAccountChanges);
  document.getElementById('akAccBannerSaveBtn')?.addEventListener('click', saveAccountChanges);

  document.getElementById('akAccDiscardBtnTop')?.addEventListener('click', discardAccountChanges);
  document.getElementById('akAccDiscardBtnBottom')?.addEventListener('click', discardAccountChanges);

  // 4. In-App Password Change Handlers
  const changePassToggle = document.getElementById('akAccChangePassToggle');
  const changePassPanel = document.getElementById('akAccChangePassPanel');
  const changePassCancel = document.getElementById('akChangePassCancelBtn');
  const changePassSave = document.getElementById('akChangePassSaveBtn');
  const changePassAlert = document.getElementById('akChangePassAlert');

  let changePassOtpRequested = false;

  const resetChangePassForm = () => {
    changePassOtpRequested = false;
    const otpGroup = document.getElementById('akChangePassOtpGroup');
    const otpInput = document.getElementById('akChangePassOtp');
    const cPass = document.getElementById('akChangeCurrentPass');
    const nPass = document.getElementById('akChangeNewPass');
    const cfPass = document.getElementById('akChangeConfirmPass');
    if (otpGroup) otpGroup.style.display = 'none';
    if (otpInput) otpInput.value = '';
    if (cPass) cPass.value = '';
    if (nPass) nPass.value = '';
    if (cfPass) cfPass.value = '';
    if (changePassSave) {
      changePassSave.disabled = false;
      changePassSave.textContent = 'Send Verification Code';
    }
    if (changePassAlert) changePassAlert.style.display = 'none';
  };

  if (changePassToggle && changePassPanel) {
    changePassToggle.addEventListener('click', () => {
      const isVisible = changePassPanel.style.display !== 'none';
      if (isVisible) {
        changePassPanel.style.display = 'none';
        resetChangePassForm();
      } else {
        changePassPanel.style.display = 'block';
        resetChangePassForm();
      }
    });
  }

  if (changePassCancel && changePassPanel) {
    changePassCancel.addEventListener('click', () => {
      changePassPanel.style.display = 'none';
      resetChangePassForm();
    });
  }

  // Resend OTP button listener
  const resendOtpBtn = document.getElementById('akChangePassResendOtpBtn');
  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', async () => {
      const currentPassword = document.getElementById('akChangeCurrentPass')?.value;
      const newPassword = document.getElementById('akChangeNewPass')?.value;
      const confirmPassword = document.getElementById('akChangeConfirmPass')?.value;

      if (!currentPassword || !newPassword || !confirmPassword) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = 'Please enter your current and new passwords first.';
          changePassAlert.style.display = 'block';
        }
        return;
      }

      resendOtpBtn.disabled = true;
      resendOtpBtn.textContent = 'Sending...';

      try {
        const res = await authService.requestChangePasswordOtp(currentPassword, newPassword, confirmPassword);
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg success';
          changePassAlert.textContent = res?.message || 'A new verification code has been dispatched to your email.';
          changePassAlert.style.display = 'block';
        }
        showToast('New verification code sent!', getIcon('check', '', 18));
      } catch (err) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = err.message || 'Failed to resend verification code.';
          changePassAlert.style.display = 'block';
        }
      } finally {
        setTimeout(() => {
          resendOtpBtn.disabled = false;
          resendOtpBtn.textContent = 'Resend Code';
        }, 3000);
      }
    });
  }

  if (changePassSave) {
    changePassSave.addEventListener('click', async () => {
      const currentPassword = document.getElementById('akChangeCurrentPass')?.value;
      const newPassword = document.getElementById('akChangeNewPass')?.value;
      const confirmPassword = document.getElementById('akChangeConfirmPass')?.value;
      const otpInput = document.getElementById('akChangePassOtp');
      const otpVal = otpInput?.value?.trim();

      if (changePassAlert) changePassAlert.style.display = 'none';

      if (!currentPassword || !newPassword || !confirmPassword) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = 'Please fill in all password fields.';
          changePassAlert.style.display = 'block';
        }
        return;
      }

      if (newPassword.length < 8) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = 'New password must be at least 8 characters long.';
          changePassAlert.style.display = 'block';
        }
        return;
      }

      if (newPassword !== confirmPassword) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = 'New passwords do not match.';
          changePassAlert.style.display = 'block';
        }
        return;
      }

      // Step 1: If OTP has not been requested yet, request OTP from backend
      if (!changePassOtpRequested) {
        changePassSave.disabled = true;
        changePassSave.textContent = 'Sending Verification Code...';

        try {
          const res = await authService.requestChangePasswordOtp(currentPassword, newPassword, confirmPassword);
          changePassOtpRequested = true;
          const otpGroup = document.getElementById('akChangePassOtpGroup');
          if (otpGroup) otpGroup.style.display = 'block';
          if (otpInput) {
            otpInput.value = '';
            otpInput.focus();
          }
          if (changePassAlert) {
            changePassAlert.className = 'ak-pass-msg success';
            changePassAlert.textContent = res?.message || 'A 6-digit verification code was sent to your email. Enter it below to confirm.';
            changePassAlert.style.display = 'block';
          }
          showToast('Verification code sent to your email!', getIcon('mail', '', 18));
          changePassSave.textContent = 'Verify Code & Update Password';
        } catch (err) {
          if (changePassAlert) {
            changePassAlert.className = 'ak-pass-msg error';
            changePassAlert.textContent = err.message || 'Failed to dispatch verification code.';
            changePassAlert.style.display = 'block';
          }
          changePassSave.textContent = 'Send Verification Code';
        } finally {
          changePassSave.disabled = false;
        }
        return;
      }

      // Step 2: OTP was requested, now verify OTP and update password
      if (!otpVal || otpVal.length !== 6) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = 'Please enter the 6-digit verification code sent to your email.';
          changePassAlert.style.display = 'block';
        }
        if (otpInput) otpInput.focus();
        return;
      }

      changePassSave.disabled = true;
      changePassSave.textContent = 'Verifying & Updating...';

      try {
        const res = await authService.changePassword(currentPassword, newPassword, confirmPassword, otpVal);
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg success';
          changePassAlert.textContent = res?.message || 'Password updated successfully! A security confirmation was dispatched to your email.';
          changePassAlert.style.display = 'block';
        }
        showToast('Password changed successfully!', getIcon('check', '', 18));
        resetChangePassForm();
        setTimeout(() => {
          if (changePassPanel) changePassPanel.style.display = 'none';
        }, 2000);
      } catch (err) {
        if (changePassAlert) {
          changePassAlert.className = 'ak-pass-msg error';
          changePassAlert.textContent = err.message || 'Failed to update password.';
          changePassAlert.style.display = 'block';
        }
        changePassSave.textContent = 'Verify Code & Update Password';
      } finally {
        changePassSave.disabled = false;
      }
    });
  }

  // 5. Password Show / Hide Toggle
  const togglePassBtn = document.getElementById('akAccTogglePassBtn');
  if (togglePassBtn) {
    togglePassBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const passInput = document.getElementById('akAccPassword');
      const eyeShow = togglePassBtn.querySelector('.ak-eye-show');
      const eyeHide = togglePassBtn.querySelector('.ak-eye-hide');

      if (passInput) {
        const isCurrentlyPassword = passInput.type === 'password';
        passInput.type = isCurrentlyPassword ? 'text' : 'password';

        if (eyeShow && eyeHide) {
          eyeShow.style.display = isCurrentlyPassword ? 'none' : 'block';
          eyeHide.style.display = isCurrentlyPassword ? 'block' : 'none';
        }
      }
    });
  }

  // 6. Address Modal Handlers
  document.getElementById('akAccAddAddrBtn')?.addEventListener('click', () => openAddressModal(null));
  document.getElementById('akAccAddrModalClose')?.addEventListener('click', closeAddressModal);
  document.getElementById('akAccAddrModalCancel')?.addEventListener('click', closeAddressModal);

  document.getElementById('akAccAddrForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('akAddrFormId').value;
    const name = document.getElementById('akAddrFormName').value.trim();
    const phone = document.getElementById('akAddrFormPhone').value.trim();
    const street = document.getElementById('akAddrFormStreet').value.trim();
    const city = document.getElementById('akAddrFormCity').value.trim();
    const state = document.getElementById('akAddrFormState').value.trim();
    const pin = document.getElementById('akAddrFormPin').value.trim();
    const isDefault = document.getElementById('akAddrFormDefault').checked;
    const tag = document.querySelector('input[name="akAddrTag"]:checked')?.value || 'Studio';

    if (!name || !phone || !street || !city || !state || !pin) {
      showToast('Please fill all required address fields.');
      return;
    }

    try {
      if (id) {
        await authService.updateAddress(id, {
          tag,
          recipient_name: name,
          phone,
          street,
          city,
          state,
          pin,
          is_default: isDefault
        });
      } else {
        await authService.addAddress({
          tag,
          recipient_name: name,
          phone,
          street,
          city,
          state,
          pin,
          is_default: isDefault
        });
      }

      closeAddressModal();
      await renderAddressesList();
      showToast(id ? 'Address updated in database!' : 'New address saved to database!', getIcon('check', '', 18));
    } catch (err) {
      showToast(err.message || 'Failed to save address.');
    }
  });

  // 8. Unsaved Changes Modal Actions
  document.getElementById('akUnsavedSaveBtn')?.addEventListener('click', async () => {
    const saved = await saveAccountChanges();
    closeUnsavedChangesModal();
    if (saved && typeof pendingNavigationAction === 'function') {
      const action = pendingNavigationAction;
      pendingNavigationAction = null;
      action();
    }
  });

  document.getElementById('akUnsavedDiscardBtn')?.addEventListener('click', () => {
    discardAccountChanges();
    closeUnsavedChangesModal();
    if (typeof pendingNavigationAction === 'function') {
      const action = pendingNavigationAction;
      pendingNavigationAction = null;
      action();
    }
  });

  document.getElementById('akUnsavedStayBtn')?.addEventListener('click', () => {
    closeUnsavedChangesModal();
    pendingNavigationAction = null;
  });
}
