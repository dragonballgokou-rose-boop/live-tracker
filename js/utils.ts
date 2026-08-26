// ============================================
// Utility Functions
// ============================================

import type { Member } from './types.js';

export type ToastType = 'success' | 'error' | 'info';

// ---------- Defaults ----------
/**
 * 既定のアーティスト。ライブ／ツアー新規作成時のアーティスト欄や
 * 公式同期モーダルのグループ絞り込みの初期値として使う。
 */
export const DEFAULT_ARTIST = '乃木坂46';

/**
 * 一覧表示のアーティスト絞り込みの初期値を決める。
 * DEFAULT_ARTIST のライブが 1 件でもあればそれを既定にし、
 * 1 件も無ければ「すべて」を表す emptyValue にフォールバックする
 * (既定で絞った結果、一覧が空になるのを防ぐため)。
 */
export function resolveDefaultArtistFilter(
  lives: { artist?: string | null }[],
  emptyValue: string = '',
): string {
  const hasDefault = lives.some(l => (l.artist || '').trim() === DEFAULT_ARTIST);
  return hasDefault ? DEFAULT_ARTIST : emptyValue;
}

// ---------- Modal ----------
export function showModal(title: string, bodyHtml: string): void {
  const container = document.getElementById('modal-container');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  if (!container || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML    = bodyHtml;
  container.classList.remove('hidden');

  const closeBtn = document.getElementById('modal-close');
  const backdrop = container.querySelector<HTMLElement>('.modal-backdrop');

  const close = () => {
    container.classList.add('hidden');
    closeBtn?.removeEventListener('click', close);
    backdrop?.removeEventListener('click', close);
  };

  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  setTimeout(() => {
    const firstInput = bodyEl.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    );
    firstInput?.focus();
  }, 100);
}

export function closeModal(): void {
  document.getElementById('modal-container')?.classList.add('hidden');
}

// ---------- Toast ----------
export function showToast(message: string, type: ToastType = 'info'): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons: Record<ToastType, string> = {
    success: '✅',
    error:   '❌',
    info:    'ℹ️',
  };

  toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut var(--transition-base) ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---------- Member Avatar ----------
export function memberAvatarHtml(member: Member, size: number = 40): string {
  const fontSize = Math.max(10, Math.round(size * 0.42));
  if (member.avatar) {
    return `<img src="${member.avatar}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:2px solid ${member.color};display:block;flex-shrink:0;" alt="" />`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${member.color};display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:700;color:white;flex-shrink:0;">${member.name.charAt(0)}</div>`;
}

// ---------- Japanese Holidays ----------
const JP_HOLIDAYS = new Set<string>([
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

export function isJapaneseHoliday(dateStr: string): boolean {
  return JP_HOLIDAYS.has(dateStr);
}

// ---------- Image Resize → Base64 ----------
export function resizeImageToBase64(
  file: File, maxSize: number, callback: (dataUrl: string) => void,
): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = Math.min(img.width, img.height, maxSize);
      const scale = size / Math.min(img.width, img.height);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const mimeType = (['image/jpeg', 'image/png', 'image/webp'] as const).includes(file.type as any)
        ? file.type
        : 'image/jpeg';
      callback(canvas.toDataURL(mimeType, 0.82));
    };
    img.src = e.target?.result as string;
  };
  reader.readAsDataURL(file);
}

export function showConfirm(title: string, message: string, onConfirm: () => void): void {
  showModal(title, `
    <div class="confirm-delete">
      <p>${message.replace(/\n/g, '<br>')}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="confirm-cancel">キャンセル</button>
        <button type="button" class="btn btn-danger" id="confirm-ok">削除する</button>
      </div>
    </div>
  `);

  document.getElementById('confirm-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('confirm-ok')?.addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}
