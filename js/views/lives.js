// ============================================
// Lives Management View
// ============================================
import { getLives, addLive, updateLive, deleteLive, getMembers, getDayAttendanceStatus, setDayAttendance, getDatesForLive } from '../store.js';
import { showModal, closeModal, showToast, showConfirm, isJapaneseHoliday } from '../utils.js';
import { showLiveDetailsModal, showMemberDetailsModal } from './details.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

let livesFilter = 'upcoming'; // 'all' | 'upcoming' | 'past'
let livesViewMode = 'tl';     // 'tl' | 'calendar'
let livesCalendarDate = new Date();
let activeFilterMemberIds = new Set();

export function renderLives() {
  const content = document.getElementById('page-content');
  const lives = getLives();
  const members = getMembers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // フィルタリング & ソート
  const upcoming = lives.filter(l => {
    const last = new Date(l.dateEnd || l.dateStart || l.date);
    last.setHours(0, 0, 0, 0);
    return last >= now;
  }).sort((a, b) => new Date(a.dateStart || a.date) - new Date(b.dateStart || b.date)); // 昇順（近い順）

  const past = lives.filter(l => {
    const last = new Date(l.dateEnd || l.dateStart || l.date);
    last.setHours(0, 0, 0, 0);
    return last < now;
  }).sort((a, b) => new Date(b.dateStart || b.date) - new Date(a.dateStart || a.date)); // 降順（新しい順）

  const all = [...lives].sort((a, b) => new Date(b.dateStart || b.date) - new Date(a.dateStart || a.date));

  let filtered = livesFilter === 'upcoming' ? upcoming
               : livesFilter === 'past'     ? past
               : all;

  // メンバーフィルター（AND: 選択した全員が参戦しているライブのみ）
  if (activeFilterMemberIds.size > 0) {
    filtered = filtered.filter(live => {
      const liveDates = getDatesForLive(live);
      return [...activeFilterMemberIds].every(memberId =>
        liveDates.some(d => getDayAttendanceStatus(live.id, d.dateStr, memberId) === 'going')
      );
    });
  }

  // 年月グループ化（TL用）
  const groups = {};
  filtered.forEach(live => {
    const d = new Date(live.dateStart || live.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(live);
  });
  const sortedKeys = livesFilter === 'upcoming'
    ? Object.keys(groups).sort()
    : Object.keys(groups).sort().reverse();

  const timelineHtml = sortedKeys.map(key => {
    const [year, mon] = key.split('-');
    const entries = groups[key].map(live => {
      const startD = new Date(live.dateStart || live.date);
      startD.setHours(0, 0, 0, 0);
      const endD = live.dateEnd ? new Date(live.dateEnd) : null;
      if (endD) endD.setHours(0, 0, 0, 0);
      const lastD = endD || startD;
      const isPast = lastD < now;
      const isOngoing = startD <= now && lastD >= now;
      const isWeekend = startD.getDay() === 0 || startD.getDay() === 6;

      const metaParts = [];
      if (live.artist) metaParts.push(escapeHtml(live.artist));
      if (live.venue) {
        const pref = live.prefecture || extractPrefecture(live.venue);
        metaParts.push(pref ? `${escapeHtml(live.venue)}（${pref}）` : escapeHtml(live.venue));
      }

      const statusBadge = isOngoing
        ? `<span class="badge badge-today" style="font-size:10px;padding:1px 8px;">開催中</span>`
        : !isPast
          ? `<span class="badge badge-upcoming" style="font-size:10px;padding:1px 8px;">予定</span>`
          : `<span class="badge badge-past" style="font-size:10px;padding:1px 8px;">終了</span>`;

      // 参戦メンバーチップ（アバター対応）
      const liveDates = getDatesForLive(live);
      const goingChips = members.map(m => {
        const isGoing = liveDates.some(d => getDayAttendanceStatus(live.id, d.dateStr, m.id) === 'going');
        if (!isGoing) return '';
        const dot = m.avatar
          ? `<img src="${m.avatar}" style="width:14px;height:14px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
          : `<span style="width:8px;height:8px;border-radius:50%;background:${m.color};display:inline-block;flex-shrink:0;"></span>`;
        return `<span class="history-member-chip"
          style="background:${m.color}20;border-color:${m.color}55;color:${m.color};">
          ${dot}
          ${escapeHtml(m.nickname || m.name)}
        </span>`;
      }).join('');

      return `
        <div class="history-entry${isPast ? ' history-entry-past' : ''}">
          <div class="history-entry-date">
            <span class="history-date-num">${startD.getDate()}</span>
            <span class="history-date-wd${isWeekend ? ' weekend' : ''}">${WEEKDAYS[startD.getDay()]}</span>
            ${endD ? `<span class="history-date-end">〜${endD.getDate()}</span>` : ''}
          </div>
          <div class="history-entry-body">
            <div class="history-entry-title" onclick="showLiveDetailsModal('${live.id}')">
              ${escapeHtml(live.name)}
              <span style="margin-left:2px;">${statusBadge}</span>
            </div>
            ${metaParts.length > 0 ? `<div class="history-entry-meta">${metaParts.join(' · ')}</div>` : ''}
            ${goingChips ? `<div class="history-entry-members">${goingChips}</div>` : ''}
            <div class="lives-entry-actions">
              <button class="btn btn-sm btn-secondary edit-live-btn" data-id="${live.id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                編集
              </button>
              <button class="btn btn-sm btn-danger delete-live-btn" data-id="${live.id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                削除
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="history-month-group">
        <div class="history-month-label">${year}年${parseInt(mon)}月</div>
        <div class="history-month-entries">${entries}</div>
      </div>
    `;
  }).join('');

  // メンバーフィルターチップ
  const memberFilterHtml = members.length > 0 ? `
    <div class="history-filter">
      <button class="history-chip${activeFilterMemberIds.size === 0 ? ' history-chip-active' : ''}" data-member="">全員</button>
      ${members.map(m => {
        const isActive = activeFilterMemberIds.has(m.id);
        return `<button class="history-chip${isActive ? ' history-chip-active' : ''}"
          data-member="${m.id}"
          ${isActive ? `style="background:${escapeHtml(m.color)}22;border-color:${escapeHtml(m.color)};color:${escapeHtml(m.color)};"` : ''}>
          <span style="width:8px;height:8px;border-radius:50%;background:${escapeHtml(m.color)};display:inline-block;flex-shrink:0;"></span>
          ${escapeHtml(m.nickname || m.name)}
        </button>`;
      }).join('')}
    </div>
  ` : '';

  const viewToggleHtml = `
    <div class="view-mode-toggle">
      <button class="view-mode-btn${livesViewMode === 'tl' ? ' active' : ''}" data-view="tl" title="タイムライン">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
      <button class="view-mode-btn${livesViewMode === 'calendar' ? ' active' : ''}" data-view="calendar" title="カレンダー">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
    </div>
  `;

  content.innerHTML = `
    <div class="section-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="live-filter-bar">
          <button class="live-filter-btn${livesFilter === 'all' ? ' active' : ''}" data-filter="all">
            全て <span class="filter-count">${lives.length}</span>
          </button>
          <button class="live-filter-btn${livesFilter === 'upcoming' ? ' active' : ''}" data-filter="upcoming">
            予定 <span class="filter-count">${upcoming.length}</span>
          </button>
          <button class="live-filter-btn${livesFilter === 'past' ? ' active' : ''}" data-filter="past">
            終了 <span class="filter-count">${past.length}</span>
          </button>
        </div>
        ${viewToggleHtml}
      </div>
      <div style="display:flex;gap:8px;">
        <button id="add-record-btn" class="btn btn-secondary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          参戦記録を追加
        </button>
        <button id="add-live-btn" class="btn btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ライブを追加
        </button>
      </div>
    </div>

    ${memberFilterHtml}

    ${livesViewMode === 'calendar'
      ? `<div class="card" style="padding:var(--space-md);"><div id="cal-container"></div></div>`
      : filtered.length > 0
        ? `<div class="history-timeline">${timelineHtml}</div>`
        : `<div class="card empty-state">
            <div class="empty-state-icon"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
            <p class="empty-state-text">${activeFilterMemberIds.size > 0 ? '該当するライブがありません' : livesFilter === 'upcoming' ? '予定のライブがありません' : livesFilter === 'past' ? '終了したライブはありません' : 'まだライブが登録されていません'}</p>
            ${livesFilter === 'upcoming' && activeFilterMemberIds.size === 0 ? '<p style="color:var(--text-tertiary);font-size:14px;">「ライブを追加」ボタンから登録しましょう！</p>' : ''}
          </div>`
    }
  `;

  // ステータスフィルターボタン（全て/予定/終了）
  content.querySelectorAll('.live-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      livesFilter = btn.dataset.filter;
      renderLives();
    });
  });

  // ビューモード切替（TL ↔ カレンダー）
  content.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      livesViewMode = btn.dataset.view;
      if (livesViewMode === 'calendar') {
        livesCalendarDate = new Date(); // 今月にリセット
      }
      renderLives();
    });
  });

  // カレンダー描画
  if (livesViewMode === 'calendar') {
    renderLivesCalendar(filtered, members, now, content);
  }

  // メンバーフィルターチップ（複数選択 AND）
  content.querySelectorAll('.history-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const memberId = chip.dataset.member;
      if (!memberId) {
        activeFilterMemberIds.clear();
      } else if (activeFilterMemberIds.has(memberId)) {
        activeFilterMemberIds.delete(memberId);
      } else {
        activeFilterMemberIds.add(memberId);
      }
      renderLives();
    });
  });

  document.getElementById('add-record-btn')?.addEventListener('click', () => openQuickRecordModal(members));
  document.getElementById('add-live-btn')?.addEventListener('click', () => openLiveModal());

  window.showLiveDetailsModal = showLiveDetailsModal;
  window.showMemberDetailsModal = showMemberDetailsModal;

  content.querySelectorAll('.edit-live-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const live = getLives().find(l => l.id === btn.dataset.id);
      if (live) openLiveModal(live);
    });
  });

  content.querySelectorAll('.delete-live-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirm('ライブを削除', 'このライブと関連する参戦記録を削除しますか？\nこの操作は取り消せません。', () => {
        deleteLive(btn.dataset.id);
        showToast('ライブを削除しました', 'success');
        renderLives();
      });
    });
  });
}

// ---- ライブ追加・編集モーダル ----
function openLiveModal(live = null) {
  const isEdit = !!live;
  const title = isEdit ? 'ライブを編集' : 'ライブを追加';

  showModal(title, `
    <form id="live-form">
      <div class="form-group">
        <label class="form-label" for="live-name">ライブ名 <span style="color: var(--accent-red)">*</span></label>
        <input type="text" id="live-name" class="form-input" placeholder="例: SUMMER SONIC 2026" value="${isEdit ? escapeAttr(live.name) : ''}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="live-artist">アーティスト</label>
        <input type="text" id="live-artist" class="form-input" placeholder="例: ONE OK ROCK" value="${isEdit ? escapeAttr(live.artist || '') : ''}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="live-date-start">開始日 <span style="color: var(--accent-red)">*</span></label>
        <input type="date" id="live-date-start" class="form-input" value="${isEdit ? toDateInputValue(live.dateStart || live.date) : ''}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="live-date-end">終了日 <span style="color: var(--text-tertiary); font-size: 12px;">(複数日の場合)</span></label>
        <input type="date" id="live-date-end" class="form-input" value="${isEdit ? toDateInputValue(live.dateEnd) : ''}" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 2;">
          <label class="form-label" for="live-venue">会場</label>
          <input type="text" id="live-venue" class="form-input" placeholder="例: 幕張メッセ" value="${isEdit ? escapeAttr(live.venue || '') : ''}" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label" for="live-pref">都道府県 <span style="color: var(--text-tertiary); font-size: 11px;">（自動検出）</span></label>
          <input type="text" id="live-pref" class="form-input" placeholder="例: 神奈川" value="${isEdit ? escapeAttr(live.prefecture || '') : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="live-memo">メモ</label>
        <textarea id="live-memo" class="form-input" rows="3" placeholder="備考があれば入力">${isEdit ? escapeHtml(live.memo || '') : ''}</textarea>
      </div>
      ${isEdit ? buildAttendanceSection(live) : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-close').click()">キャンセル</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '更新' : '追加'}</button>
      </div>
    </form>
  `);

  if (isEdit) setupAttendanceToggles();

  document.getElementById('live-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const dateStart = document.getElementById('live-date-start').value;
    const dateEnd = document.getElementById('live-date-end').value;

    const data = {
      name: document.getElementById('live-name').value.trim(),
      artist: document.getElementById('live-artist').value.trim(),
      dateStart,
      dateEnd: dateEnd || '',
      venue: document.getElementById('live-venue').value.trim(),
      prefecture: document.getElementById('live-pref').value.trim(),
      memo: document.getElementById('live-memo').value.trim()
    };

    if (!data.name || !data.dateStart) {
      showToast('ライブ名と開始日は必須です', 'error');
      return;
    }
    if (data.dateEnd && data.dateEnd < data.dateStart) {
      showToast('終了日は開始日以降にしてください', 'error');
      return;
    }

    if (isEdit) {
      updateLive(live.id, data);
      showToast('ライブを更新しました', 'success');
    } else {
      addLive(data);
      showToast('ライブを追加しました', 'success');
    }

    closeModal();
    renderLives();
  });
}

// ---- 参戦状況セクション（編集モーダル用）----
function buildAttendanceSection(live) {
  const members = getMembers();
  if (members.length === 0) return '';
  const dates = getDatesForLive(live);
  if (dates.length === 0) return '';

  const isMulti = dates.length > 1;

  function sty(status) {
    if (status === 'going') return { label: '○', color: 'var(--accent-green)', border: 'var(--accent-green)' };
    if (status === 'not-going') return { label: '×', color: 'var(--accent-red)', border: 'var(--accent-red)' };
    return { label: '?', color: 'var(--text-tertiary)', border: 'var(--border-color)' };
  }

  const daysHtml = dates.map(d => {
    const wd = WEEKDAYS[d.date.getDay()];
    const membersHtml = members.map(m => {
      const status = getDayAttendanceStatus(live.id, d.dateStr, m.id);
      const s = sty(status);
      return `
        <button type="button" class="att-toggle-btn"
          data-live-id="${live.id}" data-date="${d.dateStr}" data-member-id="${m.id}" data-status="${status}"
          style="border-color:${s.border};">
          <span class="att-toggle-avatar" style="background:${m.color};">${m.avatar ? `<img src="${m.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />` : escapeHtml(m.name.charAt(0))}</span>
          <span class="att-toggle-label" style="color:${s.color};">${s.label}</span>
          <span class="att-toggle-name">${escapeHtml(m.nickname || m.name)}</span>
        </button>
      `;
    }).join('');

    return isMulti
      ? `<div class="att-day-row">
          <span class="att-day-head">Day${d.dayNum}<br><small>${parseInt(d.dateStr.slice(5, 7))}/${parseInt(d.dateStr.slice(8))}(${wd})</small></span>
          <div class="att-members-row">${membersHtml}</div>
        </div>`
      : `<div class="att-members-row">${membersHtml}</div>`;
  }).join('');

  return `
    <div class="form-group">
      <label class="form-label">参戦状況 <span style="font-size:11px;color:var(--text-tertiary);">タップで切替（?→○→×）</span></label>
      <div class="att-section${isMulti ? ' att-section-multi' : ''}">
        ${daysHtml}
      </div>
    </div>
  `;
}

function setupAttendanceToggles() {
  const cycle = { undecided: 'going', going: 'not-going', 'not-going': 'undecided' };
  const display = {
    going: { label: '○', color: 'var(--accent-green)', border: 'var(--accent-green)' },
    'not-going': { label: '×', color: 'var(--accent-red)', border: 'var(--accent-red)' },
    undecided: { label: '?', color: 'var(--text-tertiary)', border: 'var(--border-color)' }
  };

  document.querySelectorAll('.att-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { liveId, date, memberId } = btn.dataset;
      const next = cycle[btn.dataset.status] || 'going';
      setDayAttendance(liveId, date, memberId, next);
      btn.dataset.status = next;
      const d = display[next];
      btn.querySelector('.att-toggle-label').textContent = d.label;
      btn.querySelector('.att-toggle-label').style.color = d.color;
      btn.style.borderColor = d.border;
    });
  });
}

// ---- 参戦記録を追加（クイックモーダル）----
function openQuickRecordModal(members) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const attendanceMap = new Map();

  function calcDates(startVal, endVal) {
    if (!startVal) return [];
    const result = [];
    const cursor = new Date(startVal);
    const last = endVal ? new Date(endVal) : new Date(startVal);
    cursor.setHours(0, 0, 0, 0);
    last.setHours(0, 0, 0, 0);
    if (cursor > last) return [];
    let dayNum = 1;
    while (cursor <= last) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      result.push({ dateStr: `${y}-${m}-${d}`, dayNum, wd: WEEKDAYS[cursor.getDay()] });
      cursor.setDate(cursor.getDate() + 1);
      dayNum++;
    }
    return result;
  }

  function memberGridHtml(dateStr) {
    const selected = attendanceMap.get(dateStr) || new Set();
    return members.map(m => `
      <button type="button" class="qr-member-btn${selected.has(m.id) ? ' qr-member-btn-selected' : ''}"
        data-member-id="${m.id}" data-date="${dateStr}" style="--qr-color:${m.color};">
        <span class="qr-member-avatar" style="background:${m.color};">${escapeHtml(m.name.charAt(0))}</span>
        <span class="qr-member-name">${escapeHtml(m.nickname || m.name)}</span>
      </button>
    `).join('');
  }

  function renderAttendance() {
    const startVal = document.getElementById('qr-date-start')?.value;
    const endVal = document.getElementById('qr-date-end')?.value;
    const dates = calcDates(startVal, endVal);
    const container = document.getElementById('qr-attendance-container');
    if (!container || !members.length) return;
    const isMulti = dates.length > 1;
    container.innerHTML = `
      <div class="form-group">
        <label class="form-label">${isMulti ? '日程別 参戦メンバー' : '参戦メンバー（複数選択可）'}</label>
        ${dates.map(d => `
          ${isMulti ? `<div class="qr-day-label">Day ${d.dayNum}<span style="font-weight:400;margin-left:4px;">${parseInt(d.dateStr.slice(5,7))}/${parseInt(d.dateStr.slice(8))}(${d.wd})</span></div>` : ''}
          <div class="qr-members-grid" style="${isMulti ? 'margin-bottom:10px;' : ''}">${memberGridHtml(d.dateStr)}</div>
        `).join('')}
      </div>
    `;
    container.querySelectorAll('.qr-member-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const memberId = btn.dataset.memberId;
        const dateStr = btn.dataset.date;
        if (!attendanceMap.has(dateStr)) attendanceMap.set(dateStr, new Set());
        const set = attendanceMap.get(dateStr);
        if (set.has(memberId)) { set.delete(memberId); btn.classList.remove('qr-member-btn-selected'); }
        else { set.add(memberId); btn.classList.add('qr-member-btn-selected'); }
      });
    });
  }

  showModal('参戦記録を追加', `
    <form id="qr-form">
      <div class="form-group">
        <label class="form-label" for="qr-name">ライブ名 <span style="color:var(--accent-red)">*</span></label>
        <input type="text" id="qr-name" class="form-input" placeholder="例: 乃木坂46 32nd Single 握手会" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="qr-artist">アーティスト</label>
        <input type="text" id="qr-artist" class="form-input" placeholder="例: 乃木坂46" />
      </div>
      <div class="form-group">
        <label class="form-label" for="qr-date-start">日付 <span style="color:var(--accent-red)">*</span></label>
        <input type="date" id="qr-date-start" class="form-input" value="${todayStr}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="qr-date-end">終了日 <span style="color:var(--text-tertiary);font-size:12px;">(複数日の場合)</span></label>
        <input type="date" id="qr-date-end" class="form-input" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label class="form-label" for="qr-venue">会場</label>
          <input type="text" id="qr-venue" class="form-input" placeholder="例: 幕張メッセ" />
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label" for="qr-pref">都道府県</label>
          <input type="text" id="qr-pref" class="form-input" placeholder="例: 千葉" />
        </div>
      </div>
      <div id="qr-attendance-container"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-close').click()">キャンセル</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `);

  renderAttendance();
  document.getElementById('qr-date-start')?.addEventListener('change', renderAttendance);
  document.getElementById('qr-date-end')?.addEventListener('change', renderAttendance);
  document.getElementById('qr-venue')?.addEventListener('blur', () => {
    const venue = document.getElementById('qr-venue').value;
    const prefInput = document.getElementById('qr-pref');
    if (venue && !prefInput.value) { const pref = extractPrefecture(venue); if (pref) prefInput.value = pref; }
  });

  document.getElementById('qr-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const dateStart = document.getElementById('qr-date-start').value;
    const dateEnd = document.getElementById('qr-date-end').value;
    if (!document.getElementById('qr-name').value.trim() || !dateStart) {
      showToast('ライブ名と日付は必須です', 'error'); return;
    }
    if (dateEnd && dateEnd < dateStart) { showToast('終了日は開始日以降にしてください', 'error'); return; }
    const newLive = addLive({
      name: document.getElementById('qr-name').value.trim(),
      artist: document.getElementById('qr-artist').value.trim(),
      dateStart, dateEnd: dateEnd || '',
      venue: document.getElementById('qr-venue').value.trim(),
      prefecture: document.getElementById('qr-pref').value.trim(),
      memo: ''
    });
    const dates = calcDates(dateStart, dateEnd);
    let totalGoing = 0;
    dates.forEach(d => {
      (attendanceMap.get(d.dateStr) || new Set()).forEach(memberId => {
        setDayAttendance(newLive.id, d.dateStr, memberId, 'going');
        totalGoing++;
      });
    });
    closeModal();
    showToast(totalGoing > 0 ? '参戦記録を保存しました' : 'ライブを追加しました', 'success');
    livesFilter = 'past'; // 追加後は終了タブへ（過去の記録なら）
    renderLives();
  });
}

// ---- カレンダービュー ----
function renderLivesCalendar(filteredLives, members, now, content) {
  const year = livesCalendarDate.getFullYear();
  const month = livesCalendarDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nowStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  // dateStr → lives マップ
  const dayMap = {};
  filteredLives.forEach(live => {
    getDatesForLive(live).forEach(({ dateStr }) => {
      if (!dayMap[dateStr]) dayMap[dateStr] = [];
      if (!dayMap[dateStr].find(l => l.id === live.id)) dayMap[dateStr].push(live);
    });
  });

  let cells = Array(firstDow).fill('<div class="cal-day cal-day-empty"></div>').join('');
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayLives = dayMap[ds] || [];
    const isToday = ds === nowStr;
    const dow = new Date(year, month, d).getDay();
    const events = dayLives.map(live => {
      const lastD = new Date(live.dateEnd || live.dateStart || live.date);
      lastD.setHours(0,0,0,0);
      const isPast = lastD < now;
      const goingDots = members
        .filter(m => getDayAttendanceStatus(live.id, ds, m.id) === 'going')
        .slice(0, 5)
        .map(m => m.avatar
          ? `<img src="${m.avatar}" style="width:6px;height:6px;border-radius:50%;object-fit:cover;" />`
          : `<span style="width:5px;height:5px;border-radius:50%;background:${m.color};display:inline-block;flex-shrink:0;"></span>`)
        .join('');
      return `<div class="cal-event${isPast ? ' cal-event-past' : ''}" onclick="window.showLiveDetailsModal('${live.id}')" title="${escapeAttr(live.name)}">
        <span class="cal-event-name">${escapeHtml(live.name)}</span>
        ${goingDots ? `<div class="cal-member-dots">${goingDots}</div>` : ''}
      </div>`;
    }).join('');
    cells += `<div class="cal-day${isToday ? ' cal-day-today' : ''}${dayLives.length ? ' cal-day-has-event' : ''}">
      <span class="cal-day-num${(isJapaneseHoliday(ds)||dow===0) ? ' weekend' : dow===6 ? ' saturday' : ''}">${d}</span>
      ${events}
    </div>`;
  }

  const html = `
    <div class="cal-nav">
      <button class="cal-nav-btn" id="cal-prev">‹</button>
      <span class="cal-month-label">${year}年${month+1}月</span>
      <button class="cal-nav-btn" id="cal-next">›</button>
    </div>
    <div class="cal-weekdays">${['日','月','火','水','木','金','土'].map((w,i)=>`<div class="cal-wd${i===0?' weekend':i===6?' saturday':''}">${w}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
  `;

  const container = content.querySelector('#cal-container');
  if (!container) return;
  container.innerHTML = html;
  container.querySelector('#cal-prev')?.addEventListener('click', () => {
    livesCalendarDate = new Date(year, month - 1, 1);
    renderLivesCalendar(filteredLives, members, now, content);
  });
  container.querySelector('#cal-next')?.addEventListener('click', () => {
    livesCalendarDate = new Date(year, month + 1, 1);
    renderLivesCalendar(filteredLives, members, now, content);
  });
}

// ---- Utilities ----
export function extractPrefecture(venue) {
  if (!venue) return '';
  const prefectures = ['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];
  for (const pref of prefectures) {
    if (venue.includes(pref)) return pref;
  }
  const cityMap = {
    '横浜':'神奈川','川崎':'神奈川','相模原':'神奈川','藤沢':'神奈川','横須賀':'神奈川',
    '幕張':'千葉','船橋':'千葉','柏':'千葉',
    'さいたま':'埼玉','浦和':'埼玉','川越':'埼玉',
    '仙台':'宮城',
    '名古屋':'愛知','豊橋':'愛知','豊田':'愛知',
    '札幌':'北海道','旭川':'北海道',
    '神戸':'兵庫','西宮':'兵庫','尼崎':'兵庫','姫路':'兵庫',
    '堺':'大阪','吹田':'大阪','豊中':'大阪',
    '金沢':'石川',
    '静岡':'静岡','浜松':'静岡',
    '宇都宮':'栃木',
    '那覇':'沖縄','宜野湾':'沖縄',
    '広島':'広島','岡山':'岡山','新潟':'新潟','熊本':'熊本','福岡':'福岡','北九州':'福岡',
  };
  for (const [city, pref] of Object.entries(cityMap)) {
    if (venue.includes(city)) return pref;
  }
  return '';
}

export function formatDateRange(live) {
  const start = new Date(live.dateStart || live.date);
  const startStr = `${start.getMonth() + 1}/${start.getDate()}`;
  if (live.dateEnd) {
    const end = new Date(live.dateEnd);
    const endStr = (start.getMonth() === end.getMonth())
      ? `${end.getDate()}`
      : `${end.getMonth() + 1}/${end.getDate()}`;
    return `${startStr}〜${endStr}`;
  }
  return startStr;
}

function toDateInputValue(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
