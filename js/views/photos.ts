// @ts-nocheck — TODO: convert to strict TypeScript incrementally
// ============================================
// Photos View — 生写真レート一覧
// ============================================
//
// public/photo-rates.json を読み込んで表示する。
// データは日次で GitHub Actions (update-photo-rates.yml) が更新する想定。
// ウォッチリストは localStorage に保存する MVP 実装。

import { getMembers } from '../store.js';
import { showToast } from '../utils.js';

// ── 型 ─────────────────────────────────────────────────────────
interface RateEntry    { memberName: string; rank: Rank; }
interface SeriesEntry  {
  id: string;
  label: string;
  group: 'nogi' | 'saku' | 'hina';
  event?: string;
  saleYear?: number;
  price?: number;            // 発売時の定価 (円)
  sourceUrl?: string;
  rates: RateEntry[];
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
let _cached: RatesFile | null = null;
let activeSeriesFilter: string | null = null;
let watchlistOnly = false;

const WATCH_KEY = 'livetracker:photo-watchlist';

// ── データ読み込み ─────────────────────────────────────────────
async function loadRates(opts: { noCache?: boolean } = {}): Promise<RatesFile | null> {
  if (_cached && !opts.noCache) return _cached;
  try {
    const url = `./photo-rates.json?v=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    _cached = (await res.json()) as RatesFile;
    return _cached;
  } catch (e) {
    console.warn('[photos] failed to load photo-rates.json', e);
    return null;
  }
}

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
          歴代 BIRTHDAY LIVE の個別生写真レート。価格帯はランクベースの参考値です。
        </p>
      </div>
      <div id="photos-body">
        <div style="text-align:center;padding:40px 0;color:var(--text-tertiary);font-size:13px;">読み込み中...</div>
      </div>
    </section>
  `;

  const data = await loadRates();
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

function renderBody(data: RatesFile, body: HTMLElement): void {
  const watchlist = loadWatchlist();
  const members = getMembers();
  const memberNicknameByName = new Map(
    members.map((m: any) => [normalizeName(m.name || ''), (m.nickname as string | null) || null]),
  );

  // フラット化: 全シリーズの全 rates に seriesId/seriesLabel を付与
  const flat = data.series.flatMap(s =>
    s.rates.map(r => ({ ...r, seriesId: s.id, seriesLabel: s.label, saleYear: s.saleYear ?? 0 })),
  );

  // フィルタ適用
  const filtered = flat.filter(r => {
    if (activeSeriesFilter && r.seriesId !== activeSeriesFilter) return false;
    if (watchlistOnly && !watchlist.has(watchKey(r.seriesId, r.memberName))) return false;
    return true;
  });

  // 並び替え: ランク → シリーズ新しい順 → 名前
  filtered.sort((a, b) => {
    const rd = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rd !== 0) return rd;
    const yd = (b.saleYear ?? 0) - (a.saleYear ?? 0);
    if (yd !== 0) return yd;
    return a.memberName.localeCompare(b.memberName, 'ja');
  });

  const chips = data.series
    .map(s => `<button class="history-chip ${activeSeriesFilter === s.id ? 'history-chip-active' : ''}" data-series="${escapeHtml(s.id)}">${escapeHtml(s.label)}${s.saleYear ? ` <span style="opacity:0.5;">'${String(s.saleYear).slice(2)}</span>` : ''}</button>`)
    .join('');

  const watchCount = watchlist.size;

  body.innerHTML = `
    <div class="history-filter" id="photos-series-filter" style="margin-bottom:10px;">
      <button class="history-chip ${activeSeriesFilter === null ? 'history-chip-active' : ''}" data-series="">すべて</button>
      ${chips}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:0 2px;">
      <button id="photos-watch-toggle" class="btn btn-sm ${watchlistOnly ? 'btn-primary' : 'btn-secondary'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${watchlistOnly ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"/></svg>
        ウォッチ中${watchCount > 0 ? `（${watchCount}）` : ''}
      </button>
      <span style="font-size:11px;color:var(--text-tertiary);">${filtered.length}件</span>
    </div>

    ${filtered.length === 0 ? `
      <div class="card" style="padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px;">
        ${watchlistOnly ? 'ウォッチリストは空です。♥ ボタンで推しを追加してください。' : '該当するレートがありません。'}
      </div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <div id="photos-rate-list">
          ${filtered.map(r => renderRateRow(r, watchlist, data.rankPriceYen, memberNicknameByName)).join('')}
        </div>
      </div>
    `}

    <p style="font-size:11px;color:var(--text-tertiary);margin:14px 4px 0;line-height:1.6;">
      データ出典：${data.sources.map(s => `<a href="${escapeHtml(s)}" target="_blank" rel="noopener" style="color:var(--text-tertiary);">${escapeHtml(new URL(s).hostname)}</a>`).join('、')}
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
}

function renderRateRow(
  r: { seriesId: string; seriesLabel: string; memberName: string; rank: Rank },
  watchlist: Set<string>,
  rankPrices: RatesFile['rankPriceYen'],
  memberNicknameByName: Map<string, string | null>,
): string {
  const key = watchKey(r.seriesId, r.memberName);
  const watching = watchlist.has(key);
  const nick = memberNicknameByName.get(normalizeName(r.memberName));
  const nickHtml = nick ? `<span style="color:var(--text-tertiary);font-size:11px;margin-left:6px;font-weight:500;">${escapeHtml(nick)}</span>` : '';

  return `
    <div class="photo-rate-row" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border-color);">
      <div style="min-width:34px;text-align:center;">
        <span class="rate-rank-badge ${rankClass(r.rank)}">${escapeHtml(r.rank)}</span>
      </div>
      <div style="min-width:0;flex:1;">
        <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(r.memberName)}${nickHtml}
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(r.seriesLabel)}</div>
      </div>
      <div style="text-align:right;min-width:110px;">
        <div style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;">${formatRankPrice(r.rank, rankPrices)}</div>
      </div>
      <button class="rate-watch-btn ${watching ? 'is-watching' : ''}" data-watch-toggle="${escapeHtml(key)}" aria-label="${watching ? 'ウォッチ解除' : 'ウォッチに追加'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${watching ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7z"/></svg>
      </button>
    </div>
  `;
}

function normalizeName(s: string): string {
  return String(s).replace(/\s+/g, '').normalize('NFKC');
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
