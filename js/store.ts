// ============================================
// Store - localStorage CRUD + Supabase cloud sync
// ============================================

import { supabase } from './supabase.js';
import type {
  Live, Member, Attendance, AttendanceStatus,
  LiveRow, MemberRow, AttendanceRow, SyncResult,
  MemberOfficialLink,
} from './types.js';

// ---------- localStorage keys ----------

const STORAGE_KEYS = {
  LIVES:      'livetracker_lives',
  MEMBERS:    'livetracker_members',
  ATTENDANCE: 'livetracker_attendance',
  /** 端末ローカルの推しメン（単一の memberId）。Supabase には同期しない */
  FAVORITE:   'livetracker_favorite_member',
  /** 端末ローカルの 公式メンバー ↔ ローカル member の紐付け。Supabase 同期対象外 */
  OFFICIAL_LINKS: 'livetracker_member_official_links',
} as const;

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

// ============================================
// 型変換: app <-> Supabase row
// ============================================

/**
 * Supabase の lives_event_type_check 制約は 'live' / 'event' / 'tour' のみ許可。
 * 旧データが 'ライブ' / 'イベント' の日本語ラベルで保存されているケースに備えて
 * 送信前にここで正規化する。
 * 'stage'（舞台）は制約違反を避けるため 'event' に畳む。
 * アプリ側では memo 内の `[stage]` タグで stage を復元する。
 */
function normalizeEventTypeForDb(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'ライブ' || s === 'live' || s === 'コンサート' || s === 'concert') return 'live';
  if (s === 'イベント' || s === 'event' || s === 'ミーグリ' || s === '握手') return 'event';
  if (s === 'ツアー' || s === 'tour') return 'tour';
  if (s === '舞台' || s === 'stage') return 'event'; // DB 制約回避。memo の [stage] で復元
  return null; // 未知の値は制約違反を避けて null に
}

/** stage タグの付与/除去を memo に反映する */
function ensureStageMemoTag(memo: string | null | undefined, isStage: boolean): string | null {
  const base = memo ?? '';
  const hasTag = /\[stage\]/.test(base);
  if (isStage && !hasTag) {
    return base ? `${base}\n[stage]` : '[stage]';
  }
  if (!isStage && hasTag) {
    const cleaned = base.replace(/\s*\[stage\]\s*/g, '\n').trim();
    return cleaned || null;
  }
  return base || null;
}

function liveToRow(live: Live): Omit<LiveRow, 'day_times'> & { day_times: string | null } {
  const isStage = String(live.eventType ?? '').toLowerCase() === 'stage' ||
                  String(live.eventType ?? '') === '舞台';
  const memoWithStageTag = ensureStageMemoTag(live.memo, isStage);
  return {
    id:          live.id,
    name:        live.name || '',
    artist:      live.artist     ?? null,
    venue:       live.venue      ?? null,
    date_start:  live.dateStart  ?? null,
    date_end:    live.dateEnd    ?? null,
    date:        live.date       ?? null,
    memo:        memoWithStageTag,
    icon:        live.icon       ?? null,
    icon_img:    live.iconImg    ?? null,
    color:       live.color      ?? null,
    prefecture:  live.prefecture ?? null,
    event_type:  normalizeEventTypeForDb(live.eventType),
    parent_id:   live.parentId   ?? null,
    open_time:   live.openTime   ?? null,
    start_time:  live.startTime  ?? null,
    day_times:   live.dayTimes   ? JSON.stringify(live.dayTimes) : null,
    // official_id は schema 未マイグレーションの環境を考慮して送らない。
    // 代わりに memo 内の `[official-id:...]` マーカーと name+date マッチで同一性判定する。
    created_at:  live.createdAt  ?? null,
    updated_at:  live.updatedAt  ?? null,
  };
}

function rowToLive(row: LiveRow & { official_id?: string | null }): Live {
  let dayTimes: Live['dayTimes'] = null;
  if (row.day_times) {
    try { dayTimes = JSON.parse(row.day_times); } catch { dayTimes = null; }
  }
  const officialIdFromMemo = extractOfficialIdFromMemo(row.memo);
  // memo に [stage] タグがあれば eventType を 'stage' に復元
  const hasStageTag = !!row.memo && /\[stage\]/.test(row.memo);
  const eventType = hasStageTag ? 'stage' : row.event_type;
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
    eventType:  eventType,
    parentId:   row.parent_id,
    openTime:   row.open_time,
    startTime:  row.start_time,
    dayTimes,
    officialId: row.official_id || officialIdFromMemo || null,
    createdAt:  row.created_at,
    updatedAt:  row.updated_at,
  };
}

