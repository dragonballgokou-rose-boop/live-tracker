// ============================================
// Dashboard View
// ============================================
import { getLives, getMembers, getStats, getAttendanceByMember, getDayAttendanceStatus, getDatesForLive } from '../store.js';
import { formatDateRange } from './lives.js';

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
      <div class="card stat-card" style="--stat-color: var(--accent-purple)">
        <div class="stat-label">🎵 総ライブ数</div>
        <div class="stat-value">${stats.totalLives}</div>
        <div class="stat-meta">予定: ${stats.upcomingLives} / 終了: ${stats.pastLives}</div>
      </div>
      <div class="card stat-card" style="--stat-color: var(--accent-cyan)">
        <div class="stat-label">👥 メンバー数</div>
        <div class="stat-value">${stats.totalMembers}</div>
      </div>
      <div class="card stat-card" style="--stat-color: var(--accent-green)">
        <div class="stat-label">🎫 総参戦数</div>
        <div class="stat-value">${stats.totalGoing}</div>
      </div>
      <div class="card stat-card" style="--stat-color: var(--accent-amber)">
        <div class="stat-label">📊 参戦率</div>
        <div class="stat-value">${stats.attendanceRate}%</div>
      </div>
    </div>

    <!-- Date-based Calendar -->
    ${lives.length > 0 && members.length > 0 ? `
    <div class="upcoming-section">
      <div class="section-header">
        <h2 class="section-title">📅 日付別 参加スケジュール</h2>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button id="cal-prev" class="btn btn-secondary btn-sm">← 前月</button>
          <span id="cal-month-label" style="font-weight: 600; font-size: 14px; min-width: 100px; text-align: center;"></span>
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
        <h2 class="section-title">🏆 メンバー別参戦数</h2>
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
        <h2 class="section-title">🎸 直近のライブ</h2>
        ${upcomingLives.length > 0 ? `<a href="#/lives" class="btn btn-secondary btn-sm">すべて見る →</a>` : ''}
      </div>
      ${upcomingLives.length > 0 ? `
        <div class="live-list">
          ${upcomingLives.map(live => renderLiveCard(live)).join('')}
        </div>
      ` : `
        <div class="card empty-state">
          <div class="empty-state-icon">🎸</div>
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
      const undecidedMembers = members.filter(m => getDayAttendanceStatus(live.id, dateStr, m.id) === 'undecided');
      return `
                    <div class="date-event">
                        <div class="date-event-info">
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
                            ${undecidedMembers.length > 0 ? `
                                <div class="date-member-group undecided">
                                    ${undecidedMembers.map(m => `
                                        <span class="date-member-chip undecided" title="${escapeHtml(m.name)} (未定)">
                                           <span class="date-member-dot" style="background: ${m.color}; opacity: 0.4;"></span>
                                            ${escapeHtml(m.nickname || m.name)}?
                                        </span>
                                    `).join('')}
                                </div>
                            ` : ''}
                            ${goingMembers.length === 0 && undecidedMembers.length === 0 ? `
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
    const attendance = getAttendanceByMember(member.id);
    const goingCount = attendance.filter(a => a.status === 'going').length;
    return { ...member, goingCount };
  }).sort((a, b) => b.goingCount - a.goingCount);

  return `
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${ranked.map((member, idx) => `
        <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; background: ${idx < 3 ? 'rgba(139, 92, 246, 0.06)' : 'transparent'};">
          <span style="width: 24px; text-align: center; font-weight: 700; color: ${idx === 0 ? 'var(--accent-amber)' : idx === 1 ? 'var(--text-secondary)' : idx === 2 ? '#CD7F32' : 'var(--text-tertiary)'}; font-size: 14px;">
            ${idx < 3 ? ['🥇', '🥈', '🥉'][idx] : (idx + 1)}
          </span>
          <div class="member-avatar" style="background: ${member.color}; width: 32px; height: 32px; font-size: 14px;">
            ${member.name.charAt(0)}
          </div>
          <span style="flex: 1; font-weight: 500; font-size: 14px;">${member.name}</span>
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
    <div class="card live-card">
      <div class="live-date-badge">
        <span class="month">${months[startDate.getMonth()]}</span>
        <span class="day">${startDate.getDate()}</span>
        ${endDate ? `<span style="font-size: 9px; color: rgba(255,255,255,0.7); margin-top: 2px;">〜${endDate.getMonth() + 1}/${endDate.getDate()}</span>` : ''}
      </div>
      <div class="live-info">
        <div class="live-name">${escapeHtml(live.name)}</div>
        <div class="live-meta">
          <span>🎤 ${escapeHtml(live.artist || '未設定')}</span>
          <span>📍 ${escapeHtml(live.venue || '未設定')}</span>
          <span>📅 ${formatDateRange(live)}</span>
          <span class="badge ${badgeClass}">${badgeText}</span>
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
