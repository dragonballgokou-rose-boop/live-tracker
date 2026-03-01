// ============================================
// Chart View
// ============================================
import { getLives, getMembers, getDayAttendanceStatus, getDatesForLive } from '../store.js';
import { showMemberDetailsModal, showLiveDetailsModal } from './details.js';
import { formatDateRange } from './lives.js';

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

  // ---- データ集計 ----

  // 1. メンバー別
  const memberStats = members.map(member => {
    let goingCount = 0, totalDays = 0;
    lives.forEach(live => {
      getDatesForLive(live).forEach(d => {
        totalDays++;
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') goingCount++;
      });
    });
    const rate = totalDays > 0 ? Math.round((goingCount / totalDays) * 100) : 0;
    return { ...member, goingCount, totalDays, rate };
  }).sort((a, b) => b.goingCount - a.goingCount);

  const maxMemberCount = Math.max(...memberStats.map(m => m.goingCount), 1);

  // 2. 月別（全体 + メンバー別）
  const monthMap = {};
  const memberMonthStats = {};
  members.forEach(m => { memberMonthStats[m.id] = {}; });

  lives.forEach(live => {
    getDatesForLive(live).forEach(d => {
      const key = d.dateStr.slice(0, 7);
      if (!monthMap[key]) monthMap[key] = { going: 0, total: 0 };
      monthMap[key].total++;
      members.forEach(member => {
        if (!memberMonthStats[member.id][key]) memberMonthStats[member.id][key] = { going: 0, total: 0 };
        memberMonthStats[member.id][key].total++;
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') {
          monthMap[key].going++;
          memberMonthStats[member.id][key].going++;
        }
      });
    });
  });

  const sortedMonths = Object.keys(monthMap).sort();
  const maxMonthGoing = Math.max(...sortedMonths.map(k => monthMap[k].going), 1);

  // 3. ライブ別（参戦した人数）
  const liveStats = lives.map(live => {
    const goingSet = new Set();
    getDatesForLive(live).forEach(d => {
      members.forEach(member => {
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') goingSet.add(member.id);
      });
    });
    return { ...live, goingCount: goingSet.size };
  }).filter(l => l.goingCount > 0).sort((a, b) => b.goingCount - a.goingCount).slice(0, 12);

  const maxLiveCount = Math.max(...liveStats.map(l => l.goingCount), 1);
  // 同名ライブを検出して区別するためのサブタイトル用マップ
  const liveNameCounts = {};
  liveStats.forEach(l => { liveNameCounts[l.name] = (liveNameCounts[l.name] || 0) + 1; });

  // 4. 会場別
  const venueMap = {};
  lives.forEach(live => {
    if (!live.venue) return;
    if (!venueMap[live.venue]) venueMap[live.venue] = { venue: live.venue, going: 0 };
    getDatesForLive(live).forEach(d => {
      members.forEach(member => {
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') venueMap[live.venue].going++;
      });
    });
  });
  const venueStats = Object.values(venueMap).sort((a, b) => b.going - a.going).slice(0, 10);
  const maxVenueCount = Math.max(...venueStats.map(v => v.going), 1);

  // 5. 同行マトリクス
  const coMatrix = {};
  members.forEach(a => {
    coMatrix[a.id] = {};
    members.forEach(b => { coMatrix[a.id][b.id] = 0; });
  });
  lives.forEach(live => {
    getDatesForLive(live).forEach(d => {
      const goingHere = members.filter(m => getDayAttendanceStatus(live.id, d.dateStr, m.id) === 'going');
      for (let i = 0; i < goingHere.length; i++) {
        for (let j = 0; j < goingHere.length; j++) {
          if (i !== j) coMatrix[goingHere[i].id][goingHere[j].id]++;
        }
      }
    });
  });
  let maxCo = 0;
  members.forEach(a => members.forEach(b => {
    if (a.id !== b.id) maxCo = Math.max(maxCo, coMatrix[a.id][b.id]);
  }));

  // ---- レンダリング ----
  content.innerHTML = `

    <!-- 1. メンバー別参戦日数 -->
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
              <div class="chart-bar-fill" style="width:${(m.goingCount / maxMemberCount) * 100}%;background:${escapeHtml(m.color)};"></div>
            </div>
            <div class="chart-row-values">
              <span class="chart-value-count">${m.goingCount}</span>
              <span class="chart-value-rate">${m.rate}%</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 2. 月別参戦率推移（折れ線）-->
    ${sortedMonths.length >= 2 ? `
    <div class="chart-section card" style="margin-top:var(--space-lg);">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        月別 参戦率推移（%）
      </h2>
      ${buildLegend(memberStats)}
      <div class="month-chart-wrap">
        ${buildLineChart(sortedMonths, memberMonthStats, memberStats)}
      </div>
    </div>
    ` : ''}

    <!-- 3. ライブ別参戦人数 -->
    ${liveStats.length > 0 ? `
    <div class="chart-section card" style="margin-top:var(--space-lg);">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        ライブ別 参戦人数
        <span style="font-size:11px;font-weight:400;color:var(--text-tertiary);margin-left:6px;">上位12件</span>
      </h2>
      <div class="chart-bars">
        ${liveStats.map((l, idx) => {
          const isDup = liveNameCounts[l.name] > 1;
          const subParts = isDup ? [formatDateRange(l), l.venue || l.prefecture].filter(Boolean) : [];
          const sub = subParts.join('・');
          return `
          <div class="chart-row chart-row-live" onclick="showLiveDetailsModal('${l.id}')">
            <div class="chart-row-rank" style="color:var(--text-tertiary);">${idx + 1}</div>
            <div class="chart-row-label-long">
              ${escapeHtml(l.name)}
              ${sub ? `<span class="chart-live-sub">${escapeHtml(sub)}</span>` : ''}
            </div>
            <div class="chart-bar-track chart-bar-track-sm">
              <div class="chart-bar-fill" style="width:${(l.goingCount / maxLiveCount) * 100}%;background:var(--gradient-primary);"></div>
            </div>
            <div class="chart-row-values">
              <span class="chart-value-count">${l.goingCount}<span class="chart-value-unit">人</span></span>
            </div>
          </div>
        `; }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- 4. 会場別参戦数 -->
    ${venueStats.length > 0 ? `
    <div class="chart-section card" style="margin-top:var(--space-lg);">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        会場別 参戦数
        <span style="font-size:11px;font-weight:400;color:var(--text-tertiary);margin-left:6px;">上位10会場</span>
      </h2>
      <div class="chart-bars">
        ${venueStats.map((v, idx) => `
          <div class="chart-row chart-row-live" style="cursor:default;">
            <div class="chart-row-rank" style="color:var(--text-tertiary);">${idx + 1}</div>
            <div class="chart-row-label-long">${escapeHtml(v.venue)}</div>
            <div class="chart-bar-track chart-bar-track-sm">
              <div class="chart-bar-fill" style="width:${(v.going / maxVenueCount) * 100}%;background:linear-gradient(90deg,var(--accent-cyan),var(--accent-green));"></div>
            </div>
            <div class="chart-row-values">
              <span class="chart-value-count">${v.going}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <!-- 5. 同行メンバー マトリクス -->
    ${members.length >= 2 ? `
    <div class="chart-section card" style="margin-top:var(--space-lg);">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
          <line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
        </svg>
        同行メンバー マトリクス
      </h2>
      <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:var(--space-md);">同じ日に参戦した日数。対角線は各自の総参戦日数。濃い色ほど一緒に参戦している。</p>
      ${buildHeatmap(memberStats, coMatrix, maxCo)}
    </div>
    ` : ''}

    <!-- 6. 月別参戦数推移（縦棒）-->
    ${sortedMonths.length > 0 ? `
    <div class="chart-section card" style="margin-top:var(--space-lg);">
      <h2 class="chart-section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px;">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
        </svg>
        月別 参戦数推移
      </h2>
      <div class="month-chart-wrap">
        ${buildMonthBarChart(sortedMonths, monthMap, maxMonthGoing)}
      </div>
    </div>
    ` : ''}

  `;

  window.showMemberDetailsModal = showMemberDetailsModal;
  window.showLiveDetailsModal = showLiveDetailsModal;
}

// ---- メンバーカラー凡例 ----
function buildLegend(memberStats) {
  return `
    <div style="display:flex;flex-wrap:wrap;gap:8px 12px;margin-bottom:var(--space-md);">
      ${memberStats.map(m => `
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:14px;height:3px;border-radius:2px;background:${escapeHtml(m.color)};display:inline-block;flex-shrink:0;"></span>
          <span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(m.nickname || m.name)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ---- 折れ線グラフ（月別参戦率） ----
function buildLineChart(sortedMonths, memberMonthStats, memberStats) {
  const COL_W = 44;
  const CHART_H = 140;
  const TOP_PAD = 16;
  const LEFT_PAD = 28;
  const BOTTOM_PAD = 36;
  const svgW = LEFT_PAD + sortedMonths.length * COL_W;
  const svgH = TOP_PAD + CHART_H + BOTTOM_PAD;
  const fullW = Math.max(svgW, 300);

  const gridLines = [0, 25, 50, 75, 100].map(pct => {
    const y = TOP_PAD + CHART_H - Math.round(pct * CHART_H / 100);
    return `
      <line x1="${LEFT_PAD}" y1="${y}" x2="${fullW}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <text x="${LEFT_PAD - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="rgba(255,255,255,0.2)">${pct}</text>
    `;
  }).join('');

  const xLabels = sortedMonths.map((key, i) => {
    const [year, mon] = key.split('-');
    const x = LEFT_PAD + i * COL_W + COL_W / 2;
    const subLabel = (i === 0 || mon === '01') ? `'${year.slice(2)}` : '';
    return `
      <text x="${x}" y="${TOP_PAD + CHART_H + 16}" text-anchor="middle" font-size="10" fill="var(--text-tertiary)">${parseInt(mon)}月</text>
      ${subLabel ? `<text x="${x}" y="${TOP_PAD + CHART_H + 28}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.25)">${subLabel}</text>` : ''}
    `;
  }).join('');

  const lines = memberStats.map(member => {
    const points = sortedMonths.map((month, i) => {
      const stat = memberMonthStats[member.id]?.[month];
      if (!stat || stat.total === 0) return null;
      const x = LEFT_PAD + i * COL_W + COL_W / 2;
      const y = TOP_PAD + CHART_H - Math.round((stat.going / stat.total) * CHART_H);
      return { x, y };
    });

    let d = '';
    let started = false;
    const dots = [];
    points.forEach(pt => {
      if (pt === null) { started = false; return; }
      d += started ? `L ${pt.x} ${pt.y} ` : `M ${pt.x} ${pt.y} `;
      started = true;
      dots.push(`<circle cx="${pt.x}" cy="${pt.y}" r="3" fill="${member.color}" stroke="var(--bg-secondary)" stroke-width="1.5"/>`);
    });

    if (!d) return '';
    return `
      <path d="${d}" fill="none" stroke="${member.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
      ${dots.join('')}
    `;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg width="${fullW}" height="${svgH}" viewBox="0 0 ${fullW} ${svgH}" style="display:block;min-width:${svgW}px;">
        ${gridLines}
        ${xLabels}
        ${lines}
      </svg>
    </div>
  `;
}

// ---- ヒートマップ（同行マトリクス）----
function buildHeatmap(memberStats, coMatrix, maxCo) {
  const CELL = 34;
  const LABEL_W = 60;

  const colHeaders = memberStats.map(m => `
    <div style="width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <div class="chart-avatar-sm" style="background:${escapeHtml(m.color)};width:22px;height:22px;font-size:9px;">${escapeHtml(m.name.charAt(0))}</div>
    </div>
  `).join('');

  const rows = memberStats.map(a => {
    const cells = memberStats.map(b => {
      if (a.id === b.id) {
        return `<div style="width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${escapeHtml(a.color)}33;border-radius:4px;font-size:11px;font-weight:700;color:${escapeHtml(a.color)};">${a.goingCount}</div>`;
      }
      const count = coMatrix[a.id]?.[b.id] || 0;
      const alpha = maxCo > 0 ? (count / maxCo) * 0.72 : 0;
      const textColor = alpha > 0.38 ? 'rgba(255,255,255,0.9)' : count > 0 ? 'var(--text-secondary)' : 'transparent';
      return `<div style="width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:rgba(139,92,246,${alpha.toFixed(2)});border-radius:4px;font-size:11px;font-weight:600;color:${textColor};" title="${escapeHtml(a.nickname || a.name)} × ${escapeHtml(b.nickname || b.name)}: ${count}日">${count > 0 ? count : ''}</div>`;
    }).join('');

    return `
      <div style="display:flex;align-items:center;gap:2px;margin-bottom:2px;">
        <div style="width:${LABEL_W}px;display:flex;align-items:center;gap:4px;flex-shrink:0;padding-right:4px;">
          <div class="chart-avatar-sm" style="background:${escapeHtml(a.color)};width:20px;height:20px;font-size:9px;flex-shrink:0;">${escapeHtml(a.name.charAt(0))}</div>
          <span style="font-size:10px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.nickname || a.name)}</span>
        </div>
        <div style="display:flex;gap:2px;">${cells}</div>
      </div>
    `;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <div style="display:inline-block;min-width:max-content;">
        <div style="display:flex;align-items:center;gap:2px;margin-bottom:2px;padding-left:${LABEL_W}px;">
          <div style="display:flex;gap:2px;">${colHeaders}</div>
        </div>
        ${rows}
      </div>
    </div>
  `;
}

// ---- 縦棒グラフ（月別参戦数）----
function buildMonthBarChart(months, monthMap, maxGoing) {
  const BAR_W = 36;
  const BAR_GAP = 8;
  const CHART_H = 120;
  const LABEL_H = 36;
  const TOP_PAD = 20;
  const svgW = months.length * (BAR_W + BAR_GAP);
  const svgH = TOP_PAD + CHART_H + LABEL_H;

  const bars = months.map((key, i) => {
    const { going } = monthMap[key];
    const barH = maxGoing > 0 ? Math.round((going / maxGoing) * CHART_H) : 0;
    const x = i * (BAR_W + BAR_GAP);
    const y = TOP_PAD + CHART_H - barH;
    const [year, mon] = key.split('-');
    const subLabel = i === 0 || mon === '01' ? year : '';

    return `
      <g>
        <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="4" fill="url(#chartGrad)" opacity="0.85"/>
        ${going > 0 ? `<text x="${x + BAR_W / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--accent-purple-light)">${going}</text>` : ''}
        <text x="${x + BAR_W / 2}" y="${TOP_PAD + CHART_H + 16}" text-anchor="middle" font-size="10" fill="var(--text-tertiary)">${parseInt(mon)}月</text>
        ${subLabel ? `<text x="${x + BAR_W / 2}" y="${TOP_PAD + CHART_H + 30}" text-anchor="middle" font-size="9" fill="var(--text-tertiary)" opacity="0.7">${subLabel}</text>` : ''}
      </g>
    `;
  }).join('');

  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg width="${Math.max(svgW, 300)}" height="${svgH}" viewBox="0 0 ${Math.max(svgW, 300)} ${svgH}" style="display:block;min-width:${svgW}px;">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8B5CF6"/>
            <stop offset="100%" stop-color="#EC4899"/>
          </linearGradient>
        </defs>
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
