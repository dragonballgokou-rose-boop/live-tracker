import { getLiveById, getMemberById, getMembers, getLives, getDatesForLive, getDayAttendanceStatus } from '../store.js';
import { showModal, memberAvatarHtml } from '../utils.js';
import { formatDateRange, extractPrefecture } from './lives.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function fmtDate(dateStr) {
    // "YYYY-MM-DD" → "M/D(曜)"
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

// ============================================
// ライブ詳細モーダル
// ============================================
export function showLiveDetailsModal(liveId) {
    const live = getLiveById(liveId);
    if (!live) return;
    const members = getMembers();
    const dates = getDatesForLive(live);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const lastDate = new Date(live.dateEnd || live.dateStart || live.date);
    lastDate.setHours(0, 0, 0, 0);
    const isPast = lastDate < now;

    const pref = live.prefecture || extractPrefecture(live.venue || '');

    let html = `<div style="font-size:14px;">`;

    // ── メタ情報 ──
    html += `<div style="background:rgba(0,0,0,0.2);border:1px solid var(--border-color);border-radius:10px;padding:14px;margin-bottom:20px;display:flex;flex-direction:column;gap:8px;">`;
    if (live.artist) html += `<div style="display:flex;align-items:center;gap:8px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span style="color:var(--text-secondary);">${escapeHtml(live.artist)}</span></div>`;
    html += `<div style="display:flex;align-items:center;gap:8px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span style="color:var(--text-secondary);">${formatDateRange(live)}</span>${isPast ? '<span class="badge badge-past" style="font-size:10px;">終了</span>' : '<span class="badge badge-upcoming" style="font-size:10px;">予定</span>'}</div>`;
    if (live.venue) html += `<div style="display:flex;align-items:center;gap:8px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="color:var(--text-secondary);">${escapeHtml(live.venue)}${pref ? `（${escapeHtml(pref)}）` : ''}</span></div>`;
    if (live.memo) html += `<div style="margin-top:4px;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px;font-size:12px;color:var(--text-tertiary);white-space:pre-wrap;">${escapeHtml(live.memo)}</div>`;
    html += `</div>`;

    // ── 参戦スケジュール（全メンバー × 全日程）──
    html += `<h4 style="margin-bottom:12px;font-size:14px;font-weight:700;color:var(--text-primary);">参戦スケジュール</h4>`;

    if (dates.length === 0 || members.length === 0) {
        html += `<p style="color:var(--text-tertiary);font-size:13px;">日程またはメンバーが未登録です</p>`;
    } else {
        dates.forEach(dateObj => {
            const dateStr = dateObj.dateStr;
            const d = dateObj.date;
            const dayLabel = dates.length > 1
                ? `Day${dateObj.dayNum}　${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
                : `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;

            const going = [];
            const notGoing = [];
            const undecided = [];
            members.forEach(m => {
                const status = getDayAttendanceStatus(liveId, dateStr, m.id);
                if (status === 'going') going.push(m);
                else if (status === 'not-going' || status === 'not_going') notGoing.push(m);
                else undecided.push(m);
            });

            html += `<div style="margin-bottom:12px;padding:12px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color);border-radius:8px;">`;
            html += `<div style="font-weight:700;font-size:13px;color:var(--accent-purple-light);margin-bottom:10px;">${dayLabel}　<span style="font-weight:400;font-size:12px;color:var(--text-tertiary);">参戦 ${going.length}人</span></div>`;

            // 参戦 ○
            if (going.length > 0) {
                html += `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">`;
                going.forEach(m => {
                    html += `<span style="display:inline-flex;align-items:center;gap:4px;background:${m.color}18;border:1px solid ${m.color}55;color:${m.color};border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600;">
                        <span style="width:6px;height:6px;border-radius:50%;background:${m.color};flex-shrink:0;"></span>${escapeHtml(m.nickname || m.name)}</span>`;
                });
                html += `</div>`;
            }

            // 不参戦 ×
            if (notGoing.length > 0) {
                html += `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">`;
                notGoing.forEach(m => {
                    html += `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:var(--text-tertiary);border-radius:20px;padding:3px 10px;font-size:12px;">
                        <span style="font-size:11px;color:var(--accent-red);">✕</span>${escapeHtml(m.nickname || m.name)}</span>`;
                });
                html += `</div>`;
            }

            // 未定 ？
            if (undecided.length > 0) {
                html += `<div style="display:flex;flex-wrap:wrap;gap:5px;">`;
                undecided.forEach(m => {
                    html += `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);color:var(--text-tertiary);border-radius:20px;padding:3px 10px;font-size:12px;">
                        <span style="font-size:11px;">？</span>${escapeHtml(m.nickname || m.name)}</span>`;
                });
                html += `</div>`;
            }

            html += `</div>`;
        });
    }

    html += `</div>`;
    showModal(`ライブ詳細：${live.name}`, html);
}

