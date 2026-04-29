// @ts-nocheck — TODO: convert to strict TypeScript incrementally
// ============================================
// Photos View — 生写真レート一覧 + ユーザ手動編集
// ============================================
//
// public/photo-rates.json (seed) と localStorage 上書き (photoRatesUser) を
// merge して表示する。scraper が止まっていても、ユーザが自分で正確なレートを
// 入力 → 即時反映 / メンバー詳細モーダル・ダッシュボード sparkline にも伝播。

import { getMembers } from '../store.js';
import { showToast } from '../utils.js';
import { fetchPhotoRates, getPhotoRatesSeedSync } from '../photoRates.js';
import {
  setUserSeries, clearUserSeries, isUserOverridden,
  upsertRate, createSeries,
} from '../photoRatesUser.js';
import { fetchOfficialMembers } from '../officialMembers.js';
import type { OfficialMember } from '../types.js';

// ── 型（ローカル参照用） ─────────────────────────────────────
interface RateEntry    { memberName: string; rank: Rank; }
interface SeriesEntry  {
  id: string;
  label: string;
  group: 'nogi' | 'saku' | 'hina';
  event?: string;
  saleYear?: number;
  saleDate?: string;
  price?: number;
  sourceUrl?: string;
  rates: RateEntry[];
  _userOverridden?: boolean;
}
interface RatesFile {
  version: string;
  generatedAt: string;
  sources: string[];
  rankPriceYen: Record<Rank, { low: number; high: number }>;
  series: SeriesEntry[];
}
type Rank = 'S+' | 'S' | 'S-' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C';

// ── State ──────────────────────────────────────────────────────
let activeSeriesFilter: string | null = null;
let watchlistOnly = false;
let editMode = false;
let officialMembersCache: OfficialMember[] = [];

