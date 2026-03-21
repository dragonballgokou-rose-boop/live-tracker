// ============================================
// Members Management View
// ============================================
import { getMembers, addMember, updateMember, deleteMember, getAttendanceByMember, getLives, getDatesForLive, getDayAttendanceStatus } from '../store.js';
import { showModal, closeModal, showToast, showConfirm, memberAvatarHtml } from '../utils.js';
import { dataUrlToClaudeImageBlock } from '../claude.js';

const MEMBER_COLORS = [
  // パープル・バイオレット
  '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD',
  // ピンク・ローズ
  '#BE185D', '#EC4899', '#F472B6', '#FBCFE8',
  // レッド・コーラル
  '#DC2626', '#F87171', '#FCA5A5', '#FECDD3',
  // オレンジ
  '#EA580C', '#F97316', '#FB923C', '#FDBA74',
  // イエロー・アンバー
  '#D97706', '#FBBF24', '#FCD34D', '#FEF08A',
  // グリーン
  '#059669', '#34D399', '#6EE7B7', '#A7F3D0',
  // ティール・シアン
  '#0891B2', '#22D3EE', '#67E8F9', '#A5F3FC',
  // ブルー
  '#2563EB', '#60A5FA', '#93C5FD', '#BFDBFE',
  // インディゴ
  '#4338CA', '#6366F1', '#818CF8', '#A5B4FC',
  // フューシャ
  '#A21CAF', '#D946EF', '#E879F9', '#F0ABFC',
];

export function renderMembers() {
  const content = document.getElementById('page-content');
  const members = getMembers();
  const allLives = getLives();
  // ツアー親は子公演がある場合のみ除外（子公演のない単体ツアーは集計対象）
  const tourChildIds = new Set(allLives.filter(l => l.parentId).map(l => l.parentId));
  const lives = allLives.filter(l => l.eventType !== 'tour' || !tourChildIds.has(l.id));

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
    const now = new Date();
    now.setHours(0, 0, 0, 0);

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
              ${memberAvatarHtml(member, 44)}
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

  const avatarPreviewHtml = member?.avatar
    ? `<img class="avatar-preview" id="avatar-preview-img" src="${member.avatar}" />`
    : `<div class="avatar-preview-placeholder" id="avatar-preview-placeholder" style="background:${selectedColor};">${isEdit ? escapeHtml(member.name.charAt(0)) : '？'}</div>`;

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
        <label class="form-label">アイコン画像</label>
        <div class="avatar-upload-area">
          ${avatarPreviewHtml}
          <div class="avatar-upload-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="avatar-upload-btn">画像を選択</button>
            ${member?.avatar ? `<button type="button" class="btn btn-sm" id="avatar-remove-btn" style="color:var(--accent-red);background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);">削除</button>` : ''}
          </div>
        </div>
        <input type="file" id="avatar-file-input" accept="image/*" style="display:none;" />
        <input type="hidden" id="member-avatar" value="${isEdit ? escapeAttr(member.avatar || '') : ''}" />
        <p style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">JPG・PNG・GIF など（推奨: 正方形）</p>
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
        <div class="color-custom-row">
          <label for="color-custom-input">カスタム</label>
          <input type="color" id="color-custom-input" value="${selectedColor}" />
        </div>
        <input type="hidden" id="member-color" value="${selectedColor}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-close').click()">キャンセル</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '更新' : '追加'}</button>
      </div>
    </form>
  `);

  // Color picker (palette)
  function applyColor(color) {
    document.getElementById('member-color').value = color;
    document.getElementById('color-custom-input').value = color;
    const placeholder = document.getElementById('avatar-preview-placeholder');
    if (placeholder) placeholder.style.background = color;
  }

  document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      applyColor(opt.dataset.color);
    });
  });

  document.getElementById('color-custom-input')?.addEventListener('input', (e) => {
    document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
    applyColor(e.target.value);
  });

  // Avatar upload
  document.getElementById('avatar-upload-btn')?.addEventListener('click', () => {
    document.getElementById('avatar-file-input').click();
  });

  document.getElementById('avatar-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    resizeImageToBase64(file, 160, (base64) => {
      document.getElementById('member-avatar').value = base64;
      // Claude API に画像を送る際は dataUrlToClaudeImageBlock を使用する。
      // これにより media_type（例: "image/jpeg"）が自動付与され、
      // "media_type: Field required" エラーが解消される。
      renderMemberForm._currentClaudeImageBlock = dataUrlToClaudeImageBlock(base64);
      const area = document.querySelector('.avatar-upload-area');
      const placeholder = document.getElementById('avatar-preview-placeholder');
      const existingImg = document.getElementById('avatar-preview-img');
      if (placeholder) placeholder.remove();
      if (existingImg) existingImg.remove();
      const img = document.createElement('img');
      img.className = 'avatar-preview';
      img.id = 'avatar-preview-img';
      img.src = base64;
      area.insertBefore(img, area.firstChild);

      // Show remove button if not already shown
      if (!document.getElementById('avatar-remove-btn')) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.id = 'avatar-remove-btn';
        removeBtn.className = 'btn btn-sm';
        removeBtn.style.cssText = 'color:var(--accent-red);background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);';
        removeBtn.textContent = '削除';
        document.querySelector('.avatar-upload-actions').appendChild(removeBtn);
        removeBtn.addEventListener('click', handleAvatarRemove);
      }
    });
    e.target.value = '';
  });

  function handleAvatarRemove() {
    document.getElementById('member-avatar').value = '';
    const color = document.getElementById('member-color').value;
    const nameVal = document.getElementById('member-name').value || (isEdit ? member.name : '？');
    const area = document.querySelector('.avatar-upload-area');
    const existingImg = document.getElementById('avatar-preview-img');
    if (existingImg) existingImg.remove();
    const placeholder = document.createElement('div');
    placeholder.className = 'avatar-preview-placeholder';
    placeholder.id = 'avatar-preview-placeholder';
    placeholder.style.background = color;
    placeholder.textContent = nameVal.charAt(0);
    area.insertBefore(placeholder, area.firstChild);
    document.getElementById('avatar-remove-btn')?.remove();
  }

  document.getElementById('avatar-remove-btn')?.addEventListener('click', handleAvatarRemove);

  document.getElementById('member-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('member-name').value.trim(),
      nickname: document.getElementById('member-nickname').value.trim(),
      color: document.getElementById('member-color').value,
      avatar: document.getElementById('member-avatar').value || ''
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

// ---- 画像リサイズ（Canvas） ----
function resizeImageToBase64(file, maxSize, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = Math.min(img.width, img.height, maxSize);
      const scale = size / Math.min(img.width, img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
        ? file.type
        : 'image/jpeg';
      callback(canvas.toDataURL(mimeType, 0.82));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
