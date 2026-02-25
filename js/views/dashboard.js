// ============================================
// Dashboard View
// ============================================
import { getLives, getMembers, getStats, getAttendanceByMember } from '../store.js';
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
        <h2 class="section-title">📅 直近のライブ</h2>
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
}

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
