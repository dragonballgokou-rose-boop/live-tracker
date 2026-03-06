// ============================================
// Store - AsyncStorage CRUD Operations
// (Ported from localStorage-based store.js)
// ============================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Live, Member, Attendance, AttendanceStatus, DateEntry, Stats } from '../types';

const STORAGE_KEYS = {
  LIVES:      'livetracker_lives',
  MEMBERS:    'livetracker_members',
  ATTENDANCE: 'livetracker_attendance',
};

// ============================================
// Supabase クライアント
// ============================================
// Expo の環境変数: EXPO_PUBLIC_ プレフィックスで .env に定義してください
// EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
// EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

const supabaseUrl      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey  = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

// ---------- データ変換ヘルパー ----------

function liveToRow(live: Live) {
  return {
    id:         live.id,
    name:       live.name || '',
    artist:     live.artist     ?? null,
    venue:      live.venue      ?? null,
    date_start: live.dateStart  ?? null,
    date_end:   live.dateEnd    ?? null,
    date:       live.date       ?? null,
    memo:       live.memo       ?? null,
    icon:       live.icon       ?? null,
    icon_img:   live.iconImg    ?? null,
    color:      live.color      ?? null,
    prefecture: live.prefecture ?? null,
    created_at: live.createdAt  ?? null,
    updated_at: live.updatedAt  ?? null,
  };
}

function rowToLive(row: Record<string, unknown>): Live {
  return {
    id:         row.id         as string,
    name:       row.name       as string,
    artist:     row.artist     as string | undefined,
    venue:      row.venue      as string | undefined,
    dateStart:  row.date_start as string | undefined,
    dateEnd:    row.date_end   as string | undefined,
    date:       row.date       as string | undefined,
    memo:       row.memo       as string | undefined,
    icon:       row.icon       as string | undefined,
    iconImg:    row.icon_img   as string | undefined,
    color:      row.color      as string | undefined,
    prefecture: row.prefecture as string | undefined,
    createdAt:  row.created_at as string,
    updatedAt:  row.updated_at as string,
  } as Live;
}

function memberToRow(member: Member) {
  return {
    id:         member.id,
    name:       member.name       || '',
    nickname:   member.nickname   ?? null,
    color:      member.color      ?? null,
    avatar:     member.avatar     ?? null,
    created_at: member.createdAt  ?? null,
    updated_at: member.updatedAt  ?? null,
  };
}

function rowToMember(row: Record<string, unknown>): Member {
  return {
    id:        row.id         as string,
    name:      row.name       as string,
    nickname:  row.nickname   as string | undefined,
    color:     row.color      as string,
    avatar:    row.avatar     as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  } as Member;
}

function attendanceToRow(att: Attendance) {
  return {
    id:         att.id,
    live_id:    att.liveId,
    member_id:  att.memberId,
    status:     att.status,
    created_at: att.createdAt ?? null,
    updated_at: att.updatedAt ?? null,
  };
}

function rowToAttendance(row: Record<string, unknown>): Attendance {
  return {
    id:        row.id         as string,
    liveId:    row.live_id    as string,
    memberId:  row.member_id  as string,
    status:    row.status     as AttendanceStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------- Helpers ----------
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function getAll<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveAll<T>(key: string, items: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

// ---------- コレクション単位の Supabase 同期 ----------

async function syncCollectionToSupabase<T extends { id: string }>(
  tableName: string,
  localItems: T[],
  toRow: (item: T) => Record<string, unknown>
): Promise<void> {
  if (!supabase) return;

  const { data: existing, error: fetchError } = await supabase
    .from(tableName)
    .select('id');
  if (fetchError) throw fetchError;

  const existingIds = new Set((existing || []).map((r: { id: string }) => r.id));
  const localIds    = new Set(localItems.map((i) => i.id));

  if (localItems.length > 0) {
    const { error: upsertError } = await supabase
      .from(tableName)
      .upsert(localItems.map(toRow), { onConflict: 'id' });
    if (upsertError) throw upsertError;
  }

  const toDelete = [...existingIds].filter((id) => !localIds.has(id));
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .in('id', toDelete);
    if (deleteError) throw deleteError;
  }
}

// ---------- デバウンスされた同期 ----------

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
const dirtyKeys = new Set<string>();

export function triggerSync(): void {
  if (!supabase) return;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    const keysToSync = [...dirtyKeys];
    dirtyKeys.clear();
    try {
      const promises: Promise<void>[] = [];
      if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.LIVES)) {
        promises.push(
          getAll<Live>(STORAGE_KEYS.LIVES).then((items) =>
            syncCollectionToSupabase('lives', items, liveToRow)
          )
        );
      }
      if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.MEMBERS)) {
        promises.push(
          getAll<Member>(STORAGE_KEYS.MEMBERS).then((items) =>
            syncCollectionToSupabase('members', items, memberToRow)
          )
        );
      }
      if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.ATTENDANCE)) {
        promises.push(
          getAll<Attendance>(STORAGE_KEYS.ATTENDANCE).then((items) =>
            syncCollectionToSupabase('attendance', items, attendanceToRow)
          )
        );
      }
      await Promise.all(promises);
    } catch (e) {
      console.warn('Supabase sync failed:', e);
    }
  }, 1500);
}

