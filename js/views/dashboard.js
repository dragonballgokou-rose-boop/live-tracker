// ============================================
// Dashboard View
// ============================================
import { getLives, getMembers, getStats, getAttendanceByMember, getDayAttendanceStatus, getDatesForLive } from '../store.js';
import { formatDateRange } from './lives.js';
import { showLiveDetailsModal, showMemberDetailsModal } from './details.js';

export function renderDashboard() {
  const stats = getStats();
  const lives = getLives();
  const members = getMembers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcomingLives = lives
    .filter(l => new Date(l.dateEnd || l.dateStart || l.date) >= now)
    .slice(0, 5);

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <!-- Stats -->
    <div class="stats-grid">
      <a href="#/lives" class="card stat-card" style="--stat-color: var(--accent-purple)">
        <div class="stat-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:5px;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>総ライブ数</div>
        <div class="stat-value">${stats.totalLives}</div>
        <div class="stat-meta">予定: ${stats.upcomingLives} / 終了: ${stats.pastLives}</div>
      </a>
      <a href="#/members" class="card stat-card" style="--stat-color: var(--accent-cyan)">
        <div class="stat-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:5px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>メンバー数</div>
        <div class="stat-value">${stats.totalMembers}</div>
      </a>
      <a href="#/tally" class="card stat-card" style="--stat-color: var(--accent-green)">
        <div class="stat-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:5px;"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>総参戦数</div>
        <div class="stat-value">${stats.totalGoing}</div>
      </a>
      <a href="#/tally" class="card stat-card" style="--stat-color: var(--accent-amber)">
        <div class="stat-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:5px;"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>参戦率</div>
        <div class="stat-value">${stats.attendanceRate}%</div>
      </a>
    </div>

    <!-- Date-based Calendar -->
    ${lives.length > 0 && members.length > 0 ? `
    <div class="upcoming-section">
      <div class="section-header">
        <h2 class="section-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>日付別 参加スケジュール</h2>
        <div class="section-header-controls" style="display: flex; gap: 8px; align-items: center;">
          <button id="cal-prev" class="btn btn-secondary btn-sm">← 前月</button>
          <span id="cal-month-label" style="font-weight: 600; font-size: 14px; min-width: 80px; text-align: center;"></span>
          <button id="cal-next" class="btn btn-secondary btn-sm">翌月 →</button>
        </div>
      </div>
      <div class="card" style="padding: 0; overflow: hidden;">
        <div id="date-schedule" class="date-schedule"></div>
      </div>
    </div>
    ` : ''}

    <!-- Member Ranking -->
    ${members.length > 0 ? `
    <div class="upcoming-section">
      <div class="section-header">
        <h2 class="section-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>メンバー別参戦数</h2>
      </div>
      <div class="card">
        <div class="member-ranking">
          ${getMemberRanking(members, lives)}
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Upcoming Lives -->
    <div class="upcoming-section">
      <div class="section-header">
        <h2 class="section-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>直近のライブ</h2>
        ${upcomingLives.length > 0 ? `<a href="#/lives" class="btn btn-secondary btn-sm">すべて見る →</a>` : ''}
      </div>
      ${upcomingLives.length > 0 ? `
        <div class="live-list">
          ${upcomingLives.map(live => renderLiveCard(live)).join('')}
        </div>
      ` : `
        <div class="card empty-state">
          <div class="empty-state-icon"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
          <p class="empty-state-text">まだライブが登録されていません</p>
          <a href="#/lives" class="btn btn-primary">ライブを追加する</a>
        </div>
      `}
    </div>
  `;

  // Calendar navigation
  if (lives.length > 0 && members.length > 0) {
    let currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    renderDateSchedule(currentMonth, lives, members, now);

    document.getElementById('cal-prev')?.addEventListener('click', () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      renderDateSchedule(currentMonth, lives, members, now);
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      renderDateSchedule(currentMonth, lives, members, now);
    });
  }
}

// ---------- Date-based Schedule ----------

