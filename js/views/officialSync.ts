// ============================================
// Official Sync View — 公式ライブ情報の差分確認モーダル
// ============================================

import { getLives, flushSyncNow } from '../store.js';
import { showModal, closeModal, showToast, DEFAULT_ARTIST } from '../utils.js';
import {
  fetchOfficialLives,
  computeDiff,
  applyAddition,
  applyAdditionAsChild,
  applyNewTourChildren,
  applyChildReconciliation,
  applyUpdate,
  mergeIntoExisting,
  findCandidateTourParent,
} from '../officialLives.js';
import type {
  Live, OfficialLive, OfficialLivesFile, DiffResult,
  DiffAddItem, DiffUpdateItem, DiffSkipItem,
} from '../types.js';

type ArtistFilter = 'all' | string;
type ActiveTab = 'add' | 'update' | 'skip';

interface ModalState {
  data: OfficialLivesFile;
  diff: DiffResult;
  filter: ArtistFilter;
  activeTab: ActiveTab;
}

/** Extract a human-readable error message from any caught value */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e).slice(0, 200); } catch { return String(e); }
}

// ---------- ヘッダーボタンのバッジ更新 ----------
/**
 * 公式データとローカルを比較し、ヘッダー同期ボタンに
 * 「新規+差分」の件数バッジを表示する。
 * 非同期だが失敗しても何もしない（静かに飲み込む）。
 */
export async function refreshOfficialSyncBadge(): Promise<void> {
  const btn = document.getElementById('official-sync-btn');
  if (!btn) return;
  try {
    const data = await fetchOfficialLives({ noCache: false });
    const diff = computeDiff(data.lives || [], getLives());
    const pending = diff.toAdd.length + diff.toUpdate.length;
    let badge = btn.querySelector<HTMLSpanElement>('.os-header-badge');
    if (pending > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'os-header-badge';
        btn.appendChild(badge);
      }
      badge.textContent = pending > 99 ? '99+' : String(pending);
    } else if (badge) {
      badge.remove();
    }
  } catch {
    /* silent */
  }
}

// ---------- 表示用ヘルパー ----------

const FIELD_LABEL: Record<string, string> = {
  venue:      '会場',
  prefecture: '都道府県',
  dateEnd:    '終了日',
  eventType:  '種別',
};

const ARTIST_OPTIONS = [
  { value: 'all',      label: 'すべて' },
  { value: '乃木坂46', label: '乃木坂46' },
  { value: '櫻坂46',   label: '櫻坂46' },
] as const;

// モーダル開いてる間だけ保持するステート
let _state: ModalState | null = null;

function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eventTypeLabel(v: unknown): string {
  if (v === 'event' || v === 'イベント') return 'イベント';
  if (v === 'tour')  return 'ツアー';
  if (v === 'stage' || v === '舞台') return '舞台';
  return 'ライブ';
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'live',  label: 'ライブ' },
  { value: 'event', label: 'イベント' },
  { value: 'tour',  label: 'ツアー' },
  { value: 'stage', label: '舞台' },
];

