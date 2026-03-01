// ============================================
// Tally View (集計表) - 日程別参戦対応
// ============================================
import { getLives, getMembers, getDatesForLive, setDayAttendance, getDayAttendanceStatus } from '../store.js';
import { showToast } from '../utils.js';
import { formatDateRange, extractPrefecture } from './lives.js';

export function renderTally() {
  const content = document.getElementById('page-content');
  const lives = getLives();
  const members = getMembers();

  if (lives.length === 0 || members.length === 0) {
    content.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg></div>
        <p class="empty-state-text">
          ${lives.length === 0 ? 'ライブを追加してください' : 'メンバーを追加してください'}
        </p>
        <a href="#/${lives.length === 0 ? 'lives' : 'members'}" class="btn btn-primary">
          ${lives.length === 0 ? 'ライブを追加' : 'メンバーを追加'}
        </a>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <!-- Filter -->
    <div class="tally-filter-bar">
      <input type="text" id="tally-filter-live" class="form-input" placeholder="ライブ名を検索" />
      <input type="month" id="tally-filter-month" class="form-input" />
      <button id="tally-filter-clear" class="btn btn-secondary btn-sm">クリア</button>
    </div>

    <!-- Legend -->
    <div class="tally-legend">
      <span class="tally-legend-item">
        <span class="tally-cell tally-cell-sm" data-status="going">◯</span>
        参戦
      </span>
      <span class="tally-legend-item">
        <span class="tally-cell tally-cell-sm" data-status="not_going">✕</span>
        不参戦
      </span>
      <span class="tally-legend-item">
        <span class="tally-cell tally-cell-sm" data-status="undecided">？</span>
        未定
      </span>
      <span class="tally-legend-hint">※ セルをタップで切り替え</span>
    </div>

    <!-- Table (desktop) -->
    <div class="tally-table-container" id="tally-table-container">
      ${buildTallyTable(lives, members)}
    </div>

    <!-- Cards (mobile) -->
    <div class="tally-cards-container" id="tally-cards-container">
      ${buildTallyCards(lives, members)}
    </div>
  `;

  setupTallyEvents(members);
}

// ---- Desktop: Table layout ----

function buildTallyTable(lives, members) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const rows = [];
  lives.forEach(live => {
    const dates = getDatesForLive(live);
    const isMultiDay = dates.length > 1;

    dates.forEach(({ dateStr, dayNum, date }) => {
      rows.push({
        live,
        dateStr,
        dayNum,
        date,
        isMultiDay,
        totalDays: dates.length,
        isFirstDay: dayNum === 1,
        isLastDay: dayNum === dates.length
      });
    });
  });

  const colTotals = {};
  members.forEach(m => { colTotals[m.id] = 0; });
  let grandTotal = 0;

  rows.forEach(row => {
    members.forEach(member => {
      const status = getDayAttendanceStatus(row.live.id, row.dateStr, member.id);
      if (status === 'going') {
        colTotals[member.id]++;
        grandTotal++;
      }
    });
  });

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  return `
    <table class="tally-table">
      <thead>
        <tr>
          <th>ライブ / 日程</th>
          ${members.map(m => `
            <th style="text-align: center;">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer;" onclick="showMemberDetailsModal('${m.id}')" title="メンバー詳細を見る">
                <div class="member-avatar" style="background: ${m.color}; width: 28px; height: 28px; font-size: 11px; line-height: 28px;">
                  ${m.name.charAt(0)}
                </div>
                <span style="font-size: 11px; max-width: 60px; overflow: hidden; text-overflow: ellipsis; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.2);">${escapeHtml(m.nickname || m.name)}</span>
              </div>
            </th>
          `).join('')}
          <th style="text-align: center;">合計</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => {
    const d = row.date;
    const dayOfWeek = weekdays[d.getDay()];
    const isPast = d < now;
    const pref = row.live.prefecture || (row.live.venue ? extractPrefecture(row.live.venue) : '');
    let rowTotal = 0;

    const cells = members.map(member => {
      const status = getDayAttendanceStatus(row.live.id, row.dateStr, member.id);
      if (status === 'going') rowTotal++;
      const display = status === 'going' ? '◯' : status === 'not_going' ? '✕' : '？';
      return `
              <td>
                <span class="tally-cell" data-status="${status}" data-live="${row.live.id}" data-date="${row.dateStr}" data-member="${member.id}" role="button" tabindex="0">
                  ${display}
                </span>
              </td>
            `;
    }).join('');

    let label;
    if (row.isMultiDay) {
      if (row.isFirstDay) {
        label = `
                <div style="display: flex; flex-direction: column; gap: 2px; cursor: pointer;" onclick="showLiveDetailsModal('${row.live.id}')" title="ライブ詳細を見る">
                  <span style="font-weight: 600; font-size: 13px; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.2);">${escapeHtml(row.live.name)}</span>
                  <span style="font-size: 11px; color: var(--text-tertiary);">
                    ${escapeHtml(row.live.artist || '')} · ${formatDateRange(row.live)}
                  </span>
                  <span style="font-size: 11px; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(row.live.venue || '会場未定')}${pref ? `（${pref}）` : ''}
                    ${isPast ? '<span class="badge badge-past" style="font-size: 10px;">終了</span>' : ''}
                  </span>
                  <span class="day-label" style="margin-top: 4px;">
                    <span class="day-label-tag">Day${row.dayNum}</span>
                    ${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})
                  </span>
                </div>`;
      } else {
        label = `
                <div class="day-sub-row">
                  <span class="day-label">
                    <span class="day-label-tag">Day${row.dayNum}</span>
                    ${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})
                  </span>
                </div>`;
      }
    } else {
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})`;
      label = `
                <div style="display: flex; flex-direction: column; gap: 2px; cursor: pointer;" onclick="showLiveDetailsModal('${row.live.id}')" title="ライブ詳細を見る">
                  <span style="font-weight: 600; font-size: 13px; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.2);">${escapeHtml(row.live.name)}</span>
                  <span style="font-size: 11px; color: var(--text-tertiary);">
                    ${dateStr} · ${escapeHtml(row.live.artist || '')}
                  </span>
                  <span style="font-size: 11px; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(row.live.venue || '会場未定')}${pref ? `（${pref}）` : ''}
                    ${isPast ? '<span class="badge badge-past" style="font-size: 10px;">終了</span>' : ''}
                  </span>
                </div>`;
    }

    const rowClasses = [
      isPast ? 'tally-row-past' : '',
      row.isMultiDay && row.isFirstDay ? 'tally-row-group-start' : '',
      row.isMultiDay && !row.isFirstDay ? 'tally-row-day-sub' : '',
      row.isMultiDay && row.isLastDay ? 'tally-row-group-end' : ''
    ].filter(Boolean).join(' ');

    return `
            <tr class="${rowClasses}" data-live-name="${escapeAttr(row.live.name || '')}" data-date="${row.dateStr}">
              <td>
                ${label}
              </td>
              ${cells}
              <td class="row-total">${rowTotal}</td>
            </tr>
          `;
  }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td class="col-total" style="font-weight: 700;">合計</td>
          ${members.map(m => `
            <td class="col-total">${colTotals[m.id]}</td>
          `).join('')}
          <td class="col-total" style="background: rgba(139, 92, 246, 0.12);">${grandTotal}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

// ---- Mobile: Card layout ----

function buildTallyCards(lives, members) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const rows = [];
  lives.forEach(live => {
    const dates = getDatesForLive(live);
    const isMultiDay = dates.length > 1;
    dates.forEach(({ dateStr, dayNum, date }) => {
      rows.push({ live, dateStr, dayNum, date, isMultiDay });
    });
  });

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  return rows.map(row => {
    const d = row.date;
    const dayOfWeek = weekdays[d.getDay()];
    const isPast = d < now;
    let rowTotal = 0;

    const memberData = members.map(member => ({
      member,
      status: getDayAttendanceStatus(row.live.id, row.dateStr, member.id)
    }));
    memberData.forEach(({ status }) => { if (status === 'going') rowTotal++; });
    const statusOrder = { going: 0, undecided: 1, not_going: 2 };
    memberData.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const memberBtns = memberData.map(({ member, status }) => {
      const display = status === 'going' ? '◯' : status === 'not_going' ? '✕' : '？';
      return `
        <button class="tally-card-member"
          data-status="${status}"
          data-live="${row.live.id}"
          data-date="${row.dateStr}"
          data-member="${member.id}"
          title="${escapeAttr(member.name)}">
          <div class="tally-card-avatar-wrap">
            <div class="tally-card-avatar" style="background: ${member.color}">${member.name.charAt(0)}</div>
            <span class="tally-card-status-dot" data-status="${status}">${display}</span>
          </div>
          <span class="tally-card-member-name">${escapeHtml(member.nickname || member.name)}</span>
        </button>
      `;
    }).join('');

    const dateLine = `${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})`;
    const dayBadge = row.isMultiDay ? `<span class="tally-card-day-badge">Day${row.dayNum}</span>` : '';
    const pref = row.live.prefecture || (row.live.venue ? extractPrefecture(row.live.venue) : '');
    const isToday = d.getTime() === now.getTime();
    const statusBadge = isPast
      ? '<span class="badge badge-past" style="font-size:10px;flex-shrink:0;">終了</span>'
      : isToday
      ? '<span class="badge badge-today" style="font-size:10px;flex-shrink:0;">今日！</span>'
      : '<span class="badge badge-upcoming" style="font-size:10px;flex-shrink:0;">予定</span>';
    const venuePart = row.live.venue
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:-1px;margin-right:2px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(row.live.venue)}${pref ? `（${pref}）` : ''}`
      : (pref ? `（${pref}）` : '');

    return `
      <div class="tally-card ${isPast ? 'tally-card-past' : ''}"
        data-live-name="${escapeAttr(row.live.name)}"
        data-date="${row.dateStr}">
        <div class="tally-card-header" onclick="showLiveDetailsModal('${row.live.id}')">
          <div class="tally-card-title-wrap">
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;min-width:0;">
              <span class="tally-card-name" style="margin-bottom:0;">${escapeHtml(row.live.name)}${dayBadge}</span>
              ${statusBadge}
            </div>
            ${venuePart ? `<div class="tally-card-date">${venuePart}</div>` : ''}
            <div class="tally-card-date" style="margin-top:1px;">${dateLine}</div>
          </div>
          <div class="tally-card-total-wrap">
            <span class="tally-card-total">${rowTotal}</span>
            <span class="tally-card-total-label">人</span>
          </div>
        </div>
        <div class="tally-card-members">${memberBtns}</div>
      </div>
    `;
  }).join('');
}

