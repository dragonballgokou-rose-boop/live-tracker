// ============================================
// Store - localStorage CRUD Operations
// ============================================

const STORAGE_KEYS = {
    LIVES: 'livetracker_lives',
    MEMBERS: 'livetracker_members',
    ATTENDANCE: 'livetracker_attendance'
};

// ============================================
// Cloud Sync (Google Apps Script)
// ============================================
// ユーザーがGAS URLを発行したらここに貼り付ける
export const GAS_URL = 'https://script.google.com/macros/s/AKfycbzsvKE56LE0VycDxAfRM2tafOROFCcDLhKOJRl05j2QU_IqikHoqtUkqoBwGc0SKgtN/exec';

let syncStatus = 'idle'; // 'idle' | 'syncing' | 'error'

export async function fetchFromGAS() {
    if (!GAS_URL) return false;
    try {
        syncStatus = 'syncing';
        window.dispatchEvent(new CustomEvent('livetracker:sync-start'));
        const response = await fetch(`${GAS_URL}?type=getAll`);
        const result = await response.json();

        if (result.success && result.data) {
            if (result.data.lives) saveAll(STORAGE_KEYS.LIVES, result.data.lives);
            if (result.data.members) saveAll(STORAGE_KEYS.MEMBERS, result.data.members);
            if (result.data.attendance) saveAll(STORAGE_KEYS.ATTENDANCE, result.data.attendance);
            syncStatus = 'idle';
            window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
            return true;
        }
        syncStatus = 'error';
        window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
        return false;
    } catch (e) {
        console.error('Fetch from GAS failed:', e);
        syncStatus = 'error';
        window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
        return false;
    }
}

// データの変更を検知してバックグラウンドで送信するためのタイマー
let syncTimeout = null;

export function triggerSync() {
    if (!GAS_URL) return;

    // 短時間に複数回の更新があった場合、最後の1回だけ送信する（デバウンス処理）
    if (syncTimeout) clearTimeout(syncTimeout);

    // UI側のToast通知などに利用できるよう、必要であればイベントを発火可能
    window.dispatchEvent(new CustomEvent('livetracker:sync-start'));

    syncTimeout = setTimeout(async () => {
        try {
            const data = {
                lives: getAll(STORAGE_KEYS.LIVES),
                members: getAll(STORAGE_KEYS.MEMBERS),
                attendance: getAll(STORAGE_KEYS.ATTENDANCE)
            };

            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain', // GASのCORS制約回避のため text/plain を使用
                },
                body: JSON.stringify({
                    action: 'updateAllData',
                    data: data
                })
            });
            const result = await response.json();
            if (result.success) {
                window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
            } else {
                throw new Error(result.message || 'Sync failed');
            }
        } catch (e) {
            console.error('Push to GAS failed:', e);
            window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
        }
    }, 1500); // 1.5秒間操作がなければ同期を実行
}

// ============================================
// Local Store
// ============================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ---------- Generic CRUD ----------

function getAll(key) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveAll(key, items) {
    localStorage.setItem(key, JSON.stringify(items));
    triggerSync(); // ローカル保存後にクラウドへ非同期送信
}

function addItem(key, item) {
    const items = getAll(key);
    const newItem = { ...item, id: generateId(), createdAt: new Date().toISOString() };
    items.push(newItem);
    saveAll(key, items);
    return newItem;
}

function updateItem(key, id, updates) {
    const items = getAll(key);
    const index = items.findIndex(item => item.id === id);
    if (index === -1) return null;
    items[index] = { ...items[index], ...updates, updatedAt: new Date().toISOString() };
    saveAll(key, items);
    return items[index];
}

function deleteItem(key, id) {
    const items = getAll(key);
    const filtered = items.filter(item => item.id !== id);
    saveAll(key, filtered);
    return filtered.length < items.length;
}

function getById(key, id) {
    const items = getAll(key);
    return items.find(item => item.id === id) || null;
}

// ---------- Lives ----------

export function getLives() {
    return getAll(STORAGE_KEYS.LIVES).sort((a, b) => {
        return new Date(a.dateStart || a.date) - new Date(b.dateStart || b.date);
    });
}

export function getLiveById(id) {
    return getById(STORAGE_KEYS.LIVES, id);
}

export function addLive(live) {
    return addItem(STORAGE_KEYS.LIVES, live);
}

export function updateLive(id, updates) {
    return updateItem(STORAGE_KEYS.LIVES, id, updates);
}

export function deleteLive(id) {
    // 関連する参戦記録も削除
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const filtered = attendance.filter(a => a.liveId !== id);
    saveAll(STORAGE_KEYS.ATTENDANCE, filtered);
    return deleteItem(STORAGE_KEYS.LIVES, id);
}

// ---------- Members ----------

