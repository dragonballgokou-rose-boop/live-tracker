import { getLiveById, getMemberById, getMembers, getLives, getDatesForLive, getDayAttendanceStatus, getAttendanceByMember } from '../store.js';
import { showModal } from '../utils.js';
import { formatDateRange } from './lives.js';

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function showLiveDetailsModal(liveId) {
    const live = getLiveById(liveId);
    if (!live) return;
    const members = getMembers();

    // get dates
    const dates = getDatesForLive(live);

    let html = `
        <div class="live-details-modal" style="font-size: 14px;">
            <div class="live-meta" style="margin-bottom: 24px;">
                <p style="margin-bottom: 8px;"><strong>🎤 アーティスト:</strong> ${escapeHtml(live.artist || '未設定')}</p>
                <p style="margin-bottom: 8px;"><strong>📍 会場:</strong> ${escapeHtml(live.venue || '未設定')}</p>
                <p style="margin-bottom: 8px;"><strong>📅 日程:</strong> ${formatDateRange(live)}</p>
                ${live.memo ? `<p style="margin-top: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 6px;"><strong>📝 メモ:</strong><br>${escapeHtml(live.memo).replace(/\n/g, '<br>')}</p>` : ''}
            </div>
            
            <h4 style="margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">参戦スケジュール</h4>
            <div class="live-schedule-members">
    `;

    if (dates.length === 0) {
        html += `<p style="color: var(--text-tertiary);">日程が未設定です</p>`;
    } else {
        dates.forEach(dateObj => {
            const dateStr = dateObj.dateStr;
            const goingMembers = members.filter(m => getDayAttendanceStatus(liveId, dateStr, m.id) === 'going');

            let dayLabel = dates.length > 1 ? `Day${dateObj.dayNum} (${dateObj.date.getMonth() + 1}/${dateObj.date.getDate()})` : '全日程';

            html += `
                <div style="margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; border: 1px solid var(--border-color);">
                    <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px; color: var(--accent-purple-light);">${dayLabel}</div>
            `;

            if (goingMembers.length === 0) {
                html += `<div style="font-size: 13px; color: var(--text-tertiary);">参戦予定者はいません</div>`;
            } else {
                html += `<div style="display: flex; flex-wrap: wrap; gap: 8px;">`;
                goingMembers.forEach(m => {
                    html += `
                        <span class="badge" style="background: rgba(139, 92, 246, 0.1); color: var(--text-primary); border: 1px solid var(--border-color); display: flex; align-items: center; gap: 6px; padding: 4px 10px;">
                           <span style="width: 8px; height: 8px; border-radius: 50%; background: ${m.color}; display: inline-block;"></span>
                           ${escapeHtml(m.nickname || m.name)}
                        </span>
                    `;
                });
                html += `</div>`;
            }
            html += `</div>`;
        });
    }
    html += `</div></div>`;

    showModal(`ライブ詳細：${escapeHtml(live.name)}`, html);
}

export function showMemberDetailsModal(memberId) {
    const member = getMemberById(memberId);
    if (!member) return;
    const lives = getLives();
    const attendance = getAttendanceByMember(memberId);

    // 集計用に、liveIdごとにそのメンバーが参加する日付(dateStr)とステータスをまとめる
    const liveStatusMap = {};
    attendance.forEach(a => {
        // dayKeyの形式は 'liveId_YYYY-MM-DD' または旧形式 'liveId'
        const parts = a.liveId.split('_');
        const lId = parts[0];
        const dStr = parts[1]; // undefinedの場合もある

        if (!liveStatusMap[lId]) liveStatusMap[lId] = { goingDates: [] };

        if (a.status === 'going') {
            if (dStr) liveStatusMap[lId].goingDates.push(dStr);
            else liveStatusMap[lId].goingDates.push('全日程');
        }
    });

    const goingLives = lives.filter(l => liveStatusMap[l.id] && liveStatusMap[l.id].goingDates.length > 0);

    const rate = lives.length > 0 ? Math.round((goingLives.length / lives.length) * 100) : 0;

    let html = `
        <div class="member-details-modal">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
                <div style="width: 50px; height: 50px; border-radius: 50%; background: ${member.color}; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; color: white;">
                    ${member.name.charAt(0)}
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 18px;">${escapeHtml(member.name)}</h3>
                    ${member.nickname ? `<div style="color: var(--text-tertiary); font-size: 13px;">@${escapeHtml(member.nickname)}</div>` : ''}
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; margin-bottom: 24px;">
                <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; flex: 1; text-align: center;">
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">参戦予定ライブ</div>
                    <div style="font-size: 20px; font-weight: bold; color: var(--accent-purple-light);">${goingLives.length} <span style="font-size: 12px; font-weight: normal; color: var(--text-tertiary);">/ ${lives.length}件</span></div>
                </div>
                <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; flex: 1; text-align: center;">
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">参戦率</div>
                    <div style="font-size: 20px; font-weight: bold; color: var(--accent-blue);">${rate}%</div>
                </div>
            </div>
    `;

    // sort lives chronologically
    const sortByDate = (a, b) => {
        const da = new Date(a.dateStart || a.date).getTime();
        const db = new Date(b.dateStart || b.date).getTime();
        return da - db;
    };

    const renderLiveList = (title, list, statusClass) => {
        if (list.length === 0) return '';
        list.sort(sortByDate);

        let section = `
            <h4 style="margin-bottom: 12px; font-size: 15px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">${title} (${list.length}件)</h4>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px;">
        `;
        list.forEach(l => {
            const datesArr = liveStatusMap[l.id].goingDates;
            const datesDisplay = datesArr.every(d => d === '全日程') ? '' : `<br><span style="font-size: 12px; color: var(--text-tertiary);">参戦日: ${datesArr.join(', ')}</span>`;

            section += `
                <div style="padding: 12px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px;">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${escapeHtml(l.name)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">
                        📅 ${formatDateRange(l)} · 📍 ${escapeHtml(l.venue || '未定')}
                        ${datesDisplay}
                    </div>
                </div>
            `;
        });
        section += `</div>`;
        return section;
    };

    html += renderLiveList('🎤 参戦予定ライブ', goingLives, 'going');

    if (goingLives.length === 0) {
        html += `<p style="color: var(--text-tertiary); text-align: center; padding: 20px 0;">予定されているライブはありません</p>`;
    }

    html += `</div>`;

    showModal(`メンバー詳細：${escapeHtml(member.name)}`, html);
}
