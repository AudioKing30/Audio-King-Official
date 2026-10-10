/**
 * AudioKing Production Authentication Controller
 * Connects frontend views directly to authService and backend REST API.
 * Real Database Persistence, Real Bcrypt Hashing, Real 6-digit OTP, Real Session Cookies.
 */

import { showToast } from './toast.js';
import { getIcon } from '../../assets/icons/icons.js';
import { authService } from '../services/authService.js';
import { apiUrl } from '../services/apiConfig.js';

let pendingSignupEmail = '';
let pendingResetEmail = '';
let pendingResetToken = '';
let otpCountdownTimer = null;
let resetCountdownTimer = null;

/**
 * Returns current authenticated user formatted with convenience properties
 */
export function getCurrentUser() {
  const u = authService.getUser();
  if (!u) return null;
  const names = (u.fullName || '').trim().split(/\s+/);
  return {
    ...u,
    firstName: u.displayName || names[0] || 'Member',
    lastName: names.slice(1).join(' ') || ''
  };
}

/**
 * Account avatar handling scrapped by design — header nav always displays standard vector SVG icon
 */
export function updateNavAccountAvatar() {}

/**
 * Updates UI header, account dropdown, and user information
 */
export function updateHeaderAccountState() {
  const status = authService.getStatus();
  const user = getCurrentUser();
  const accountVal = document.getElementById('akAccountValue');
  const dropdownHeader = document.getElementById('akAccountUserHeader');
  const loggedInItems = document.getElementById('akAccountLoggedInItems');
  const loggedOutItems = document.getElementById('akAccountLoggedOutItems');

  // Mobile Drawer Account Card elements
  const mobPfpInitials = document.getElementById('akMobPfpInitials');
  const mobUserName = document.getElementById('akMobUserName');
  const mobUserEmail = document.getElementById('akMobUserEmail');
  const mobLoggedIn = document.getElementById('akMobActionsLoggedIn');
  const mobLoggedOut = document.getElementById('akMobActionsLoggedOut');

  if (status === 'loading') {
    if (accountVal) accountVal.innerHTML = '<span class="ak-account-loading-pulse">Account</span>';
    if (dropdownHeader) dropdownHeader.style.display = 'none';
    if (loggedInItems) loggedInItems.style.display = 'none';
    if (loggedOutItems) loggedOutItems.style.display = 'none';
    if (mobLoggedIn) mobLoggedIn.style.display = 'none';
    if (mobLoggedOut) mobLoggedOut.style.display = 'none';
    return;
  }

  if (user) {
    const displayName = user.fullName || `${user.firstName} ${user.lastName || ''}`.trim() || user.displayName || 'Musician';
    const email = user.email || '';
    const initial = ((user.firstName || user.displayName || user.fullName || 'U')[0] || 'U').toUpperCase();

    const adminTrigger = document.getElementById('akAdminDashboardTrigger');
    const mobAdminTrigger = document.getElementById('akMobActionAdmin');
    const isAdmin = user.role === 'admin';

    if (accountVal) accountVal.textContent = isAdmin ? 'Admin' : (user.firstName || user.displayName || 'My Account');
    if (adminTrigger) adminTrigger.style.display = isAdmin ? 'flex' : 'none';
    if (mobAdminTrigger) mobAdminTrigger.style.display = isAdmin ? 'block' : 'none';

    if (dropdownHeader) {
      dropdownHeader.style.display = 'flex';
      const nameEl = dropdownHeader.querySelector('.ak-account-user-name');
      const emailEl = dropdownHeader.querySelector('.ak-account-user-email');
      if (nameEl) nameEl.textContent = isAdmin ? `${displayName} (Admin)` : displayName;
      if (emailEl) emailEl.textContent = email;
    }
    if (loggedInItems) loggedInItems.style.display = 'block';
    if (loggedOutItems) loggedOutItems.style.display = 'none';

    // Mobile Drawer Account Card
    if (mobPfpInitials) mobPfpInitials.textContent = initial;
    if (mobUserName) mobUserName.textContent = isAdmin ? `${displayName} (Admin)` : displayName;
    if (mobUserEmail) mobUserEmail.textContent = email;
    if (mobLoggedIn) mobLoggedIn.style.display = 'flex';
    if (mobLoggedOut) mobLoggedOut.style.display = 'none';

    // Footer dynamic auth link
    const footerAuthItem = document.getElementById('akFooterAuthItem');
    const footerLogoutItem = document.getElementById('akFooterLogoutItem');
    if (footerAuthItem) footerAuthItem.style.display = 'none';
    if (footerLogoutItem) footerLogoutItem.style.display = 'block';
  } else {
    if (accountVal) accountVal.textContent = 'Sign In';
    if (dropdownHeader) dropdownHeader.style.display = 'none';
    if (loggedInItems) loggedInItems.style.display = 'none';
    if (loggedOutItems) loggedOutItems.style.display = 'block';

    // Mobile Drawer Account Card (Logged Out)
    if (mobPfpInitials) mobPfpInitials.textContent = 'G';
    if (mobUserName) mobUserName.textContent = 'Guest Musician';
    if (mobUserEmail) mobUserEmail.textContent = 'Sign in to your account';
    if (mobLoggedIn) mobLoggedIn.style.display = 'none';
    if (mobLoggedOut) mobLoggedOut.style.display = 'flex';

    // Footer dynamic auth link
    const footerAuthItem = document.getElementById('akFooterAuthItem');
    const footerLogoutItem = document.getElementById('akFooterLogoutItem');
    if (footerAuthItem) footerAuthItem.style.display = 'block';
    if (footerLogoutItem) footerLogoutItem.style.display = 'none';
  }
}