// ---- Events ----

function setupTallyEvents(members) {
  // Table cell clicks
  const tableContainer = document.getElementById('tally-table-container');
  if (tableContainer) {
    tableContainer.addEventListener('click', (e) => {
      const cell = e.target.closest('.tally-cell');
      if (!cell) return;

      const liveId = cell.dataset.live;
      const dateStr = cell.dataset.date;
      const memberId = cell.dataset.member;
      const currentStatus = cell.dataset.status;

      const nextStatus = { 'undecided': 'going', 'going': 'not_going', 'not_going': 'undecided' }[currentStatus];
      const display = { 'going': '◯', 'not_going': '✕', 'undecided': '？' }[nextStatus];

      setDayAttendance(liveId, dateStr, memberId, nextStatus);
      cell.dataset.status = nextStatus;
      cell.textContent = display;

      cell.style.transform = 'scale(1.3)';
      setTimeout(() => { cell.style.transform = ''; }, 150);

      updateTotals(members);
    });
  }

  // Card member button clicks
  const cardsContainer = document.getElementById('tally-cards-container');
  if (cardsContainer) {
    cardsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tally-card-member');
      if (!btn) return;

      const liveId = btn.dataset.live;
      const dateStr = btn.dataset.date;
      const memberId = btn.dataset.member;
      const currentStatus = btn.dataset.status;

      const nextStatus = { 'undecided': 'going', 'going': 'not_going', 'not_going': 'undecided' }[currentStatus];
      const display = { 'going': '◯', 'not_going': '✕', 'undecided': '？' }[nextStatus];

      setDayAttendance(liveId, dateStr, memberId, nextStatus);
      btn.dataset.status = nextStatus;

      const dot = btn.querySelector('.tally-card-status-dot');
      if (dot) {
        dot.dataset.status = nextStatus;
        dot.textContent = display;
      }

      // Update card total
      const card = btn.closest('.tally-card');
      if (card) {
        const total = card.querySelectorAll('.tally-card-member[data-status="going"]').length;
        const totalEl = card.querySelector('.tally-card-total');
        if (totalEl) totalEl.textContent = total;
      }

      btn.style.transform = 'scale(1.2)';
      setTimeout(() => { btn.style.transform = ''; }, 150);
    });
  }

  // Filter events
  const filterLive = document.getElementById('tally-filter-live');
  const filterMonth = document.getElementById('tally-filter-month');
  const filterClear = document.getElementById('tally-filter-clear');

  filterLive.addEventListener('input', () => applyFilters());
  filterMonth.addEventListener('change', () => applyFilters());
  filterClear.addEventListener('click', () => {
    filterLive.value = '';
    filterMonth.value = '';
    applyFilters();
  });
}