// ---------- 初回ロード ----------

export async function fetchFromSupabase(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const [livesRes, membersRes, attendanceRes] = await Promise.all([
      supabase.from('lives').select('*'),
      supabase.from('members').select('*'),
      supabase.from('attendance').select('*'),
    ]);

    if (livesRes.error)      throw livesRes.error;
    if (membersRes.error)    throw membersRes.error;
    if (attendanceRes.error) throw attendanceRes.error;

    await Promise.all([
      saveAll(STORAGE_KEYS.LIVES,      livesRes.data.map(rowToLive)),
      saveAll(STORAGE_KEYS.MEMBERS,    membersRes.data.map(rowToMember)),
      saveAll(STORAGE_KEYS.ATTENDANCE, attendanceRes.data.map(rowToAttendance)),
    ]);
    return true;
  } catch (e) {
    console.warn('fetchFromSupabase failed:', e);
    return false;
  }
}

// ---------- Lives ----------
export async function getLives(): Promise<Live[]> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  return lives.sort((a, b) => {
    const da = new Date(a.dateStart || a.date || '').getTime();
    const db = new Date(b.dateStart || b.date || '').getTime();
    return da - db;
  });
}

export async function getLiveById(id: string): Promise<Live | undefined> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  return lives.find((l) => l.id === id);
}

export async function addLive(data: Omit<Live, 'id' | 'createdAt' | 'updatedAt'>): Promise<Live> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  const newLive: Live = {
    ...data,
    id: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  lives.push(newLive);
  await saveAll(STORAGE_KEYS.LIVES, lives);
  dirtyKeys.add(STORAGE_KEYS.LIVES);
  triggerSync();
  return newLive;
}

export async function updateLive(id: string, updates: Partial<Live>): Promise<void> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  const idx = lives.findIndex((l) => l.id === id);
  if (idx !== -1) {
    lives[idx] = { ...lives[idx], ...updates, updatedAt: new Date().toISOString() };
    await saveAll(STORAGE_KEYS.LIVES, lives);
    dirtyKeys.add(STORAGE_KEYS.LIVES);
    triggerSync();
  }
}

export async function deleteLive(id: string): Promise<void> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  await saveAll(STORAGE_KEYS.LIVES, lives.filter((l) => l.id !== id));
  const attendance = await getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  await saveAll(
    STORAGE_KEYS.ATTENDANCE,
    attendance.filter((a) => !a.liveId.startsWith(id))
  );
  dirtyKeys.add(STORAGE_KEYS.LIVES);
  dirtyKeys.add(STORAGE_KEYS.ATTENDANCE);
  triggerSync();
}

// ---------- Members ----------
export async function getMembers(): Promise<Member[]> {
  return getAll<Member>(STORAGE_KEYS.MEMBERS);
}

export async function getMemberById(id: string): Promise<Member | undefined> {
  const members = await getAll<Member>(STORAGE_KEYS.MEMBERS);
  return members.find((m) => m.id === id);
}

export async function addMember(data: Omit<Member, 'id' | 'createdAt' | 'updatedAt'>): Promise<Member> {
  const members = await getAll<Member>(STORAGE_KEYS.MEMBERS);
  const newMember: Member = {
    ...data,
    id: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  members.push(newMember);
  await saveAll(STORAGE_KEYS.MEMBERS, members);
  dirtyKeys.add(STORAGE_KEYS.MEMBERS);
  triggerSync();
  return newMember;
}

export async function updateMember(id: string, updates: Partial<Member>): Promise<void> {
  const members = await getAll<Member>(STORAGE_KEYS.MEMBERS);
  const idx = members.findIndex((m) => m.id === id);
  if (idx !== -1) {
    members[idx] = { ...members[idx], ...updates, updatedAt: new Date().toISOString() };
    await saveAll(STORAGE_KEYS.MEMBERS, members);
    dirtyKeys.add(STORAGE_KEYS.MEMBERS);
    triggerSync();
  }
}

export async function deleteMember(id: string): Promise<void> {
  const members = await getAll<Member>(STORAGE_KEYS.MEMBERS);
  await saveAll(STORAGE_KEYS.MEMBERS, members.filter((m) => m.id !== id));
  const attendance = await getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  await saveAll(
    STORAGE_KEYS.ATTENDANCE,
    attendance.filter((a) => a.memberId !== id)
  );
  dirtyKeys.add(STORAGE_KEYS.MEMBERS);
  dirtyKeys.add(STORAGE_KEYS.ATTENDANCE);
  triggerSync();
}

// ---------- Attendance ----------
export async function getAttendance(): Promise<Attendance[]> {
  return getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
}

export async function setAttendance(
  liveId: string,
  memberId: string,
  status: AttendanceStatus
): Promise<void> {
  const attendance = await getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const existing = attendance.findIndex((a) => a.liveId === liveId && a.memberId === memberId);
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
      updatedAt: new Date().toISOString(),
    });
  }
  await saveAll(STORAGE_KEYS.ATTENDANCE, attendance);
  dirtyKeys.add(STORAGE_KEYS.ATTENDANCE);
  triggerSync();
}

