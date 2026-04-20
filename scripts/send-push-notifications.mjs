#!/usr/bin/env node
// ============================================
// Web Push 通知 送信スクリプト (CI 専用)
// ============================================
// 2 モード:
//   1) --feeds-diff
//      `public/official-member-feeds.json` を git HEAD~1 / HEAD で比較し、
//      「新しいブログ」「新しいスケジュール」を検知したメンバーについて
//      そのメンバーを推しメン登録している購読者に通知。
//
//   2) --live-reminders
//      Supabase から明日 / 今日のライブを取得し、
//      attendance.status='going' のメンバーに前日 / 当日通知を送る。
//
// 必須環境変数:
//   VAPID_PUBLIC_KEY   / VAPID_PRIVATE_KEY   / VAPID_SUBJECT (mailto:... or https://...)
//   SUPABASE_URL       / SUPABASE_SERVICE_KEY  (service_role 推奨 / anon でも可)
//
// デバッグ用オプション:
//   --dry-run    実際には送信せず、送信予定件数をログに出すだけ

import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEEDS_PATH = resolve(__dirname, '..', 'public', 'official-member-feeds.json');
const APP_URL    = process.env.APP_URL || 'https://dragonballgokou-rose-boop.github.io/live-tracker/';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const MODE_FEEDS = args.has('--feeds-diff');
const MODE_LIVES = args.has('--live-reminders');

if (!MODE_FEEDS && !MODE_LIVES) {
  console.error('usage: send-push-notifications.mjs (--feeds-diff | --live-reminders) [--dry-run]');
  process.exit(1);
}

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:push@example.com';
const SUPABASE_URL  = process.env.SUPABASE_URL      || '';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が未設定です');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定です');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ---------- 送信ユーティリティ ----------

/** 送達失敗 (410 Gone / 404) の購読を DB から削除 */
async function cleanupDeadSubscription(endpoint) {
  try {
    await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    console.log(`  cleaned up dead subscription: ${endpoint.slice(0, 60)}…`);
  } catch (e) {
    console.warn(`  cleanup failed: ${e?.message || e}`);
  }
}

/** 1 購読へ payload を送信。失敗時は 410/404 なら cleanup */
async function sendOne(sub, payload) {
  const subscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  if (DRY_RUN) {
    console.log(`  [dry] would send to ${sub.endpoint.slice(0, 60)}… : ${payload.title} / ${payload.body}`);
    return;
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) {
      await cleanupDeadSubscription(sub.endpoint);
    } else {
      console.warn(`  send failed (${code}): ${err?.body || err?.message || err}`);
    }
  }
}

// ---------- feeds-diff モード ----------