function renderEventTypeSelect(id: string, selected: string, kind: 'add' | 'upd', index: number): string {
  const opts = EVENT_TYPE_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`,
  ).join('');
  const extraCls = kind === 'upd' ? ' os-upd-type' : '';
  return `<select class="form-input os-type-select${extraCls}" id="${id}" data-index="${index}">${opts}</select>`;
}

function normalizeEventTypeValue(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'ライブ' || s === 'live') return 'live';
  if (s === 'イベント' || s === 'event') return 'event';
  if (s === 'ツアー' || s === 'tour') return 'tour';
  if (s === '舞台' || s === 'stage') return 'stage';
  return 'live';
}

function formatDateRange(startIso?: string | null, endIso?: string | null): string {
  if (!startIso) return '';
  if (!endIso || endIso === startIso) return startIso.slice(0, 10);
  return `${startIso.slice(0, 10)} 〜 ${endIso.slice(0, 10)}`;
}

function filterByArtist<T extends { official: OfficialLive }>(items: T[], artist: ArtistFilter): T[] {
  if (artist === 'all') return items;
  return items.filter(it => (it.official?.artist || '') === artist);
}

// ---------- メイン ----------

export async function showOfficialSyncModal(): Promise<void> {
  showModal('公式ライブ情報の同期', `
    <div class="official-sync-loading" style="text-align:center;padding:40px 0;color:var(--text-secondary);">
      <div class="loader-spinner" style="margin:0 auto 12px;"></div>
      公式データを読み込んでいます…
    </div>
  `);

  let data: OfficialLivesFile;
  try {
    data = await fetchOfficialLives({ noCache: true });
  } catch (e: unknown) {
    showModal('公式ライブ情報の同期', `
      <div style="padding:20px;text-align:center;">
        <p style="margin-bottom:16px;color:var(--accent-red);">${escapeHtml(errMsg(e))}</p>
        <button type="button" class="btn btn-secondary" id="sync-close">閉じる</button>
      </div>
    `);
    document.getElementById('sync-close')?.addEventListener('click', closeModal);
    return;
  }

  const localLives = getLives();
  const diff = computeDiff(data.lives || [], localLives);

  // グループ絞り込みは既定で乃木坂46。該当データが無い場合のみ「すべて」に落とす。
  const hasDefaultArtist = [...diff.toAdd, ...diff.toUpdate, ...diff.toSkip]
    .some(it => (it.official?.artist || '') === DEFAULT_ARTIST);

  _state = { data, diff, filter: hasDefaultArtist ? DEFAULT_ARTIST : 'all', activeTab: 'add' };
  renderModal();
}

function renderModal(): void {
  if (!_state) return;
  const { data, diff, filter, activeTab } = _state;
  const updatedAt = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
    : '不明';

  const toAdd    = filterByArtist(diff.toAdd,    filter);
  const toUpdate = filterByArtist(diff.toUpdate, filter);
  const toSkip   = filterByArtist(diff.toSkip,   filter);

  const artistOptions = ARTIST_OPTIONS.map(o => {
    const sel = o.value === filter ? ' selected' : '';
    return `<option value="${escapeHtml(o.value)}"${sel}>${escapeHtml(o.label)}</option>`;
  }).join('');

  const html = `
    <div class="official-sync">
      <div class="official-sync-meta">
        <div>公式データ更新: <strong>${escapeHtml(updatedAt)}</strong></div>
        <div class="official-sync-note">
          ローカルのライブは自動で削除・上書きされません。各項目を個別に確認してください。
        </div>
      </div>

      <div class="os-filter-row">
        <label for="os-artist-select" class="os-filter-label">グループ</label>
        <select id="os-artist-select" class="form-input os-filter-select">
          ${artistOptions}
        </select>
        <button type="button" class="btn btn-secondary btn-sm os-recheck" id="os-recheck" title="公式データを再取得して差分を再計算">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
          再チェック
        </button>
      </div>

      <div class="official-sync-tabs">
        <button type="button" class="os-tab${activeTab === 'add' ? ' active' : ''}" data-tab="add">
          新規 <span class="os-badge">${toAdd.length}</span>
        </button>
        <button type="button" class="os-tab${activeTab === 'update' ? ' active' : ''}" data-tab="update">
          差分あり <span class="os-badge">${toUpdate.length}</span>
        </button>
        <button type="button" class="os-tab${activeTab === 'skip' ? ' active' : ''}" data-tab="skip">
          一致 <span class="os-badge">${toSkip.length}</span>
        </button>
      </div>

      <div class="os-panel${activeTab === 'add' ? '' : ' hidden'}" data-panel="add">
        ${toAdd.length === 0
          ? `<div class="os-empty">新規の公式ライブはありません。</div>`
          : `
            <div class="os-bulk-head">
              <label class="os-check-all-label">
                <input type="checkbox" id="os-check-all" />
                <span>すべて選択</span>
              </label>
              <button type="button" class="btn btn-primary btn-sm" id="os-add-checked" disabled>
                選択した0件を追加
              </button>
            </div>
            ${toAdd.map(renderAddItem).join('')}
          `}
      </div>

      <div class="os-panel${activeTab === 'update' ? '' : ' hidden'}" data-panel="update">
        ${toUpdate.length === 0
          ? `<div class="os-empty">差分のある公式ライブはありません。</div>`
          : toUpdate.map(renderUpdateItem).join('')}
      </div>

      <div class="os-panel${activeTab === 'skip' ? '' : ' hidden'}" data-panel="skip">
        ${toSkip.length === 0
          ? `<div class="os-empty">一致する公式ライブはありません。</div>`
          : toSkip.map(renderSkipItem).join('')}
      </div>
    </div>
  `;

  showModal('公式ライブ情報の同期', html);
  attachHandlers({ toAdd, toUpdate });
}

/**
 * 追加/統合の後、_state.diff を localStorage から再計算する。
 * これで「即UIから消す」手動ロジックのバグを完全回避する。
 */
function refreshDiffFromStore() {
  if (!_state?.data) return;
  _state.diff = computeDiff(_state.data.lives || [], getLives());
}

interface HandlerCtx {
  toAdd:    DiffAddItem[];
  toUpdate: DiffUpdateItem[];
}

function attachHandlers({ toAdd, toUpdate }: HandlerCtx): void {
  // グループフィルター
  document.getElementById('os-artist-select')?.addEventListener('change', e => {
    if (!_state) return;
    _state.filter = (e.target as HTMLSelectElement).value;
    renderModal();
  });

  // 再チェック（公式データを再取得 + 差分再計算）
  document.getElementById('os-recheck')?.addEventListener('click', async () => {
    const btn = document.getElementById('os-recheck') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '読み込み中…';
    try {
      const data = await fetchOfficialLives({ noCache: true });
      const localLives = getLives();
      if (!_state) return;
      _state.data = data;
      _state.diff = computeDiff(data.lives || [], localLives);
      renderModal();
      showToast('最新データで差分を再計算しました', 'success');
    } catch {
      showToast('公式データの再取得に失敗しました', 'error');
      btn.disabled = false;
      btn.textContent = '再チェック';
    }
  });

  // タブ切替
  document.querySelectorAll<HTMLButtonElement>('.os-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_state) return;
      _state.activeTab = btn.dataset.tab as ActiveTab;
      document.querySelectorAll('.os-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll<HTMLElement>('.os-panel').forEach(p => {
        p.classList.toggle('hidden', p.dataset.panel !== _state!.activeTab);
      });
    });
  });

  // 個別追加
  document.querySelectorAll<HTMLButtonElement>('[data-action="add"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const official = toAdd[i]?.official;
      if (!official) return;
      const typeSel = document.getElementById(`os-add-type-${i}`) as HTMLSelectElement | null;
      const override = typeSel?.value || null;
      let added: Live | null = null;
      try {
        added = applyAddition(official, override);
      } catch (err: unknown) {
        console.error('applyAddition failed', err);
        showToast(`追加失敗: ${errMsg(err)}`, 'error');
        return;
      }
      if (!added) {
        showToast('追加に失敗しました（結果が空）', 'error');
        return;
      }
      showToast(`追加: ${official.name} (ローカル${getLives().length}件)`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // 既存ツアーの追加公演として入れる
  document.querySelectorAll<HTMLButtonElement>('[data-action="add-as-child"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const parentId = btn.dataset.parentId;
      const official = toAdd[i]?.official;
      if (!official || !parentId) return;
      const parent = getLives().find(l => l.id === parentId);
      if (!parent) {
        showToast('親ツアーが見つかりません', 'error');
        return;
      }
      let added: Live | null = null;
      try {
        added = applyAdditionAsChild(official, parent);
      } catch (err: unknown) {
        console.error('applyAdditionAsChild failed', err);
        showToast(`追加失敗: ${errMsg(err)}`, 'error');
        return;
      }
      if (!added) {
        showToast('追加に失敗しました', 'error');
        return;
      }
      showToast(`「${parent.name}」の追加公演として登録: ${official.name}`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // 類似既存ライブと統合（ローカルの既存ライブを公式で更新）
  document.querySelectorAll<HTMLButtonElement>('[data-action="merge"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const sIdx = Number(btn.dataset.similar);
      const item = toAdd[i];
      const target = item?.similar?.[sIdx]?.local;
      if (!item || !target) return;
      let merged: Live | null = null;
      try {
        merged = mergeIntoExisting(target, item.official);
      } catch (err: unknown) {
        console.error('mergeIntoExisting failed', err);
        showToast(`統合失敗: ${errMsg(err)}`, 'error');
        return;
      }
      if (!merged) {
        showToast('統合に失敗しました', 'error');
        return;
      }
      showToast(`統合: ${target.name}`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // ピッカーで選択された任意の既存ライブと統合
  document.querySelectorAll<HTMLButtonElement>('[data-action="merge-picked"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const localIdx = Number(btn.dataset.localIdx);
      const official = toAdd[i]?.official;
      const target = getLives()[localIdx];
      if (!official || !target) return;
      let merged: Live | null = null;
      try {
        merged = mergeIntoExisting(target, official);
      } catch (err: unknown) {
        console.error('mergeIntoExisting failed', err);
        showToast(`統合失敗: ${errMsg(err)}`, 'error');
        return;
      }
      if (!merged) {
        showToast('統合に失敗しました', 'error');
        return;
      }
      showToast(`統合: ${target.name}`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // 統合ピッカーの検索
  document.querySelectorAll<HTMLInputElement>('.os-merge-search').forEach(input => {
    input.addEventListener('input', e => {
      const target = e.target as HTMLInputElement;
      const i = Number(target.dataset.index);
      const list = document.querySelector<HTMLElement>(`.os-merge-picker-list[data-index="${i}"]`);
      if (!list) return;
      list.innerHTML = renderMergePickerList(i, target.value);
      list.querySelectorAll<HTMLButtonElement>('[data-action="merge-picked"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const official = toAdd[Number(btn.dataset.index)]?.official;
          const target = getLives()[Number(btn.dataset.localIdx)];
          if (!official || !target) return;
          try {
            mergeIntoExisting(target, official);
          } catch (err: unknown) {
            showToast(`統合失敗: ${errMsg(err)}`, 'error');
            return;
          }
          showToast(`既存ライブと統合しました: ${target.name}`, 'success');
          refreshDiffFromStore();
          refreshOfficialSyncBadge();
          renderModal();
        });
      });
    });
  });

  // チェックボックスの状態管理
  const updateCheckedCountUI = (): void => {
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.os-item-check')];
    const checked = boxes.filter(b => b.checked && !b.disabled);
    const checkAll = document.getElementById('os-check-all') as HTMLInputElement | null;
    const addBtn   = document.getElementById('os-add-checked') as HTMLButtonElement | null;
    if (addBtn) {
      addBtn.disabled = checked.length === 0;
      addBtn.textContent = `選択した${checked.length}件を追加`;
    }
    if (checkAll) {
      const selectable = boxes.filter(b => !b.disabled);
      checkAll.checked = selectable.length > 0 && checked.length === selectable.length;
      checkAll.indeterminate = checked.length > 0 && checked.length < selectable.length;
    }
  };

  // 個別チェックボックス
  document.querySelectorAll<HTMLInputElement>('.os-item-check').forEach(cb => {
    cb.addEventListener('change', updateCheckedCountUI);
  });

  // 全選択チェックボックス
  document.getElementById('os-check-all')?.addEventListener('change', e => {
    const on = (e.target as HTMLInputElement).checked;
    document.querySelectorAll<HTMLInputElement>('.os-item-check').forEach(cb => {
      if (!cb.disabled) cb.checked = on;
    });
    updateCheckedCountUI();
  });

  // チェックした分だけ一括追加
  document.getElementById('os-add-checked')?.addEventListener('click', async () => {
    let n = 0;
    const failures: string[] = [];
    document.querySelectorAll<HTMLInputElement>('.os-item-check:checked').forEach(cb => {
      if (cb.disabled) return;
      const i = Number(cb.dataset.index);
      const official = toAdd[i]?.official;
      if (!official) return;
      const typeSel = document.getElementById(`os-add-type-${i}`) as HTMLSelectElement | null;
      const override = typeSel?.value || null;
      try {
        const added = applyAddition(official, override);
        if (!added) throw new Error('addLive returned falsy');
      } catch (err: unknown) {
        console.error('applyAddition failed', err);
        failures.push(`${official.name}: ${errMsg(err)}`);
        return;
      }
      n++;
    });
    if (n === 0 && failures.length === 0) {
      showToast('選択がありません', 'info');
      return;
    }
    if (failures.length > 0) {
      showToast(`${failures.length}件失敗: ${failures[0]}`, 'error');
    }
    if (n > 0) showToast(`${n}件追加 (ローカル${getLives().length}件)`, 'success');
    refreshDiffFromStore();
    refreshOfficialSyncBadge();
    renderModal();

    const res = await flushSyncNow();
    if (res && res.ok === false && res.reason === 'sync-failed') {
      showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
    }
  });

  // 「会場を取り込む」ボタン: 既に舞台/ライブ化済みで venue 空の item に対し、
  // 公式ツアーの最初の child から venue/時刻を吸収する
  document.querySelectorAll<HTMLButtonElement>('[data-action="absorb-venue"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const item = toUpdate[i];
      if (!item) return;
      try {
        applyUpdate(item.local, item.official, []);
      } catch (err: unknown) {
        console.error('applyUpdate (absorb) failed', err);
        showToast(`会場取り込み失敗: ${errMsg(err)}`, 'error');
        return;
      }
      showToast(`会場情報を取り込み: ${item.official.name}`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // 種別 select を変更したら即座に反映（再レンダリングで他アイテムの
  // 変更が失われる問題を回避。「舞台」等は選ぶだけで即時保存される）
  document.querySelectorAll<HTMLSelectElement>('.os-upd-type').forEach(sel => {
    sel.addEventListener('change', async () => {
      const i = Number(sel.dataset.index);
      const item = toUpdate[i];
      if (!item) return;
      const selectedType = sel.value;
      const currentType = normalizeEventTypeValue(item.local.eventType);
      if (!selectedType || selectedType === currentType) return;
      try {
        applyUpdate(item.local, item.official, [], selectedType);
      } catch (err: unknown) {
        console.error('applyUpdate (type only) failed', err);
        showToast(`種別変更失敗: ${errMsg(err)}`, 'error');
        return;
      }
      const label = EVENT_TYPE_OPTIONS.find(o => o.value === selectedType)?.label ?? selectedType;
      showToast(`「${item.official.name}」を ${label} に変更`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // 差分の反映（選択フィールド）
  document.querySelectorAll<HTMLButtonElement>('[data-action="apply-diff"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const item = toUpdate[i];
      if (!item) return;
      const container = btn.closest('.os-item');
      if (!container) return;
      const checkedFields = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')]
        .map(cb => cb.dataset.field)
        .filter((f): f is string => Boolean(f));
      // 種別 select は change で即時反映しているのでここでは扱わない
      if (checkedFields.length === 0) {
        showToast('反映するフィールドを選択してください（種別は select で即時変更されます）', 'info');
        return;
      }
      try {
        applyUpdate(item.local, item.official, checkedFields);
      } catch (err: unknown) {
        console.error('applyUpdate failed', err);
        showToast(`反映失敗: ${errMsg(err)}`, 'error');
        return;
      }
      showToast(`更新: ${item.official.name}`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // ツアーの新規子公演を一括追加
  document.querySelectorAll<HTMLButtonElement>('[data-action="add-new-children"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const item = toUpdate[i];
      if (!item || !item.newChildren || item.newChildren.length === 0) return;
      let n = 0;
      try {
        n = applyNewTourChildren(item.local, item.official, item.newChildren);
      } catch (err: unknown) {
        console.error('applyNewTourChildren failed', err);
        showToast(`追加失敗: ${errMsg(err)}`, 'error');
        return;
      }
      showToast(`${n}件の公演を「${item.local.name}」に追加しました`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });

  // 既存の子公演に不足フィールド（venue/dateEnd/時刻等）を公式データで補完
  document.querySelectorAll<HTMLButtonElement>('[data-action="reconcile-children"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const item = toUpdate[i];
      if (!item || !item.childUpdates || item.childUpdates.length === 0) return;
      let n = 0;
      try {
        for (const u of item.childUpdates) {
          if (applyChildReconciliation(u)) n++;
        }
      } catch (err: unknown) {
        console.error('applyChildReconciliation failed', err);
        showToast(`補完失敗: ${errMsg(err)}`, 'error');
        return;
      }
      showToast(`${n}件の子公演を補完しました`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        showToast(`Supabase同期失敗: ${errMsg(res.error)}`, 'error');
      }
    });
  });
}

// ---------- アイテムレンダリング ----------

function renderSourceLine(official: OfficialLive): string {
  const src = official.sourceUrl
    ? `<a href="${escapeHtml(official.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="os-source">根拠URL ↗</a>`
    : '';
  const scrapedAt = official.scrapedAt
    ? `<span class="os-source-meta">${escapeHtml(new Date(official.scrapedAt).toLocaleDateString('ja-JP'))} 取得</span>`
    : '';
  // ニュース欄からの推定データは正確性が落ちるため明示する
  const provisionalNote = official.provisional
    ? `<div class="os-provisional-note">
         公式のライブ一覧にはまだ掲載されていない告知（ニュース欄）から推定した日程です。
         会場・日付が不正確な場合があります。正式掲載後は自動で置き換わります。
       </div>`
    : '';
  return `${provisionalNote}<div class="os-source-line">${src} ${scrapedAt}</div>`;
}

