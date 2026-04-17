// ============================================
// Official Sync View — 公式ライブ情報の差分確認モーダル
// ============================================

import { getLives } from '../store.js';
import { showModal, closeModal, showToast } from '../utils.js';
import {
  fetchOfficialLives,
  computeDiff,
  applyAddition,
  applyUpdate,
  DIFF_FIELDS,
} from '../officialLives.js';

// ---------- 表示用ヘルパー ----------

const FIELD_LABEL = {
  venue:      '会場',
  prefecture: '都道府県',
  dateEnd:    '終了日',
  eventType:  '種別',
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateRange(startIso, endIso) {
  if (!startIso) return '';
  if (!endIso || endIso === startIso) return startIso.slice(0, 10);
  return `${startIso.slice(0, 10)} 〜 ${endIso.slice(0, 10)}`;
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
  const { toAdd, toUpdate, toSkip } = computeDiff(data.lives || [], localLives);

  renderModal(data, { toAdd, toUpdate, toSkip });
}

function renderModal(data, diff) {
  const { toAdd, toUpdate, toSkip } = diff;
  const updatedAt = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
    : '不明';

  const html = `
    <div class="official-sync">
      <div class="official-sync-meta">
        <div>公式データ更新: <strong>${escapeHtml(updatedAt)}</strong></div>
        <div>対象: 乃木坂46 / 櫻坂46</div>
        <div class="official-sync-note">
          ローカルのライブは自動で削除・上書きされません。各項目を個別に確認してください。
        </div>
      </div>

      <div class="official-sync-tabs">
        <button type="button" class="os-tab active" data-tab="add">
          新規 <span class="os-badge">${toAdd.length}</span>
        </button>
        <button type="button" class="os-tab" data-tab="update">
          差分あり <span class="os-badge">${toUpdate.length}</span>
        </button>
        <button type="button" class="os-tab" data-tab="skip">
          一致 <span class="os-badge">${toSkip.length}</span>
        </button>
      </div>

      <div class="os-panel" data-panel="add">
        ${toAdd.length === 0
          ? `<div class="os-empty">新規の公式ライブはありません。</div>`
          : toAdd.map(renderAddItem).join('')}
        ${toAdd.length > 1 ? `
          <div class="os-bulk">
            <button type="button" class="btn btn-secondary btn-sm" id="os-add-all">
              すべて追加（${toAdd.length}件）
            </button>
          </div>
        ` : ''}
      </div>

      <div class="os-panel hidden" data-panel="update">
        ${toUpdate.length === 0
          ? `<div class="os-empty">差分のある公式ライブはありません。</div>`
          : toUpdate.map(renderUpdateItem).join('')}
      </div>

      <div class="os-panel hidden" data-panel="skip">
        ${toSkip.length === 0
          ? `<div class="os-empty">一致する公式ライブはありません。</div>`
          : toSkip.map(renderSkipItem).join('')}
      </div>
    </div>
  `;

  showModal('公式ライブ情報の同期', html);

  // タブ切替
  document.querySelectorAll('.os-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.os-tab').forEach(b => b.classList.toggle('active', b === btn));
      const target = btn.dataset.tab;
      document.querySelectorAll('.os-panel').forEach(p => {
        p.classList.toggle('hidden', p.dataset.panel !== target);
      });
    });
  });

  // 個別追加
  document.querySelectorAll('[data-action="add"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      const official = toAdd[i]?.official;
      if (!official) return;
      applyAddition(official);
      btn.closest('.os-item').classList.add('os-applied');
      btn.disabled = true;
      btn.textContent = '追加済み';
      showToast(`追加しました: ${official.name}`, 'success');
    });
  });

  // 一括追加
  document.getElementById('os-add-all')?.addEventListener('click', () => {
    let n = 0;
    toAdd.forEach((item, i) => {
      const btn = document.querySelector(`[data-action="add"][data-index="${i}"]`);
      if (btn && !btn.disabled) {
        applyAddition(item.official);
        btn.disabled = true;
        btn.textContent = '追加済み';
        btn.closest('.os-item').classList.add('os-applied');
        n++;
      }
    });
    showToast(`${n}件追加しました`, 'success');
  });

  // 差分の反映（選択フィールド）
  document.querySelectorAll('[data-action="apply-diff"]').forEach(btn => {
    btn.addEventListener('click', () => {
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
      applyUpdate(item.local, item.official, checkedFields);
      container.classList.add('os-applied');
      btn.disabled = true;
      btn.textContent = '反映済み';
      showToast(`更新しました: ${item.official.name}`, 'success');
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
  return `
    <div class="os-item">
      <div class="os-item-header">
        <div class="os-item-title">
          <span class="os-artist">${escapeHtml(o.artist || '')}</span>
          <span class="os-name">${escapeHtml(o.name || '')}</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm"
                data-action="add" data-index="${i}">追加</button>
      </div>
      <div class="os-item-body">
        <div class="os-row"><span class="os-label">日程</span> ${escapeHtml(formatDateRange(o.dateStart, o.dateEnd))}</div>
        <div class="os-row"><span class="os-label">会場</span> ${escapeHtml(o.venue || '-')}</div>
        <div class="os-row"><span class="os-label">種別</span> ${escapeHtml(o.eventType || 'ライブ')}</div>
        ${renderSourceLine(o)}
      </div>
    </div>
  `;
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
