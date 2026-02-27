// ============================================
// Store - AsyncStorage CRUD Operations
// (Ported from localStorage-based store.js)
// ============================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Live, Member, Attendance, AttendanceStatus, DateEntry, Stats } from '../types';

const STORAGE_KEYS = {
  LIVES: 'livetracker_lives',
  MEMBERS: 'livetracker_members',
  ATTENDANCE: 'livetracker_attendance',
};

export const GAS_URL =
  'https://script.google.com/macros/s/AKfycbzsvKE56LE0VycDxAfRM2tafOROFCcDLhKOJRl05j2QU_IqikHoqtUkqoBwGc0SKgtN/exec';

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

// ---------- Lives ----------
export async function getLives(): Promise<Live[]> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  return lives.sort((a, b) => {
    const da = new Date(a.dateStart || a.date || '').getTime();
    const db = new Date(b.dateStart || b.date || '').getTime();
    return db - da;
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
  return newLive;
}

export async function updateLive(id: string, updates: Partial<Live>): Promise<void> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  const idx = lives.findIndex((l) => l.id === id);
  if (idx !== -1) {
    lives[idx] = { ...lives[idx], ...updates, updatedAt: new Date().toISOString() };
    await saveAll(STORAGE_KEYS.LIVES, lives);
  }
}

export async function deleteLive(id: string): Promise<void> {
  const lives = await getAll<Live>(STORAGE_KEYS.LIVES);
  await saveAll(
    STORAGE_KEYS.LIVES,
    lives.filter((l) => l.id !== id)
  );
  // Remove related attendance
  const attendance = await getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  await saveAll(
    STORAGE_KEYS.ATTENDANCE,
    attendance.filter((a) => !a.liveId.startsWith(id))
  );
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
  return newMember;
}

export async function updateMember(id: string, updates: Partial<Member>): Promise<void> {
  const members = await getAll<Member>(STORAGE_KEYS.MEMBERS);
  const idx = members.findIndex((m) => m.id === id);
  if (idx !== -1) {
    members[idx] = { ...members[idx], ...updates, updatedAt: new Date().toISOString() };
    await saveAll(STORAGE_KEYS.MEMBERS, members);
  }
}

export async function deleteMember(id: string): Promise<void> {
  const members = await getAll<Member>(STORAGE_KEYS.MEMBERS);
  await saveAll(
    STORAGE_KEYS.MEMBERS,
    members.filter((m) => m.id !== id)
  );
  const attendance = await getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  await saveAll(
    STORAGE_KEYS.ATTENDANCE,
    attendance.filter((a) => a.memberId !== id)
  );
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
    totalLives: lives.length,
    upcomingLives: upcomingLives.length,
    pastLives: pastLives.length,
    totalMembers: members.length,
    totalGoing: goingCount,
    attendanceRate:
      totalPossibleSchedules > 0 && members.length > 0
        ? Math.round((goingCount / (totalPossibleSchedules * members.length)) * 100)
        : 0,
  };
}

// ---------- Cloud Sync (GAS) ----------
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

export function triggerSync(): void {
  if (!GAS_URL) return;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const [lives, members, attendance] = await Promise.all([
        getAll<Live>(STORAGE_KEYS.LIVES),
        getAll<Member>(STORAGE_KEYS.MEMBERS),
        getAll<Attendance>(STORAGE_KEYS.ATTENDANCE),
      ]);
      await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'updateAllData', data: { lives, members, attendance } }),
      });
    } catch (e) {
      console.warn('Sync failed:', e);
    }
  }, 2000);
}

export async function fetchFromGAS(): Promise<boolean> {
  if (!GAS_URL) return false;
  try {
    const response = await fetch(`${GAS_URL}?type=getAll`);
    const result = await response.json();
    if (result.success && result.data) {
      if (result.data.lives) await saveAll(STORAGE_KEYS.LIVES, result.data.lives);
      if (result.data.members) await saveAll(STORAGE_KEYS.MEMBERS, result.data.members);
      if (result.data.attendance) await saveAll(STORAGE_KEYS.ATTENDANCE, result.data.attendance);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('fetchFromGAS failed:', e);
    return false;
  }
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
  await saveAll(STORAGE_KEYS.LIVES, data.lives);
  await saveAll(STORAGE_KEYS.MEMBERS, data.members);
  await saveAll(STORAGE_KEYS.ATTENDANCE, data.attendance);
}
