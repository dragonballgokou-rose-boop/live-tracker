-- ============================================
-- Live Tracker - Supabase Schema
-- ============================================
-- Supabase ダッシュボードの SQL Editor に貼り付けて実行してください

-- ============================================
-- テーブル定義
-- ============================================

create table if not exists lives (
  id          text primary key,
  name        text not null,
  artist      text,
  venue       text,
  date_start  text,
  date_end    text,
  date        text,
  memo        text,
  icon        text,
  icon_img    text,
  color       text,
  prefecture  text,
  created_at  timestamptz,
  updated_at  timestamptz
);

create table if not exists members (
  id          text primary key,
  name        text not null,
  nickname    text,
  color       text,
  avatar      text,
  created_at  timestamptz,
  updated_at  timestamptz
);

-- attendance.live_id は通常の live.id、または
-- 日付別記録の場合は "{liveId}_{dateStr}" の複合キーになります
create table if not exists attendance (
  id          text primary key,
  live_id     text not null,
  member_id   text not null,
  status      text not null check (status in ('going', 'notgoing', 'undecided')),
  created_at  timestamptz,
  updated_at  timestamptz
);

-- ============================================
-- インデックス
-- ============================================

create index if not exists attendance_live_id_idx    on attendance (live_id);
create index if not exists attendance_member_id_idx  on attendance (member_id);

-- ============================================
-- Row Level Security (RLS)
-- 認証なしで匿名アクセスを許可する設定
-- ============================================

alter table lives      enable row level security;
alter table members    enable row level security;
alter table attendance enable row level security;

-- 全操作を許可（認証なしアプリのため）
create policy "allow all for lives"
  on lives for all
  using (true)
  with check (true);

create policy "allow all for members"
  on members for all
  using (true)
  with check (true);

create policy "allow all for attendance"
  on attendance for all
  using (true)
  with check (true);
