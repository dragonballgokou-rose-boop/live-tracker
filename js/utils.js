// ============================================
// Utility Functions
// ============================================

// ---------- Modal ----------
export function showModal(title, bodyHtml) {
    const container = document.getElementById('modal-container');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    container.classList.remove('hidden');

    // Close handlers
    const closeBtn = document.getElementById('modal-close');
    const backdrop = container.querySelector('.modal-backdrop');

    const close = () => {
        container.classList.add('hidden');
        closeBtn.removeEventListener('click', close);
        backdrop.removeEventListener('click', close);
    };

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    // Focus first input
    setTimeout(() => {
        const firstInput = bodyEl.querySelector('input, textarea, select');
        if (firstInput) firstInput.focus();
    }, 100);
}

export function closeModal() {
    document.getElementById('modal-container').classList.add('hidden');
}

// ---------- Toast ----------
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️'
    };

    toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut var(--transition-base) ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ---------- Member Avatar ----------
export function memberAvatarHtml(member, size = 40) {
    const fontSize = Math.max(10, Math.round(size * 0.42));
    if (member.avatar) {
        return `<img src="${member.avatar}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:2px solid ${member.color};display:block;flex-shrink:0;" alt="" />`;
    }
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${member.color};display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:700;color:white;flex-shrink:0;">${member.name.charAt(0)}</div>`;
}

export function showConfirm(title, message, onConfirm) {
    showModal(title, `
    <div class="confirm-delete">
      <p>${message.replace(/\n/g, '<br>')}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="confirm-cancel">キャンセル</button>
        <button type="button" class="btn btn-danger" id="confirm-ok">削除する</button>
      </div>
    </div>
  `);

    document.getElementById('confirm-cancel').addEventListener('click', () => closeModal());
    document.getElementById('confirm-ok').addEventListener('click', () => {
        closeModal();
        onConfirm();
    });
}
