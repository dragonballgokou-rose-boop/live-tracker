// ============================================
// Rooms View - ルーム選択・作成・参加
// ============================================
import { getCurrentUser, getUserRooms, createRoom, joinRoomByCode, leaveRoom, signOut, setCurrentRoom } from '../supabase.js';
import { showToast } from '../utils.js';

export async function renderRooms(onRoomSelected) {
    const app = document.getElementById('app');
    const user = await getCurrentUser();
    if (!user) return;

    app.innerHTML = `
        <div class="rooms-container">
            <div class="rooms-card">
                <div class="rooms-header">
                    <div class="auth-logo" style="margin-bottom:16px;">
                        <img src="icon.svg" alt="" width="36" height="36" class="auth-logo-img" />
                        <h1 class="auth-logo-text" style="font-size:20px;">LIVE<span class="logo-accent">TRACKER</span></h1>
                    </div>
                    <p style="color:var(--text-secondary);font-size:13px;margin-bottom:4px;">ログイン中: <strong style="color:var(--text-primary);">${escapeHtml(user.email || '')}</strong></p>
                </div>

                <div class="rooms-list-section">
                    <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                        参加中のルーム
                    </h2>
                    <div id="rooms-list">
                        <div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px;">読み込み中...</div>
                    </div>
                </div>

                <div class="rooms-actions">
                    <button id="create-room-btn" class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        新しいルームを作成
                    </button>
                    <button id="join-room-btn" class="btn btn-secondary" style="width:100%;justify-content:center;margin-bottom:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                        招待コードで参加
                    </button>
                    <button id="rooms-signout-btn" class="btn" style="width:100%;justify-content:center;color:var(--text-tertiary);background:transparent;border:1px solid var(--border-color);">
                        ログアウト
                    </button>
                </div>
            </div>
        </div>
    `;

    // ルーム一覧を読み込む
    await loadRoomsList(onRoomSelected);

    // イベント
    document.getElementById('create-room-btn').addEventListener('click', () => showCreateRoomModal(onRoomSelected));
    document.getElementById('join-room-btn').addEventListener('click', () => showJoinRoomModal(onRoomSelected));
    document.getElementById('rooms-signout-btn').addEventListener('click', async () => {
        try {
            await signOut();
            location.reload();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

async function loadRoomsList(onRoomSelected) {
    const listEl = document.getElementById('rooms-list');
    if (!listEl) return;

    try {
        const rooms = await getUserRooms();

        if (rooms.length === 0) {
            listEl.innerHTML = `
                <div style="text-align:center;padding:24px 16px;color:var(--text-tertiary);font-size:13px;border:1px dashed var(--border-color);border-radius:10px;">
                    <div style="font-size:32px;margin-bottom:8px;">🏠</div>
                    まだルームに参加していません。<br>新規作成か招待コードで参加しましょう。
                </div>
            `;
            return;
        }

        listEl.innerHTML = rooms.map(room => `
            <div class="room-item" data-room-id="${room.id}" style="cursor:pointer;">
                <div class="room-item-info">
                    <div class="room-item-name">${escapeHtml(room.name)}</div>
                    ${room.description ? `<div class="room-item-desc">${escapeHtml(room.description)}</div>` : ''}
                    <div class="room-item-meta">
                        ${room.role === 'owner' ? '<span class="badge" style="font-size:10px;background:rgba(139,92,246,0.2);color:var(--accent-purple-light);border:1px solid rgba(139,92,246,0.3);">オーナー</span>' : ''}
                        <span style="font-size:11px;color:var(--text-tertiary);">招待コード: <code style="font-family:monospace;letter-spacing:1px;">${room.invite_code || ''}</code></span>
                    </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--text-tertiary);"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
        `).join('');

        listEl.querySelectorAll('.room-item').forEach(item => {
            item.addEventListener('click', () => {
                const room = rooms.find(r => r.id === item.dataset.roomId);
                if (room) {
                    setCurrentRoom(room);
                    onRoomSelected(room);
                }
            });
        });
    } catch (err) {
        listEl.innerHTML = `<p style="color:var(--accent-red);font-size:13px;padding:12px;">${escapeHtml(err.message)}</p>`;
    }
}

function showCreateRoomModal(onRoomSelected) {
    // シンプルなモーダル（既存のshowModal使わず直接作成してimport循環を避ける）
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal" style="max-width:420px;">
            <div class="modal-header">
                <h3 class="modal-title">新しいルームを作成</h3>
                <button class="modal-close" id="create-room-close">&times;</button>
            </div>
            <div class="modal-body">
                <form id="create-room-form">
                    <div class="form-group">
                        <label class="form-label" for="room-name-input">ルーム名 <span style="color:var(--accent-red)">*</span></label>
                        <input type="text" id="room-name-input" class="form-input" placeholder="例: みんな大好き" required maxlength="50" />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="room-desc-input">説明（任意）</label>
                        <input type="text" id="room-desc-input" class="form-input" placeholder="簡単な説明" maxlength="200" />
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" id="create-room-cancel">キャンセル</button>
                        <button type="submit" class="btn btn-primary" id="create-room-submit">作成する</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#create-room-close').addEventListener('click', close);
    overlay.querySelector('#create-room-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#create-room-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('room-name-input').value.trim();
        const desc = document.getElementById('room-desc-input').value.trim();
        const submitBtn = document.getElementById('create-room-submit');

        if (!name) return;

        submitBtn.disabled = true;
        submitBtn.textContent = '作成中...';

        try {
            const room = await createRoom(name, desc);
            close();
            setCurrentRoom(room);
            showToast(`ルーム「${room.name}」を作成しました`, 'success');
            onRoomSelected(room);
        } catch (err) {
            showToast(err.message || 'ルームの作成に失敗しました', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '作成する';
        }
    });
}

function showJoinRoomModal(onRoomSelected) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal" style="max-width:380px;">
            <div class="modal-header">
                <h3 class="modal-title">招待コードで参加</h3>
                <button class="modal-close" id="join-room-close">&times;</button>
            </div>
            <div class="modal-body">
                <form id="join-room-form">
                    <div class="form-group">
                        <label class="form-label" for="invite-code-input">招待コード <span style="color:var(--accent-red)">*</span></label>
                        <input type="text" id="invite-code-input" class="form-input"
                            placeholder="例: ABCD1234"
                            maxlength="8"
                            style="text-transform:uppercase;letter-spacing:2px;font-family:monospace;font-size:16px;text-align:center;"
                            required />
                        <p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">ルームオーナーから8文字のコードをもらってください</p>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" id="join-room-cancel">キャンセル</button>
                        <button type="submit" class="btn btn-primary" id="join-room-submit">参加する</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#join-room-close').addEventListener('click', close);
    overlay.querySelector('#join-room-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#join-room-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('invite-code-input').value.trim().toUpperCase();
        const submitBtn = document.getElementById('join-room-submit');

        if (!code) return;

        submitBtn.disabled = true;
        submitBtn.textContent = '参加中...';

        try {
            const room = await joinRoomByCode(code);
            close();
            setCurrentRoom(room);
            showToast(`ルーム「${room.name}」に参加しました`, 'success');
            onRoomSelected(room);
        } catch (err) {
            showToast(err.message || '参加に失敗しました', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '参加する';
        }
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
