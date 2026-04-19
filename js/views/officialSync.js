// ============================================
// Official Sync View — 公式ライブ情報の差分確認モーダル
// ============================================

import { getLives, flushSyncNow } from '../store.js';
import { showModal, closeModal, showToast } from '../utils.js';
import {
  fetchOfficialLives,
  computeDiff,
  applyAddition,
  applyUpdate,
  mergeIntoExisting,
} from '../officialLives.js';

// ---------- ヘッダーボタンのバッジ更新 ----------
/**
 * 公式データとローカルを比較し、ヘッダー同期ボタンに
 * 「新規+差分」の件数バッジを表示する。
 * 非同期だが失敗しても何もしない（静かに飲み込む）。
 */
export async function refreshOfficialSyncBadge() {
  const btn = document.getElementById('official-sync-btn');
  if (!btn) return;
  try {
    const data = await fetchOfficialLives({ noCache: false });
    const diff = computeDiff(data.lives || [], getLives());
    const pending = diff.toAdd.length + diff.toUpdate.length;
    let badge = btn.querySelector('.os-header-badge');
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

const FIELD_LABEL = {
  venue:      '会場',
  prefecture: '都道府県',
  dateEnd:    '終了日',
  eventType:  '種別',
};

const ARTIST_OPTIONS = [
  { value: 'all',      label: 'すべて' },
  { value: '乃木坂46', label: '乃木坂46' },
  { value: '櫻坂46',   label: '櫻坂46' },
];

// モーダル開いてる間だけ保持するステート
let _state = null; // { data, diff, filter, activeTab }

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eventTypeLabel(v) {
  // DB に格納される値は live/event/tour 。UI 表示用に日本語へ
  if (v === 'event' || v === 'イベント') return 'イベント';
  if (v === 'tour')  return 'ツアー';
  return 'ライブ';
}

function formatDateRange(startIso, endIso) {
  if (!startIso) return '';
  if (!endIso || endIso === startIso) return startIso.slice(0, 10);
  return `${startIso.slice(0, 10)} 〜 ${endIso.slice(0, 10)}`;
}

function filterByArtist(items, artist) {
  if (artist === 'all') return items;
  return items.filter(it => (it.official?.artist || '') === artist);
}

// ---------- メイン ----------

export async function showOfficialSyncModal() {
  showModal('公式ライブ情報の同期', `
    <div class="official-sync-loading" style="text-align:center;padding:40px 0;color:var(--text-secondary);">
      <div class="loader-spinner" style="margin:0 auto 12px;"></div>
      公式データを読み込んでいます…
    </div>
  `);

  let data;
  try {
    data = await fetchOfficialLives({ noCache: true });
  } catch (e) {
    showModal('公式ライブ情報の同期', `
      <div style="padding:20px;text-align:center;">
        <p style="margin-bottom:16px;color:var(--accent-red);">${escapeHtml(e.message)}</p>
        <button type="button" class="btn btn-secondary" id="sync-close">閉じる</button>
      </div>
    `);
    document.getElementById('sync-close').addEventListener('click', closeModal);
    return;
  }

  const localLives = getLives();
  const diff = computeDiff(data.lives || [], localLives);

  _state = { data, diff, filter: 'all', activeTab: 'add' };
  renderModal();
}

function renderModal() {
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

function attachHandlers({ toAdd, toUpdate }) {
  // グループフィルター
  document.getElementById('os-artist-select')?.addEventListener('change', e => {
    _state.filter = e.target.value;
    renderModal();
  });

  // 再チェック（公式データを再取得 + 差分再計算）
  document.getElementById('os-recheck')?.addEventListener('click', async () => {
    const btn = document.getElementById('os-recheck');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '読み込み中…';
    try {
      const data = await fetchOfficialLives({ noCache: true });
      const localLives = getLives();
      _state.data = data;
      _state.diff = computeDiff(data.lives || [], localLives);
      renderModal();
      showToast('最新データで差分を再計算しました', 'success');
    } catch (e) {
      showToast('公式データの再取得に失敗しました', 'error');
      btn.disabled = false;
      btn.textContent = '再チェック';
    }
  });

  // タブ切替
  document.querySelectorAll('.os-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.os-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.os-panel').forEach(p => {
        p.classList.toggle('hidden', p.dataset.panel !== _state.activeTab);
      });
    });
  });

  // 個別追加
  document.querySelectorAll('[data-action="add"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const official = toAdd[i]?.official;
      if (!official) return;
      let added = null;
      try {
        added = applyAddition(official);
      } catch (err) {
        console.error('applyAddition failed', err);
        showToast(`追加失敗: ${err.message || err}`, 'error');
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

      // デバウンスを飛ばして即 Supabase 同期。失敗したら toast で明示
      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        const msg = res.error?.message || res.error?.details || JSON.stringify(res.error || {}).slice(0, 120);
        showToast(`Supabase同期失敗: ${msg}`, 'error');
      }
    });
  });

  // 類似既存ライブと統合（ローカルの既存ライブを公式で更新）
  document.querySelectorAll('[data-action="merge"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const sIdx = Number(btn.dataset.similar);
      const item = toAdd[i];
      const target = item?.similar?.[sIdx]?.local;
      if (!item || !target) return;
      let merged = null;
      try {
        merged = mergeIntoExisting(target, item.official);
      } catch (err) {
        console.error('mergeIntoExisting failed', err);
        showToast(`統合失敗: ${err.message || err}`, 'error');
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
        const msg = res.error?.message || JSON.stringify(res.error || {}).slice(0, 120);
        showToast(`Supabase同期失敗: ${msg}`, 'error');
      }
    });
  });

  // ピッカーで選択された任意の既存ライブと統合
  document.querySelectorAll('[data-action="merge-picked"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const localIdx = Number(btn.dataset.localIdx);
      const official = toAdd[i]?.official;
      const target = getLives()[localIdx];
      if (!official || !target) return;
      let merged = null;
      try {
        merged = mergeIntoExisting(target, official);
      } catch (err) {
        console.error('mergeIntoExisting failed', err);
        showToast(`統合失敗: ${err.message || err}`, 'error');
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
        const msg = res.error?.message || JSON.stringify(res.error || {}).slice(0, 120);
        showToast(`Supabase同期失敗: ${msg}`, 'error');
      }
    });
  });

  // 統合ピッカーの検索
  document.querySelectorAll('.os-merge-search').forEach(input => {
    input.addEventListener('input', e => {
      const i = Number(e.target.dataset.index);
      const list = document.querySelector(`.os-merge-picker-list[data-index="${i}"]`);
      if (!list) return;
      list.innerHTML = renderMergePickerList(i, e.target.value);
      // 新しいボタンにハンドラを付け直す
      list.querySelectorAll('[data-action="merge-picked"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const official = toAdd[Number(btn.dataset.index)]?.official;
          const target = getLives()[Number(btn.dataset.localIdx)];
          if (!official || !target) return;
          try {
            mergeIntoExisting(target, official);
          } catch (err) {
            showToast(`統合失敗: ${err.message || err}`, 'error');
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
  const updateCheckedCountUI = () => {
    const boxes = [...document.querySelectorAll('.os-item-check')];
    const checked = boxes.filter(b => b.checked && !b.disabled);
    const checkAll = document.getElementById('os-check-all');
    const addBtn = document.getElementById('os-add-checked');
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
  document.querySelectorAll('.os-item-check').forEach(cb => {
    cb.addEventListener('change', updateCheckedCountUI);
  });

  // 全選択チェックボックス
  document.getElementById('os-check-all')?.addEventListener('change', e => {
    const on = e.target.checked;
    document.querySelectorAll('.os-item-check').forEach(cb => {
      if (!cb.disabled) cb.checked = on;
    });
    updateCheckedCountUI();
  });

  // チェックした分だけ一括追加
  document.getElementById('os-add-checked')?.addEventListener('click', async () => {
    let n = 0;
    const failures = [];
    document.querySelectorAll('.os-item-check:checked').forEach(cb => {
      if (cb.disabled) return;
      const i = Number(cb.dataset.index);
      const official = toAdd[i]?.official;
      if (!official) return;
      try {
        const added = applyAddition(official);
        if (!added) throw new Error('addLive returned falsy');
      } catch (err) {
        console.error('applyAddition failed', err);
        failures.push(`${official.name}: ${err.message || err}`);
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
      const msg = res.error?.message || res.error?.details || JSON.stringify(res.error || {}).slice(0, 120);
      showToast(`Supabase同期失敗: ${msg}`, 'error');
    }
  });

  // 差分の反映（選択フィールド）
  document.querySelectorAll('[data-action="apply-diff"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const item = toUpdate[i];
      if (!item) return;
      const container = btn.closest('.os-item');
      const checkedFields = [...container.querySelectorAll('input[type=checkbox]:checked')]
        .map(cb => cb.dataset.field);
      if (checkedFields.length === 0) {
        showToast('反映するフィールドを選択してください', 'info');
        return;
      }
      try {
        applyUpdate(item.local, item.official, checkedFields);
      } catch (err) {
        console.error('applyUpdate failed', err);
        showToast(`反映失敗: ${err.message || err}`, 'error');
        return;
      }
      showToast(`更新: ${item.official.name}`, 'success');
      refreshDiffFromStore();
      refreshOfficialSyncBadge();
      renderModal();

      const res = await flushSyncNow();
      if (res && res.ok === false && res.reason === 'sync-failed') {
        const msg = res.error?.message || JSON.stringify(res.error || {}).slice(0, 120);
        showToast(`Supabase同期失敗: ${msg}`, 'error');
      }
    });
  });
}

// ---------- アイテムレンダリング ----------

function renderSourceLine(official) {
  const src = official.sourceUrl
    ? `<a href="${escapeHtml(official.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="os-source">根拠URL ↗</a>`
    : '';
  const scrapedAt = official.scrapedAt
    ? `<span class="os-source-meta">${escapeHtml(new Date(official.scrapedAt).toLocaleDateString('ja-JP'))} 取得</span>`
    : '';
  return `<div class="os-source-line">${src} ${scrapedAt}</div>`;
}

function renderAddItem(item, i) {
  const o = item.official;
  const similar = Array.isArray(item.similar) ? item.similar : [];
  const similarWarning = similar.length > 0 ? `
    <div class="os-similar-warn">
      ⚠ 既存に似たライブがあります（${similar.length}件）。重複を避けたい場合は「既存と統合」を使ってください:
      <ul class="os-similar-list">
        ${similar.slice(0, 3).map((s, sIdx) => `
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

  return `
    <div class="os-item${similar.length > 0 ? ' os-item-warn' : ''}">
      <div class="os-item-header">
        <label class="os-item-check-wrap" title="一括追加の対象に含める">
          <input type="checkbox" class="os-item-check" data-index="${i}" />
        </label>
        ${logoHtml}
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}</span>
          <span class="os-name">${escapeHtml(o.name || '')}</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm"
                data-action="add" data-index="${i}">追加</button>
      </div>
      <div class="os-item-body">
        ${similarWarning}
        <div class="os-row"><span class="os-label">日程</span> ${escapeHtml(formatDateRange(o.dateStart, o.dateEnd))}</div>
        <div class="os-row"><span class="os-label">会場</span> ${escapeHtml(o.venue || '-')}</div>
        <div class="os-row"><span class="os-label">種別</span> ${escapeHtml(eventTypeLabel(o.eventType))}</div>
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
function renderMergePickerList(addIndex, query) {
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

function renderUpdateItem(item, i) {
  const { official: o, local: l, diffs } = item;
  const diffRows = diffs.map(d => `
    <label class="os-diff-row">
      <input type="checkbox" data-field="${escapeHtml(d.field)}" checked />
      <span class="os-diff-label">${escapeHtml(FIELD_LABEL[d.field] || d.field)}</span>
      <span class="os-diff-from">${escapeHtml(d.from || '（空）')}</span>
      <span class="os-diff-arrow">→</span>
      <span class="os-diff-to">${escapeHtml(d.to || '（空）')}</span>
    </label>
  `).join('');

  return `
    <div class="os-item">
      <div class="os-item-header">
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}</span>
          <span class="os-name">${escapeHtml(o.name || '')}</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm"
                data-action="apply-diff" data-index="${i}">選択を反映</button>
      </div>
      <div class="os-item-body">
        <div class="os-row"><span class="os-label">日程</span> ${escapeHtml(formatDateRange(l.dateStart, l.dateEnd))}</div>
        <div class="os-diffs">
          <div class="os-diffs-head">差分（チェックを外せば反映しない）</div>
          ${diffRows}
        </div>
        ${renderSourceLine(o)}
      </div>
    </div>
  `;
}

function renderSkipItem(item) {
  const { official: o } = item;
  return `
    <div class="os-item os-skip">
      <div class="os-item-header">
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}</span>
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
