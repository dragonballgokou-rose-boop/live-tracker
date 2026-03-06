// ============================================
// Store - Data Layer (localStorage cache + Supabase sync)
// ============================================

import { supabase, getCurrentRoomId } from './supabase.js';

const STORAGE_KEYS = {
    LIVES: 'livetracker_lives',
    MEMBERS: 'livetracker_members',
    ATTENDANCE: 'livetracker_attendance'
};

// ============================================
// Supabase Sync Helpers
// ============================================

function isUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function liveFromDb(row) {
    return {
        id: row.id,
        name: row.name,
        artist: row.artist || '',
        venue: row.venue || '',
        prefecture: row.prefecture || '',
        dateStart: row.date_start,
        dateEnd: row.date_end || '',
        memo: row.memo || '',
        icon: row.icon || '🎵',
        iconImg: row.icon_img || '',
        color: row.color || '#8B5CF6',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function liveToDb(live, roomId) {
    return {
        id: live.id,
        room_id: roomId,
        name: live.name,
        artist: live.artist || null,
        venue: live.venue || null,
        prefecture: live.prefecture || null,
        date_start: live.dateStart || live.date,
        date_end: live.dateEnd || null,
        memo: live.memo || null,
        icon: live.icon || null,
        icon_img: live.iconImg || null,
        color: live.color || null,
        updated_at: new Date().toISOString(),
    };
}

function memberFromDb(row) {
    return {
        id: row.id,
        name: row.name,
        nickname: row.nickname || '',
        color: row.color || '#8B5CF6',
        avatar: row.avatar || '',
        memo: row.memo || '',
        createdAt: row.created_at,
    };
}

function memberToDb(member, roomId) {
    return {
        id: member.id,
        room_id: roomId,
        name: member.name,
        nickname: member.nickname || null,
        color: member.color || null,
        avatar: member.avatar || null,
        memo: member.memo || null,
    };
}

function attendanceFromDb(row) {
    // Reconstruct the compound liveId key used by the app
    const liveId = row.date_str ? `${row.live_id}_${row.date_str}` : row.live_id;
    return {
        id: row.id,
        liveId,
        memberId: row.member_id,
        status: row.status || 'undecided',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// Parse compound liveId (e.g. "uuid_2026-03-01") back to { liveId, dateStr }
function parseLiveId(compoundId) {
    const match = compoundId.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
    if (match) {
        return { liveId: match[1], dateStr: match[2] };
    }
    return { liveId: compoundId, dateStr: '' };
}

// ============================================
// Supabase fetch (replaces fetchFromGAS)
// ============================================

export async function fetchFromSupabase() {
    const roomId = getCurrentRoomId();
    if (!roomId) return false;

    try {
        window.dispatchEvent(new CustomEvent('livetracker:sync-start'));

        const [livesRes, membersRes] = await Promise.all([
            supabase.from('lives').select('*').eq('room_id', roomId).order('date_start'),
            supabase.from('members').select('*').eq('room_id', roomId).order('created_at'),
        ]);

        if (livesRes.error) throw livesRes.error;
        if (membersRes.error) throw membersRes.error;

        const dbLives = livesRes.data || [];
        const dbMembers = membersRes.data || [];

        // If Supabase is empty but localStorage has data, migrate once
        if (dbLives.length === 0 && dbMembers.length === 0) {
            const localLives = getAll(STORAGE_KEYS.LIVES);
            const localMembers = getAll(STORAGE_KEYS.MEMBERS);
            if (localLives.length > 0 || localMembers.length > 0) {
                await migrateLocalToSupabase(roomId, localLives, localMembers);
                return fetchFromSupabase(); // re-fetch after migration
            }
        }

        // Fetch attendance for this room's lives
        const liveIds = dbLives.map(l => l.id);
        let attendance = [];
        if (liveIds.length > 0) {
            const { data, error } = await supabase
                .from('attendance')
                .select('*')
                .in('live_id', liveIds);
            if (error) throw error;
            attendance = (data || []).map(attendanceFromDb);
        }

        // Update localStorage cache
        localStorage.setItem(STORAGE_KEYS.LIVES, JSON.stringify(dbLives.map(liveFromDb)));
        localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(dbMembers.map(memberFromDb)));
        localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(attendance));

        window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
        return true;
    } catch (e) {
        console.error('Fetch from Supabase failed:', e);
        window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
        return false;
    }
}

// One-time migration of existing localStorage data to Supabase
async function migrateLocalToSupabase(roomId, localLives, localMembers) {
    const localAttendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const idMap = {}; // oldId → newId (Supabase UUID)

    // Insert lives
    for (const live of localLives) {
        const dbLive = {
            room_id: roomId,
            name: live.name,
            artist: live.artist || null,
            venue: live.venue || null,
            prefecture: live.prefecture || null,
            date_start: live.dateStart || live.date,
            date_end: live.dateEnd || null,
            memo: live.memo || null,
            icon: live.icon || null,
            icon_img: live.iconImg || null,
            color: live.color || null,
        };
        if (isUUID(live.id)) dbLive.id = live.id;
        const { data, error } = await supabase.from('lives').insert(dbLive).select().single();
        if (!error && data) idMap[live.id] = data.id;
    }

    // Insert members
    for (const member of localMembers) {
        const dbMember = {
            room_id: roomId,
            name: member.name,
            nickname: member.nickname || null,
            color: member.color || null,
            avatar: member.avatar || null,
            memo: member.memo || null,
        };
        if (isUUID(member.id)) dbMember.id = member.id;
        const { data, error } = await supabase.from('members').insert(dbMember).select().single();
        if (!error && data) idMap[member.id] = data.id;
    }

    // Insert attendance
    const attToInsert = [];
    for (const att of localAttendance) {
        const { liveId: rawLiveId, dateStr } = parseLiveId(att.liveId);
        const actualLiveId = idMap[rawLiveId] || rawLiveId;
        const actualMemberId = idMap[att.memberId] || att.memberId;
        if (!isUUID(actualLiveId) || !isUUID(actualMemberId)) continue;
        attToInsert.push({
            live_id: actualLiveId,
            member_id: actualMemberId,
            date_str: dateStr,
            status: att.status || 'undecided',
        });
    }
    if (attToInsert.length > 0) {
        await supabase.from('attendance').upsert(attToInsert, { onConflict: 'live_id,member_id,date_str' });
    }
}

// ============================================
// Supabase write helpers (fire-and-forget)
// ============================================

async function syncLiveToSupabase(live) {
    const roomId = getCurrentRoomId();
    if (!roomId || !isUUID(live.id)) return;
    const { error } = await supabase
        .from('lives')
        .upsert(liveToDb(live, roomId), { onConflict: 'id' });
    if (error) console.error('Live sync error:', error);
}

async function syncMemberToSupabase(member) {
    const roomId = getCurrentRoomId();
    if (!roomId || !isUUID(member.id)) return;
    const { error } = await supabase
        .from('members')
        .upsert(memberToDb(member, roomId), { onConflict: 'id' });
    if (error) console.error('Member sync error:', error);
}

async function syncAttendanceToSupabase(compoundLiveId, memberId, status) {
    const { liveId, dateStr } = parseLiveId(compoundLiveId);
    if (!isUUID(liveId) || !isUUID(memberId)) return;
    const { error } = await supabase.from('attendance').upsert({
        live_id: liveId,
        member_id: memberId,
        date_str: dateStr,
        status,
    }, { onConflict: 'live_id,member_id,date_str' });
    if (error) console.error('Attendance sync error:', error);
}

async function deleteSupabaseLive(id) {
    if (!isUUID(id)) return;
    const { error } = await supabase.from('lives').delete().eq('id', id);
    if (error) console.error('Live delete error:', error);
}

async function deleteSupabaseMember(id) {
    if (!isUUID(id)) return;
    const { error } = await supabase.from('members').delete().eq('id', id);
    if (error) console.error('Member delete error:', error);
}

// ============================================
// Local Store (localStorage CRUD)
// ============================================

function generateId() {
    // Use UUID for Supabase compatibility
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

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
    const newLive = addItem(STORAGE_KEYS.LIVES, live);
    syncLiveToSupabase(newLive);
    return newLive;
}

export function updateLive(id, updates) {
    const updated = updateItem(STORAGE_KEYS.LIVES, id, updates);
    if (updated) syncLiveToSupabase(updated);
    return updated;
}

export function deleteLive(id) {
    // Delete related attendance from localStorage and Supabase
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const filtered = attendance.filter(a => !a.liveId.startsWith(id));
    saveAll(STORAGE_KEYS.ATTENDANCE, filtered);
    deleteSupabaseLive(id); // cascade deletes attendance in Supabase via FK
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
    const newMember = addItem(STORAGE_KEYS.MEMBERS, member);
    syncMemberToSupabase(newMember);
    return newMember;
}

export function updateMember(id, updates) {
    const updated = updateItem(STORAGE_KEYS.MEMBERS, id, updates);
    if (updated) syncMemberToSupabase(updated);
    return updated;
}

export function deleteMember(id) {
    // Delete related attendance from localStorage and Supabase
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const filtered = attendance.filter(a => a.memberId !== id);
    saveAll(STORAGE_KEYS.ATTENDANCE, filtered);
    deleteSupabaseMember(id); // cascade deletes attendance in Supabase via FK
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
    syncAttendanceToSupabase(liveId, memberId, status);
}

export function getAttendanceStatus(liveId, memberId) {
    const attendance = getAll(STORAGE_KEYS.ATTENDANCE);
    const record = attendance.find(a => a.liveId === liveId && a.memberId === memberId);
    return record ? record.status : null;
}

// ---------- Date-based Attendance ----------

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

export async function importData(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        if (!data.lives || !data.members || !data.attendance) {
            throw new Error('無効なデータ形式です');
        }
        saveAll(STORAGE_KEYS.LIVES, data.lives);
        saveAll(STORAGE_KEYS.MEMBERS, data.members);
        saveAll(STORAGE_KEYS.ATTENDANCE, data.attendance);

        // Push imported data to Supabase
        const roomId = getCurrentRoomId();
        if (roomId) {
            await migrateLocalToSupabase(roomId, data.lives, data.members);
        }
        return true;
    } catch (e) {
        console.error('Import error:', e);
        throw e;
    }
}