// ============================================
// メンバー詳細モーダル
// ============================================
export function showMemberDetailsModal(memberId) {
    const member = getMemberById(memberId);
    if (!member) return;
    const lives = getLives();

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // 参戦日数集計
    const liveStatusMap = {};
    let goingDaysCount = 0;
    let totalDays = 0;

    lives.forEach(live => {
        const dates = getDatesForLive(live);
        const goingDates = [];
        dates.forEach(d => {
            totalDays++;
            if (getDayAttendanceStatus(live.id, d.dateStr, memberId) === 'going') {
                goingDates.push(d.dateStr);
                goingDaysCount++;
            }
        });
        liveStatusMap[live.id] = { goingDates };
    });

    // 参戦したライブを 予定 / 結果 に分割
    const goingLives = lives.filter(l => liveStatusMap[l.id].goingDates.length > 0);

    const upcomingGoingLives = goingLives
        .filter(l => { const d = new Date(l.dateEnd || l.dateStart || l.date); d.setHours(0,0,0,0); return d >= now; })
        .sort((a, b) => new Date(a.dateStart || a.date) - new Date(b.dateStart || b.date));

    const pastGoingLives = goingLives
        .filter(l => { const d = new Date(l.dateEnd || l.dateStart || l.date); d.setHours(0,0,0,0); return d < now; })
        .sort((a, b) => new Date(b.dateStart || b.date) - new Date(a.dateStart || a.date)); // 新しい順

    const rate = totalDays > 0 ? Math.round((goingDaysCount / totalDays) * 100) : 0;

    let html = `<div class="member-details-modal">`;

    // アバター & 名前
    html += `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
            ${memberAvatarHtml(member, 50)}
            <div>
                <h3 style="margin:0;font-size:18px;">${escapeHtml(member.name)}</h3>
                ${member.nickname ? `<div style="color:var(--text-tertiary);font-size:13px;">@${escapeHtml(member.nickname)}</div>` : ''}
            </div>
        </div>
    `;

    // 統計
    html += `
        <div style="display:flex;gap:12px;margin-bottom:24px;">
            <div style="background:rgba(255,255,255,0.05);border:1px solid var(--border-color);border-radius:8px;padding:12px;flex:1;text-align:center;">
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">参戦日数</div>
                <div style="font-size:20px;font-weight:bold;color:var(--accent-purple-light);">${goingDaysCount} <span style="font-size:12px;font-weight:normal;color:var(--text-tertiary);">/ ${totalDays}回</span></div>
            </div>
            <div style="background:rgba(255,255,255,0.05);border:1px solid var(--border-color);border-radius:8px;padding:12px;flex:1;text-align:center;">
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">参戦率（過去）</div>
                <div style="font-size:20px;font-weight:bold;color:var(--accent-blue);">${rate}%</div>
            </div>
        </div>
    `;

    // ライブカードを生成するヘルパー
    function liveCard(live) {
        const goingDates = liveStatusMap[live.id].goingDates;
        const datesDisplay = goingDates.map(d => fmtDate(d)).join('・');
        return `
            <div style="padding:12px;background:rgba(0,0,0,0.2);border:1px solid var(--border-color);border-radius:8px;">
                <div style="font-weight:600;font-size:14px;margin-bottom:6px;">${escapeHtml(live.name)}</div>
                <div style="font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        ${formatDateRange(live)}
                    </span>
                    ${live.venue ? `<span>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        ${escapeHtml(live.venue)}
                    </span>` : ''}
                </div>
                ${goingDates.length > 0 ? `<div style="margin-top:6px;font-size:11px;color:var(--text-tertiary);">参戦日: ${datesDisplay}</div>` : ''}
            </div>
        `;
    }

    // ── 参戦予定 ──
    html += `<div style="margin-bottom:20px;">`;
    html += `<h4 style="margin-bottom:10px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border-color);padding-bottom:8px;">
        <span class="badge badge-upcoming" style="font-size:10px;">予定</span>
        参戦予定ライブ <span style="font-size:12px;font-weight:400;color:var(--text-tertiary);">${upcomingGoingLives.length}件</span>
    </h4>`;
    if (upcomingGoingLives.length > 0) {
        html += `<div style="display:flex;flex-direction:column;gap:8px;">`;
        upcomingGoingLives.forEach(l => { html += liveCard(l); });
        html += `</div>`;
    } else {
        html += `<p style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:12px 0;">参戦予定のライブはありません</p>`;
    }
    html += `</div>`;

    // ── 参戦結果 ──
    html += `<div>`;
    html += `<h4 style="margin-bottom:10px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border-color);padding-bottom:8px;">
        <span class="badge badge-past" style="font-size:10px;">結果</span>
        参戦結果 <span style="font-size:12px;font-weight:400;color:var(--text-tertiary);">${pastGoingLives.length}件</span>
    </h4>`;
    if (pastGoingLives.length > 0) {
        html += `<div style="display:flex;flex-direction:column;gap:8px;">`;
        pastGoingLives.forEach(l => { html += liveCard(l); });
        html += `</div>`;
    } else {
        html += `<p style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:12px 0;">参戦済みのライブはありません</p>`;
    }
    html += `</div>`;

    html += `</div>`;
    showModal(`メンバー詳細：${member.name}`, html);
}
