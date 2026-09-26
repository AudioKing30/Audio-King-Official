/**
 * AudioKing Non-Intrusive Toast Notification
 */
let toastTimeout = null;

export function showToast(message, iconSvg = '') {
  let container = document.getElementById('akToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'akToastContainer';
    container.className = 'ak-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'ak-toast';
  toast.innerHTML = `
    ${iconSvg ? `<span>${iconSvg}</span>` : ''}
    <span>${message}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}
