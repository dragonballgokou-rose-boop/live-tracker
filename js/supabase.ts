import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase 環境変数が設定されていません。クラウド同期は無効になります。');
}

export const supabase: SupabaseClient | null = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 0 } },
      global: {
        headers: { 'x-client-info': 'live-tracker' },
      },
    })
  : null;

// Realtime チャンネルを自動接続しないよう切断
if (supabase) {
  supabase.removeAllChannels();
}
