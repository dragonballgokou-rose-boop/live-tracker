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