function applyFilters() {
  const liveQuery = document.getElementById('tally-filter-live').value.toLowerCase();
  const monthQuery = document.getElementById('tally-filter-month').value;

  // Filter table rows
  document.querySelectorAll('.tally-table tbody tr').forEach(row => {
    const liveName = (row.dataset.liveName || '').toLowerCase();
    const date = row.dataset.date || '';
    let visible = true;
    if (liveQuery && !liveName.includes(liveQuery)) visible = false;
    if (monthQuery && !date.startsWith(monthQuery)) visible = false;
    row.style.display = visible ? '' : 'none';
  });

  // Filter cards
  document.querySelectorAll('.tally-card').forEach(card => {
    const liveName = (card.dataset.liveName || '').toLowerCase();
    const date = card.dataset.date || '';
    let visible = true;
    if (liveQuery && !liveName.includes(liveQuery)) visible = false;
    if (monthQuery && !date.startsWith(monthQuery)) visible = false;
    card.style.display = visible ? '' : 'none';
  });
}

function updateTotals(members) {
  const colTotals = {};
  members.forEach(m => { colTotals[m.id] = 0; });
  let grandTotal = 0;

  const rows = document.querySelectorAll('.tally-table tbody tr');
  rows.forEach(row => {
    let rowTotal = 0;
    const cells = row.querySelectorAll('.tally-cell');
    cells.forEach((cell, cIdx) => {
      if (cell.dataset.status === 'going') {
        rowTotal++;
        if (members[cIdx]) colTotals[members[cIdx].id]++;
        grandTotal++;
      }
    });
    const rowTotalCell = row.querySelector('.row-total');
    if (rowTotalCell) rowTotalCell.textContent = rowTotal;
  });

  const footCells = document.querySelectorAll('.tally-table tfoot .col-total');
  members.forEach((m, idx) => {
    if (footCells[idx + 1]) footCells[idx + 1].textContent = colTotals[m.id];
  });
  if (footCells[members.length + 1]) {
    footCells[members.length + 1].textContent = grandTotal;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
