// ============================================
// Lives Management View
// ============================================
import { getLives, addLive, updateLive, deleteLive, getMembers, getDayAttendanceStatus, setDayAttendance, getDatesForLive } from '../store.js';
import { showModal, closeModal, showToast, showConfirm } from '../utils.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

let livesFilter = 'upcoming'; // 'upcoming' | 'past'

export function renderLives() {
  const content = document.getElementById('page-content');
  const lives = getLives();
  const members = getMembers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // フィルタリング & ソート
  const upcoming = lives.filter(l => {
    const last = new Date(l.dateEnd || l.dateStart || l.date);
    last.setHours(0, 0, 0, 0);
    return last >= now;
  }).sort((a, b) => new Date(a.dateStart || a.date) - new Date(b.dateStart || b.date)); // 昇順（近い順）

  const past = lives.filter(l => {
    const last = new Date(l.dateEnd || l.dateStart || l.date);
    last.setHours(0, 0, 0, 0);
    return last < now;
  }).sort((a, b) => new Date(b.dateStart || b.date) - new Date(a.dateStart || a.date)); // 降順（新しい順）

  const filtered = livesFilter === 'upcoming' ? upcoming : past;

  // 年月グループ化
  const groups = {};
  filtered.forEach(live => {
    const d = new Date(live.dateStart || live.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(live);
  });
  const sortedKeys = livesFilter === 'upcoming'
    ? Object.keys(groups).sort()          // 予定: 古い月から
    : Object.keys(groups).sort().reverse(); // 終了: 新しい月から

  const timelineHtml = sortedKeys.map(key => {
    const [year, mon] = key.split('-');
    const entries = groups[key].map(live => {
      const startD = new Date(live.dateStart || live.date);
      startD.setHours(0, 0, 0, 0);
      const endD = live.dateEnd ? new Date(live.dateEnd) : null;
      if (endD) endD.setHours(0, 0, 0, 0);
      const lastD = endD || startD;
      const isPast = lastD < now;
      const isOngoing = startD <= now && lastD >= now;
      const isWeekend = startD.getDay() === 0 || startD.getDay() === 6;
      const endLabel = endD ? `〜${endD.getDate()}` : '';

      const metaParts = [];
      if (live.artist) metaParts.push(escapeHtml(live.artist));
      if (live.venue) {
        const pref = live.prefecture || extractPrefecture(live.venue);
        metaParts.push(pref ? `${escapeHtml(live.venue)}（${pref}）` : escapeHtml(live.venue));
      }

      const statusBadge = isOngoing
        ? `<span class="badge badge-today" style="font-size:10px;padding:1px 8px;">開催中</span>`
        : !isPast
          ? `<span class="badge badge-upcoming" style="font-size:10px;padding:1px 8px;">予定</span>`
          : `<span class="badge badge-past" style="font-size:10px;padding:1px 8px;">終了</span>`;

      // 参戦メンバーチップ
      const liveDates = getDatesForLive(live);
      const goingChips = members.map(m => {
        const isGoing = liveDates.some(d => getDayAttendanceStatus(live.id, d.dateStr, m.id) === 'going');
        if (!isGoing) return '';
        return `<span class="history-member-chip"
          style="background:${m.color}20;border-color:${m.color}55;color:${m.color};">
          <span style="width:7px;height:7px;border-radius:50%;background:${m.color};display:inline-block;flex-shrink:0;"></span>
          ${escapeHtml(m.nickname || m.name)}
        </span>`;
      }).join('');

      return `
        <div class="history-entry${isPast ? ' history-entry-past' : ''}">
          <div class="history-entry-date">
            <span class="history-date-num">${startD.getDate()}${endLabel}</span>
            <span class="history-date-wd${isWeekend ? ' weekend' : ''}">${WEEKDAYS[startD.getDay()]}</span>
          </div>
          <div class="history-entry-body">
            <div class="history-entry-title" onclick="showLiveDetailsModal('${live.id}')">
              ${escapeHtml(live.name)}
              <span style="margin-left:2px;">${statusBadge}</span>
            </div>
            ${metaParts.length > 0 ? `<div class="history-entry-meta">${metaParts.join(' · ')}</div>` : ''}
            ${goingChips ? `<div class="history-entry-members">${goingChips}</div>` : ''}
            <div class="lives-entry-actions">
              <button class="btn btn-sm btn-secondary edit-live-btn" data-id="${live.id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                編集
              </button>
              <button class="btn btn-sm btn-danger delete-live-btn" data-id="${live.id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                削除
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="history-month-group">
        <div class="history-month-label">${year}年${parseInt(mon)}月</div>
        <div class="history-month-entries">${entries}</div>
      </div>
    `;
  }).join('');

  content.innerHTML = `
    <div class="section-header">
      <div class="live-filter-bar">
        <button class="live-filter-btn${livesFilter === 'upcoming' ? ' active' : ''}" data-filter="upcoming">
          予定 <span class="filter-count">${upcoming.length}</span>
        </button>
        <button class="live-filter-btn${livesFilter === 'past' ? ' active' : ''}" data-filter="past">
          終了 <span class="filter-count">${past.length}</span>
        </button>
      </div>
      <button id="add-live-btn" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ライブを追加
      </button>
    </div>

    ${filtered.length > 0 ? `<div class="history-timeline">${timelineHtml}</div>` : `
      <div class="card empty-state">
        <div class="empty-state-icon"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <p class="empty-state-text">${livesFilter === 'upcoming' ? '予定のライブがありません' : '終了したライブはありません'}</p>
        ${livesFilter === 'upcoming' ? '<p style="color:var(--text-tertiary);font-size:14px;">「ライブを追加」ボタンから登録しましょう！</p>' : ''}
      </div>
    `}
  `;

  // フィルターボタン
  content.querySelectorAll('.live-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      livesFilter = btn.dataset.filter;
      renderLives();
    });
  });

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

// ---- ライブ追加・編集モーダル ----
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
      <div class="form-group">
        <label class="form-label" for="live-date-start">開始日 <span style="color: var(--accent-red)">*</span></label>
        <input type="date" id="live-date-start" class="form-input" value="${isEdit ? toDateInputValue(live.dateStart || live.date) : ''}" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="live-date-end">終了日 <span style="color: var(--text-tertiary); font-size: 12px;">(複数日の場合)</span></label>
        <input type="date" id="live-date-end" class="form-input" value="${isEdit ? toDateInputValue(live.dateEnd) : ''}" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 2;">
          <label class="form-label" for="live-venue">会場</label>
          <input type="text" id="live-venue" class="form-input" placeholder="例: 幕張メッセ" value="${isEdit ? escapeAttr(live.venue || '') : ''}" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label" for="live-pref">都道府県 <span style="color: var(--text-tertiary); font-size: 11px;">（自動検出）</span></label>
          <input type="text" id="live-pref" class="form-input" placeholder="例: 神奈川" value="${isEdit ? escapeAttr(live.prefecture || '') : ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="live-memo">メモ</label>
        <textarea id="live-memo" class="form-input" rows="3" placeholder="備考があれば入力">${isEdit ? escapeHtml(live.memo || '') : ''}</textarea>
      </div>
      ${isEdit ? buildAttendanceSection(live) : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-close').click()">キャンセル</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '更新' : '追加'}</button>
      </div>
    </form>
  `);

  if (isEdit) setupAttendanceToggles();

  document.getElementById('live-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const dateStart = document.getElementById('live-date-start').value;
    const dateEnd = document.getElementById('live-date-end').value;

    const data = {
      name: document.getElementById('live-name').value.trim(),
      artist: document.getElementById('live-artist').value.trim(),
      dateStart,
      dateEnd: dateEnd || '',
      venue: document.getElementById('live-venue').value.trim(),
      prefecture: document.getElementById('live-pref').value.trim(),
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

// ---- 参戦状況セクション（編集モーダル用）----
function buildAttendanceSection(live) {
  const members = getMembers();
  if (members.length === 0) return '';
  const dates = getDatesForLive(live);
  if (dates.length === 0) return '';

  const isMulti = dates.length > 1;

  function sty(status) {
    if (status === 'going') return { label: '○', color: 'var(--accent-green)', border: 'var(--accent-green)' };
    if (status === 'not-going') return { label: '×', color: 'var(--accent-red)', border: 'var(--accent-red)' };
    return { label: '?', color: 'var(--text-tertiary)', border: 'var(--border-color)' };
  }

  const daysHtml = dates.map(d => {
    const wd = WEEKDAYS[d.date.getDay()];
    const membersHtml = members.map(m => {
      const status = getDayAttendanceStatus(live.id, d.dateStr, m.id);
      const s = sty(status);
      return `
        <button type="button" class="att-toggle-btn"
          data-live-id="${live.id}" data-date="${d.dateStr}" data-member-id="${m.id}" data-status="${status}"
          style="border-color:${s.border};">
          <span class="att-toggle-avatar" style="background:${m.color};">${escapeHtml(m.name.charAt(0))}</span>
          <span class="att-toggle-label" style="color:${s.color};">${s.label}</span>
          <span class="att-toggle-name">${escapeHtml(m.nickname || m.name)}</span>
        </button>
      `;
    }).join('');

    return isMulti
      ? `<div class="att-day-row">
          <span class="att-day-head">Day${d.dayNum}<br><small>${parseInt(d.dateStr.slice(5, 7))}/${parseInt(d.dateStr.slice(8))}(${wd})</small></span>
          <div class="att-members-row">${membersHtml}</div>
        </div>`
      : `<div class="att-members-row">${membersHtml}</div>`;
  }).join('');

  return `
    <div class="form-group">
      <label class="form-label">参戦状況 <span style="font-size:11px;color:var(--text-tertiary);">タップで切替（?→○→×）</span></label>
      <div class="att-section${isMulti ? ' att-section-multi' : ''}">
        ${daysHtml}
      </div>
    </div>
  `;
}

function setupAttendanceToggles() {
  const cycle = { undecided: 'going', going: 'not-going', 'not-going': 'undecided' };
  const display = {
    going: { label: '○', color: 'var(--accent-green)', border: 'var(--accent-green)' },
    'not-going': { label: '×', color: 'var(--accent-red)', border: 'var(--accent-red)' },
    undecided: { label: '?', color: 'var(--text-tertiary)', border: 'var(--border-color)' }
  };

  document.querySelectorAll('.att-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { liveId, date, memberId } = btn.dataset;
      const next = cycle[btn.dataset.status] || 'going';
      setDayAttendance(liveId, date, memberId, next);
      btn.dataset.status = next;
      const d = display[next];
      btn.querySelector('.att-toggle-label').textContent = d.label;
      btn.querySelector('.att-toggle-label').style.color = d.color;
      btn.style.borderColor = d.border;
    });
  });
}

// ---- Utilities ----
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

function toDateInputValue(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
