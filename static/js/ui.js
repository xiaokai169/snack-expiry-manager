/* =========================================================
   UI 基础能力：弹窗、提示、确认框、徽章
   ========================================================= */
import { $, $$, escapeHtml } from './utils.js';

/* ========================= 图标 ========================= */
export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/* ========================= 弹窗 ========================= */
const modalStack = [];
const lastFocus = new WeakMap();
let confirmResolver = null;

export function openModal(target) {
  const modal = typeof target === 'string' ? document.getElementById(target) : target;
  if (!modal || !modal.hidden) return;

  lastFocus.set(modal, document.activeElement);
  modal.hidden = false;
  if (!modalStack.includes(modal)) modalStack.push(modal);
  document.body.classList.add('modal-open');

  window.requestAnimationFrame(() => {
    const focusTarget = modal.querySelector(
      'input:not([type="hidden"]):not([disabled]), select, textarea, button:not([disabled])'
    );
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
    } else {
      modal.querySelector('.modal-dialog')?.focus({ preventScroll: true });
    }
  });
}

export function closeModal(target) {
  const modal = typeof target === 'string' ? document.getElementById(target) : target;
  if (!modal || modal.hidden) return;

  modal.hidden = true;
  const index = modalStack.indexOf(modal);
  if (index >= 0) modalStack.splice(index, 1);
  if (modalStack.length === 0) document.body.classList.remove('modal-open');

  const previous = lastFocus.get(modal);
  if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
    previous.focus({ preventScroll: true });
  }

  modal.dispatchEvent(new CustomEvent('modal:closed'));

  if (modal.id === 'confirmModal' && confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(false);
  }
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) closeModal(top);
}

export function isModalOpen() {
  return modalStack.length > 0;
}

export function confirmAction({
  title = '确认操作',
  message = '',
  okText = '确定',
  cancelText = '取消',
  danger = false
} = {}) {
  if (confirmResolver) {
    const previous = confirmResolver;
    confirmResolver = null;
    previous(false);
  }

  const modal = document.getElementById('confirmModal');
  if (!modal) return Promise.resolve(false);

  $('#confirmTitle', modal).textContent = title;
  $('#confirmMessage', modal).innerHTML = message;
  const okBtn = $('#confirmOkBtn', modal);
  okBtn.textContent = okText;
  const mobileStyle = Boolean(modal.querySelector('.m-sheet-foot'));
  okBtn.className = mobileStyle
    ? `m-btn ${danger ? 'danger' : 'primary'}`
    : `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  const cancelBtn = modal.querySelector(
    '.modal-footer [data-action="confirm-cancel"], .m-sheet-foot [data-action="confirm-cancel"]'
  );
  if (cancelBtn) cancelBtn.textContent = cancelText;

  const promise = new Promise((resolve) => {
    confirmResolver = resolve;
  });

  openModal(modal);
  window.requestAnimationFrame(() => okBtn.focus({ preventScroll: true }));
  return promise;
}

/* 弹窗通用关闭按钮、Esc、遮罩 */
document.addEventListener('click', (event) => {
  const closer = event.target.closest('[data-close-modal]');
  if (!closer) return;
  const modal = closer.closest('.modal');
  if (modal) closeModal(modal);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalStack.length) {
    event.preventDefault();
    closeTopModal();
  }
});

/* 确认框按钮 */
document.addEventListener('click', (event) => {
  const ok = event.target.closest('#confirmOkBtn');
  if (ok && confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    closeModal('confirmModal');
    resolve(true);
    return;
  }

  const cancel = event.target.closest('[data-action="confirm-cancel"]');
  if (cancel && confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    closeModal('confirmModal');
    resolve(false);
  }
});

/* ========================= Toast ========================= */
const TOAST_ICONS = {
  success: 'check',
  error: 'warning',
  info: 'info',
  warn: 'warning'
};

export function toast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  // 最多同时保留 2 条（手机）/ 4 条（电脑），避免连续操作时提示堆满屏幕
  const maxToasts = window.matchMedia('(max-width: 680px)').matches ? 2 : 4;
  while (container.children.length >= maxToasts) {
    container.firstElementChild?.remove();
  }

  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.innerHTML = `${icon(TOAST_ICONS[type] || 'info')}<span>${escapeHtml(message)}</span>`;
  container.appendChild(node);

  window.setTimeout(() => {
    node.classList.add('out');
    window.setTimeout(() => node.remove(), 220);
  }, duration);
}

/* ========================= 徽章 ========================= */
export function statusBadge(status) {
  if (status === '已下架') return '<span class="badge badge-gray"><span class="dot"></span>已下架</span>';
  if (status === '无需下架') return '<span class="badge badge-blue"><span class="dot"></span>无需下架</span>';
  return '<span class="badge badge-green"><span class="dot"></span>未下架</span>';
}

export function remainingBadge(product, meta) {
  if (product.status === '已下架') {
    return '<span class="badge badge-gray">已下架</span>';
  }
  if (product.status === '无需下架') {
    return `<span class="badge badge-blue">${escapeHtml(meta.remainingLabel)}</span>`;
  }
  if (meta.expired) {
    return `<span class="badge badge-red">${escapeHtml(meta.remainingLabel)}</span>`;
  }
  if (meta.warning) {
    return `<span class="badge badge-orange">${escapeHtml(meta.remainingLabel)}</span>`;
  }
  return `<span class="badge badge-green">${escapeHtml(meta.remainingLabel)}</span>`;
}

/* ========================= 空状态 ========================= */
export function emptyState({ iconName = 'box', title, description, actions = '' }) {
  return `
    <div class="empty-state">
      <span class="empty-orb">${icon(iconName)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${actions ? `<div class="empty-actions">${actions}</div>` : ''}
    </div>
  `;
}
