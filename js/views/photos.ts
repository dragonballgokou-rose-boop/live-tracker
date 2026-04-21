// @ts-nocheck — TODO: convert to strict TypeScript incrementally
// ============================================
// Photos View — 生写真レート一覧（MVP）
// ============================================
//
// ユーザー投稿 + 公開レートサイト由来のデータを Supabase に蓄積し、
// 推し別にウォッチできることを目指すが、まずは静的なデモデータで UI を先に出す。

import { getMembers } from '../store.js';
import { showToast } from '../utils.js';

// ── 型定義（MVP 用） ───────────────────────────────────────────
interface PhotoRate {
  /** 生写真の種類 ID（例: "13th-birthday-tshirt"） */
  seriesId: string;
  /** 表示名 */
  seriesLabel: string;
  /** 対象メンバー ID（store の members.id に対応する想定） */
  memberId: string | null;
  /** メンバー名（memberId が未マッピングな場合のフォールバック表示） */
  memberNameRaw: string;
  /** 参考レート（円）。ヒキ（レア）なカードほど高い。 */
  price: number;
  /** 前回記録からの差分（円）。null = 初回。 */
  delta: number | null;
  /** 最終更新（ISO） */
  updatedAt: string;
  /** 出典 */
  source: string;
}

// MVP 用ダミーデータ（あとで Supabase 由来に差し替える）
const DEMO_RATES: PhotoRate[] = [
  { seriesId: '13th-birthday-anniv',   seriesLabel: '13周年記念',          memberId: null, memberNameRaw: '与田 祐希',    price: 2800, delta:  200, updatedAt: '2026-04-20T12:00:00+09:00', source: 'nogizakarate.com' },
  { seriesId: '13th-birthday-anniv',   seriesLabel: '13周年記念',          memberId: null, memberNameRaw: '山下 美月',    price: 2200, delta:  -50, updatedAt: '2026-04-20T12:00:00+09:00', source: 'nogizakarate.com' },
  { seriesId: '13th-birthday-tshirt',  seriesLabel: '13th BDライブTシャツ', memberId: null, memberNameRaw: '遠藤 さくら',  price: 1900, delta:  150, updatedAt: '2026-04-20T12:00:00+09:00', source: 'nogizakarate.com' },
  { seriesId: '12th-birthday-anniv',   seriesLabel: '12周年記念',          memberId: null, memberNameRaw: '井上 和',      price: 3100, delta:  300, updatedAt: '2026-04-20T12:00:00+09:00', source: 'nogizakarate.com' },
  { seriesId: '12th-birthday-animal',  seriesLabel: 'アニマルルームウェア', memberId: null, memberNameRaw: '賀喜 遥香',    price: 1500, delta:    0, updatedAt: '2026-04-20T12:00:00+09:00', source: 'nogizakarate.com' },
  { seriesId: '11th-birthday-varsity', seriesLabel: 'スタジャン',          memberId: null, memberNameRaw: '久保 史緒里',  price: 1200, delta: -100, updatedAt: '2026-04-20T12:00:00+09:00', source: 'nogizakarate.com' },
];

let activeSeriesFilter: string | null = null;

export function renderPhotos(): void {
  const content = document.getElementById('page-content');
  if (!content) return;

  const members = getMembers();
  const memberByName = new Map(
    members.map((m: { id: string; name?: string; nickname?: string }) => [
      (m.name || m.nickname || '').replace(/\s+/g, ''),
      m,
    ]),
  );

  const rates = DEMO_RATES.map(r => {
    const key = r.memberNameRaw.replace(/\s+/g, '');
    const mapped = memberByName.get(key);
    return mapped ? { ...r, memberId: mapped.id } : r;
  });

  const seriesList = [...new Map(rates.map(r => [r.seriesId, r.seriesLabel])).entries()];

  const filtered = activeSeriesFilter
    ? rates.filter(r => r.seriesId === activeSeriesFilter)
    : rates;

  const sorted = [...filtered].sort((a, b) => b.price - a.price);

  content.innerHTML = `
    <section class="photos-section">
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <h2 style="font-size:16px;font-weight:700;margin:0;">生写真レート（ベータ）</h2>
        </div>
        <p style="font-size:12px;color:var(--text-tertiary);margin:0;line-height:1.55;">
          歴代 BIRTHDAY LIVE の個別生写真レートを追跡。
          データは参考値（公開レートサイト・ユーザー投稿を集約予定）です。
        </p>
      </div>

      <div class="history-filter" id="photos-series-filter" style="margin-bottom:12px;">
        <button class="history-chip ${activeSeriesFilter === null ? 'history-chip-active' : ''}" data-series="">すべて</button>
        ${seriesList.map(([id, label]) => `
          <button class="history-chip ${activeSeriesFilter === id ? 'history-chip-active' : ''}" data-series="${escapeHtml(id)}">${escapeHtml(label)}</button>
        `).join('')}
      </div>

      <div class="card" style="padding:0;overflow:hidden;">
        <div id="photos-rate-list">
          ${sorted.map(renderRateRow).join('')}
        </div>
      </div>

      <p style="font-size:11px;color:var(--text-tertiary);margin:14px 4px 0;line-height:1.6;">
        ※ 本画面は MVP です。今後：Supabase 連携 / 推しウォッチリスト / Web Push 通知を順次追加予定。
      </p>
    </section>
  `;

  content.querySelectorAll<HTMLButtonElement>('#photos-series-filter .history-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.series || '';
      activeSeriesFilter = id === '' ? null : id;
      renderPhotos();
    });
  });

  content.querySelectorAll<HTMLElement>('[data-photo-watch]').forEach(el => {
    el.addEventListener('click', () => {
      showToast('ウォッチリスト機能は近日実装予定', 'info');
    });
  });
}

function renderRateRow(r: PhotoRate): string {
  const deltaClass = r.delta == null ? '' : r.delta > 0 ? 'trend-up' : r.delta < 0 ? 'trend-down' : 'trend-flat';
  const deltaLabel = r.delta == null ? '—' : `${r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '±'} ¥${Math.abs(r.delta).toLocaleString()}`;

  return `
    <div class="photo-rate-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border-color);">
      <div style="min-width:0;flex:1;">
        <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.memberNameRaw)}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(r.seriesLabel)}</div>
      </div>
      <div style="text-align:right;min-width:110px;">
        <div style="font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;">¥${r.price.toLocaleString()}</div>
        <div class="${deltaClass}" style="font-size:11px;font-variant-numeric:tabular-nums;margin-top:2px;">${deltaLabel}</div>
      </div>
      <button class="btn btn-secondary btn-sm" data-photo-watch aria-label="ウォッチ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"/></svg>
      </button>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