/**
 * Display server or validation error inside the auth modal
 */
function showAuthError(message) {
  const banner = document.getElementById('akAuthErrorBanner');
  if (banner) {
    banner.textContent = message;
    banner.style.display = 'flex';
  }
}

/**
 * Clear any displayed auth error
 */
function clearAuthError() {
  const banner = document.getElementById('akAuthErrorBanner');
  if (banner) {
    banner.textContent = '';
    banner.style.display = 'none';
  }
}

/**
 * Open authentication modal
 */
export function openAuthModal(initialTab = 'signin', message = '') {
  const modal = document.getElementById('akAuthModal');
  const msgEl = document.getElementById('akAuthPromptMessage');

  // Trigger background server pre-warm so backend is hot and ready
  authService.prewarmServer();

  clearAuthError();

  if (msgEl) {
    if (message) {
      msgEl.textContent = message;
      msgEl.style.display = 'block';
    } else {
      msgEl.style.display = 'none';
    }
  }

  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    switchAuthTab(initialTab);
  }
}

/**
 * Close authentication modal
 */
export function closeAuthModal() {
  const modal = document.getElementById('akAuthModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
  clearAuthError();
  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  if (resetCountdownTimer) clearInterval(resetCountdownTimer);
}

/**
 * Switch view inside the auth modal
 */
export function switchAuthTab(view) {
  clearAuthError();

  const tabSignIn = document.getElementById('akAuthTabSignIn');
  const tabSignUp = document.getElementById('akAuthTabSignUp');
  const tabsContainer = document.getElementById('akAuthTabs');

  const viewSignIn = document.getElementById('akAuthViewSignIn');
  const viewSignUp = document.getElementById('akAuthViewSignUp');
  const viewOtp = document.getElementById('akAuthViewOtp');
  const viewForgot1 = document.getElementById('akAuthViewForgotStep1');
  const viewForgot2 = document.getElementById('akAuthViewForgotStep2');
  const viewForgot3 = document.getElementById('akAuthViewForgotStep3');

  // Hide all views first
  [viewSignIn, viewSignUp, viewOtp, viewForgot1, viewForgot2, viewForgot3].forEach(el => {
    if (el) el.style.display = 'none';
  });

  if (view === 'signin') {
    if (tabsContainer) tabsContainer.style.display = 'flex';
    tabSignIn?.classList.add('active');
    tabSignUp?.classList.remove('active');
    if (viewSignIn) viewSignIn.style.display = 'block';
  } else if (view === 'signup') {
    if (tabsContainer) tabsContainer.style.display = 'flex';
    tabSignIn?.classList.remove('active');
    tabSignUp?.classList.add('active');
    if (viewSignUp) viewSignUp.style.display = 'block';
  } else {
    // Specialized steps (OTP, Forgot Password) hide the main tabs
    if (tabsContainer) tabsContainer.style.display = 'none';
    if (view === 'otp' && viewOtp) viewOtp.style.display = 'block';
    if (view === 'forgot1' && viewForgot1) viewForgot1.style.display = 'block';
    if (view === 'forgot2' && viewForgot2) viewForgot2.style.display = 'block';
    if (view === 'forgot3' && viewForgot3) viewForgot3.style.display = 'block';
  }
}

/**
 * Show signup OTP verification screen with countdown
 */
export function showOtpVerification(email) {
  pendingSignupEmail = email;
  switchAuthTab('otp');

  const targetEl = document.getElementById('akOtpEmailTarget');
  if (targetEl) targetEl.textContent = email;

  setupOtpInputs('akOtpInputsContainer', () => {
    document.getElementById('akOtpVerifyBtn')?.click();
  });

  startResendTimer('akOtpResendBtn', 'akOtpCountdown', otpCountdownTimer, timer => {
    otpCountdownTimer = timer;
  });
}

/**
 * Setup 6-digit OTP input auto-advance, backspace, and paste support
 */
function setupOtpInputs(containerId, onComplete) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const inputs = container.querySelectorAll('.ak-otp-digit');
  inputs.forEach(input => (input.value = ''));

  if (inputs.length > 0) {
    setTimeout(() => inputs[0].focus(), 100);
  }

  inputs.forEach((input, index) => {
    input.oninput = (e) => {
      clearAuthError();
      const val = e.target.value.replace(/\D/g, '');
      input.value = val ? val.slice(-1) : '';

      if (input.value && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }

      // If all inputs filled, trigger completion callback
      const fullCode = Array.from(inputs).map(inp => inp.value).join('');
      if (fullCode.length === inputs.length && typeof onComplete === 'function') {
        onComplete();
      }
    };

    input.onkeydown = (e) => {
      if (e.key === 'Backspace') {
        if (!input.value && index > 0) {
          inputs[index - 1].focus();
          inputs[index - 1].value = '';
        }
      }
    };

    input.onpaste = (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, inputs.length);
      if (pasted) {
        inputs.forEach((inp, i) => {
          inp.value = pasted[i] || '';
        });
        const targetIndex = Math.min(pasted.length, inputs.length - 1);
        inputs[targetIndex].focus();

        if (pasted.length === inputs.length && typeof onComplete === 'function') {
          onComplete();
        }
      }
    };
  });
}

