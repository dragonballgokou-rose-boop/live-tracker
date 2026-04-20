// ============================================
// Web Push 通知 クライアントモジュール
// ============================================
// PushSubscription 購読 / Supabase への保存 / 設定更新 / 解除
//
// 保存先: Supabase `push_subscriptions` (endpoint = PK)
// UI からは getCurrentStatus / enable / disable / updatePrefs を呼べば OK

import { supabase } from './supabase.js';

export interface PushPrefs {
  blog: boolean;
  schedule: boolean;
  live_prev_day: boolean;
  live_day: boolean;
}

export const DEFAULT_PREFS: PushPrefs = {
  blog: true,
  schedule: true,
  live_prev_day: true,
  live_day: true,
};

export interface PushStatus {
  /** Notification / Push / SW が利用できるか */
  supported: boolean;
  /** 権限状態 */
  permission: NotificationPermission | 'unsupported';
  /** 現在このブラウザで subscribe 済みか */
  subscribed: boolean;
  /** Supabase に保存されている prefs（subscribe 済み時のみ） */
  prefs: PushPrefs | null;
}

const VAPID_PUBLIC_KEY = ((import.meta.env as any).VITE_VAPID_PUBLIC_KEY as string | undefined) || '';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function hasVapidKey(): boolean {
  return !!VAPID_PUBLIC_KEY;
}

/** base64url 文字列 → Uint8Array (PushManager.subscribe 用) */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** ArrayBuffer → base64url */
function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) return reg;
    // iOS PWA で ready が無限待ちになるケースがあるので 3 秒で諦める
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 3000));
    const ready = navigator.serviceWorker.ready as unknown as Promise<ServiceWorkerRegistration | null>;
    return (await Promise.race([ready, timeout])) as ServiceWorkerRegistration | null;
  } catch { return null; }
}

async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  try {
    // pushManager 未サポート (iOS Safari 16.3 以下など) でも throw するので try-catch
    if (!('pushManager' in reg)) return null;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

/** Supabase から現在の prefs を取得。無ければ null */
async function fetchPrefs(endpoint: string): Promise<PushPrefs | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('prefs')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (error || !data) return null;
  return { ...DEFAULT_PREFS, ...(data.prefs as Partial<PushPrefs>) };
}

/** 現在の購読状態を取得 */
export async function getCurrentStatus(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false, prefs: null };
  }
  const permission = Notification.permission;
  const sub = await getSubscription();
  if (!sub) {
    return { supported: true, permission, subscribed: false, prefs: null };
  }
  const prefs = await fetchPrefs(sub.endpoint);
  return { supported: true, permission, subscribed: true, prefs: prefs || DEFAULT_PREFS };
}

export interface EnableArgs {
  memberId: string;
  oshiCode?: string | null;
  oshiGroup?: string | null;
}

/** 通知を有効化（権限取得 → subscribe → Supabase 保存） */
export async function enablePush(args: EnableArgs): Promise<{ ok: true; prefs: PushPrefs } | { ok: false; reason: string }> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!hasVapidKey())    return { ok: false, reason: 'no-vapid-key' };
  if (!supabase)         return { ok: false, reason: 'supabase-not-configured' };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'permission-denied' };

  const reg = await getRegistration();
  if (!reg) return { ok: false, reason: 'no-sw' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const rawKey = sub.getKey('p256dh');
  const rawAuth = sub.getKey('auth');
  if (!rawKey || !rawAuth) return { ok: false, reason: 'no-keys' };

  const row = {
    endpoint:   sub.endpoint,
    p256dh:     bufferToBase64Url(rawKey),
    auth:       bufferToBase64Url(rawAuth),
    member_id:  args.memberId,
    oshi_code:  args.oshiCode ?? null,
    oshi_group: args.oshiGroup ?? null,
    prefs:      DEFAULT_PREFS,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' });
  if (error) {
    console.warn('push_subscriptions upsert failed:', error);
    return { ok: false, reason: 'supabase-error' };
  }
  return { ok: true, prefs: DEFAULT_PREFS };
}

/** 通知を無効化（subscribe 解除 & Supabase 行削除） */
export async function disablePush(): Promise<void> {
  const sub = await getSubscription();
  if (sub) {
    try { await sub.unsubscribe(); } catch { /* noop */ }
    if (supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
  }
}

/** 特定カテゴリの on/off を切り替える */
export async function updatePrefs(partial: Partial<PushPrefs>): Promise<PushPrefs | null> {
  if (!supabase) return null;
  const sub = await getSubscription();
  if (!sub) return null;
  const current = (await fetchPrefs(sub.endpoint)) || DEFAULT_PREFS;
  const next: PushPrefs = { ...current, ...partial };
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ prefs: next, updated_at: new Date().toISOString() })
    .eq('endpoint', sub.endpoint);
  if (error) {
    console.warn('push_subscriptions update failed:', error);
    return current;
  }
  return next;
}

/**
 * 推しメンが変更されたときに oshi_code/oshi_group を追従させる。
 * endpoint が既に存在する場合のみ UPDATE する（購読していなければ何もしない）。
 */
export async function syncOshiToSubscription(args: {
  memberId: string;
  oshiCode?: string | null;
  oshiGroup?: string | null;
}): Promise<void> {
  if (!supabase) return;
  const sub = await getSubscription();
  if (!sub) return;
  await supabase
    .from('push_subscriptions')
    .update({
      member_id:  args.memberId,
      oshi_code:  args.oshiCode  ?? null,
      oshi_group: args.oshiGroup ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('endpoint', sub.endpoint);
}
