// @ts-nocheck — TODO: convert to strict TypeScript incrementally
// ============================================
// Members Management View
// ============================================
import {
  getMembers, addMember, updateMember, deleteMember,
  getAttendanceByMember, getLives, getDatesForLive, getDayAttendanceStatus,
  buildAttendanceLookup, lookupDayAttendance,
  getOfficialLink, setOfficialLink,
} from '../store.js';
import { showModal, closeModal, showToast, showConfirm, memberAvatarHtml, resizeImageToBase64 } from '../utils.js';
import {
  fetchOfficialMembers, buildOfficialBlogUrl, findOfficialMemberByName,
  getOfficialMemberSync, fetchOfficialMemberFeeds, getMemberFeedSync,
} from '../officialMembers.js';
import {
  isPushSupported, hasVapidKey, getCurrentStatus,
  enablePush, disablePush, updatePrefs, DEFAULT_PREFS,
} from '../push.js';

// ── セクション見出し用 SVG アイコン（feather スタイル / 14px / stroke=currentColor）
const ICON_ATTR = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICON_CLIPBOARD = `<svg class="oshi-section-icon" ${ICON_ATTR}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`;
const ICON_EDIT = `<svg class="oshi-section-icon" ${ICON_ATTR}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const ICON_CALENDAR = `<svg class="oshi-section-icon" ${ICON_ATTR}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const ICON_EDIT_LG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const ICON_BELL = `<svg class="oshi-section-icon" ${ICON_ATTR}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

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

  // 参戦ルックアップを 1 回だけ構築
  const attMap = buildAttendanceLookup();

  // 公式メンバー（推しメン情報）を非同期で取得、まだなら load 後に再描画
  if (!getOfficialMemberSync('__probe__', 'nogi') && !(window as any).__officialMembersLoaded) {
    (window as any).__officialMembersLoaded = true;
    fetchOfficialMembers()
      .then(() => renderMembers())
      .catch(() => { /* silently ignore */ });
  }

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
        if (lookupDayAttendance(attMap, live.id, d.dateStr, member.id) === 'going') {
          goingCount++;
        }
      });
    });

    const rate = totalPossibleSchedules > 0 ? Math.round((goingCount / totalPossibleSchedules) * 100) : 0;

    const link = getOfficialLink(member.id);
    const oshi = getOfficialMemberSync(link?.officialCode, link?.officialGroup);
    const oshiChipHtml = link && oshi ? `
      <button class="oshi-chip" data-action="open-oshi" data-member-id="${member.id}" onclick="event.stopPropagation()" title="${escapeAttr(oshi.name || '')}の詳細を開く">
        ${oshi.imgUrl ? `<img class="oshi-chip-img" src="${escapeAttr(oshi.imgUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy" />` : '<span class="oshi-chip-img oshi-chip-ph">★</span>'}
        <span class="oshi-chip-text">
          <span class="oshi-chip-label">推しメン</span>
          <span class="oshi-chip-name">${escapeHtml(oshi.name || '')}</span>
        </span>
      </button>
    ` : (link && !oshi ? `
      <button class="oshi-chip oshi-chip-unknown" data-action="open-oshi" data-member-id="${member.id}" onclick="event.stopPropagation()">
        <span class="oshi-chip-img oshi-chip-ph">★</span>
        <span class="oshi-chip-text">
          <span class="oshi-chip-label">推しメン</span>
          <span class="oshi-chip-name">（公式データ未取得）</span>
        </span>
      </button>
    ` : '');
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
            ${oshiChipHtml}
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

  content.querySelectorAll('[data-action="open-oshi"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.memberId;
      if (id) openOshiModal(id);
    });
  });

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

// ============================================
// 推しメン詳細モーダル
// ============================================

async function openOshiModal(memberId: string): Promise<void> {
  const user = getMembers().find(m => m.id === memberId);
  const link = getOfficialLink(memberId);
  if (!user || !link) {
    showToast('推しメンが設定されていません', 'error');
    return;
  }

  showModal('推しメン', `
    <div class="oshi-modal-loading" style="padding:40px 0;text-align:center;color:var(--text-secondary);">
      <div class="loader-spinner" style="margin:0 auto 12px;"></div>
      読み込み中…
    </div>
  `);

  // 公式データ並列取得: メンバー一覧 + 個別フィード
  let oshiData: ReturnType<typeof getOfficialMemberSync> = null;
  await Promise.all([
    fetchOfficialMembers()
      .then(() => { oshiData = getOfficialMemberSync(link.officialCode, link.officialGroup); })
      .catch(() => {}),
    fetchOfficialMemberFeeds().catch(() => null),
  ]);

  if (!oshiData) {
    showModal('推しメン', `
      <p style="padding:20px;">公式メンバー情報が見つかりません。ピッカーで設定し直してください。</p>
    `);
    return;
  }

  const feeds = getMemberFeedSync(link.officialCode, link.officialGroup);
  const blogUrl = buildOfficialBlogUrl(link.officialCode, link.officialGroup);
  // 確認済: スケジュールはメンバー詳細ページ /artist/<code> に埋め込まれている
  const scheduleUrl = oshiData.group === 'nogi'
    ? `https://www.nogizaka46.com/s/n46/artist/${encodeURIComponent(oshiData.code)}?ima=0000`
    : oshiData.group === 'saku'
    ? `https://sakurazaka46.com/s/s46/artist/${encodeURIComponent(oshiData.code)}?ima=0000`
    : null;
  const artist = oshiData.artist || (oshiData.group === 'nogi' ? '乃木坂46' : oshiData.group === 'saku' ? '櫻坂46' : '');

  const renderBlogRow = (b: NonNullable<typeof feeds>['blog'][number]) => `
    <a class="oshi-blog-row" href="${escapeAttr(b.url)}" target="_blank" rel="noopener noreferrer">
      ${b.thumbnail
        ? `<img class="oshi-blog-thumb" src="${escapeAttr(b.thumbnail)}" referrerpolicy="no-referrer" loading="lazy" />`
        : `<div class="oshi-blog-thumb oshi-blog-thumb-ph">${ICON_EDIT_LG}</div>`}
      <div class="oshi-blog-body">
        <div class="oshi-blog-title">${escapeHtml(b.title)}</div>
        ${b.date ? `<div class="oshi-blog-date">${escapeHtml(formatBlogDate(b.date))}</div>` : ''}
      </div>
    </a>
  `;

  const renderScheduleRow = (s: NonNullable<typeof feeds>['schedule'][number]) => `
    <li class="oshi-sched-row">
      ${s.dayOfMonth != null ? `<span class="oshi-sched-day">${s.dayOfMonth}</span>` : '<span class="oshi-sched-day">·</span>'}
      <div class="oshi-sched-body">
        ${s.cate ? `<span class="oshi-sched-cate">${escapeHtml(s.cate)}</span>` : ''}
        <span class="oshi-sched-title">${escapeHtml(s.title)}</span>
      </div>
    </li>
  `;

  showModal(`${user.name} の推しメン`, `
    <div class="oshi-modal">
      <div class="oshi-hero">
        ${oshiData.imgUrl ? `<img class="oshi-hero-img" src="${escapeAttr(oshiData.imgUrl)}" referrerpolicy="no-referrer" />` : '<div class="oshi-hero-img oshi-hero-ph">★</div>'}
        <div class="oshi-hero-info">
          <div class="oshi-hero-artist">${escapeHtml(artist)}</div>
          <div class="oshi-hero-name">${escapeHtml(oshiData.name || '')}</div>
          ${oshiData.kana ? `<div class="oshi-hero-kana">${escapeHtml(oshiData.kana)}</div>` : ''}
          ${oshiData.generation ? `<div class="oshi-hero-gen">${escapeHtml(oshiData.generation)}</div>` : ''}
        </div>
      </div>

      <div class="oshi-actions">
        ${blogUrl ? `<a class="btn btn-primary" href="${escapeAttr(blogUrl)}" target="_blank" rel="noopener noreferrer">
          公式ブログを開く ↗
        </a>` : ''}
        ${scheduleUrl ? `<a class="btn btn-secondary" href="${escapeAttr(scheduleUrl)}" target="_blank" rel="noopener noreferrer">出演予定を開く ↗</a>` : ''}
        ${oshiData.detailUrl ? `<a class="btn btn-secondary" href="${escapeAttr(oshiData.detailUrl)}" target="_blank" rel="noopener noreferrer">プロフィール↗</a>` : ''}
      </div>

      ${feeds && feeds.profile && Object.values(feeds.profile).some(v => v != null) ? `
      <div class="oshi-section">
        <h4 class="oshi-section-head">${ICON_CLIPBOARD}<span>プロフィール</span></h4>
        <dl class="oshi-profile">
          ${feeds.profile.birthday ? `<dt>誕生日</dt><dd>${escapeHtml(formatProfileBirthday(feeds.profile.birthday))}</dd>` : ''}
          ${feeds.profile.height ? `<dt>身長</dt><dd>${escapeHtml(feeds.profile.height)}</dd>` : ''}
          ${feeds.profile.bloodType ? `<dt>血液型</dt><dd>${escapeHtml(feeds.profile.bloodType)}型</dd>` : ''}
          ${feeds.profile.birthplace ? `<dt>出身地</dt><dd>${escapeHtml(feeds.profile.birthplace)}</dd>` : ''}
          ${feeds.profile.zodiac ? `<dt>星座</dt><dd>${escapeHtml(feeds.profile.zodiac)}</dd>` : ''}
        </dl>
      </div>
      ` : ''}

      <div class="oshi-section">
        <h4 class="oshi-section-head">${ICON_EDIT}<span>最新ブログ</span></h4>
        ${feeds && feeds.blog.length > 0
          ? `<div class="oshi-blog-list">${feeds.blog.slice(0, 10).map(renderBlogRow).join('')}</div>`
          : `<p style="color:var(--text-tertiary);font-size:13px;">${feeds ? 'ブログ記事はありません。' : 'フィードデータが未生成です（毎日自動更新）。公式ブログリンクから直接ご覧ください。'}</p>`}
      </div>

      <div class="oshi-section">
        <h4 class="oshi-section-head">${ICON_CALENDAR}<span>直近の出演予定</span></h4>
        ${feeds && feeds.schedule.length > 0
          ? `<ul class="oshi-sched-list">${feeds.schedule.slice(0, 10).map(renderScheduleRow).join('')}</ul>`
          : `<p style="color:var(--text-tertiary);font-size:13px;">${feeds ? '直近の予定はありません。' : 'フィードデータが未生成です。出演予定リンクから直接ご覧ください。'}</p>`}
      </div>

      <div class="oshi-section">
        <h4 class="oshi-section-head">${ICON_BELL}<span>通知設定</span></h4>
        <div id="oshi-push-section" data-member-id="${user.id}" data-oshi-code="${escapeAttr(oshiData.code || '')}" data-oshi-group="${escapeAttr(oshiData.group || '')}">
          <p style="color:var(--text-tertiary);font-size:12px;">読み込み中…</p>
        </div>
      </div>
    </div>
  `);

  // 通知設定の非同期初期化（未ハンドル throw で UI がハングしないよう catch）
  wireUpPushSection().catch(err => {
    console.warn('wireUpPushSection failed:', err);
    const root = document.getElementById('oshi-push-section');
    if (root) root.innerHTML = `<p style="color:var(--text-tertiary);font-size:12px;">通知設定の読み込みに失敗しました: ${String(err?.message || err)}</p>`;
  });
}