/** 暫定エントリを示すタグ */
function provisionalTag(official: OfficialLive): string {
  return official.provisional ? ' <span class="os-provisional-tag">暫定</span>' : '';
}

function renderAddItem(item: DiffAddItem, i: number): string {
  const o = item.official;
  const similar = Array.isArray(item.similar) ? item.similar : [];
  const similarWarning = similar.length > 0 ? `
    <div class="os-similar-warn">
      ⚠ 既存に似たライブがあります（${similar.length}件）。重複を避けたい場合は「既存と統合」を使ってください:
      <ul class="os-similar-list">
        ${similar.slice(0, 3).map((s, sIdx: number) => `
          <li>
            <span class="os-similar-name">「${escapeHtml(s.local.name || '')}」</span>
            <span class="os-similar-date">${escapeHtml((s.local.dateStart || '').slice(0, 10))}</span>
            <span class="os-similar-diff">(${s.diffDays}日差)</span>
            <button type="button" class="btn btn-secondary btn-sm os-merge-btn"
                    data-action="merge" data-index="${i}" data-similar="${sIdx}">既存と統合</button>
          </li>
        `).join('')}
      </ul>
    </div>
  ` : '';

  const logoHtml = o.iconImg
    ? `<img src="${escapeHtml(o.iconImg)}" class="os-item-logo" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`
    : '';

  // どのライブでも「任意の既存ライブと統合」できるピッカー
  const pickerHtml = `
    <details class="os-merge-picker">
      <summary>他の既存ライブと統合する</summary>
      <div class="os-merge-picker-body">
        <input type="text" class="form-input os-merge-search" placeholder="ライブ名で検索..." data-index="${i}" />
        <div class="os-merge-picker-list" data-index="${i}">
          ${renderMergePickerList(i, '')}
        </div>
      </div>
    </details>
  `;

  const isTour = o.eventType === 'tour';
  const childCount = Array.isArray(o.children) ? o.children.length : 0;

  // ツアーファイナル等で、既存ローカルツアーの追加公演にできる場合の候補
  const parentTourCandidate = !isTour ? findCandidateTourParent(o, getLives()) : null;
  const parentTourSuggestion = parentTourCandidate ? `
    <div class="os-tour-link-suggest">
      <span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
        既存ツアー <strong>${escapeHtml(parentTourCandidate.name)}</strong> の追加公演として入れられます
      </span>
      <button type="button" class="btn btn-secondary btn-sm"
              data-action="add-as-child" data-index="${i}" data-parent-id="${escapeHtml(parentTourCandidate.id)}">
        ツアーに追加
      </button>
    </div>
  ` : '';

  // ツアーは venue が空、会場一覧を先頭3件まで展開して代わりに表示
  // ツアーの場合、レグ（会場ごとに連続日をまとめたもの）を表示
  const venueLineHtml = isTour
    ? (childCount > 0
        ? `<div class="os-row"><span class="os-label">公演</span> ${childCount}レグ<span style="color:var(--text-tertiary);font-size:11px;margin-left:6px;">(${o.children!.slice(0, 3).map(c => escapeHtml(`${c.venue || '—'} ${formatDateRange(c.dateStart, c.dateEnd)}`)).join(' / ')}${childCount > 3 ? ` …+${childCount - 3}` : ''})</span></div>`
        : `<div class="os-row"><span class="os-label">公演</span> <span style="color:var(--text-tertiary);">— 未登録</span></div>`)
    : `<div class="os-row"><span class="os-label">会場</span> ${escapeHtml(o.venue || '-')}</div>`;

  return `
    <div class="os-item${similar.length > 0 ? ' os-item-warn' : ''}${isTour ? ' os-item-tour' : ''}">
      <div class="os-item-header">
        <label class="os-item-check-wrap" title="一括追加の対象に含める">
          <input type="checkbox" class="os-item-check" data-index="${i}" />
        </label>
        ${logoHtml}
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}${isTour ? ' <span class="os-tour-tag">ツアー</span>' : ''}${provisionalTag(o)}</span>
          <span class="os-name">${escapeHtml(o.name || '')}</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm"
                data-action="add" data-index="${i}">追加</button>
      </div>
      <div class="os-item-body">
        ${similarWarning}
        ${parentTourSuggestion}
        <div class="os-row"><span class="os-label">日程</span> ${escapeHtml(formatDateRange(o.dateStart, o.dateEnd))}</div>
        ${venueLineHtml}
        <div class="os-row os-type-row">
          <span class="os-label">種別</span>
          ${renderEventTypeSelect(`os-add-type-${i}`, normalizeEventTypeValue(o.eventType), 'add', i)}
        </div>
        ${pickerHtml}
        ${renderSourceLine(o)}
      </div>
    </div>
  `;
}

