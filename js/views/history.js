// ============================================
// History View - 参戦記録一覧
// ============================================
import { getLives, getMembers, getDayAttendanceStatus, getDatesForLive, addLive, setDayAttendance } from '../store.js';
import { showModal, closeModal, showToast } from '../utils.js';
import { showLiveDetailsModal, showMemberDetailsModal } from './details.js';
import { extractPrefecture } from './lives.js';

let activeFilterMemberId = null;

export function renderHistory() {
  const members = getMembers();
  const lives = getLives();
  const content = document.getElementById('page-content');

  // 各ライブの参戦メンバーを計算
  const livesWithGoing = lives.map(live => {
    const goingIds = new Set();
    getDatesForLive(live).forEach(d => {
      members.forEach(m => {
        if (getDayAttendanceStatus(live.id, d.dateStr, m.id) === 'going') goingIds.add(m.id);
      });
    });
    return { ...live, goingIds: [...goingIds] };
  }).sort((a, b) => new Date(b.dateStart || b.date) - new Date(a.dateStart || a.date));

  // メンバーフィルター適用後のリスト
  const filtered = activeFilterMemberId
    ? livesWithGoing.filter(l => l.goingIds.includes(activeFilterMemberId))
    : livesWithGoing.filter(l => l.goingIds.length > 0);

  // 年月グループ
  const groups = {};
  filtered.forEach(live => {
    const d = new Date(live.dateStart || live.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(live);
  });
  const sortedKeys = Object.keys(groups).sort().reverse();

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  // ---- HTML生成 ----

  const filterHtml = members.length > 0 ? `
    <div class="history-filter">
      <button class="history-chip ${!activeFilterMemberId ? 'history-chip-active' : ''}" data-member="">全員</button>
      ${members.map(m => `
        <button class="history-chip ${activeFilterMemberId === m.id ? 'history-chip-active' : ''}"
          data-member="${m.id}"
          ${activeFilterMemberId === m.id ? `style="background:${escHtml(m.color)}22;border-color:${escHtml(m.color)};color:${escHtml(m.color)};"` : ''}>
          <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(m.color)};display:inline-block;flex-shrink:0;"></span>
          ${escHtml(m.nickname || m.name)}
        </button>
      `).join('')}
    </div>
  ` : '';

  const timelineHtml = sortedKeys.map(key => {
    const [year, mon] = key.split('-');
    const entries = groups[key].map(live => {
      const startD = new Date(live.dateStart || live.date);
      startD.setHours(0, 0, 0, 0);
      const endD = live.dateEnd ? new Date(live.dateEnd) : null;
      if (endD) endD.setHours(0, 0, 0, 0);
      const isPast = (endD || startD) < now;
      const isOngoing = startD <= now && (!endD || endD >= now);
      const isWeekend = startD.getDay() === 0 || startD.getDay() === 6;
      const endLabel = endD ? `〜${endD.getDate()}` : '';

      const metaParts = [];
      if (live.artist) metaParts.push(escHtml(live.artist));
      if (live.venue) {
        const pref = live.prefecture || extractPrefecture(live.venue);
        metaParts.push(pref ? `${escHtml(live.venue)}（${pref}）` : escHtml(live.venue));
      }

      const goingChips = live.goingIds.map(id => {
        const m = members.find(x => x.id === id);
        if (!m) return '';
        return `
          <span class="history-member-chip" onclick="showMemberDetailsModal('${m.id}')"
            style="background:${m.color}20;border-color:${m.color}55;color:${m.color};">
            <span style="width:7px;height:7px;border-radius:50%;background:${m.color};display:inline-block;flex-shrink:0;"></span>
            ${escHtml(m.nickname || m.name)}
          </span>`;
      }).join('');

      const statusBadge = isOngoing
        ? `<span class="badge badge-today" style="font-size:10px;padding:1px 8px;">開催中</span>`
        : !isPast
          ? `<span class="badge badge-upcoming" style="font-size:10px;padding:1px 8px;">予定</span>`
          : '';

      return `
        <div class="history-entry${isPast ? ' history-entry-past' : ''}">
          <div class="history-entry-date">
            <span class="history-date-num">${startD.getDate()}${endLabel}</span>
            <span class="history-date-wd${isWeekend ? ' weekend' : ''}">${weekdays[startD.getDay()]}</span>
          </div>
          <div class="history-entry-body">
            <div class="history-entry-title" onclick="showLiveDetailsModal('${live.id}')">
              ${escHtml(live.name)}${statusBadge ? `<span style="margin-left:4px;">${statusBadge}</span>` : ''}
            </div>
            ${metaParts.length > 0 ? `<div class="history-entry-meta">${metaParts.join(' · ')}</div>` : ''}
            <div class="history-entry-members">
              ${goingChips || '<span style="font-size:11px;color:var(--text-tertiary);">参戦者未設定</span>'}
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

  const totalGoing = livesWithGoing.filter(l => l.goingIds.length > 0).length;

  content.innerHTML = `
    <div class="section-header">
      <span style="color:var(--text-secondary);font-size:14px;">参戦済み ${totalGoing}件 / 全${lives.length}件</span>
      <button id="add-record-btn" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        参戦記録を追加
      </button>
    </div>

    ${filterHtml}

    ${filtered.length === 0 ? `
      <div class="card empty-state">
        <div class="empty-state-icon">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <p class="empty-state-text">${activeFilterMemberId ? 'このメンバーの参戦記録がありません' : 'まだ参戦記録がありません'}</p>
        <button id="add-record-btn-2" class="btn btn-primary">参戦記録を追加する</button>
      </div>
    ` : `<div class="history-timeline">${timelineHtml}</div>`}
  `;

  document.getElementById('add-record-btn')?.addEventListener('click', () => openQuickRecordModal(members));
  document.getElementById('add-record-btn-2')?.addEventListener('click', () => openQuickRecordModal(members));

  content.querySelectorAll('.history-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilterMemberId = chip.dataset.member || null;
      renderHistory();
    });
  });

  window.showLiveDetailsModal = showLiveDetailsModal;
  window.showMemberDetailsModal = showMemberDetailsModal;
}

// ---- クイック参戦記録モーダル ----
function openQuickRecordModal(members) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // dateStr -> Set<memberId>
  const attendanceMap = new Map();
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
      result.push({ dateStr: `${y}-${m}-${d}`, dayNum, wd: WEEKDAYS[cursor.getDay()], isWeekend: cursor.getDay() === 0 || cursor.getDay() === 6 });
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
        <span class="qr-member-avatar" style="background:${m.color};">${escHtml(m.name.charAt(0))}</span>
        <span class="qr-member-name">${escHtml(m.nickname || m.name)}</span>
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
          ${isMulti ? `
            <div class="qr-day-label">
              Day ${d.dayNum}
              <span style="font-weight:400;margin-left:4px;">${parseInt(d.dateStr.slice(5, 7))}/${parseInt(d.dateStr.slice(8))}(${d.wd})</span>
            </div>` : ''}
          <div class="qr-members-grid" style="${isMulti ? 'margin-bottom:10px;' : ''}">
            ${memberGridHtml(d.dateStr)}
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.qr-member-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const memberId = btn.dataset.memberId;
        const dateStr = btn.dataset.date;
        if (!attendanceMap.has(dateStr)) attendanceMap.set(dateStr, new Set());
        const set = attendanceMap.get(dateStr);
        if (set.has(memberId)) {
          set.delete(memberId);
          btn.classList.remove('qr-member-btn-selected');
        } else {
          set.add(memberId);
          btn.classList.add('qr-member-btn-selected');
        }
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

  // 初回レンダリング
  renderAttendance();

  // 日付変更時に参戦グリッドを更新
  document.getElementById('qr-date-start')?.addEventListener('change', renderAttendance);
  document.getElementById('qr-date-end')?.addEventListener('change', renderAttendance);

  // 会場入力で都道府県を自動補完
  document.getElementById('qr-venue')?.addEventListener('blur', () => {
    const venue = document.getElementById('qr-venue').value;
    const prefInput = document.getElementById('qr-pref');
    if (venue && !prefInput.value) {
      const pref = extractPrefecture(venue);
      if (pref) prefInput.value = pref;
    }
  });

  document.getElementById('qr-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const dateStart = document.getElementById('qr-date-start').value;
    const dateEnd = document.getElementById('qr-date-end').value;

    if (!document.getElementById('qr-name').value.trim() || !dateStart) {
      showToast('ライブ名と日付は必須です', 'error');
      return;
    }
    if (dateEnd && dateEnd < dateStart) {
      showToast('終了日は開始日以降にしてください', 'error');
      return;
    }

    const newLive = addLive({
      name: document.getElementById('qr-name').value.trim(),
      artist: document.getElementById('qr-artist').value.trim(),
      dateStart,
      dateEnd: dateEnd || '',
      venue: document.getElementById('qr-venue').value.trim(),
      prefecture: document.getElementById('qr-pref').value.trim(),
      memo: ''
    });

    // 日程別に参戦を設定
    const dates = calcDates(dateStart, dateEnd);
    let totalGoing = 0;
    dates.forEach(d => {
      const selected = attendanceMap.get(d.dateStr) || new Set();
      selected.forEach(memberId => {
        setDayAttendance(newLive.id, d.dateStr, memberId, 'going');
        totalGoing++;
      });
    });

    closeModal();
    showToast(totalGoing > 0 ? `参戦記録を保存しました` : 'ライブを追加しました', 'success');
    renderHistory();
  });
}

function escHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