/** memo 本文内に埋め込まれた `[official-id:...]` から ID を抽出する */
function extractOfficialIdFromMemo(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const m = /\[official-id:([^\]\s]+)\]/.exec(String(memo));
  return m ? m[1] ?? null : null;
}

function memberToRow(member: Member): MemberRow {
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

function rowToMember(row: MemberRow): Member {
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

function attendanceToRow(att: Attendance): AttendanceRow {
  return {
    id:         att.id,
    live_id:    att.liveId,
    member_id:  att.memberId,
    // Supabase の status_check は 'going'/'notgoing'/'undecided' のみ許可 (アンダースコア無し)
    status:     att.status === 'not_going' ? 'notgoing' : att.status,
    created_at: att.createdAt ?? null,
    updated_at: att.updatedAt ?? null,
  };
}

function rowToAttendance(row: AttendanceRow): Attendance {
  return {
    id:        row.id,
    liveId:    row.live_id,
    memberId:  row.member_id,
    status:    (row.status === 'notgoing' ? 'not_going' : row.status) as AttendanceStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================
// Supabase sync
// ============================================

let syncPaused = false;

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as any).code ?? (err as any).status ?? (err as any).statusCode;
  if (code === 402 || code === '402') return true;
  const msg = String((err as any).message ?? (err as any).msg ?? '');
  return msg.includes('exceed_egress_quota') || msg.includes('restricted');
}

function pauseSyncOnQuotaError(err: unknown): void {
  if (!isQuotaExceededError(err)) return;
  syncPaused = true;
  console.warn('Supabase エグレス制限超過を検出。クラウド同期を一時停止し、ローカルモードで動作します。');
  window.dispatchEvent(new CustomEvent('livetracker:sync-paused', { detail: { reason: 'quota-exceeded' } }));
}

async function syncCollectionToSupabase<T extends { id: string }, R>(
  tableName: string,
  localItems: T[],
  toRow: (item: T) => R,
): Promise<void> {
  if (!supabase || syncPaused) return;

  const { data: existing, error: fetchError } = await supabase
    .from(tableName)
    .select('id');
  if (fetchError) {
    pauseSyncOnQuotaError(fetchError);
    throw fetchError;
  }

  const existingIds = new Set((existing || []).map((r: { id: string }) => r.id));
  const localIds    = new Set(localItems.map(i => i.id));

  if (localItems.length > 0) {
    const { error: upsertError } = await supabase
      .from(tableName)
      .upsert(localItems.map(toRow) as any, { onConflict: 'id' });
    if (upsertError) throw upsertError;
  }

  const toDelete = [...existingIds].filter(id => !localIds.has(id));
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .in('id', toDelete);
    if (deleteError) throw deleteError;
  }
}

// ---------- debounced sync ----------

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
const dirtyKeys = new Set<StorageKey>();

async function runSyncNow(): Promise<void> {
  const keysToSync = [...dirtyKeys];
  dirtyKeys.clear();

  const promises: Promise<void>[] = [];
  if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.LIVES)) {
    promises.push(
      syncCollectionToSupabase('lives', getAll<Live>(STORAGE_KEYS.LIVES), liveToRow)
    );
  }
  if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.MEMBERS)) {
    promises.push(
      syncCollectionToSupabase('members', getAll<Member>(STORAGE_KEYS.MEMBERS), memberToRow)
    );
  }
  if (keysToSync.length === 0 || keysToSync.includes(STORAGE_KEYS.ATTENDANCE)) {
    promises.push(
      syncCollectionToSupabase('attendance', getAll<Attendance>(STORAGE_KEYS.ATTENDANCE), attendanceToRow)
    );
  }
  await Promise.all(promises);
}

export function triggerSync(): void {
  if (!supabase || syncPaused) return;

  window.dispatchEvent(new CustomEvent('livetracker:sync-start'));

  if (syncTimeout) clearTimeout(syncTimeout);

  syncTimeout = setTimeout(async () => {
    try {
      await runSyncNow();
      window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
    } catch (e) {
      console.error('Supabase への同期に失敗しました:', e);
      window.dispatchEvent(new CustomEvent('livetracker:sync-error', { detail: { error: e } }));
    }
  }, 1500);
}