export function getMembers() {
    return getAll(STORAGE_KEYS.MEMBERS).sort((a, b) => {
        return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

export function getMemberById(id) {
    return getById(STORAGE_KEYS.MEMBERS, id);
}

export function addMember(member) {
    return addItem(STORAGE_KEYS.MEMBERS, member);
}

export function updateMember(id, updates) {
    return updateItem(STORAGE_KEYS.MEMBERS, id, updates);
}

export function deleteMember(id) {
    // 関連する参戦記録も削除
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const filtered = attendance.filter(a => a.memberId !== id);
    saveAll(STORAGE_KEYS.ATTENDANCE, filtered);
    return deleteItem(STORAGE_KEYS.MEMBERS, id);
}

// ---------- Attendance ----------

export function getAttendance() {
    return getAll(STORAGE_KEYS.ATTENDANCE);
}

export function getAttendanceByLive(liveId) {
    return getAll(STORAGE_KEYS.ATTENDANCE).filter(a => a.liveId === liveId);
}

export function getAttendanceByMember(memberId) {
    return getAll(STORAGE_KEYS.ATTENDANCE).filter(a => a.memberId === memberId);
}

export function setAttendance(liveId, memberId, status) {
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const existing = attendance.findIndex(a => a.liveId === liveId && a.memberId === memberId);

    if (existing !== -1) {
        attendance[existing].status = status;
        attendance[existing].updatedAt = new Date().toISOString();
    } else {
        attendance.push({
            id: generateId(),
            liveId,
            memberId,
            status,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    saveAll(STORAGE_KEYS.ATTENDANCE, attendance);
}

export function getAttendanceStatus(liveId, memberId) {
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const record = attendance.find(a => a.liveId === liveId && a.memberId === memberId);
    return record ? record.status : null;
}

// ---------- Date-based Attendance (日付ごとの参戦管理) ----------

export function getDatesForLive(live) {
    const start = new Date(live.dateStart || live.date);
    const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const dates = [];
    const cursor = new Date(start);
    let dayNum = 1;
    while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        dates.push({
            dateStr: `${y}-${m}-${d}`,
            dayNum,
            date: new Date(cursor)
        });
        cursor.setDate(cursor.getDate() + 1);
        dayNum++;
    }
    return dates;
}

export function setDayAttendance(liveId, dateStr, memberId, status) {
    const dayKey = `${liveId}_${dateStr}`;
    setAttendance(dayKey, memberId, status);
}

export function getDayAttendanceStatus(liveId, dateStr, memberId) {
    const dayKey = `${liveId}_${dateStr}`;
    let status = getAttendanceStatus(dayKey, memberId);
    if (status === null) {
        status = getAttendanceStatus(liveId, memberId);
    }
    return status || 'undecided';
}

// ---------- Statistics ----------

export function getStats() {
    const lives = getLives();
    const members = getMembers();
    const attendance = getAttendance();
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const upcomingLives = lives.filter(l => new Date(l.dateEnd || l.dateStart || l.date) >= now);
    const pastLives = lives.filter(l => new Date(l.dateEnd || l.dateStart || l.date) < now);

    // 全メンバー×全ライブ×全日程 での「〇（going）」の数を正確にカウント
    let goingCount = 0;
    let totalPossibleSchedules = 0;

    lives.forEach(live => {
        const dates = getDatesForLive(live);
        totalPossibleSchedules += dates.length;
        dates.forEach(d => {
            members.forEach(m => {
                if (getDayAttendanceStatus(live.id, d.dateStr, m.id) === 'going') {
                    goingCount++;
                }
            });
        });
    });

    return {
        totalLives: lives.length,
        upcomingLives: upcomingLives.length,
        pastLives: pastLives.length,
        totalMembers: members.length,
        totalGoing: goingCount,
        attendanceRate: totalPossibleSchedules > 0 && members.length > 0
            ? Math.round((goingCount / (totalPossibleSchedules * members.length)) * 100)
            : 0
    };
}

// ---------- Export / Import ----------

export function exportData() {
    const data = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        lives: getAll(STORAGE_KEYS.LIVES),
        members: getAll(STORAGE_KEYS.MEMBERS),
        attendance: getAll(STORAGE_KEYS.ATTENDANCE)
    };
    return JSON.stringify(data, null, 2);
}

export function importData(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        if (!data.lives || !data.members || !data.attendance) {
            throw new Error('無効なデータ形式です');
        }
        saveAll(STORAGE_KEYS.LIVES, data.lives);
        saveAll(STORAGE_KEYS.MEMBERS, data.members);
        saveAll(STORAGE_KEYS.ATTENDANCE, data.attendance);
        return true;
    } catch (e) {
        console.error('Import error:', e);
        throw e;
    }
}
