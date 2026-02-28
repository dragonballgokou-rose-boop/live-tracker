// ============================================
// Lives Management View
// ============================================
import { getLives, addLive, updateLive, deleteLive } from '../store.js';
import { showModal, closeModal, showToast, showConfirm } from '../utils.js';

export function renderLives() {
  const content = document.getElementById('page-content');
  const lives = getLives();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  content.innerHTML = `
    <div class="section-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="color: var(--text-secondary); font-size: 14px;">全 ${lives.length} 件</span>
      </div>
      <button id="add-live-btn" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        ライブを追加
      </button>
    </div>

    ${lives.length > 0 ? `
      <div class="live-list">
        ${lives.map(live => {
    const startDate = new Date(live.dateStart || live.date);
    const endDate = live.dateEnd ? new Date(live.dateEnd) : null;
    startDate.setHours(0, 0, 0, 0);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lastDate = endDate ? new Date(live.dateEnd) : startDate;
    lastDate.setHours(0, 0, 0, 0);
    const isPast = lastDate < now;
    const isToday = startDate.getTime() <= now.getTime() && lastDate.getTime() >= now.getTime();

    const metaParts = [];
    if (live.artist) metaParts.push(escapeHtml(live.artist));
    if (live.venue) {
      const pref = extractPrefecture(live.venue);
      metaParts.push(pref ? `${escapeHtml(live.venue)}（${pref}）` : escapeHtml(live.venue));
    }
    metaParts.push(formatDateRange(live));
    const statusBadge = isToday
      ? '<span class="badge badge-today">開催中！</span>'
      : isPast
        ? '<span class="badge badge-past">終了</span>'
        : '<span class="badge badge-upcoming">予定</span>';

    return `
          <div class="card live-card${isPast ? ' live-card-past' : ''}">
            <div class="live-card-main" onclick="showLiveDetailsModal('${live.id}')">
              <div class="live-date-badge">
                <span class="month">${months[startDate.getMonth()]}</span>
                <span class="day">${startDate.getDate()}</span>
                ${endDate ? `<span class="live-date-end">〜${endDate.getDate()}</span>` : ''}
              </div>
              <div class="live-info">
                <div class="live-name-row">
                  <span class="live-name">${escapeHtml(live.name)}</span>
                  ${statusBadge}
                </div>
                <div class="live-meta">${metaParts.join(' · ')}</div>
              </div>
            </div>
            <div class="live-actions">
              <button class="btn btn-icon btn-secondary edit-live-btn" data-id="${live.id}" title="編集">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="btn btn-icon btn-danger delete-live-btn" data-id="${live.id}" title="削除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
          `;
  }).join('')}
      </div>
    ` : `
      <div class="card empty-state">
        <div class="empty-state-icon">🎸</div>
        <p class="empty-state-text">まだライブが登録されていません</p>
        <p style="color: var(--text-tertiary); font-size: 14px;">「ライブを追加」ボタンから最初のライブを登録しましょう！</p>
      </div>
    `}
  `;

  // Events
  document.getElementById('add-live-btn')?.addEventListener('click', () => openLiveModal());

  content.querySelectorAll('.edit-live-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const live = getLives().find(l => l.id === btn.dataset.id);
      if (live) openLiveModal(live);
    });
  });

  content.querySelectorAll('.delete-live-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showConfirm('ライブを削除', 'このライブと関連する参戦記録を削除しますか？\nこの操作は取り消せません。', () => {
        deleteLive(btn.dataset.id);
        showToast('ライブを削除しました', 'success');
        renderLives();
      });
    });
  });
}

