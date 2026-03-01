// ============================================
// Chart View
// ============================================
import { getLives, getMembers, getDayAttendanceStatus, getDatesForLive } from '../store.js';
import { showMemberDetailsModal } from './details.js';

export function renderChart() {
  const members = getMembers();
  const lives = getLives();
  const content = document.getElementById('page-content');

  if (members.length === 0 || lives.length === 0) {
    content.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state-icon">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
          </svg>
        </div>
        <p class="empty-state-text">ライブとメンバーを登録するとグラフが表示されます</p>
        <a href="#/lives" class="btn btn-primary">ライブを追加する</a>
      </div>
    `;
    return;
  }

  // ---- メンバー別集計 ----
  const memberStats = members.map(member => {
    let goingCount = 0;
    let totalDays = 0;
    lives.forEach(live => {
      getDatesForLive(live).forEach(d => {
        totalDays++;
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') goingCount++;
      });
    });
    const rate = totalDays > 0 ? Math.round((goingCount / totalDays) * 100) : 0;
    return { ...member, goingCount, totalDays, rate };
  }).sort((a, b) => b.goingCount - a.goingCount);

  const maxCount = Math.max(...memberStats.map(m => m.goingCount), 1);

  // ---- 月別集計 ----
  const monthMap = {};
  lives.forEach(live => {
    getDatesForLive(live).forEach(d => {
      const key = d.dateStr.slice(0, 7); // "YYYY-MM"
      if (!monthMap[key]) monthMap[key] = { total: 0, going: 0 };
      monthMap[key].total++;
      members.forEach(member => {
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') {
          monthMap[key].going++;
        }
      });
    });
  });

  const sortedMonths = Object.keys(monthMap).sort();
  const maxGoing = Math.max(...sortedMonths.map(k => monthMap[k].going), 1);

  content.innerHTML = `
    <!-- メンバー別参戦日数 -->
    <div class="chart-section card">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        メンバー別 参戦日数
      </h2>
      <div class="chart-bars">
        ${memberStats.map((m, idx) => `
          <div class="chart-row" onclick="showMemberDetailsModal('${m.id}')">
            <div class="chart-row-rank" style="color:${idx < 3 ? ['var(--accent-amber)','var(--text-secondary)','#CD7F32'][idx] : 'var(--text-tertiary)'};">${idx + 1}</div>
            <div class="chart-avatar-sm" style="background:${escapeHtml(m.color)};">${escapeHtml(m.name.charAt(0))}</div>
            <div class="chart-row-label">${escapeHtml(m.nickname || m.name)}</div>
            <div class="chart-bar-track">
              <div class="chart-bar-fill" style="width:${(m.goingCount / maxCount) * 100}%;background:${escapeHtml(m.color)};"></div>
            </div>
            <div class="chart-row-values">
              <span class="chart-value-count">${m.goingCount}</span>
              <span class="chart-value-rate">${m.rate}%</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 月別参戦推移 -->
    ${sortedMonths.length > 0 ? `
    <div class="chart-section card" style="margin-top: var(--space-lg);">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        月別 参戦数推移
      </h2>
      <div class="month-chart-wrap">
        ${buildMonthChart(sortedMonths, monthMap, maxGoing)}
      </div>
    </div>
    ` : ''}
  `;

  // モーダル関数をグローバルに公開
  window.showMemberDetailsModal = showMemberDetailsModal;
}

function buildMonthChart(months, monthMap, maxGoing) {
  const BAR_W = 36;
  const BAR_GAP = 8;
  const CHART_H = 120;
  const LABEL_H = 36;
  const TOP_PAD = 20; // 数字ラベルがSVG上端で切れないための余白
  const svgW = months.length * (BAR_W + BAR_GAP);
  const svgH = TOP_PAD + CHART_H + LABEL_H;

  const bars = months.map((key, i) => {
    const { going } = monthMap[key];
    const barH = maxGoing > 0 ? Math.round((going / maxGoing) * CHART_H) : 0;
    const x = i * (BAR_W + BAR_GAP);
    const y = TOP_PAD + CHART_H - barH;
    const [year, mon] = key.split('-');
    const label = `${parseInt(mon)}月`;
    const subLabel = i === 0 || mon === '01' ? year : '';

    return `
      <g>
        <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="4"
          fill="url(#chartGrad)" opacity="0.85"/>
        ${going > 0 ? `<text x="${x + BAR_W / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--accent-purple-light)">${going}</text>` : ''}
        <text x="${x + BAR_W / 2}" y="${TOP_PAD + CHART_H + 16}" text-anchor="middle" font-size="10" fill="var(--text-tertiary)">${label}</text>
        ${subLabel ? `<text x="${x + BAR_W / 2}" y="${TOP_PAD + CHART_H + 30}" text-anchor="middle" font-size="9" fill="var(--text-tertiary)" opacity="0.7">${subLabel}</text>` : ''}
      </g>
    `;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg width="${Math.max(svgW, 300)}" height="${svgH}" viewBox="0 0 ${Math.max(svgW, 300)} ${svgH}"
        style="display:block;min-width:${svgW}px;">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8B5CF6"/>
            <stop offset="100%" stop-color="#EC4899"/>
          </linearGradient>
        </defs>
        <!-- 横グリッド線 -->
        ${[0.25, 0.5, 0.75, 1].map(r => {
          const y = TOP_PAD + CHART_H - Math.round(r * CHART_H);
          return `<line x1="0" y1="${y}" x2="${Math.max(svgW, 300)}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
        }).join('')}
        ${bars}
      </svg>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