/**
 * デバウンスを飛ばして即座に Supabase 同期を実行する。
 * 成功/失敗を明示的に返すので呼び出し側で UI フィードバックできる。
 */
export async function flushSyncNow(): Promise<SyncResult> {
  if (!supabase) return { ok: false, reason: 'supabase-not-configured' };
  if (syncPaused) return { ok: false, reason: 'quota-exceeded' };

  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
  window.dispatchEvent(new CustomEvent('livetracker:sync-start'));
  try {
    await runSyncNow();
    window.dispatchEvent(new CustomEvent('livetracker:sync-success'));
    return { ok: true };
  } catch (e) {
    console.error('flushSyncNow failed:', e);
    window.dispatchEvent(new CustomEvent('livetracker:sync-error', { detail: { error: e } }));
    return { ok: false, reason: 'sync-failed', error: e };
  }
}

// ---------- 初回ロード時の取得 ----------

/**
 * リモート配列を基本に、ローカルにしか無いアイテム（= まだ Supabase に
 * push されていない新規追加分）を保護してマージする。
 */
function mergePreservingLocalOnly<T extends { id: string }>(remoteArr: T[], localArr: T[]): T[] {
  const remoteIds = new Set(remoteArr.map(r => r.id));
  const localOnly = localArr.filter(l => l && l.id && !remoteIds.has(l.id));
  return [...remoteArr, ...localOnly];
}

export async function fetchFromSupabase(): Promise<boolean> {
  if (!supabase || syncPaused) return false;
  try {
    window.dispatchEvent(new CustomEvent('livetracker:sync-start'));

    const [livesRes, membersRes, attendanceRes] = await Promise.all([
      supabase.from('lives').select('*'),
      supabase.from('members').select('*'),
      supabase.from('attendance').select('*'),
    ]);

    const firstError = livesRes.error || membersRes.error || attendanceRes.error;
    if (firstError && isQuotaExceededError(firstError)) {
      pauseSyncOnQuotaError(firstError);
      window.dispatchEvent(new CustomEvent('livetracker:sync-error'));
      return false;
    }

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
      await Promise.all([
        syncCollectionToSupabase('lives',      getAll<Live>(STORAGE_KEYS.LIVES),          liveToRow),
        syncCollectionToSupabase('members',    getAll<Member>(STORAGE_KEYS.MEMBERS),      memberToRow),
        syncCollectionToSupabase('attendance', getAll<Attendance>(STORAGE_KEYS.ATTENDANCE), attendanceToRow),
      ]);
    } else if (remoteHasData) {
      const remoteLives      = (livesRes.data as (LiveRow & { official_id?: string | null })[]).map(rowToLive);
      const remoteMembers    = (membersRes.data as MemberRow[]).map(rowToMember);
      const remoteAttendance = (attendanceRes.data as AttendanceRow[]).map(rowToAttendance);

      const mergedLives      = mergePreservingLocalOnly(remoteLives,      getAll<Live>(STORAGE_KEYS.LIVES));
      const mergedMembers    = mergePreservingLocalOnly(remoteMembers,    getAll<Member>(STORAGE_KEYS.MEMBERS));
      const mergedAttendance = mergePreservingLocalOnly(remoteAttendance, getAll<Attendance>(STORAGE_KEYS.ATTENDANCE));

      localStorage.setItem(STORAGE_KEYS.LIVES,      JSON.stringify(mergedLives));
      localStorage.setItem(STORAGE_KEYS.MEMBERS,    JSON.stringify(mergedMembers));
      localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(mergedAttendance));

      const remoteIds = {
        lives:      new Set(remoteLives.map(x => x.id)),
        members:    new Set(remoteMembers.map(x => x.id)),
        attendance: new Set(remoteAttendance.map(x => x.id)),
      };
      const hasLocalOnly =
        mergedLives.some(x => !remoteIds.lives.has(x.id)) ||
        mergedMembers.some(x => !remoteIds.members.has(x.id)) ||
        mergedAttendance.some(x => !remoteIds.attendance.has(x.id));
      if (hasLocalOnly) {
        console.log('fetchFromSupabase: detected local-only items, pushing back');
        dirtyKeys.add(STORAGE_KEYS.LIVES);
        dirtyKeys.add(STORAGE_KEYS.MEMBERS);
        dirtyKeys.add(STORAGE_KEYS.ATTENDANCE);
        triggerSync();
      }
    }

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

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function getAll<T>(key: StorageKey): T[] {
  try {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as T[]) : [];
  } catch {
    return [];
  }
}