function openLiveModal(live = null) {
  const isEdit = !!live;
  const title = isEdit ? 'ライブを編集' : 'ライブを追加';

  showModal(title, `
    <form id="live-form">
      <div class="form-group">
        <label class="form-label" for="live-name">ライブ名 <span style="color: var(--accent-red)">*</span></label>
        <input type="text" id="live-name" class="form-input" placeholder="例: SUMMER SONIC 2026" value="${isEdit ? escapeAttr(live.name) : ''}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="live-artist">アーティスト</label>
        <input type="text" id="live-artist" class="form-input" placeholder="例: ONE OK ROCK" value="${isEdit ? escapeAttr(live.artist || '') : ''}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="live-date-start">開始日 <span style="color: var(--accent-red)">*</span></label>
          <input type="date" id="live-date-start" class="form-input" value="${isEdit ? (live.dateStart || live.date || '') : ''}" required />
        </div>
        <div class="form-group">
          <label class="form-label" for="live-date-end">終了日 <span style="color: var(--text-tertiary); font-size: 12px;">(複数日の場合)</span></label>
          <input type="date" id="live-date-end" class="form-input" value="${isEdit ? (live.dateEnd || '') : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="live-venue">会場</label>
        <input type="text" id="live-venue" class="form-input" placeholder="例: 幕張メッセ" value="${isEdit ? escapeAttr(live.venue || '') : ''}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="live-memo">メモ</label>
        <textarea id="live-memo" class="form-input" rows="3" placeholder="備考があれば入力">${isEdit ? escapeHtml(live.memo || '') : ''}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-close').click()">キャンセル</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '更新' : '追加'}</button>
      </div>
    </form>
  `);

  document.getElementById('live-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const dateStart = document.getElementById('live-date-start').value;
    const dateEnd = document.getElementById('live-date-end').value;

    const data = {
      name: document.getElementById('live-name').value.trim(),
      artist: document.getElementById('live-artist').value.trim(),
      dateStart: dateStart,
      dateEnd: dateEnd || '',
      venue: document.getElementById('live-venue').value.trim(),
      memo: document.getElementById('live-memo').value.trim()
    };

    if (!data.name || !data.dateStart) {
      showToast('ライブ名と開始日は必須です', 'error');
      return;
    }

    if (data.dateEnd && data.dateEnd < data.dateStart) {
      showToast('終了日は開始日以降にしてください', 'error');
      return;
    }

    if (isEdit) {
      updateLive(live.id, data);
      showToast('ライブを更新しました', 'success');
    } else {
      addLive(data);
      showToast('ライブを追加しました', 'success');
    }

    closeModal();
    renderLives();
  });
}

export function extractPrefecture(venue) {
  if (!venue) return '';
  const prefectures = ['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];
  for (const pref of prefectures) {
    if (venue.includes(pref)) return pref;
  }
  const cityMap = {
    '横浜':'神奈川','川崎':'神奈川','相模原':'神奈川','藤沢':'神奈川','横須賀':'神奈川',
    '幕張':'千葉','船橋':'千葉','柏':'千葉',
    'さいたま':'埼玉','浦和':'埼玉','川越':'埼玉',
    '仙台':'宮城',
    '名古屋':'愛知','豊橋':'愛知','豊田':'愛知',
    '札幌':'北海道','旭川':'北海道',
    '神戸':'兵庫','西宮':'兵庫','尼崎':'兵庫','姫路':'兵庫',
    '堺':'大阪','吹田':'大阪','豊中':'大阪',
    '金沢':'石川',
    '静岡':'静岡','浜松':'静岡',
    '宇都宮':'栃木',
    '那覇':'沖縄','宜野湾':'沖縄',
    '広島':'広島','岡山':'岡山','新潟':'新潟','熊本':'熊本','福岡':'福岡','北九州':'福岡',
  };
  for (const [city, pref] of Object.entries(cityMap)) {
    if (venue.includes(city)) return pref;
  }
  return '';
}

export function formatDateRange(live) {
  const start = new Date(live.dateStart || live.date);
  const startStr = `${start.getMonth() + 1}/${start.getDate()}`;

  if (live.dateEnd) {
    const end = new Date(live.dateEnd);
    const endStr = (start.getMonth() === end.getMonth())
      ? `${end.getDate()}`
      : `${end.getMonth() + 1}/${end.getDate()}`;
    return `${startStr}〜${endStr}`;
  }
  return startStr;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