/**
 * Start 60-second cooldown timer for OTP resend buttons
 */
function startResendTimer(btnId, displayId, existingTimer, saveTimer) {
  if (existingTimer) clearInterval(existingTimer);

  const btn = document.getElementById(btnId);
  const display = document.getElementById(displayId);
  if (!btn) return;

  let seconds = 60;
  btn.disabled = true;
  if (display) display.textContent = `(${seconds}s)`;

  const interval = setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) {
      clearInterval(interval);
      btn.disabled = false;
      if (display) display.textContent = '';
    } else {
      if (display) display.textContent = `(${seconds}s)`;
    }
  }, 1000);

  saveTimer(interval);
}

/**
 * Set loading state on a submit button
 */
function setButtonLoading(btn, isLoading, loadingText = 'Processing...') {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = loadingText;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || 'Submit';
  }
}

/**
 * Open confirmation modal before logging out
 */
export function openLogoutConfirmModal() {
  const modal = document.getElementById('akLogoutModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close logout confirmation modal
 */
export function closeLogoutConfirmModal() {
  const modal = document.getElementById('akLogoutModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

/**
 * Perform confirmed secure logout
 */
export async function executeLogout() {
  closeLogoutConfirmModal();
  await authService.logout();
  updateHeaderAccountState();
  showToast('You have been securely logged out.');
  if (typeof window !== 'undefined' && (window.location.hash.startsWith('#account') || window.location.hash.startsWith('#orders'))) {
    window.location.hash = '#home';
  }
}

/**
 * Log out current user (prompts for confirmation)
 */
export async function logout() {
  openLogoutConfirmModal();
}

/**
 * Open user profile / account settings
 */
export function openProfileModal() {
  if (typeof window !== 'undefined' && window.showAccountSettings) {
    window.showAccountSettings();
  }
}

/**
 * Initialize all authentication event listeners and session restoration
 */
export function initAuth() {
  // 1. Subscribe to reactive auth updates
  authService.subscribe((user) => {
    updateHeaderAccountState();
  });

  // 2. Restore active session from HttpOnly cookie on page load
  if (typeof window !== 'undefined' && window.location.search && window.location.search.includes('auth=google_success')) {
    authService.init().then(user => {
      if (user) {
        showToast(`Welcome to AudioKing, ${user.firstName || user.fullName || 'Musician'}! (Signed in via Google)`, getIcon('check-circle', '', 20));
      }
    });
  } else {
    authService.init();
  }

  // 3. Optional Google Identity Services (GIS) native prompt
  if (typeof window !== 'undefined') {
    const setupGsi = async () => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        let clientId = '6900904235-b1cckc398cfk9v254f2icu08lgch5q8u.apps.googleusercontent.com';
        try {
          const configRes = await fetch(apiUrl('/api/auth/google/config'));
          if (configRes.ok) {
            const configData = await configRes.json();
            if (configData.clientId) clientId = configData.clientId;
          }
        } catch (e) {}

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => {
            if (response && response.credential) {
              try {
                await authService.googleLogin(response.credential);
                closeAuthModal();
                const user = authService.getUser();
                showToast(`Welcome to AudioKing, ${user?.firstName || user?.fullName || 'Musician'}! (Signed in via Google)`, getIcon('check-circle', '', 20));
              } catch (e) {
                console.warn('[GSI Login Error]', e);
              }
            }
          }
        });
      }
    };
    if (window.google?.accounts?.id) {
      setupGsi();
    } else {
      window.addEventListener('load', setupGsi);
    }
  }

  // 3. Modal close and tab navigation
  const signInTab = document.getElementById('akAuthTabSignIn');
  const signUpTab = document.getElementById('akAuthTabSignUp');
  const modalClose = document.getElementById('akAuthClose');
  const modal = document.getElementById('akAuthModal');

  if (signInTab) signInTab.addEventListener('click', () => switchAuthTab('signin'));
  if (signUpTab) signUpTab.addEventListener('click', () => switchAuthTab('signup'));
  if (modalClose) modalClose.addEventListener('click', closeAuthModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAuthModal();
    });
  }

  // Keyboard accessibility: Escape to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal?.classList.contains('open')) {
      closeAuthModal();
    }
  });

  // -------------------------------------------------------------------------
  // SIGN IN FLOW
  // -------------------------------------------------------------------------
  const signInForm = document.getElementById('akSignInForm');
  const signInBtn = document.getElementById('akSignInBtn');
  const signInEmailInput = document.getElementById('akSignInEmail');
  const signInPassInput = document.getElementById('akSignInPass');
  if (signInEmailInput) signInEmailInput.addEventListener('focus', () => authService.prewarmServer());
  if (signInPassInput) signInPassInput.addEventListener('focus', () => authService.prewarmServer());

  if (signInForm) {
    signInForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (signInBtn?.disabled) return;
      clearAuthError();

      const email = document.getElementById('akSignInEmail')?.value.trim();
      const pass = document.getElementById('akSignInPass')?.value;

      if (!email || !pass) {
        showAuthError('Please enter both email and password.');
        return;
      }

      setButtonLoading(signInBtn, true, 'Signing in...');

      // Dynamic feedback timers if server takes a few seconds to spin up from sleep
      const statusTimer1 = setTimeout(() => {
        if (signInBtn?.disabled) setButtonLoading(signInBtn, true, 'Connecting to server...');
      }, 2500);

      const statusTimer2 = setTimeout(() => {
        if (signInBtn?.disabled) setButtonLoading(signInBtn, true, 'Waking up secure server...');
      }, 7000);

      try {
        await authService.login(email, pass, {
          onStatus: (msg) => {
            if (signInBtn?.disabled) setButtonLoading(signInBtn, true, msg);
          }
        });
        clearTimeout(statusTimer1);
        clearTimeout(statusTimer2);

        closeAuthModal();
        const user = getCurrentUser();
        if (user && user.role === 'admin') {
          showToast('Welcome Administrator! Opening Admin Portal...', getIcon('check-circle', '', 20));
          if (typeof window !== 'undefined') {
            if (typeof window.showAdmin === 'function') {
              window.showAdmin(true);
            } else {
              window.location.hash = '#admin';
            }
          }
          return;
        }
        // Customer login
        if (typeof window !== 'undefined' && window.location.hash.startsWith('#admin')) {
          showToast(`Welcome back, ${user?.firstName || 'Musician'}! Note: Administrator credentials required for Admin Portal.`, 'info');
          if (typeof window.showHome === 'function') window.showHome();
          else window.location.hash = '#home';
          return;
        }
        showToast(`Welcome back, ${user?.firstName || 'Musician'}!`, getIcon('check-circle', '', 20));
      } catch (err) {
        clearTimeout(statusTimer1);
        clearTimeout(statusTimer2);
        if (err.notRegistered) {
          showAuthError(err.message || 'This user is not registered yet. Please register your account first.');
          showToast('This user is not registered yet. Please register your account first.', 'info');
          setTimeout(() => {
            switchAuthTab('signup');
            const signUpEmail = document.getElementById('akSignUpEmail');
            if (signUpEmail && !signUpEmail.value) {
              signUpEmail.value = err.email || email;
            }
          }, 1400);
        } else if (err.requiresVerification) {
          showToast('Account verification required. A code was sent to your email.');
          showOtpVerification(err.email || email);
        } else {
          showAuthError(err.message || 'Invalid email or password.');
        }
      } finally {
        setButtonLoading(signInBtn, false);
      }
    });
  }

  // Forgot password link in sign-in form
  const forgotLink = document.getElementById('akSignInForgotLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', () => {
      const emailVal = document.getElementById('akSignInEmail')?.value.trim() || '';
      const forgotInput = document.getElementById('akForgotEmail');
      if (forgotInput && emailVal) forgotInput.value = emailVal;
      switchAuthTab('forgot1');
    });
  }

  // -------------------------------------------------------------------------
  // SIGN UP FLOW
  // -------------------------------------------------------------------------
  const signUpForm = document.getElementById('akSignUpForm');
  const signUpBtn = document.getElementById('akSignUpBtn');

  if (signUpForm) {
    signUpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();

      const firstName = document.getElementById('akSignUpFirst')?.value.trim();
      const lastName = document.getElementById('akSignUpLast')?.value.trim();
      const email = document.getElementById('akSignUpEmail')?.value.trim();
      const phone = document.getElementById('akSignUpPhone')?.value.trim();
      const gstNumber = document.getElementById('akSignUpGst')?.value.trim().toUpperCase() || '';
      const pass = document.getElementById('akSignUpPass')?.value;
      const passConfirm = document.getElementById('akSignUpPassConfirm')?.value;

      if (!firstName || !lastName || !email || !phone || !pass) {
        showAuthError('All fields are required.');
        return;
      }

      if (pass.length < 8) {
        showAuthError('Password must be at least 8 characters long.');
        return;
      }

      if (pass !== passConfirm) {
        showAuthError('Passwords do not match.');
        return;
      }

      setButtonLoading(signUpBtn, true, 'Creating account...');

      try {
        await authService.signup({
          fullName: `${firstName} ${lastName}`,
          email,
          password: pass,
          confirmPassword: passConfirm,
          phone,
          gstNumber
        });

        showOtpVerification(email);
        showToast('Verification code dispatched to your email.');
      } catch (err) {
        showAuthError(err.message || 'Signup failed.');
      } finally {
        setButtonLoading(signUpBtn, false);
      }
    });
  }

  // -------------------------------------------------------------------------
  // SIGNUP OTP VERIFY & RESEND
  // -------------------------------------------------------------------------
  const otpVerifyBtn = document.getElementById('akOtpVerifyBtn');
  if (otpVerifyBtn) {
    otpVerifyBtn.addEventListener('click', async () => {
      clearAuthError();
      const inputs = document.querySelectorAll('#akOtpInputsContainer .ak-otp-digit');
      const otp = Array.from(inputs).map(inp => inp.value).join('');

      if (otp.length !== 6) {
        showAuthError('Please enter the full 6-digit verification code.');
        return;
      }

      setButtonLoading(otpVerifyBtn, true, 'Verifying code...');

      try {
        await authService.verifySignupOtp(pendingSignupEmail, otp);
        closeAuthModal();
        const user = getCurrentUser();
        showToast(`Account verified! Welcome to AudioKing, ${user?.firstName || 'Musician'}!`, getIcon('check-circle', '', 20));
      } catch (err) {
        showAuthError(err.message || 'Invalid or expired verification code.');
      } finally {
        setButtonLoading(otpVerifyBtn, false);
      }
    });
  }

  const otpResendBtn = document.getElementById('akOtpResendBtn');
  if (otpResendBtn) {
    otpResendBtn.addEventListener('click', async () => {
      clearAuthError();
      if (!pendingSignupEmail) return;

      try {
        await authService.resendSignupOtp(pendingSignupEmail);
        showToast('Fresh verification code sent.');
        startResendTimer('akOtpResendBtn', 'akOtpCountdown', otpCountdownTimer, timer => {
          otpCountdownTimer = timer;
        });
      } catch (err) {
        showAuthError(err.message || 'Failed to resend code.');
      }
    });
  }

  document.getElementById('akOtpBackToSignIn')?.addEventListener('click', () => switchAuthTab('signin'));

  // -------------------------------------------------------------------------
  // FORGOT PASSWORD FLOW (3 STEPS)
  // -------------------------------------------------------------------------
  // Step 1: Send OTP
  const forgotForm1 = document.getElementById('akForgotFormStep1');
  const forgotSendBtn = document.getElementById('akForgotSendBtn');

  if (forgotForm1) {
    forgotForm1.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();

      const email = document.getElementById('akForgotEmail')?.value.trim();
      if (!email) {
        showAuthError('Please enter your email address.');
        return;
      }

      setButtonLoading(forgotSendBtn, true, 'Sending code...');

      try {
        await authService.forgotPassword(email);
        pendingResetEmail = email;

        const targetEl = document.getElementById('akForgotEmailTarget');
        if (targetEl) targetEl.textContent = email;

        switchAuthTab('forgot2');
        setupOtpInputs('akForgotOtpInputsContainer', () => {
          document.getElementById('akForgotVerifyBtn')?.click();
        });

        startResendTimer('akForgotResendBtn', 'akForgotCountdown', resetCountdownTimer, timer => {
          resetCountdownTimer = timer;
        });

        showToast('Reset code sent to your email.');
      } catch (err) {
        showAuthError(err.message || 'Failed to send reset code.');
      } finally {
        setButtonLoading(forgotSendBtn, false);
      }
    });
  }

  // Step 2: Verify Reset OTP
  const forgotVerifyBtn = document.getElementById('akForgotVerifyBtn');
  if (forgotVerifyBtn) {
    forgotVerifyBtn.addEventListener('click', async () => {
      clearAuthError();
      const inputs = document.querySelectorAll('#akForgotOtpInputsContainer .ak-reset-otp-digit');
      const otp = Array.from(inputs).map(inp => inp.value).join('');

      if (otp.length !== 6) {
        showAuthError('Please enter the full 6-digit code.');
        return;
      }

      setButtonLoading(forgotVerifyBtn, true, 'Verifying...');

      try {
        const res = await authService.verifyResetOtp(pendingResetEmail, otp);
        pendingResetToken = res.resetToken;
        switchAuthTab('forgot3');
      } catch (err) {
        showAuthError(err.message || 'Invalid or expired reset code.');
      } finally {
        setButtonLoading(forgotVerifyBtn, false);
      }
    });
  }

  const forgotResendBtn = document.getElementById('akForgotResendBtn');
  if (forgotResendBtn) {
    forgotResendBtn.addEventListener('click', async () => {
      clearAuthError();
      if (!pendingResetEmail) return;

      try {
        await authService.forgotPassword(pendingResetEmail);
        showToast('Fresh reset code sent.');
        startResendTimer('akForgotResendBtn', 'akForgotCountdown', resetCountdownTimer, timer => {
          resetCountdownTimer = timer;
        });
      } catch (err) {
        showAuthError(err.message || 'Failed to resend code.');
      }
    });
  }

  // Step 3: Reset Password
  const resetForm = document.getElementById('akResetPasswordForm');
  const resetSubmitBtn = document.getElementById('akResetSubmitBtn');

  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthError();

      const newPass = document.getElementById('akResetNewPass')?.value;
      const confirmPass = document.getElementById('akResetConfirmPass')?.value;

      if (!newPass || newPass.length < 8) {
        showAuthError('Password must be at least 8 characters long.');
        return;
      }

      if (newPass !== confirmPass) {
        showAuthError('Passwords do not match.');
        return;
      }

      setButtonLoading(resetSubmitBtn, true, 'Updating password...');

      try {
        await authService.resetPassword(pendingResetEmail, pendingResetToken, newPass, confirmPass);
        closeAuthModal();
        showToast('Password updated successfully! Welcome back.', getIcon('check-circle', '', 20));
      } catch (err) {
        showAuthError(err.message || 'Failed to update password.');
      } finally {
        setButtonLoading(resetSubmitBtn, false);
      }
    });
  }

  // Back to sign-in links for forgot password views
  document.getElementById('akForgotBackBtn1')?.addEventListener('click', () => switchAuthTab('signin'));
  document.getElementById('akForgotBackBtn2')?.addEventListener('click', () => switchAuthTab('signin'));
  document.getElementById('akForgotBackBtn3')?.addEventListener('click', () => switchAuthTab('signin'));

  // -------------------------------------------------------------------------
  // GOOGLE OAUTH
  // -------------------------------------------------------------------------
  const handleGoogleClick = async () => {
    clearAuthError();
    const googleBtn1 = document.getElementById('akGoogleBtn');
    const googleBtn2 = document.getElementById('akGoogleBtnSignUp');
    setButtonLoading(googleBtn1, true, 'Connecting Google...');
    setButtonLoading(googleBtn2, true, 'Connecting Google...');

    try {
      await authService.initiateGoogleAuth();
      closeAuthModal();
      const user = authService.getUser();
      if (user) {
        showToast(`Welcome to AudioKing, ${user.firstName || user.fullName || 'Musician'}! (Signed in via Google)`, getIcon('check-circle', '', 20));
      }
    } catch (err) {
      console.warn('[Google Auth]', err.message);
      // If user simply closed the window before finishing or cancelled, don't flash scary red banner
      if (err.message && (err.message.includes('closed') || err.message.includes('cancelled') || err.message.includes('timed out'))) {
        return;
      }
      showAuthError(err.message || 'Google Sign-In was unable to complete. Please try again or use Email login.');
    } finally {
      setButtonLoading(googleBtn1, false);
      setButtonLoading(googleBtn2, false);
    }
  };

  document.getElementById('akGoogleBtn')?.addEventListener('click', handleGoogleClick);
  document.getElementById('akGoogleBtnSignUp')?.addEventListener('click', handleGoogleClick);

  // -------------------------------------------------------------------------
  // DROPDOWN & EXTERNAL TRIGGERS
  // -------------------------------------------------------------------------
  const accountTrigger = document.getElementById('akAccountTrigger');
  if (accountTrigger) {
    accountTrigger.addEventListener('click', (e) => {
      if (e.target.closest('#akAccountDropdown a, #akAccountDropdown button')) return;
      if (!authService.isAuthenticated()) {
        openAuthModal('signin');
      } else {
        accountTrigger.classList.toggle('open');
      }
    });
    document.addEventListener('click', (e) => {
      if (!accountTrigger.contains(e.target)) {
        accountTrigger.classList.remove('open');
      }
    });
  }
  document.getElementById('akSignInTrigger')?.addEventListener('click', () => openAuthModal('signin'));
  document.getElementById('akSignUpTrigger')?.addEventListener('click', () => openAuthModal('signup'));
  document.getElementById('akProfileTrigger')?.addEventListener('click', openProfileModal);
  document.getElementById('akFooterProfileTrigger')?.addEventListener('click', () => {
    if (authService.isAuthenticated()) openProfileModal();
    else openAuthModal('signin');
  });
  document.getElementById('akFooterOrdersTrigger')?.addEventListener('click', () => {
    if (authService.isAuthenticated()) {
      if (typeof window !== 'undefined' && window.showAccountSettings) window.showAccountSettings('orders');
    } else {
      openAuthModal('signin');
    }
  });
  document.getElementById('akLogoutTrigger')?.addEventListener('click', logout);
  document.getElementById('akFooterLogoutTrigger')?.addEventListener('click', logout);

  // Mobile Drawer Account Actions
  const closeMobDrawer = () => {
    const mobileDrawer = document.getElementById('akMobileDrawer');
    if (mobileDrawer) {
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    }
  };

  document.getElementById('akMobActionSignIn')?.addEventListener('click', () => {
    closeMobDrawer();
    openAuthModal('signin');
  });
  document.getElementById('akMobActionSignUp')?.addEventListener('click', () => {
    closeMobDrawer();
    openAuthModal('signup');
  });
  document.getElementById('akMobActionProfile')?.addEventListener('click', () => {
    closeMobDrawer();
    openProfileModal();
  });
  document.getElementById('akMobActionOrders')?.addEventListener('click', () => {
    closeMobDrawer();
    if (typeof window !== 'undefined' && window.showAccountSettings) {
      window.showAccountSettings('orders');
    }
  });
  document.getElementById('akMobActionLogout')?.addEventListener('click', () => {
    closeMobDrawer();
    logout();
  });

  // Logout confirmation modal listeners
  document.getElementById('akLogoutModalClose')?.addEventListener('click', closeLogoutConfirmModal);
  document.getElementById('akLogoutCancelBtn')?.addEventListener('click', closeLogoutConfirmModal);
  document.getElementById('akLogoutConfirmBtn')?.addEventListener('click', executeLogout);
  document.getElementById('akLogoutModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'akLogoutModal') closeLogoutConfirmModal();
  });

  document.getElementById('akFooterAuthTrigger')?.addEventListener('click', () => openAuthModal('signin'));




  // Deep-link hash listener for direct login / signup modals (e.g. #auth=signin)
  const checkHashAuth = () => {
    if (typeof window !== 'undefined' && window.location.hash) {
      if (window.location.hash.includes('auth=signin')) {
        openAuthModal('signin');
      } else if (window.location.hash.includes('auth=signup')) {
        openAuthModal('signup');
      }
    }
  };
  checkHashAuth();
  window.addEventListener('hashchange', checkHashAuth);

  document.getElementById('akProfileClose')?.addEventListener('click', () => {
    document.getElementById('akProfileModal')?.classList.remove('open');
    document.body.style.overflow = '';
  });

  // Delegated Show / Hide Password Toggle
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ak-password-toggle-btn');
    if (!btn) return;
    e.preventDefault();

    const targetId = btn.getAttribute('data-target');
    let input = targetId ? document.getElementById(targetId) : null;
    if (!input) {
      input = btn.closest('.ak-password-wrapper')?.querySelector('input');
    }
    if (!input) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    btn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');

    const eyeSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeOffSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

    btn.innerHTML = isPassword ? eyeOffSvg : eyeSvg;
  });
}
