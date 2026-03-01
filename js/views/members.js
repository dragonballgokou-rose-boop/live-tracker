// ============================================
// Members Management View
// ============================================
import { getMembers, addMember, updateMember, deleteMember, getAttendanceByMember, getLives, getDatesForLive, getDayAttendanceStatus } from '../store.js';
import { showModal, closeModal, showToast, showConfirm } from '../utils.js';

const MEMBER_COLORS = [
  '#8B5CF6', '#EC4899', '#22D3EE', '#34D399', '#FBBF24',
  '#F87171', '#6366F1', '#14B8A6', '#F97316', '#A78BFA',
  '#FB7185', '#38BDF8', '#4ADE80', '#FACC15', '#E879F9',
  '#2DD4BF', '#818CF8', '#FB923C'
];

export function renderMembers() {
  const content = document.getElementById('page-content');
  const members = getMembers();
  const lives = getLives();

  content.innerHTML = `
    <div class="section-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="color: var(--text-secondary); font-size: 14px;">全 ${members.length} 名</span>
      </div>
      <button id="add-member-btn" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        メンバーを追加
      </button>
    </div>

    ${members.length > 0 ? `
      <div class="members-grid">
        ${members.map(member => {
    let goingCount = 0;
    let totalPossibleSchedules = 0;

    lives.forEach(live => {
      const dates = getDatesForLive(live);
      totalPossibleSchedules += dates.length;
      dates.forEach(d => {
        if (getDayAttendanceStatus(live.id, d.dateStr, member.id) === 'going') {
          goingCount++;
        }
      });
    });

    const rate = totalPossibleSchedules > 0 ? Math.round((goingCount / totalPossibleSchedules) * 100) : 0;

    return `
          <div class="card member-card" style="cursor: pointer; --member-color: ${member.color};" onclick="showMemberDetailsModal('${member.id}')" title="メンバー詳細を見る">
            <div class="member-card-top">
              <div class="member-avatar" style="background: ${member.color}">
                ${member.name.charAt(0)}
              </div>
              <div class="member-info">
                <div class="member-name">${escapeHtml(member.name)}</div>
                ${member.nickname ? `<div class="member-nickname">@${escapeHtml(member.nickname)}</div>` : ''}
              </div>
              <div class="member-rate-badge" style="color: ${member.color};">${rate}%</div>
            </div>
            <div class="member-card-bottom">
              <div class="member-progress-wrap">
                <div class="member-progress-track">
                  <div class="member-progress-fill" style="width: ${rate}%; background: ${member.color};"></div>
                </div>
                <span class="member-stat-label">${goingCount} / ${totalPossibleSchedules} 回</span>
              </div>
              <div class="member-card-actions">
                <button class="btn btn-icon btn-secondary edit-member-btn" data-id="${member.id}" title="編集" onclick="event.stopPropagation()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="btn btn-icon btn-danger delete-member-btn" data-id="${member.id}" title="削除" onclick="event.stopPropagation()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          </div>
          `;
  }).join('')}
      </div>
    ` : `
      <div class="card empty-state">
        <div class="empty-state-icon"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <p class="empty-state-text">まだメンバーが登録されていません</p>
        <p style="color: var(--text-tertiary); font-size: 14px;">「メンバーを追加」ボタンからチームメンバーを登録しましょう！</p>
      </div>
    `}
  `;

  // Events
  document.getElementById('add-member-btn')?.addEventListener('click', () => openMemberModal());

  content.querySelectorAll('.edit-member-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const member = getMembers().find(m => m.id === btn.dataset.id);
      if (member) openMemberModal(member);
    });
  });

  content.querySelectorAll('.delete-member-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirm('メンバーを削除', 'このメンバーとすべての参戦記録を削除しますか？\nこの操作は取り消せません。', () => {
        deleteMember(btn.dataset.id);
        showToast('メンバーを削除しました', 'success');
        renderMembers();
      });
    });
  });
}

function openMemberModal(member = null) {
  const isEdit = !!member;
  const title = isEdit ? 'メンバーを編集' : 'メンバーを追加';
  const selectedColor = member?.color || MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];

  showModal(title, `
    <form id="member-form">
      <div class="form-group">
        <label class="form-label" for="member-name">名前 <span style="color: var(--accent-red)">*</span></label>
        <input type="text" id="member-name" class="form-input" placeholder="例: 田中太郎" value="${isEdit ? escapeAttr(member.name) : ''}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="member-nickname">ニックネーム</label>
        <input type="text" id="member-nickname" class="form-input" placeholder="例: たなっち" value="${isEdit ? escapeAttr(member.nickname || '') : ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">アイコンカラー</label>
        <div class="color-picker" id="color-picker">
          ${MEMBER_COLORS.map(color => `
            <div class="color-option ${color === selectedColor ? 'selected' : ''}"
                 style="background: ${color}"
                 data-color="${color}"
                 role="button"
                 tabindex="0">
            </div>
          `).join('')}
        </div>
        <input type="hidden" id="member-color" value="${selectedColor}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-close').click()">キャンセル</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '更新' : '追加'}</button>
      </div>
    </form>
  `);

  // Color picker
  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById('member-color').value = opt.dataset.color;
    });
  });

  document.getElementById('member-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('member-name').value.trim(),
      nickname: document.getElementById('member-nickname').value.trim(),
      color: document.getElementById('member-color').value
    };

    if (!data.name) {
      showToast('名前は必須です', 'error');
      return;
    }

    if (isEdit) {
      updateMember(member.id, data);
      showToast('メンバーを更新しました', 'success');
    } else {
      addMember(data);
      showToast('メンバーを追加しました', 'success');
    }

    closeModal();
    renderMembers();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