async function loadPrevFeeds() {
  try {
    const prev = execSync('git show HEAD~1:public/official-member-feeds.json', {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    return JSON.parse(prev);
  } catch {
    console.warn('HEAD~1 の feeds JSON が取得できませんでした (初回コミット?)。差分送信はスキップします。');
    return null;
  }
}

function diffNewBlogs(prevFeed, nextFeed) {
  const prevUrls = new Set((prevFeed?.blog || []).map(b => b.url));
  return (nextFeed?.blog || []).filter(b => !prevUrls.has(b.url));
}

function diffNewSchedules(prevFeed, nextFeed) {
  // title + dayOfMonth + cate の組を id として使用
  const key = s => `${s.dayOfMonth ?? ''}|${s.cate ?? ''}|${s.title ?? ''}`;
  const prevSet = new Set((prevFeed?.schedule || []).map(key));
  return (nextFeed?.schedule || []).filter(s => !prevSet.has(key(s)));
}

async function runFeedsDiff() {
  const next = JSON.parse(await readFile(FEEDS_PATH, 'utf8'));
  const prev = await loadPrevFeeds();
  if (!prev) return;

  // 購読者一覧（oshi_code / oshi_group でマッチ）
  const { data: subs, error } = await sb.from('push_subscriptions').select('*');
  if (error) { console.error('fetch subs failed:', error); return; }
  if (!subs || subs.length === 0) { console.log('購読者なし'); return; }

  let sentBlog = 0, sentSched = 0;

  for (const [key, nextFeed] of Object.entries(next.feeds || {})) {
    const [group, code] = key.split(':');
    const prevFeed = prev.feeds?.[key];
    const newBlogs = diffNewBlogs(prevFeed, nextFeed);
    const newScheds = diffNewSchedules(prevFeed, nextFeed);
    if (newBlogs.length === 0 && newScheds.length === 0) continue;

    const targets = subs.filter(s =>
      s.oshi_code === code && s.oshi_group === group
    );
    if (targets.length === 0) continue;

    const memberName = await lookupMemberName(group, code);

    // ブログ通知（最大 3 件まで 1 通ずつ）
    for (const blog of newBlogs.slice(0, 3)) {
      for (const sub of targets.filter(t => t.prefs?.blog !== false)) {
        await sendOne(sub, {
          title: `${memberName} の新着ブログ`,
          body: blog.title,
          url: blog.url,
          tag: `blog:${key}:${blog.url}`,
        });
        sentBlog++;
      }
    }

    // スケジュール更新通知（まとめて 1 通）
    if (newScheds.length > 0) {
      const summary = newScheds.length === 1
        ? `新しい出演: ${newScheds[0].title}`
        : `出演予定が ${newScheds.length} 件追加されました`;
      for (const sub of targets.filter(t => t.prefs?.schedule !== false)) {
        await sendOne(sub, {
          title: `${memberName} の出演情報`,
          body: summary,
          url: APP_URL,
          tag: `schedule:${key}`,
        });
        sentSched++;
      }
    }
  }

  console.log(`feeds-diff: sent ${sentBlog} blog, ${sentSched} schedule push`);
}

// ---------- live-reminders モード ----------

function ymd(d) { return d.toISOString().slice(0, 10); }

function nowInJst() {
  // JST = UTC+9。GitHub Actions は UTC。
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

async function runLiveReminders() {
  const today = nowInJst();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = ymd(today);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = ymd(tomorrow);

  // 今日 or 明日に開催のライブ
  const { data: lives, error: livesErr } = await sb
    .from('lives')
    .select('id,name,venue,date_start,date_end')
    .or(`date_start.eq.${todayStr},date_start.eq.${tomorrowStr}`);
  if (livesErr) { console.error('lives fetch failed:', livesErr); return; }
  if (!lives || lives.length === 0) { console.log('対象ライブなし'); return; }

  // going 参戦者
  const liveIds = lives.map(l => l.id);
  const { data: attendance, error: attErr } = await sb
    .from('attendance')
    .select('live_id,member_id,status')
    .in('live_id', liveIds)
    .eq('status', 'going');
  if (attErr) { console.error('attendance fetch failed:', attErr); return; }

  if (!attendance || attendance.length === 0) { console.log('going 参戦者なし'); return; }

  const memberIds = [...new Set(attendance.map(a => a.member_id))];

  // 該当メンバーの subscription
  const { data: subs, error: subsErr } = await sb
    .from('push_subscriptions')
    .select('*')
    .in('member_id', memberIds);
  if (subsErr) { console.error('subs fetch failed:', subsErr); return; }
  if (!subs || subs.length === 0) { console.log('購読者なし'); return; }

  const subsByMember = new Map();
  for (const s of subs) {
    if (!subsByMember.has(s.member_id)) subsByMember.set(s.member_id, []);
    subsByMember.get(s.member_id).push(s);
  }

  let sent = 0;
  const livesById = new Map(lives.map(l => [l.id, l]));

  for (const att of attendance) {
    const live = livesById.get(att.live_id);
    if (!live) continue;
    const isToday = live.date_start === todayStr;
    const prefKey = isToday ? 'live_day' : 'live_prev_day';
    const prefixLabel = isToday ? '【今日】' : '【明日】';
    const targets = (subsByMember.get(att.member_id) || []).filter(s => s.prefs?.[prefKey] !== false);
    for (const sub of targets) {
      await sendOne(sub, {
        title: `${prefixLabel} ${live.name}`,
        body: live.venue ? `会場: ${live.venue}` : '参戦予定のライブです',
        url: APP_URL,
        tag: `live:${live.id}:${prefKey}`,
      });
      sent++;
    }
  }
  console.log(`live-reminders: sent ${sent} push (today=${todayStr}, tomorrow=${tomorrowStr})`);
}

// ---------- helper: 公式メンバー名 lookup ----------

let membersCache = null;
async function lookupMemberName(group, code) {
  if (!membersCache) {
    try {
      const txt = await readFile(resolve(__dirname, '..', 'public', 'official-members.json'), 'utf8');
      membersCache = JSON.parse(txt);
    } catch { membersCache = { members: [] }; }
  }
  const m = (membersCache.members || []).find(x => x.group === group && x.code === code);
  return (m && m.name) || '推しメン';
}

// ---------- main ----------

(async () => {
  if (MODE_FEEDS) await runFeedsDiff();
  if (MODE_LIVES) await runLiveReminders();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
