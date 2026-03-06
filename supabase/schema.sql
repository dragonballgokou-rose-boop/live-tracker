-- ============================================================
-- LIVE TRACKER - Supabase Schema
-- Supabase ダッシュボードの SQL Editor でこれを実行してください
-- ============================================================

-- -------- Extensions --------
create extension if not exists "pgcrypto";

-- -------- Helper Function --------
create or replace function public.generate_invite_code()
returns text as $$
  select upper(substring(md5(random()::text) from 1 for 8));
$$ language sql volatile;

-- -------- Tables --------

-- Rooms (Discord サーバーに相当)
create table public.rooms (
  id          uuid        default gen_random_uuid() primary key,
  name        text        not null,
  description text,
  invite_code text        unique default public.generate_invite_code(),
  owner_id    uuid        references auth.users(id) on delete cascade not null,
  plan        text        default 'free' check (plan in ('free', 'pro', 'team')),
  created_at  timestamptz default now()
);

-- Room Membership
create table public.room_members (
  id           uuid        default gen_random_uuid() primary key,
  room_id      uuid        references public.rooms(id) on delete cascade not null,
  user_id      uuid        references auth.users(id) on delete cascade not null,
  role         text        default 'member' check (role in ('owner', 'admin', 'member')),
  display_name text,
  joined_at    timestamptz default now(),
  unique(room_id, user_id)
);

-- User Profiles (auth.users の拡張)
create table public.user_profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  avatar_url   text,
  updated_at   timestamptz default now()
);

-- Lives (room スコープ)
create table public.lives (
  id          uuid        default gen_random_uuid() primary key,
  room_id     uuid        references public.rooms(id) on delete cascade not null,
  name        text        not null,
  artist      text,
  venue       text,
  prefecture  text,
  date_start  date        not null,
  date_end    date,
  tour_name   text,
  memo        text,
  icon        text,
  icon_img    text,
  color       text,
  created_by  uuid        references auth.users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Members (room スコープ - 推しメンなど)
create table public.members (
  id         uuid        default gen_random_uuid() primary key,
  room_id    uuid        references public.rooms(id) on delete cascade not null,
  name       text        not null,
  nickname   text,
  color      text,
  avatar     text,
  memo       text,
  created_at timestamptz default now()
);

-- Attendance (参戦記録)
create table public.attendance (
  id         uuid        default gen_random_uuid() primary key,
  live_id    uuid        references public.lives(id) on delete cascade not null,
  member_id  uuid        references public.members(id) on delete cascade not null,
  date_str   text        not null default '',
  status     text        check (status in ('going', 'not_going', 'undecided')),
  user_id    uuid        references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(live_id, member_id, date_str)
);

-- Messages (チャット)
create table public.messages (
  id           uuid        default gen_random_uuid() primary key,
  room_id      uuid        references public.rooms(id) on delete cascade not null,
  live_id      uuid        references public.lives(id) on delete set null,
  user_id      uuid        references auth.users(id) on delete cascade not null,
  display_name text,
  avatar_url   text,
  content      text        not null,
  created_at   timestamptz default now()
);

-- -------- Row Level Security --------

alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;
alter table public.user_profiles enable row level security;
alter table public.lives         enable row level security;
alter table public.members       enable row level security;
alter table public.attendance    enable row level security;
alter table public.messages      enable row level security;

-- ルームメンバーチェック用ヘルパー関数
create or replace function public.is_room_member(p_room_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$ language sql security definer;

-- Rooms ポリシー
create policy "members can view their rooms"
  on public.rooms for select
  using (public.is_room_member(id));

create policy "authenticated users can create rooms"
  on public.rooms for insert
  with check (owner_id = auth.uid());

create policy "owners can update rooms"
  on public.rooms for update
  using (owner_id = auth.uid());

create policy "owners can delete rooms"
  on public.rooms for delete
  using (owner_id = auth.uid());

-- Room Members ポリシー
create policy "room members can view membership"
  on public.room_members for select
  using (public.is_room_member(room_id));

create policy "users can join rooms"
  on public.room_members for insert
  with check (user_id = auth.uid());

create policy "users can leave or be removed"
  on public.room_members for delete
  using (user_id = auth.uid() or
    exists (select 1 from public.rooms where id = room_id and owner_id = auth.uid()));

-- User Profiles ポリシー
create policy "anyone can view profiles"
  on public.user_profiles for select using (true);

create policy "users can insert own profile"
  on public.user_profiles for insert with check (id = auth.uid());

create policy "users can update own profile"
  on public.user_profiles for update using (id = auth.uid());

-- Lives ポリシー
create policy "room members can view lives"
  on public.lives for select using (public.is_room_member(room_id));

create policy "room members can insert lives"
  on public.lives for insert with check (public.is_room_member(room_id));

create policy "room members can update lives"
  on public.lives for update using (public.is_room_member(room_id));

create policy "room members can delete lives"
  on public.lives for delete using (public.is_room_member(room_id));

-- Members ポリシー
create policy "room members can view members"
  on public.members for select using (public.is_room_member(room_id));

create policy "room members can insert members"
  on public.members for insert with check (public.is_room_member(room_id));

create policy "room members can update members"
  on public.members for update using (public.is_room_member(room_id));

create policy "room members can delete members"
  on public.members for delete using (public.is_room_member(room_id));

-- Attendance ポリシー (lives 経由でルームチェック)
create policy "room members can view attendance"
  on public.attendance for select
  using (exists (
    select 1 from public.lives l
    where l.id = attendance.live_id and public.is_room_member(l.room_id)
  ));

create policy "room members can upsert attendance"
  on public.attendance for insert
  with check (exists (
    select 1 from public.lives l
    where l.id = live_id and public.is_room_member(l.room_id)
  ));

create policy "room members can update attendance"
  on public.attendance for update
  using (exists (
    select 1 from public.lives l
    where l.id = attendance.live_id and public.is_room_member(l.room_id)
  ));

-- Messages ポリシー
create policy "room members can view messages"
  on public.messages for select using (public.is_room_member(room_id));

create policy "room members can send messages"
  on public.messages for insert
  with check (public.is_room_member(room_id) and user_id = auth.uid());

-- -------- Realtime (必要なテーブルを有効化) --------
-- Supabase ダッシュボード > Database > Replication で
-- messages と attendance を有効化してください

-- -------- Trigger: 新規ユーザー登録時にプロフィール自動作成 --------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
