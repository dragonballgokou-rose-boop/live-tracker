// ============================================
// Supabase Client + Auth + Room Context
// ============================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.error('Supabase 環境変数が設定されていません。.env ファイルを確認してください。');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// -------- Auth --------

export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function signUpWithEmail(email, password, displayName) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: displayName } }
    });
    if (error) throw error;
    return data;
}

export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
}

export async function signInWithDiscord() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setCurrentRoom(null);
}

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
}

// -------- Room Context --------

let _currentRoom = null;

export function getCurrentRoom() {
    if (!_currentRoom) {
        const stored = localStorage.getItem('livetracker_current_room');
        if (stored) {
            try { _currentRoom = JSON.parse(stored); } catch { _currentRoom = null; }
        }
    }
    return _currentRoom;
}

export function setCurrentRoom(room) {
    _currentRoom = room;
    if (room) {
        localStorage.setItem('livetracker_current_room', JSON.stringify(room));
    } else {
        localStorage.removeItem('livetracker_current_room');
    }
    window.dispatchEvent(new CustomEvent('livetracker:room-changed', { detail: room }));
}

export function getCurrentRoomId() {
    return getCurrentRoom()?.id ?? null;
}

// -------- User Profile --------

export async function getUserProfile(userId) {
    const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
    return data;
}

export async function upsertUserProfile(userId, updates) {
    const { error } = await supabase
        .from('user_profiles')
        .upsert({ id: userId, ...updates, updated_at: new Date().toISOString() });
    if (error) throw error;
}

// -------- Room Management --------

export async function createRoom(name, description = '') {
    const user = await getCurrentUser();
    if (!user) throw new Error('ログインが必要です');

    // UUID をクライアントで生成することで INSERT 後の ID を把握する
    const roomId = crypto.randomUUID();

    // 1. ルームを INSERT
    const { error: roomError } = await supabase
        .from('rooms')
        .insert({ id: roomId, name: name.trim(), description: description.trim(), owner_id: user.id });

    if (roomError) throw roomError;

    // 2. オーナーを room_members に追加（SELECT の前に追加して RLS を通過させる）
    const { error: memberError } = await supabase
        .from('room_members')
        .upsert({ room_id: roomId, user_id: user.id, role: 'owner' }, { onConflict: 'room_id,user_id' });

    if (memberError) throw memberError;

    // 3. ルームを取得（is_room_member が true になったので RLS を通過できる）
    const { data: room, error: fetchError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .single();

    if (fetchError) throw fetchError;
    if (!room) throw new Error('ルームの作成に失敗しました');

    return room;
}

export async function getUserRooms() {
    const { data, error } = await supabase
        .from('room_members')
        .select('role, joined_at, rooms(id, name, description, invite_code, owner_id, plan, created_at)')
        .order('joined_at', { ascending: false });

    if (error) throw error;
    // m.rooms が null のエントリ（削除済みルーム等）を除外
    return (data || [])
        .map(m => (m.rooms ? { ...m.rooms, role: m.role } : null))
        .filter(r => r && r.id);
}

export async function joinRoomByCode(inviteCode) {
    const user = await getCurrentUser();
    if (!user) throw new Error('ログインが必要です');

    // 招待コードからルームを検索
    const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('id, name')
        .eq('invite_code', inviteCode.trim().toUpperCase())
        .single();

    if (roomError || !room) throw new Error('招待コードが無効です');

    // 既に参加済みかチェック
    const { data: existing } = await supabase
        .from('room_members')
        .select('id')
        .eq('room_id', room.id)
        .eq('user_id', user.id)
        .single();

    if (existing) throw new Error('すでにこのルームに参加しています');

    // ルームに参加
    const { error: joinError } = await supabase
        .from('room_members')
        .insert({ room_id: room.id, user_id: user.id, role: 'member' });

    if (joinError) throw joinError;

    return room;
}

export async function leaveRoom(roomId) {
    const user = await getCurrentUser();
    if (!user) throw new Error('ログインが必要です');

    const { error } = await supabase
        .from('room_members')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', user.id);

    if (error) throw error;
}