const WATCH_KEY = 'livetracker:photo-watchlist';
const ALL_RANKS: Rank[] = ['S+', 'S', 'S-', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C'];

// ── Watchlist (localStorage) ───────────────────────────────────
function loadWatchlist(): Set<string> {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveWatchlist(set: Set<string>): void {
  localStorage.setItem(WATCH_KEY, JSON.stringify([...set]));
}

function watchKey(seriesId: string, memberName: string): string {
  return `${seriesId}::${memberName}`;
}

// ── Rank → 表示 ────────────────────────────────────────────────
function formatRankPrice(rank: Rank, table: RatesFile['rankPriceYen']): string {
  const r = table[rank];
  if (!r) return '—';
  return `¥${r.low.toLocaleString()}〜¥${r.high.toLocaleString()}`;
}

function rankClass(rank: Rank): string {
  if (rank.startsWith('S')) return 'rank-s';
  if (rank.startsWith('A')) return 'rank-a';
  if (rank.startsWith('B')) return 'rank-b';
  return 'rank-c';
}

const RANK_ORDER: Record<Rank, number> = {
  'S+': 0, 'S': 1, 'S-': 2,
  'A+': 3, 'A': 4, 'A-': 5,
  'B+': 6, 'B': 7, 'B-': 8,
  'C':  9,
};

// ── Render ────────────────────────────────────────────────────
export async function renderPhotos(): Promise<void> {
  const content = document.getElementById('page-content');
  if (!content) return;

  content.innerHTML = `
    <section class="photos-section">
      <div class="card" style="padding:16px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <h2 style="font-size:16px;font-weight:700;margin:0;">生写真レート</h2>
          <span id="photos-updated" style="margin-left:auto;font-size:11px;color:var(--text-tertiary);"></span>
        </div>
        <p style="font-size:12px;color:var(--text-tertiary);margin:0;line-height:1.55;">
          歴代 BIRTHDAY LIVE / シングル個別 の生写真レート。編集モードでご自身の正確な情報を入力できます（端末内に保存）。
        </p>
      </div>
      <div id="photos-body">
        <div style="text-align:center;padding:40px 0;color:var(--text-tertiary);font-size:13px;">読み込み中...</div>
      </div>
    </section>
  `;

  // 公式メンバー一覧（編集 UI のメンバー picker 用）— 失敗しても本体は表示する
  try {
    const f = await fetchOfficialMembers();
    officialMembersCache = (f.members || []).filter(m => !m.graduated);
  } catch { officialMembersCache = []; }

  const data = await fetchPhotoRates({ noCache: true });
  const body = document.getElementById('photos-body');
  if (!body) return;

  if (!data) {
    body.innerHTML = `
      <div class="card" style="padding:20px;text-align:center;color:var(--text-tertiary);">
        レートデータを取得できませんでした。<br>
        時間をおいて再度お試しください。
      </div>`;
    return;
  }

  const updatedEl = document.getElementById('photos-updated');
  if (updatedEl) {
    const d = new Date(data.generatedAt);
    updatedEl.textContent = `更新: ${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  }

  renderBody(data, body);
}

// ユーザ編集後に再レンダ（merge 結果を反映）
async function rerender(): Promise<void> {
  const data = await fetchPhotoRates({ noCache: true });
  const body = document.getElementById('photos-body');
  if (data && body) renderBody(data, body);
}

function renderBody(data: RatesFile, body: HTMLElement): void {
  const watchlist = loadWatchlist();
  const members = getMembers();
  const memberNicknameByName = new Map(
    members.map((m: any) => [normalizeName(m.name || ''), (m.nickname as string | null) || null]),
  );

  // saleDate を取り出す（無ければ saleYear-06 で代替）
  const effectiveSaleDate = (s: SeriesEntry): string => {
    if (s.saleDate && /^\d{4}-\d{2}$/.test(s.saleDate)) return s.saleDate;
    if (s.saleYear) return `${s.saleYear}-06`;
    return '0000-00';
  };

  // フラット化: 全シリーズの全 rates に seriesId/seriesLabel/saleDate を付与
  const flat = data.series.flatMap(s =>
    s.rates.map(r => ({
      ...r,
      seriesId: s.id,
      seriesLabel: s.label,
      saleYear: s.saleYear ?? 0,
      saleDate: effectiveSaleDate(s),
    })),
  );

  // フィルタ適用（直近2年はスクレイパ側で強制しているのでここでは触らない）
  const filtered = flat.filter(r => {
    if (activeSeriesFilter && r.seriesId !== activeSeriesFilter) return false;
    if (watchlistOnly && !watchlist.has(watchKey(r.seriesId, r.memberName))) return false;
    return true;
  });

  // 並び替え: 発売日 新しい順 → ランク → 名前
  filtered.sort((a, b) => {
    const dd = b.saleDate.localeCompare(a.saleDate);
    if (dd !== 0) return dd;
    const rd = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rd !== 0) return rd;
    return a.memberName.localeCompare(b.memberName, 'ja');
  });

  const chips = data.series
    .map(s => {
      const d = effectiveSaleDate(s);
      const tag = /^\d{4}-\d{2}$/.test(d) ? ` <span style="opacity:0.5;">${d.replace('-', '/')}</span>` : '';
      return `<button class="history-chip ${activeSeriesFilter === s.id ? 'history-chip-active' : ''}" data-series="${escapeHtml(s.id)}">${escapeHtml(s.label)}${tag}</button>`;
    })
    .join('');

  const watchCount = watchlist.size;

  body.innerHTML = `
    <div class="history-filter" id="photos-series-filter" style="margin-bottom:10px;">
      <button class="history-chip ${activeSeriesFilter === null ? 'history-chip-active' : ''}" data-series="">すべて</button>
      ${chips}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;padding:0 2px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button id="photos-watch-toggle" class="btn btn-sm ${watchlistOnly ? 'btn-primary' : 'btn-secondary'}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="${watchlistOnly ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"/></svg>
          ウォッチ中${watchCount > 0 ? `（${watchCount}）` : ''}
        </button>
        <button id="photos-edit-toggle" class="btn btn-sm ${editMode ? 'btn-primary' : 'btn-secondary'}">
          ${editMode ? '✓ 完了' : '✎ 編集'}
        </button>
        ${editMode ? `<button id="photos-add-series" class="btn btn-sm btn-secondary">+ シリーズ</button>` : ''}
      </div>
      <span style="font-size:11px;color:var(--text-tertiary);">${filtered.length}件</span>
    </div>

    ${editMode ? renderEditPanel(data) : ''}

    ${filtered.length === 0 ? `
      <div class="card" style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px;">
        ${watchlistOnly ? 'ウォッチリストは空です。♥ ボタンで推しを追加してください。' : '該当するレートがありません。'}
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <div id="photos-rate-list">
          ${filtered.map(r => renderRateRow(r, watchlist, data.rankPriceYen, memberNicknameByName, editMode)).join('')}
        </div>
      </div>
    `}

    <p style="font-size:11px;color:var(--text-tertiary);margin:14px 4px 0;line-height:1.6;">
      データ出典：${data.sources.map(s => `<a href="${escapeHtml(s)}" target="_blank" rel="noopener" style="color:var(--text-tertiary);">${escapeHtml(new URL(s).hostname)}</a>`).join('、')}<br>
      編集データは端末内 (localStorage) に保存。scraper の更新で seed が変わっても上書きは保持されます。
    </p>
  `;

  // Events
  body.querySelectorAll<HTMLButtonElement>('#photos-series-filter .history-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.series || '';
      activeSeriesFilter = id === '' ? null : id;
      renderBody(data, body);
    });
  });

  body.querySelector<HTMLButtonElement>('#photos-watch-toggle')?.addEventListener('click', () => {
    watchlistOnly = !watchlistOnly;
    renderBody(data, body);
  });

  body.querySelector<HTMLButtonElement>('#photos-edit-toggle')?.addEventListener('click', () => {
    editMode = !editMode;
    renderBody(data, body);
  });

  body.querySelector<HTMLButtonElement>('#photos-add-series')?.addEventListener('click', () => {
    handleAddSeries();
  });

  body.querySelector<HTMLButtonElement>('#photos-add-rate')?.addEventListener('click', () => {
    handleAddRate(data);
  });

  body.querySelectorAll<HTMLButtonElement>('[data-watch-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.watchToggle!;
      const set = loadWatchlist();
      if (set.has(key)) {
        set.delete(key);
        showToast('ウォッチを解除しました', 'info');
      } else {
        set.add(key);
        showToast('ウォッチに追加しました', 'success');
      }
      saveWatchlist(set);
      renderBody(data, body);
    });
  });

  // Edit mode: rank 変更
  body.querySelectorAll<HTMLSelectElement>('[data-edit-rank]').forEach(sel => {
    sel.addEventListener('change', () => {
      const seriesId = sel.dataset.seriesId!;
      const memberName = sel.dataset.memberName!;
      const newRank = sel.value as Rank | '';
      const seed = getPhotoRatesSeedSync();
      if (!seed) return;
      upsertRate(seed, seriesId, memberName, newRank ? newRank : null);
      showToast(newRank ? `${memberName} を ${newRank} に変更` : `${memberName} を削除`, 'success');
      rerender();
    });
  });

  body.querySelectorAll<HTMLButtonElement>('[data-edit-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const seriesId = btn.dataset.seriesId!;
      const memberName = btn.dataset.memberName!;
      if (!confirm(`${memberName} を削除しますか？`)) return;
      const seed = getPhotoRatesSeedSync();
      if (!seed) return;
      upsertRate(seed, seriesId, memberName, null);
      showToast(`${memberName} を削除しました`, 'info');
      rerender();
    });
  });

  // Edit mode: シリーズ単位の reset (上書きを破棄して seed に戻す)
  body.querySelectorAll<HTMLButtonElement>('[data-edit-reset-series]').forEach(btn => {
    btn.addEventListener('click', () => {
      const seriesId = btn.dataset.editResetSeries!;
      if (!confirm('このシリーズの編集を破棄して初期状態に戻しますか？')) return;
      clearUserSeries(seriesId);
      showToast('編集を破棄しました', 'info');
      rerender();
    });
  });
}

function renderRateRow(
  r: { seriesId: string; seriesLabel: string; memberName: string; rank: Rank },
  watchlist: Set<string>,
  rankPrices: RatesFile['rankPriceYen'],
  memberNicknameByName: Map<string, string | null>,
  edit: boolean,
): string {
  const key = watchKey(r.seriesId, r.memberName);
  const watching = watchlist.has(key);
  const nick = memberNicknameByName.get(normalizeName(r.memberName));
  const nickHtml = nick ? `<span style="color:var(--text-tertiary);font-size:11px;margin-left:6px;font-weight:500;">${escapeHtml(nick)}</span>` : '';

  const rankCell = edit
    ? `<select data-edit-rank data-series-id="${escapeHtml(r.seriesId)}" data-member-name="${escapeHtml(r.memberName)}"
         style="background:rgba(255,255,255,0.06);border:1px solid var(--border-color);color:var(--text-primary);border-radius:6px;padding:4px 6px;font-size:12px;">
         ${ALL_RANKS.map(rk => `<option value="${rk}" ${rk===r.rank?'selected':''}>${rk}</option>`).join('')}
       </select>`
    : `<span class="rate-rank-badge ${rankClass(r.rank)}">${escapeHtml(r.rank)}</span>`;

  const rightCell = edit
    ? `<button data-edit-delete data-series-id="${escapeHtml(r.seriesId)}" data-member-name="${escapeHtml(r.memberName)}"
        style="background:transparent;border:1px solid var(--border-color);color:#f87171;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;">×</button>`
    : `<button class="rate-watch-btn ${watching ? 'is-watching' : ''}" data-watch-toggle="${escapeHtml(key)}" aria-label="${watching ? 'ウォッチ解除' : 'ウォッチに追加'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${watching ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"/></svg>
      </button>`;

  return `
    <div class="photo-rate-row" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border-color);">
      <div style="min-width:46px;text-align:center;">${rankCell}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(r.memberName)}${nickHtml}
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(r.seriesLabel)}</div>
      </div>
      <div style="text-align:right;min-width:110px;">
        <div style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;">${formatRankPrice(r.rank, rankPrices)}</div>
      </div>
      ${rightCell}
    </div>
  `;
}

// ── 編集パネル: シリーズ追加 / メンバー追加 ─────────────────
function renderEditPanel(data: RatesFile): string {
  // 編集済みシリーズ（_userOverridden）には reset ボタンを出す
  const overridden = data.series.filter(s => s._userOverridden);
  return `
    <div class="card" style="padding:12px 14px;margin-bottom:10px;background:rgba(167,139,250,0.06);border-color:rgba(167,139,250,0.3);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <strong style="font-size:13px;">編集モード</strong>
        <span style="font-size:11px;color:var(--text-tertiary);">変更は端末内に保存されます</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        <button id="photos-add-rate" class="btn btn-sm btn-primary">+ メンバーをシリーズに追加</button>
      </div>
      ${overridden.length > 0 ? `
        <div style="margin-top:10px;font-size:11px;color:var(--text-tertiary);">
          編集済みシリーズ:
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
            ${overridden.map(s => `
              <button data-edit-reset-series="${escapeHtml(s.id)}"
                style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);color:var(--text-secondary);padding:3px 8px;border-radius:6px;cursor:pointer;font-size:11px;">
                ${escapeHtml(s.label)} ↻
              </button>`).join('')}
          </div>
        </div>` : ''}
    </div>
  `;
}

// ── 編集 actions ────────────────────────────────────────────
function handleAddSeries(): void {
  const label = prompt('新しいシリーズ名を入力（例: 38thシングル個別生写真）');
  if (!label) return;
  const sd = prompt('発売年月（YYYY-MM 形式、例: 2025-08）');
  const saleDate = sd && /^\d{4}-\d{2}$/.test(sd) ? sd : undefined;
  // id は label をベースに簡易生成（衝突したら数字を付ける）
  const baseId = `user-${Date.now().toString(36)}`;
  createSeries({ id: baseId, label, saleDate, group: 'nogi' });
  showToast(`シリーズ「${label}」を追加`, 'success');
  rerender();
}

function handleAddRate(data: RatesFile): void {
  if (data.series.length === 0) {
    showToast('シリーズが無いので先に「+ シリーズ」で作成してください', 'info');
    return;
  }
  // 簡易フォーム: window.prompt + select は無いので、シリーズ → メンバー → ランクを順に
  const seriesOpts = data.series.map((s, i) => `${i+1}. ${s.label}${s.saleDate ? ' ('+s.saleDate+')' : ''}`).join('\n');
  const seriesIdxStr = prompt(`シリーズ番号を入力:\n${seriesOpts}`);
  if (!seriesIdxStr) return;
  const seriesIdx = parseInt(seriesIdxStr, 10) - 1;
  if (isNaN(seriesIdx) || !data.series[seriesIdx]) { showToast('番号が不正です', 'error'); return; }
  const series = data.series[seriesIdx];

  const memberName = prompt('メンバー名を入力（例: 鈴木 佑捺）');
  if (!memberName) return;

  const rank = prompt(`ランクを入力 (${ALL_RANKS.join(' / ')})`);
  if (!rank || !ALL_RANKS.includes(rank as Rank)) { showToast('ランクが不正です', 'error'); return; }

  const seed = getPhotoRatesSeedSync();
  if (!seed) return;
  // seed に無いシリーズへの upsertRate も動くように、まず upsertRate に渡す
  // （ user 専用シリーズの場合、photoRatesUser.ts の upsertRate は seed に無いため
  //   何もしない設計なので、専用 path で直接 setUserSeries で追加する）
  if (seed.series.some(s => s.id === series.id)) {
    upsertRate(seed, series.id, memberName, rank as Rank);
  } else {
    // user 専用シリーズ: 既存 override に追加
    const ov = (function() {
      const all = JSON.parse(localStorage.getItem('livetracker:user-photo-rates') || '{"series":{}}');
      const cur = all.series[series.id];
      if (!cur) return null;
      const idx = cur.rates.findIndex((r: any) => normalizeName(r.memberName) === normalizeName(memberName));
      if (idx >= 0) cur.rates[idx] = { memberName, rank: rank as Rank };
      else cur.rates.push({ memberName, rank: rank as Rank });
      return cur;
    })();
    if (ov) setUserSeries(ov);
  }
  showToast(`${memberName} (${rank}) を「${series.label}」に追加`, 'success');
  rerender();
}

function normalizeName(s: string): string {
  return String(s).replace(/\s+/g, '').normalize('NFKC');
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