function saveAll<T>(key: StorageKey, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
  dirtyKeys.add(key);
  triggerSync();
}

function addItem<T extends { id?: string; createdAt?: string | null }>(
  key: StorageKey, item: Omit<T, 'id' | 'createdAt'> & Partial<Pick<T, 'id' | 'createdAt'>>
): T {
  const items = getAll<T>(key);
  const newItem = { ...item, id: generateId(), createdAt: new Date().toISOString() } as T;
  items.push(newItem);
  saveAll(key, items);
  return newItem;
}

function updateItem<T extends { id: string; updatedAt?: string | null }>(
  key: StorageKey, id: string, updates: Partial<T>
): T | null {
  const items = getAll<T>(key);
  const index = items.findIndex(item => item.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], ...updates, updatedAt: new Date().toISOString() } as T;
  saveAll(key, items);
  return items[index] as T;
}

function deleteItem<T extends { id: string }>(key: StorageKey, id: string): boolean {
  const items = getAll<T>(key);
  const filtered = items.filter(item => item.id !== id);
  saveAll(key, filtered);
  return filtered.length < items.length;
}

function getById<T extends { id: string }>(key: StorageKey, id: string): T | null {
  const items = getAll<T>(key);
  return items.find(item => item.id === id) || null;
}

// ---------- Lives ----------

export function getLives(): Live[] {
  return getAll<Live>(STORAGE_KEYS.LIVES).sort((a, b) => {
    return +new Date(a.dateStart || a.date || 0) - +new Date(b.dateStart || b.date || 0);
  });
}

export function getLiveById(id: string): Live | null {
  return getById<Live>(STORAGE_KEYS.LIVES, id);
}

export function addLive(live: Partial<Live>): Live {
  return addItem<Live>(STORAGE_KEYS.LIVES, live as any);
}

export function updateLive(id: string, updates: Partial<Live>): Live | null {
  return updateItem<Live>(STORAGE_KEYS.LIVES, id, updates);
}

export function deleteLive(id: string): boolean {
  const attendance = getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const filtered = attendance.filter(a => a.liveId !== id);
  saveAll(STORAGE_KEYS.ATTENDANCE, filtered);
  return deleteItem<Live>(STORAGE_KEYS.LIVES, id);
}

// ---------- Members ----------

export function getMembers(): Member[] {
  return getAll<Member>(STORAGE_KEYS.MEMBERS).sort((a, b) => {
    return +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0);
  });
}

export function getMemberById(id: string): Member | null {
  return getById<Member>(STORAGE_KEYS.MEMBERS, id);
}

export function addMember(member: Partial<Member>): Member {
  return addItem<Member>(STORAGE_KEYS.MEMBERS, member as any);
}

export function updateMember(id: string, updates: Partial<Member>): Member | null {
  return updateItem<Member>(STORAGE_KEYS.MEMBERS, id, updates);
}

export function deleteMember(id: string): boolean {
  const attendance = getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const filtered = attendance.filter(a => a.memberId !== id);
  saveAll(STORAGE_KEYS.ATTENDANCE, filtered);
  // 紐付けも削除
  const links = getOfficialLinks().filter(l => l.memberId !== id);
  localStorage.setItem(STORAGE_KEYS.OFFICIAL_LINKS, JSON.stringify(links));
  if (getFavoriteMemberId() === id) setFavoriteMemberId(null);
  return deleteItem<Member>(STORAGE_KEYS.MEMBERS, id);
}

// ---------- 推しメン（端末ローカル） ----------

export function getFavoriteMemberId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.FAVORITE);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setFavoriteMemberId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS.FAVORITE, id);
    else    localStorage.removeItem(STORAGE_KEYS.FAVORITE);
  } catch {
    /* noop */
  }
}

// ---------- 公式メンバーとの紐付け（端末ローカル） ----------

