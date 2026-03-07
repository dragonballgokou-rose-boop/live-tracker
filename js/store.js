// ============================================
// Store - localStorage CRUD Operations
// ============================================

import { supabase } from './supabase.js';

const STORAGE_KEYS = {
    LIVES: 'livetracker_lives',
    MEMBERS: 'livetracker_members',
    ATTENDANCE: 'livetracker_attendance'
};

// ============================================
// Cloud Sync (Supabase)
// ============================================

// ---------- データ変換ヘルパー ----------

function liveToRow(live) {
    return {
        id:          live.id,
        name:        live.name || '',
        artist:      live.artist      ?? null,
        venue:       live.venue       ?? null,
        date_start:  live.dateStart   ?? null,
        date_end:    live.dateEnd     ?? null,
        date:        live.date        ?? null,
        memo:        live.memo        ?? null,
        icon:        live.icon        ?? null,
        icon_img:    live.iconImg     ?? null,
        color:       live.color       ?? null,
        prefecture:  live.prefecture  ?? null,
        created_at:  live.createdAt   ?? null,
        updated_at:  live.updatedAt   ?? null,
    };
}

function rowToLive(row) {
    return {
        id:         row.id,
        name:       row.name,
        artist:     row.artist,
        venue:      row.venue,
        dateStart:  row.date_start,
        dateEnd:    row.date_end,
        date:       row.date,
        memo:       row.memo,
        icon:       row.icon,
        iconImg:    row.icon_img,
        color:      row.color,
        prefecture: row.prefecture,
        createdAt:  row.created_at,
        updatedAt:  row.updated_at,
    };
}

function memberToRow(member) {
    return {
        id:         member.id,
        name:       member.name || '',
        nickname:   member.nickname  ?? null,
        color:      member.color     ?? null,
        avatar:     member.avatar    ?? null,
        created_at: member.createdAt ?? null,
        updated_at: member.updatedAt ?? null,
    };
}

function rowToMember(row) {
    return {
        id:        row.id,
        name:      row.name,
        nickname:  row.nickname,
        color:     row.color,
        avatar:    row.avatar,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function attendanceToRow(att) {
    return {
        id:         att.id,
        live_id:    att.liveId,
        member_id:  att.memberId,
        status:     att.status === 'not_going' ? 'notgoing' : att.status,
        created_at: att.createdAt ?? null,
        updated_at: att.updatedAt ?? null,
    };
}

function rowToAttendance(row) {
    return {
        id:        row.id,
        liveId:    row.live_id,
        memberId:  row.member_id,
        status:    row.status === 'notgoing' ? 'not_going' : row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ---------- コレクション単位の同期 ----------

async function syncCollectionToSupabase(tableName, localItems, toRow) {
    if (!supabase) return;

    // Supabase に現在存在する ID を取得
    const { data: existing, error: fetchError } = await supabase
        .from(tableName)
        .select('id');
    if (fetchError) throw fetchError;

    const existingIds = new Set((existing || []).map(r => r.id));
    const localIds    = new Set(localItems.map(i => i.id));

    // 現在のデータを upsert
    if (localItems.length > 0) {
        const { error: upsertError } = await supabase
            .from(tableName)
            .upsert(localItems.map(toRow), { onConflict: 'id' });
        if (upsertError) throw upsertError;
    }

    // ローカルに存在しない（削除された）レコードを Supabase からも削除
    const toDelete = [...existingIds].filter(id => !localIds.has(id));
    if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
            .from(tableName)
            .delete()
            .in('id', toDelete);
        if (deleteError) throw deleteError;
    }
}

// ---------- デバウンスされたバックグラウンド同期 ----------

let syncTimeout = null;
const dirtyKeys  = new Set();

export function triggerSync() {
    if (!supabase) return;

    window.dispatchEvent(new CustomEvent('livetracker:sync-start'));

    if (syncTimeout) clearTimeout(syncTimeout);

    syncTimeout = setTimeout(async () => {
        const keysToSync = [...dirtyKeys];
        dirtyKeys.clear();

        try {
            const promises = [];

            if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.LIVES)) {
                promises.push(
                    syncCollectionToSupabase('lives', getAll(STORAGE_KEYS.LIVES), liveToRow)
                );
            }
            if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.MEMBERS)) {
                promises.push(
                    syncCollectionToSupabase('members', getAll(STORAGE_KEYS.MEMBERS), memberToRow)
                );
            }
            if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.ATTENDANCE)) {
                promises.push(
                    syncCollectionToSupabase('attendance', getAll(STORAGE_KEYS.ATTENDANCE), attendanceToRow)
                );
            }

            await Promise.all(promises);
            window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
        } catch (e) {
            console.error('Supabase への同期に失敗しました:', e);
            window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
        }
    }, 1500);
}

// ---------- 初回ロード時の取得 ----------

export async function fetchFromSupabase() {
    if (!supabase) return false;
    try {
        window.dispatchEvent(new CustomEvent('livetracker:sync-start'));

        const [livesRes, membersRes, attendanceRes] = await Promise.all([
            supabase.from('lives').select('*'),
            supabase.from('members').select('*'),
            supabase.from('attendance').select('*'),
        ]);

        if (livesRes.error)      throw livesRes.error;
        if (membersRes.error)    throw membersRes.error;
        if (attendanceRes.error) throw attendanceRes.error;

        const remoteHasData =
            livesRes.data.length > 0 ||
            membersRes.data.length > 0 ||
            attendanceRes.data.length > 0;

        const localHasData =
            getAll(STORAGE_KEYS.LIVES).length > 0 ||
            getAll(STORAGE_KEYS.MEMBERS).length > 0 ||
            getAll(STORAGE_KEYS.ATTENDANCE).length > 0;

        if (!remoteHasData && localHasData) {
            // Supabase が空でローカルにデータがある場合 → ローカルを Supabase へ push
            await Promise.all([
                syncCollectionToSupabase('lives',      getAll(STORAGE_KEYS.LIVES),      liveToRow),
                syncCollectionToSupabase('members',    getAll(STORAGE_KEYS.MEMBERS),    memberToRow),
                syncCollectionToSupabase('attendance', getAll(STORAGE_KEYS.ATTENDANCE), attendanceToRow),
            ]);
        } else if (remoteHasData) {
            // Supabase にデータがある場合 → ローカルを上書き
            localStorage.setItem(STORAGE_KEYS.LIVES,      JSON.stringify(livesRes.data.map(rowToLive)));
            localStorage.setItem(STORAGE_KEYS.MEMBERS,    JSON.stringify(membersRes.data.map(rowToMember)));
            localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(attendanceRes.data.map(rowToAttendance)));
        }
        // 両方空の場合は何もしない

        window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
        return true;
    } catch (e) {
        console.error('Supabase からの取得に失敗しました:', e);
        window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
        return false;
    }
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
    dirtyKeys.add(key);
    triggerSync();
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
