import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://pkayjsveiqelpouaaizi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrYXlqc3ZlaXFlbHBvdWFhaXppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODgwNTEsImV4cCI6MjA4ODM2NDA1MX0.iZV_RIh5NF34k69YkZg5PgGpEYJ31w0DffOYfxb4NP4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const data = JSON.parse(readFileSync('/home/user/live-tracker/import-data.json', 'utf8'));

// lives テーブル用に変換
const lives = data.lives.map(live => ({
  id:          live.id,
  name:        live.name || '',
  artist:      live.artist      || null,
  venue:       live.venue       || null,
  date_start:  live.dateStart   || null,
  date_end:    live.dateEnd     || null,
  date:        live.date        || null,
  memo:        live.memo        || null,
  icon:        live.icon        || null,
  icon_img:    live.iconImg     || null,
  color:       live.color       || null,
  prefecture:  live.prefecture  || null,
  created_at:  live.createdAt   || null,
  updated_at:  live.updatedAt   || null,
}));

// members テーブル用に変換
const members = data.members.map(member => ({
  id:         member.id,
  name:       member.name || '',
  nickname:   member.nickname  || null,
  color:      member.color     || null,
  avatar:     member.avatar    || null,
  created_at: member.createdAt || null,
  updated_at: member.updatedAt || null,
}));

// attendance テーブル用に変換（not_going → notgoing）
const attendance = data.attendance.map(att => ({
  id:         att.id,
  live_id:    att.liveId,
  member_id:  att.memberId,
  status:     att.status === 'not_going' ? 'notgoing' : att.status,
  created_at: att.createdAt || null,
  updated_at: att.updatedAt || null,
}));

async function importAll() {
  console.log(`Lives: ${lives.length}件`);
  console.log(`Members: ${members.length}件`);
  console.log(`Attendance: ${attendance.length}件`);

  // Lives を upsert
  console.log('\n--- Lives をインポート中 ---');
  const { error: livesErr } = await supabase.from('lives').upsert(lives, { onConflict: 'id' });
  if (livesErr) { console.error('Lives エラー:', livesErr.message); process.exit(1); }
  console.log('✓ Lives 完了');

  // Members を upsert
  console.log('--- Members をインポート中 ---');
  const { error: membersErr } = await supabase.from('members').upsert(members, { onConflict: 'id' });
  if (membersErr) { console.error('Members エラー:', membersErr.message); process.exit(1); }
  console.log('✓ Members 完了');

  // Attendance を upsert（チャンクで送る）
  console.log('--- Attendance をインポート中 ---');
  const CHUNK = 50;
  for (let i = 0; i < attendance.length; i += CHUNK) {
    const chunk = attendance.slice(i, i + CHUNK);
    const { error: attErr } = await supabase.from('attendance').upsert(chunk, { onConflict: 'id' });
    if (attErr) { console.error(`Attendance エラー (chunk ${i}):`, attErr.message); process.exit(1); }
    process.stdout.write(`  ${Math.min(i + CHUNK, attendance.length)}/${attendance.length}\r`);
  }
  console.log('\n✓ Attendance 完了');

  console.log('\n✅ インポート完了！');
}

importAll().catch(e => { console.error(e); process.exit(1); });