export async function getAttendanceStatus(
  liveId: string,
  memberId: string
): Promise<AttendanceStatus | null> {
  const attendance = await getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const record = attendance.find((a) => a.liveId === liveId && a.memberId === memberId);
  return record ? record.status : null;
}

// ---------- Date-based Attendance ----------
export function getDatesForLive(live: Live): DateEntry[] {
  const start = new Date(live.dateStart || live.date || '');
  const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const dates: DateEntry[] = [];
  const cursor = new Date(start);
  let dayNum = 1;
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    dates.push({ dateStr: `${y}-${m}-${d}`, dayNum, date: new Date(cursor) });
    cursor.setDate(cursor.getDate() + 1);
    dayNum++;
  }
  return dates;
}

export async function setDayAttendance(
  liveId: string,
  dateStr: string,
  memberId: string,
  status: AttendanceStatus
): Promise<void> {
  const dayKey = `${liveId}_${dateStr}`;
  await setAttendance(dayKey, memberId, status);
}

export async function getDayAttendanceStatus(
  liveId: string,
  dateStr: string,
  memberId: string
): Promise<AttendanceStatus> {
  const dayKey = `${liveId}_${dateStr}`;
  let status = await getAttendanceStatus(dayKey, memberId);
  if (status === null) {
    status = await getAttendanceStatus(liveId, memberId);
  }
  return status || 'undecided';
}

// ---------- Statistics ----------
export async function getStats(): Promise<Stats> {
  const lives = await getLives();
  const members = await getMembers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcomingLives = lives.filter(
    (l) => new Date(l.dateEnd || l.dateStart || l.date || '') >= now
  );
  const pastLives = lives.filter(
    (l) => new Date(l.dateEnd || l.dateStart || l.date || '') < now
  );

  let goingCount = 0;
  let totalPossibleSchedules = 0;

  for (const live of lives) {
    const dates = getDatesForLive(live);
    totalPossibleSchedules += dates.length;
    for (const d of dates) {
      for (const m of members) {
        const s = await getDayAttendanceStatus(live.id, d.dateStr, m.id);
        if (s === 'going') goingCount++;
      }
    }
  }

  return {
    totalLives:     lives.length,
    upcomingLives:  upcomingLives.length,
    pastLives:      pastLives.length,
    totalMembers:   members.length,
    totalGoing:     goingCount,
    attendanceRate:
      totalPossibleSchedules > 0 && members.length > 0
        ? Math.round((goingCount / (totalPossibleSchedules * members.length)) * 100)
        : 0,
  };
}

// ---------- Export / Import ----------
export async function exportData(): Promise<string> {
  const [lives, members, attendance] = await Promise.all([
    getAll<Live>(STORAGE_KEYS.LIVES),
    getAll<Member>(STORAGE_KEYS.MEMBERS),
    getAll<Attendance>(STORAGE_KEYS.ATTENDANCE),
  ]);
  return JSON.stringify(
    { version: '1.0', exportedAt: new Date().toISOString(), lives, members, attendance },
    null,
    2
  );
}

export async function importData(jsonString: string): Promise<void> {
  const data = JSON.parse(jsonString);
  if (!data.lives || !data.members || !data.attendance) {
    throw new Error('無効なデータ形式です');
  }
  await Promise.all([
    saveAll(STORAGE_KEYS.LIVES,      data.lives),
    saveAll(STORAGE_KEYS.MEMBERS,    data.members),
    saveAll(STORAGE_KEYS.ATTENDANCE, data.attendance),
  ]);
  dirtyKeys.add(STORAGE_KEYS.LIVES);
  dirtyKeys.add(STORAGE_KEYS.MEMBERS);
  dirtyKeys.add(STORAGE_KEYS.ATTENDANCE);
  triggerSync();
}