function renderDateSchedule(month, lives, members, now) {
  const container = document.getElementById('date-schedule');
  const label = document.getElementById('cal-month-label');
  if (!container || !label) return;

  const year = month.getFullYear();
  const mon = month.getMonth();
  label.textContent = `${year}年${mon + 1}月`;

  // Build a map: dateStr -> [{live, dayLabel}]
  const dateMap = {};
  lives.forEach(live => {
    const start = new Date(live.dateStart || live.date);
    const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const cursor = new Date(start);
    let dayNum = 1;
    const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    while (cursor <= end) {
      if (cursor.getFullYear() === year && cursor.getMonth() === mon) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        if (!dateMap[key]) dateMap[key] = [];
        dateMap[key].push({
          live,
          dayLabel: totalDays > 1 ? `Day${dayNum}` : null
        });
      }
      cursor.setDate(cursor.getDate() + 1);
      dayNum++;
    }
  });

  // Sort dates
  const sortedDates = Object.keys(dateMap).sort();

  if (sortedDates.length === 0) {
    container.innerHTML = `
            <div style="padding: 32px; text-align: center; color: var(--text-tertiary); font-size: 14px;">
                この月にはライブの予定がありません
            </div>
        `;
    return;
  }

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  container.innerHTML = sortedDates.map(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = weekdays[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = d.getTime() === now.getTime();
    const isPast = d < now;
    const entries = dateMap[dateStr];

    return `
        <div class="date-row ${isToday ? 'date-row-today' : ''} ${isPast ? 'date-row-past' : ''}" >
            <div class="date-row-date">
                <span class="date-row-day">${d.getDate()}</span>
                <span class="date-row-weekday ${isWeekend ? 'weekend' : ''}">${dayOfWeek}</span>
                ${isToday ? '<span class="badge badge-today" style="font-size: 9px; padding: 1px 6px;">TODAY</span>' : ''}
            </div>
            <div class="date-row-events">
                ${entries.map(({ live, dayLabel }) => {
      const goingMembers = members.filter(m => getDayAttendanceStatus(live.id, dateStr, m.id) === 'going');
      return `
                    <div class="date-event">
                        <div class="date-event-info" style="cursor: pointer;" onclick="window.showLiveDetailsModal('${live.id}')">
                            <span class="date-event-name">${escapeHtml(live.name)}${dayLabel ? ` <span class="date-event-day-label">${dayLabel}</span>` : ''}</span>
                            <span class="date-event-meta">${escapeHtml(live.artist || '')} · ${escapeHtml(live.venue || '')}</span>
                        </div>
                        <div class="date-event-members">
                            ${goingMembers.length > 0 ? `
                                <div class="date-member-group going">
                                    ${goingMembers.map(m => `
                                        <span class="date-member-chip going" title="${escapeHtml(m.name)}">
                                            <span class="date-member-dot" style="background: ${m.color};"></span>
                                            ${escapeHtml(m.nickname || m.name)}
                                        </span>
                                    `).join('')}
                                </div>
                            ` : ''}
                            ${goingMembers.length === 0 ? `
                                <span style="font-size: 11px; color: var(--text-tertiary);">参加者なし</span>
                            ` : ''}
                        </div>
                    </div>
                    `;
    }).join('')}
            </div>
        </div>
        `;
  }).join('');
}

// ---------- Member Ranking ----------

function getMemberRanking(members, lives) {
  const ranked = members.map(member => {
    let goingCount = 0;
    lives.forEach(live => {
      const dates = getDatesForLive(live);
      dates.forEach(d => {
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') {
          goingCount++;
        }
      });
    });
    return { ...member, goingCount };
  }).sort((a, b) => b.goingCount - a.goingCount);

  return `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${ranked.map((member, idx) => `
        <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; background: ${idx < 3 ? 'rgba(139, 92, 246, 0.06)' : 'transparent'};">
          <span style="width: 24px; text-align: center; font-weight: 700; color: ${idx === 0 ? 'var(--accent-amber)' : idx === 1 ? 'var(--text-secondary)' : idx === 2 ? '#CD7F32' : 'var(--text-tertiary)'}; font-size: 14px;">
            ${idx + 1}
          </span>
          <div class="member-avatar" style="background: ${member.color}; width: 32px; height: 32px; font-size: 14px; cursor: pointer;" onclick="showMemberDetailsModal('${member.id}')">
            ${member.name.charAt(0)}
          </div>
          <span style="flex: 1; font-weight: 500; font-size: 14px; cursor: pointer; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.2);" onclick="showMemberDetailsModal('${member.id}')">${escapeHtml(member.name)}</span>
          <span style="font-weight: 700; color: var(--accent-purple-light); font-size: 14px;">${member.goingCount}</span>
          <span style="color: var(--text-tertiary); font-size: 12px;">参戦</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ---------- Live Card ----------

function renderLiveCard(live) {
  const startDate = new Date(live.dateStart || live.date);
  const endDate = live.dateEnd ? new Date(live.dateEnd) : null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const sDate = new Date(live.dateStart || live.date);
  sDate.setHours(0, 0, 0, 0);
  const eDate = endDate ? new Date(live.dateEnd) : sDate;
  eDate.setHours(0, 0, 0, 0);

  let badgeClass = 'badge-upcoming';
  let badgeText = '予定';
  if (sDate.getTime() <= now.getTime() && eDate.getTime() >= now.getTime()) {
    badgeClass = 'badge-today';
    badgeText = sDate.getTime() === now.getTime() && eDate.getTime() === now.getTime() ? '今日！' : '開催中！';
  } else if (eDate < now) {
    badgeClass = 'badge-past';
    badgeText = '終了';
  }

  return `
    <div class="card live-card" style="cursor: pointer;" onclick="showLiveDetailsModal('${live.id}')">
      <div class="live-date-badge">
        <span class="month">${months[startDate.getMonth()]}</span>
        <span class="day">${startDate.getDate()}</span>
        ${endDate ? `<span style="font-size: 9px; color: rgba(255,255,255,0.7); margin-top: 2px;">〜${endDate.getMonth() + 1}/${endDate.getDate()}</span>` : ''}
      </div>
      <div class="live-info">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;min-width:0;">
          <div class="live-name" style="text-decoration:underline;text-decoration-color:rgba(255,255,255,0.2);flex:1;min-width:0;">${escapeHtml(live.name)}</div>
          <span class="badge ${badgeClass}" style="flex-shrink:0;">${badgeText}</span>
        </div>
        <div class="live-meta">
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>${escapeHtml(live.artist || '未設定')}</span>
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml(live.venue || '未設定')}</span>
          <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${formatDateRange(live)}</span>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
