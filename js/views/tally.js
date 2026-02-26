// ============================================
// Tally View (集計表) - 日程別参戦対応
// ============================================
import { getLives, getMembers, getDatesForLive, setDayAttendance, getDayAttendanceStatus } from '../store.js';
import { showToast } from '../utils.js';
import { formatDateRange } from './lives.js';

export function renderTally() {
  const content = document.getElementById('page-content');
  const lives = getLives();
  const members = getMembers();

  if (lives.length === 0 || members.length === 0) {
    content.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon">📊</div>
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
    <div class="filter-bar">
      <input type="text" id="tally-filter-artist" class="form-input" placeholder="🔍 アーティストで絞り込み" />
      <input type="month" id="tally-filter-month" class="form-input" placeholder="月で絞り込み" />
      <button id="tally-filter-clear" class="btn btn-secondary btn-sm">クリア</button>
    </div>

    <!-- Legend -->
    <div style="display: flex; gap: 20px; margin-bottom: 16px; font-size: 13px; color: var(--text-secondary);">
      <span>
        <span class="tally-cell" data-status="going" style="width: 24px; height: 24px; font-size: 12px; display: inline-flex; vertical-align: middle;">◯</span>
        参戦
      </span>
      <span>
        <span class="tally-cell" data-status="not_going" style="width: 24px; height: 24px; font-size: 12px; display: inline-flex; vertical-align: middle;">✕</span>
        不参戦
      </span>
      <span>
        <span class="tally-cell" data-status="undecided" style="width: 24px; height: 24px; font-size: 12px; display: inline-flex; vertical-align: middle;">？</span>
        未定
      </span>
      <span style="margin-left: auto; font-size: 12px; color: var(--text-tertiary);">
        ※ セルをクリックで切り替え
      </span>
    </div>

    <!-- Table -->
    <div class="tally-table-container" id="tally-table-container">
      ${buildTallyTable(lives, members)}
    </div>
  `;

  // Event listeners
  setupTallyEvents(members);
}

function buildTallyTable(lives, members) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Build rows: each row is a (live, date) pair
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

  // Calculate column totals (going count per member across all date-rows)
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
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isPast = d < now;
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

    // Build the row label
    let label;
    if (row.isMultiDay) {
      if (row.isFirstDay) {
        // First day: show live name + day info + venue
        label = `
                <div style="display: flex; flex-direction: column; gap: 2px; cursor: pointer;" onclick="showLiveDetailsModal('${row.live.id}')" title="ライブ詳細を見る">
                  <span style="font-weight: 600; font-size: 13px; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.2);">${escapeHtml(row.live.name)}</span>
                  <span style="font-size: 11px; color: var(--text-tertiary);">
                    ${escapeHtml(row.live.artist || '')} · ${formatDateRange(row.live)}
                  </span>
                  <span style="font-size: 11px; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px;">
                    📍 ${escapeHtml(row.live.venue || '会場未定')}
                    ${isPast ? '<span class="badge badge-past" style="font-size: 10px;">終了</span>' : ''}
                  </span>
                  <span class="day-label" style="margin-top: 4px;">
                    <span class="day-label-tag">Day${row.dayNum}</span>
                    ${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})
                  </span>
                </div>`;
      } else {
        // Subsequent days: show only day info (indented)
        label = `
                <div class="day-sub-row">
                  <span class="day-label">
                    <span class="day-label-tag">Day${row.dayNum}</span>
                    ${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})
                  </span>
                </div>`;
      }
    } else {
      // Single-day live -> Show date, artist, venue
      const dateStr = `${d.getMonth() + 1}/${d.getDate()}(${dayOfWeek})`;
      label = `
                <div style="display: flex; flex-direction: column; gap: 2px; cursor: pointer;" onclick="showLiveDetailsModal('${row.live.id}')" title="ライブ詳細を見る">
                  <span style="font-weight: 600; font-size: 13px; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.2);">${escapeHtml(row.live.name)}</span>
                  <span style="font-size: 11px; color: var(--text-tertiary);">
                    ${dateStr} · ${escapeHtml(row.live.artist || '')}
                  </span>
                  <span style="font-size: 11px; color: var(--text-tertiary); display: flex; align-items: center; gap: 4px;">
                    📍 ${escapeHtml(row.live.venue || '会場未定')}
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
            <tr class="${rowClasses}" data-artist="${escapeAttr(row.live.artist || '')}" data-date="${row.dateStr}">
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

function setupTallyEvents(members) {
  const container = document.getElementById('tally-table-container');

  // Cell click - toggle status (now with date key)
  container.addEventListener('click', (e) => {
    const cell = e.target.closest('.tally-cell');
    if (!cell) return;

    const liveId = cell.dataset.live;
    const dateStr = cell.dataset.date;
    const memberId = cell.dataset.member;
    const currentStatus = cell.dataset.status;

    // Cycle: undecided → going → not_going → undecided
    const nextStatus = {
      'undecided': 'going',
      'going': 'not_going',
      'not_going': 'undecided'
    }[currentStatus];

    const display = { 'going': '◯', 'not_going': '✕', 'undecided': '？' }[nextStatus];

    setDayAttendance(liveId, dateStr, memberId, nextStatus);

    cell.dataset.status = nextStatus;
    cell.textContent = display;

    // Add animation
    cell.style.transform = 'scale(1.3)';
    setTimeout(() => { cell.style.transform = ''; }, 150);

    // Update totals
    updateTotals(members);
  });

  // Filter events
  const filterArtist = document.getElementById('tally-filter-artist');
  const filterMonth = document.getElementById('tally-filter-month');
  const filterClear = document.getElementById('tally-filter-clear');

  filterArtist.addEventListener('input', () => applyFilters());
  filterMonth.addEventListener('change', () => applyFilters());
  filterClear.addEventListener('click', () => {
    filterArtist.value = '';
    filterMonth.value = '';
    applyFilters();
  });
}

function applyFilters() {
  const artistQuery = document.getElementById('tally-filter-artist').value.toLowerCase();
  const monthQuery = document.getElementById('tally-filter-month').value;

  const rows = document.querySelectorAll('.tally-table tbody tr');
  rows.forEach(row => {
    const artist = (row.dataset.artist || '').toLowerCase();
    const date = row.dataset.date || '';

    let visible = true;
    if (artistQuery && !artist.includes(artistQuery)) visible = false;
    if (monthQuery && !date.startsWith(monthQuery)) visible = false;

    row.style.display = visible ? '' : 'none';
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