/**
 * 任意の既存ライブを絞り込んで統合候補として表示する。
 * query が与えられた場合は name/artist/date に対する部分一致で絞り込む。
 */
function renderMergePickerList(addIndex: number, query: string): string {
  const localLives = getLives();
  const q = (query || '').trim().toLowerCase();
  const filtered = q
    ? localLives.filter(l => {
        const hay = `${l.name || ''} ${l.artist || ''} ${l.venue || ''} ${l.dateStart || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : localLives.slice(0, 30); // 初期は先頭30件

  if (filtered.length === 0) {
    return `<div class="os-merge-empty">該当する既存ライブがありません</div>`;
  }

  return filtered.map((l, lIdx) => {
    const realIdx = localLives.indexOf(l);
    return `
      <div class="os-merge-candidate">
        <div class="os-merge-cand-info">
          <div class="os-merge-cand-name">${escapeHtml(l.name || '(無題)')}</div>
          <div class="os-merge-cand-meta">
            ${escapeHtml(l.artist || '')} ${escapeHtml((l.dateStart || '').slice(0, 10))}
            ${l.venue ? `／${escapeHtml(l.venue)}` : ''}
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm"
                data-action="merge-picked" data-index="${addIndex}" data-local-idx="${realIdx}">統合</button>
      </div>
    `;
  }).join('');
}

const CHILD_FIELD_LABEL: Record<string, string> = {
  venue:      '会場',
  prefecture: '都道府県',
  dateStart:  '開始日',
  dateEnd:    '終了日',
  openTime:   '開場',
  startTime:  '開演',
  dayTimes:   '日別時刻',
};

function renderUpdateItem(item: DiffUpdateItem, i: number): string {
  const { official: o, local: l, diffs } = item;
  const newChildren = item.newChildren ?? [];
  const childUpdates = item.childUpdates ?? [];
  const diffRows = diffs.map(d => `
    <label class="os-diff-row">
      <input type="checkbox" data-field="${escapeHtml(d.field)}" checked />
      <span class="os-diff-label">${escapeHtml(FIELD_LABEL[d.field] || d.field)}</span>
      <span class="os-diff-from">${escapeHtml(d.from || '（空）')}</span>
      <span class="os-diff-arrow">→</span>
      <span class="os-diff-to">${escapeHtml(d.to || '（空）')}</span>
    </label>
  `).join('');

  const newChildrenBlock = newChildren.length > 0 ? `
    <div class="os-new-children">
      <div class="os-new-children-head">
        <span>🆕 このツアーに新しい公演 ${newChildren.length} 件が追加されています</span>
        <button type="button" class="btn btn-primary btn-sm"
                data-action="add-new-children" data-index="${i}">
          ${newChildren.length}件まとめて追加
        </button>
      </div>
      <ul class="os-new-children-list">
        ${newChildren.slice(0, 8).map(c => `
          <li>
            <span class="os-new-child-date">${escapeHtml(formatDateRange(c.dateStart, c.dateEnd))}${c.dayLabel ? ` (${escapeHtml(c.dayLabel)})` : ''}</span>
            <span class="os-new-child-venue">${escapeHtml(c.venue || '—')}${c.prefecture ? `（${escapeHtml(c.prefecture)}）` : ''}</span>
          </li>
        `).join('')}
        ${newChildren.length > 8 ? `<li style="color:var(--text-tertiary);">…他 ${newChildren.length - 8} 件</li>` : ''}
      </ul>
    </div>
  ` : '';

  const childUpdatesBlock = childUpdates.length > 0 ? `
    <div class="os-new-children" style="border-color:rgba(74,222,128,0.35);background:rgba(74,222,128,0.06);">
      <div class="os-new-children-head">
        <span>🔧 既存の子公演で情報が不足している ${childUpdates.length} 件を公式データで補完できます</span>
        <button type="button" class="btn btn-primary btn-sm"
                data-action="reconcile-children" data-index="${i}">
          ${childUpdates.length}件まとめて補完
        </button>
      </div>
      <ul class="os-new-children-list">
        ${childUpdates.slice(0, 8).map(u => {
          const c = u.officialChild;
          const fields = u.fieldsToFill.map(f => CHILD_FIELD_LABEL[f] || f).join(' / ');
          return `
          <li>
            <span class="os-new-child-date">${escapeHtml(formatDateRange(c.dateStart, c.dateEnd))}</span>
            <span class="os-new-child-venue">${escapeHtml(c.venue || '—')}${c.prefecture ? `（${escapeHtml(c.prefecture)}）` : ''}</span>
            <span style="color:var(--text-tertiary);font-size:11px;margin-left:6px;">補完: ${escapeHtml(fields)}</span>
          </li>`;
        }).join('')}
        ${childUpdates.length > 8 ? `<li style="color:var(--text-tertiary);">…他 ${childUpdates.length - 8} 件</li>` : ''}
      </ul>
    </div>
  ` : '';

  // 種別変更できるように反映ボタンは常に表示
  const applyBtnHtml = `
    <button type="button" class="btn btn-primary btn-sm"
            data-action="apply-diff" data-index="${i}">選択を反映</button>
  `;

  const diffBlock = diffs.length > 0 ? `
    <div class="os-diffs">
      <div class="os-diffs-head">差分（チェックを外せば反映しない）</div>
      ${diffRows}
    </div>
  ` : '';

  // 現状の種別（ローカル優先、なければ公式）をプリセレクト
  const currentType = normalizeEventTypeValue(l.eventType || o.eventType);
  const officialType = normalizeEventTypeValue(o.eventType);
  // バッジはローカルの実際の種別を表示（公式とは別物だと分かるように）
  const badgeHtml =
    currentType === 'tour'  ? ' <span class="os-tour-tag">ツアー</span>' :
    currentType === 'stage' ? ' <span class="os-tour-tag" style="background:rgba(251,191,36,0.15);color:#FCD34D;border-color:rgba(251,191,36,0.35);">舞台</span>' :
    currentType === 'event' ? ' <span class="os-tour-tag" style="background:rgba(236,72,153,0.18);color:#F472B6;border-color:rgba(236,72,153,0.35);">イベント</span>' :
    '';

  // 舞台などに変換済みだが、親の venue が空で公式 children から埋められる場合
  const absorbVenueBanner = item.canAbsorbVenue ? `
    <div class="os-type-hint-banner" style="margin-top:8px;padding:10px 12px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.35);border-radius:8px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:8px;justify-content:space-between;">
      <span style="display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:16px;line-height:1;">🏟</span>
        <span>会場情報が空のままです。公式データ（${Array.isArray(o.children) ? o.children.length : 0}公演）から <strong>会場・時刻を取り込めます</strong>。</span>
      </span>
      <button type="button" class="btn btn-primary btn-sm"
              data-action="absorb-venue" data-index="${i}">会場を取り込む</button>
    </div>
  ` : '';

  // 種別ミスマッチの時は目立つ案内バナーを出して行動を促す
  const officialChildCount = Array.isArray(o.children) ? o.children.length : 0;
  const typeMismatchBanner =
    officialType === 'tour' && currentType !== 'tour' ? `
      <div class="os-type-hint-banner" style="margin-top:8px;padding:10px 12px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.35);border-radius:8px;font-size:12px;color:var(--text-secondary);display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:16px;line-height:1;">💡</span>
        <span>公式では <strong style="color:#a78bfa;">ツアー</strong>（${officialChildCount}公演）として登録されています。<br>
        上の「種別」を <strong>ツアー</strong> に変えると即座に <strong>子公演が自動で追加</strong>され各日に会場情報が表示されます。</span>
      </div>
    ` :
    (!!officialType && !!currentType && officialType !== currentType) ? `
      <div class="os-type-hint-banner" style="margin-top:8px;padding:10px 12px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.35);border-radius:8px;font-size:12px;color:var(--text-secondary);display:flex;align-items:flex-start;gap:8px;">
        <span style="font-size:16px;line-height:1;">ℹ️</span>
        <span>公式では <strong>${escapeHtml(eventTypeLabel(officialType))}</strong> として登録されていますが、ローカルは <strong>${escapeHtml(eventTypeLabel(currentType))}</strong> です。種別を揃えたい場合のみ上の select を変更してください。</span>
      </div>
    ` : '';

  return `
    <div class="os-item">
      <div class="os-item-header">
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}${badgeHtml}${provisionalTag(o)}</span>
          <span class="os-name">${escapeHtml(o.name || '')}</span>
        </div>
        ${applyBtnHtml}
      </div>
      <div class="os-item-body">
        <div class="os-row"><span class="os-label">日程</span> ${escapeHtml(formatDateRange(l.dateStart, l.dateEnd))}</div>
        <div class="os-row os-type-row">
          <span class="os-label">種別</span>
          ${renderEventTypeSelect(`os-upd-type-${i}`, currentType, 'upd', i)}
          <span class="os-type-hint">変更すると即時反映されます</span>
        </div>
        ${absorbVenueBanner}
        ${typeMismatchBanner}
        ${newChildrenBlock}
        ${childUpdatesBlock}
        ${diffBlock}
        ${renderSourceLine(o)}
      </div>
    </div>
  `;
}

function renderSkipItem(item: DiffSkipItem): string {
  const { official: o } = item;
  return `
    <div class="os-item os-skip">
      <div class="os-item-header">
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}${provisionalTag(o)}</span>
          <span class="os-name">${escapeHtml(o.name || '')}</span>
        </div>
        <span class="os-badge-ok">一致</span>
      </div>
      <div class="os-item-body">
        <div class="os-row"><span class="os-label">日程</span> ${escapeHtml(formatDateRange(o.dateStart, o.dateEnd))}</div>
      </div>
    </div>
  `;
}
