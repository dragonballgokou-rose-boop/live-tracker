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

// ---------- Japanese Holidays ----------
const JP_HOLIDAYS = new Set([
    // 2024
    '2024-01-01','2024-01-08','2024-02-11','2024-02-12','2024-02-23',
    '2024-03-20','2024-04-29','2024-05-03','2024-05-04','2024-05-05','2024-05-06',
    '2024-07-15','2024-08-11','2024-08-12','2024-09-16','2024-09-22','2024-09-23',
    '2024-10-14','2024-11-03','2024-11-04','2024-11-23',
    // 2025
    '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24',
    '2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05','2025-05-06',
    '2025-07-21','2025-08-11','2025-09-15','2025-09-23','2025-10-13',
    '2025-11-03','2025-11-23','2025-11-24',
    // 2026
    '2026-01-01','2026-01-12','2026-02-11','2026-02-23',
    '2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
    '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23',
    '2026-10-12','2026-11-03','2026-11-23',
    // 2027
    '2027-01-01','2027-01-11','2027-02-11','2027-02-23',
    '2027-03-21','2027-04-29','2027-05-03','2027-05-04','2027-05-05',
    '2027-07-19','2027-08-11','2027-09-20','2027-09-23',
    '2027-10-11','2027-11-03','2027-11-23',
]);

export function isJapaneseHoliday(dateStr) {
    return JP_HOLIDAYS.has(dateStr);
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