async function wireUpPushSection(): Promise<void> {
  const root = document.getElementById('oshi-push-section');
  if (!root) return;

  const memberId  = root.dataset.memberId  || '';
  const oshiCode  = root.dataset.oshiCode  || '';
  const oshiGroup = root.dataset.oshiGroup || '';

  const render = (inner: string) => { root.innerHTML = inner; };

  // 即座に「進捗が分かる」表示に差し替える
  render(`<p style="color:var(--text-tertiary);font-size:11px;">環境を確認中…</p>`);

  if (!isPushSupported()) {
    render(`<p style="color:var(--text-tertiary);font-size:12px;">この端末のブラウザでは通知に対応していません。<br/>iOS は Safari の「ホーム画面に追加」で開いてください。</p>`);
    return;
  }
  if (!hasVapidKey()) {
    render(`<p style="color:var(--text-tertiary);font-size:12px;">通知サーバ鍵 (VAPID) が未設定です。<code>VITE_VAPID_PUBLIC_KEY</code> を設定してください。</p>`);
    return;
  }

  render(`<p style="color:var(--text-tertiary);font-size:11px;">購読状態を確認中…</p>`);
  // getCurrentStatus が 5 秒以内に返らなければ「未購読」として扱い UI を進める
  const timeout = new Promise<any>(resolve => setTimeout(() => resolve({
    supported: true, permission: 'default' as NotificationPermission, subscribed: false, prefs: null,
    _timedOut: true,
  }), 5000));
  const status = await Promise.race([getCurrentStatus(), timeout]);
  if ((status as any)._timedOut) {
    console.warn('[push] getCurrentStatus timed out; falling back to unsubscribed state');
  }

  if (!status.subscribed) {
    render(`
      <p style="color:var(--text-secondary);font-size:12px;margin-bottom:8px;">
        推しメンの新しいブログや、参戦予定ライブの前日・当日リマインドを通知します。
      </p>
      <button id="oshi-push-enable" class="btn btn-primary btn-sm">通知をオンにする</button>
      ${status.permission === 'denied' ? `<p style="color:var(--accent-red);font-size:11px;margin-top:6px;">ブラウザの通知権限がブロックされています。サイト設定から許可してください。</p>` : ''}
    `);
    const btn = document.getElementById('oshi-push-enable') as HTMLButtonElement | null;
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '登録中…';
        const res = await enablePush({ memberId, oshiCode: oshiCode || null, oshiGroup: oshiGroup || null });
        if (res.ok) {
          showToast('通知をオンにしました', 'success');
          wireUpPushSection();
        } else {
          btn.disabled = false;
          btn.textContent = '通知をオンにする';
          const msg =
            res.reason === 'permission-denied' ? '通知が許可されませんでした' :
            res.reason === 'no-vapid-key'      ? 'VAPID 鍵が未設定です' :
            res.reason === 'supabase-not-configured' ? 'Supabase 未設定です' :
            `通知の登録に失敗: ${res.reason}`;
          showToast(msg, 'error');
        }
      });
    }
    return;
  }

  const prefs = status.prefs || DEFAULT_PREFS;
  const row = (key: keyof typeof prefs, label: string, desc: string) => `
    <label class="push-pref-row">
      <input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''} />
      <span class="push-pref-label">
        <span class="push-pref-title">${label}</span>
        <span class="push-pref-desc">${desc}</span>
      </span>
    </label>
  `;
  render(`
    <div class="push-pref-list">
      ${row('blog',          '新着ブログ',       '推しメンのブログが更新されたら通知')}
      ${row('schedule',      '出演予定の更新',   '推しメンのスケジュールが更新されたら通知')}
      ${row('live_prev_day', 'ライブ前日リマインド', '参戦予定ライブの前日に通知')}
      ${row('live_day',      'ライブ当日リマインド', '参戦予定ライブの当日朝に通知')}
    </div>
    <button id="oshi-push-disable" class="btn btn-sm" style="margin-top:10px;color:var(--accent-red);background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);">通知をオフにする</button>
  `);

  root.querySelectorAll<HTMLInputElement>('input[data-pref]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const key = cb.dataset.pref as keyof typeof prefs;
      const next = await updatePrefs({ [key]: cb.checked } as any);
      if (!next) {
        cb.checked = !cb.checked;
        showToast('設定の保存に失敗しました', 'error');
      }
    });
  });
  const off = document.getElementById('oshi-push-disable');
  if (off) off.addEventListener('click', async () => {
    await disablePush();
    showToast('通知をオフにしました', 'success');
    wireUpPushSection();
  });
}

function formatBlogDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  return hh ? `${y}.${mo}.${d} ${hh}:${mm}` : `${y}.${mo}.${d}`;
}

/** "2001-08-09" → "2001年8月9日"、年なし "08-09" → "8月9日" */
function formatProfileBirthday(s: string): string {
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${full[1]}年${Number(full[2])}月${Number(full[3])}日`;
  const md = s.match(/^(\d{2})-(\d{2})$/);
  if (md) return `${Number(md[1])}月${Number(md[2])}日`;
  return s;
}

function openMemberModal(member = null) {
  const isEdit = !!member;
  const title = isEdit ? 'メンバーを編集' : 'メンバーを追加';
  const selectedColor = member?.color || MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
  const existingLink = isEdit ? getOfficialLink(member.id) : null;

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
        <label class="form-label" for="member-official">公式メンバー紐付け（推しメンの公式ブログを開くために使用）</label>
        <select id="member-official" class="form-input">
          <option value="">— 未設定 —</option>
          <option value="__loading__">公式一覧を読み込み中…</option>
        </select>
        <p style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">端末ごとに保存。Supabase には同期されません。</p>
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

  // 公式メンバーピッカーを非同期で populate
  (async () => {
    const sel = document.getElementById('member-official');
    if (!sel) return;
    try {
      const data = await fetchOfficialMembers();
      const members = Array.isArray(data.members) ? data.members : [];
      const nogi = members.filter(m => m.group === 'nogi' && !m.graduated);
      const saku = members.filter(m => m.group === 'saku' && !m.graduated);
      const grad = members.filter(m => m.graduated);
      const currentKey = existingLink
        ? `${existingLink.officialGroup}:${existingLink.officialCode}`
        : '';
      const suggested = !existingLink && isEdit
        ? findOfficialMemberByName(member?.name || '', members)
        : null;
      const suggestedKey = suggested ? `${suggested.group}:${suggested.code}` : '';
      const opt = (m) => {
        const key = `${m.group}:${m.code}`;
        const label = [m.name || m.eng || m.code, m.kana ? `（${m.kana}）` : ''].join('');
        const sel = key === currentKey || (!currentKey && key === suggestedKey);
        return `<option value="${key}"${sel ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      };
      const optgroup = (label, list) => list.length === 0 ? '' :
        `<optgroup label="${escapeHtml(label)}">${list.map(opt).join('')}</optgroup>`;
      sel.innerHTML =
        `<option value=""${!currentKey && !suggestedKey ? ' selected' : ''}>— 未設定 —</option>` +
        optgroup('乃木坂46', nogi) +
        optgroup('櫻坂46', saku) +
        optgroup('卒業メンバー', grad);
    } catch (e) {
      sel.innerHTML = `<option value="">— 公式一覧の取得に失敗 —</option>`;
      console.warn('[members] fetchOfficialMembers failed', e);
    }
  })();

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

    const officialKey = (document.getElementById('member-official')?.value || '').trim();
    let officialGroup = null;
    let officialCode = null;
    if (officialKey && officialKey !== '__loading__') {
      const ix = officialKey.indexOf(':');
      if (ix > 0) {
        officialGroup = officialKey.slice(0, ix);
        officialCode  = officialKey.slice(ix + 1);
      }
    }

    let savedId;
    if (isEdit) {
      updateMember(member.id, data);
      savedId = member.id;
      showToast('メンバーを更新しました', 'success');
    } else {
      const created = addMember(data);
      savedId = created.id;
      showToast('メンバーを追加しました', 'success');
    }
    setOfficialLink(savedId, officialCode, officialGroup);

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