export function getOfficialLinks(): MemberOfficialLink[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OFFICIAL_LINKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getOfficialLink(memberId: string): MemberOfficialLink | null {
  return getOfficialLinks().find(l => l.memberId === memberId) || null;
}

export function setOfficialLink(
  memberId: string, officialCode: string | null, officialGroup: string | null,
): void {
  const links = getOfficialLinks().filter(l => l.memberId !== memberId);
  if (officialCode && officialGroup) {
    links.push({ memberId, officialCode, officialGroup });
  }
  localStorage.setItem(STORAGE_KEYS.OFFICIAL_LINKS, JSON.stringify(links));
}

// ---------- Attendance ----------

export function getAttendance(): Attendance[] {
  return getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
}

export function getAttendanceByLive(liveId: string): Attendance[] {
  return getAll<Attendance>(STORAGE_KEYS.ATTENDANCE).filter(a => a.liveId === liveId);
}

export function getAttendanceByMember(memberId: string): Attendance[] {
  return getAll<Attendance>(STORAGE_KEYS.ATTENDANCE).filter(a => a.memberId === memberId);
}

export function setAttendance(liveId: string, memberId: string, status: AttendanceStatus): void {
  const attendance = getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const existing = attendance.findIndex(a => a.liveId === liveId && a.memberId === memberId);

  if (existing !== -1) {
    const prev = attendance[existing]!;
    attendance[existing] = { ...prev, status, updatedAt: new Date().toISOString() };
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
  saveAll(STORAGE_KEYS.ATTENDANCE, attendance);
}

export function getAttendanceStatus(liveId: string, memberId: string): AttendanceStatus | null {
  const attendance = getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const record = attendance.find(a => a.liveId === liveId && a.memberId === memberId);
  return record ? record.status : null;
}

// ---------- Date-based Attendance ----------

export interface DateInfo {
  dateStr: string;
  dayNum: number;
  date: Date;
}

/**
 * ツアーの場合は子ライブ（parentId で紐付く live）の各日程を返す。
 * 単独公演なら dateStart〜dateEnd を 1 日ずつ展開。
 * 範囲が異常に広い（51日以上）場合は初日のみに切り詰める。
 */
export function getEffectiveDatesForLive(live: Live): DateInfo[] {
  // ツアー親の場合 → 子ライブを集める
  if (live.eventType === 'tour') {
    const children = getAll<Live>(STORAGE_KEYS.LIVES).filter(l => l.parentId === live.id);
    if (children.length > 0) {
      const dates: DateInfo[] = [];
      let dayCounter = 0;
      children
        .sort((a, b) => (a.dateStart || '').localeCompare(b.dateStart || ''))
        .forEach(child => {
          // 子が dateStart〜dateEnd の範囲（2days など）を持つ場合、
          // 各日を個別の Day として展開する（会場は同じでも Day1/Day2 として表示）
          const sRaw = child.dateStart || child.date;
          const eRaw = child.dateEnd   || child.dateStart || child.date;
          if (!sRaw) return;
          const s = new Date(sRaw);
          const e = new Date(eRaw || sRaw);
          if (isNaN(+s) || isNaN(+e)) return;
          s.setHours(0, 0, 0, 0);
          e.setHours(0, 0, 0, 0);
          // 安全策: 単一 child の範囲が 30 日超は不整合として dateStart のみ
          const days = (+e - +s) / 86400000;
          const finalEnd = (isFinite(days) && days > 30) ? new Date(s) : e;
          for (let cur = new Date(s); cur <= finalEnd; cur.setDate(cur.getDate() + 1)) {
            dayCounter++;
            const y  = cur.getFullYear();
            const m  = String(cur.getMonth() + 1).padStart(2, '0');
            const dd = String(cur.getDate()).padStart(2, '0');
            dates.push({
              dateStr: `${y}-${m}-${dd}`,
              dayNum:  dayCounter,
              date:    new Date(cur),
            });
          }
        });
      return dates;
    }
  }

  // スパンが異常に広いものはデータ不整合の可能性が高いので初日のみ
  const s = new Date(live.dateStart || live.date || 0);
  const e = new Date(live.dateEnd || live.dateStart || live.date || 0);
  if (!isNaN(+s) && !isNaN(+e)) {
    const days = (+e - +s) / 86400000;
    if (isFinite(days) && days > 50) {
      return getDatesForLive({ ...live, dateEnd: live.dateStart || live.date || null });
    }
  }
  return getDatesForLive(live);
}

export function getDatesForLive(live: Live): DateInfo[] {
  const start = new Date(live.dateStart || live.date || 0);
  const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
  if (isNaN(+start) || isNaN(+end)) return [];
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const dates: DateInfo[] = [];
  const cursor = new Date(start);
  let dayNum = 1;
  while (cursor <= end) {
    const y  = cursor.getFullYear();
    const m  = String(cursor.getMonth() + 1).padStart(2, '0');
    const d  = String(cursor.getDate()).padStart(2, '0');
    dates.push({
      dateStr: `${y}-${m}-${d}`,
      dayNum,
      date: new Date(cursor),
    });
    cursor.setDate(cursor.getDate() + 1);
    dayNum++;
  }
  return dates;
}

export function setDayAttendance(liveId: string, dateStr: string, memberId: string, status: AttendanceStatus): void {
  const dayKey = `${liveId}_${dateStr}`;
  setAttendance(dayKey, memberId, status);
}

export function getDayAttendanceStatus(liveId: string, dateStr: string, memberId: string): AttendanceStatus {
  const dayKey = `${liveId}_${dateStr}`;
  let status = getAttendanceStatus(dayKey, memberId);
  if (status === null) {
    status = getAttendanceStatus(liveId, memberId);
  }
  return status || 'undecided';
}

/**
 * 集計表など N×M 回の参戦検索が必要なビュー用の一括ルックアップ。
 * localStorage の読み込み・JSON.parse を 1 回で済ませ Map を返す。
 */
export function buildAttendanceLookup(): Map<string, AttendanceStatus> {
  const all = getAll<Attendance>(STORAGE_KEYS.ATTENDANCE);
  const map = new Map<string, AttendanceStatus>();
  for (const a of all) {
    map.set(`${a.liveId}|${a.memberId}`, a.status);
  }
  return map;
}

export function lookupDayAttendance(
  map: Map<string, AttendanceStatus>,
  liveId: string,
  dateStr: string,
  memberId: string,
): AttendanceStatus {
  return map.get(`${liveId}_${dateStr}|${memberId}`)
    ?? map.get(`${liveId}|${memberId}`)
    ?? 'undecided';
}

// ---------- Statistics ----------

export interface Stats {
  totalLives: number;
  upcomingLives: number;
  pastLives: number;
  totalMembers: number;
  totalGoing: number;
  attendanceRate: number;
}

export function getStats(): Stats {
  const lives = getLives();
  const members = getMembers();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcomingLives = lives.filter(l => new Date(l.dateEnd || l.dateStart || l.date || 0) >= now);
  const pastLives     = lives.filter(l => new Date(l.dateEnd || l.dateStart || l.date || 0) < now);

  // 性能: N×M 回の localStorage 読み出しを避けるため 1 回だけ Map 化する
  const attMap = buildAttendanceLookup();

  let goingCount = 0;
  let totalPossibleSchedules = 0;

  lives.forEach(live => {
    const dates = getDatesForLive(live);
    totalPossibleSchedules += dates.length;
    dates.forEach(d => {
      members.forEach(m => {
        if (lookupDayAttendance(attMap, live.id, d.dateStr, m.id) === 'going') {
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
      : 0,
  };
}

// ---------- Export / Import ----------

export function exportData(): string {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    lives:      getAll<Live>(STORAGE_KEYS.LIVES),
    members:    getAll<Member>(STORAGE_KEYS.MEMBERS),
    attendance: getAll<Attendance>(STORAGE_KEYS.ATTENDANCE),
  };
  return JSON.stringify(data, null, 2);
}

export function importData(jsonString: string): boolean {
  try {
    const data = JSON.parse(jsonString);
    if (!data.lives || !data.members || !data.attendance) {
      throw new Error('無効なデータ形式です');
    }
    saveAll(STORAGE_KEYS.LIVES,      data.lives);
    saveAll(STORAGE_KEYS.MEMBERS,    data.members);
    saveAll(STORAGE_KEYS.ATTENDANCE, data.attendance);
    return true;
  } catch (e) {
    console.error('Import error:', e);
    throw e;
  }
}
