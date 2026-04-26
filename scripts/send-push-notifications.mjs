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
const LOG_PATH   = resolve(__dirname, '..', 'public', 'push-log.json');
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
  console.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が未設定です。push 送信をスキップします。');
  process.exit(0);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定です。push 送信をスキップします。');
  process.exit(0);
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

/** 1 購読へ payload を送信。失敗時は 410/404 なら cleanup
 *  返り値: 'sent' | 'dry' | 'cleaned' | `error:${code}` (送信失敗の HTTP code or 'unknown')
 */
async function sendOne(sub, payload) {
  const subscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  if (DRY_RUN) {
    console.log(`  [dry] would send to ${sub.endpoint.slice(0, 60)}… : ${payload.title} / ${payload.body}`);
    return 'dry';
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return 'sent';
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) {
      await cleanupDeadSubscription(sub.endpoint);
      return 'cleaned';
    }
    console.warn(`  send failed (${code}): ${err?.body || err?.message || err}`);
    return `error:${code || 'unknown'}`;
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
  // prev は URL と (title+date) の両方で既知とみなす（スクレイパが URL 違いで
  // 同じ記事を重複収集した場合に、直前の diff でも同じ title+date が push 済みの
  // ものとして扱うため）
  const prevUrls = new Set((prevFeed?.blog || []).map(b => b.url));
  const prevKeys = new Set((prevFeed?.blog || []).map(b => `${b.title ?? ''}|${b.date ?? ''}`));
  const newOnes = (nextFeed?.blog || []).filter(b =>
    !prevUrls.has(b.url) && !prevKeys.has(`${b.title ?? ''}|${b.date ?? ''}`)
  );
  // next 側でも title+date が同一のものは 1 件にまとめる（1 記事 1 通知）
  const seen = new Set();
  const deduped = [];
  for (const b of newOnes) {
    const k = `${b.title ?? ''}|${b.date ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(b);
  }
  return deduped;
}

function diffNewSchedules(prevFeed, nextFeed) {
  // title + dayOfMonth + cate の組を id として使用
  const key = s => `${s.dayOfMonth ?? ''}|${s.cate ?? ''}|${s.title ?? ''}`;
  const prevSet = new Set((prevFeed?.schedule || []).map(key));
  return (nextFeed?.schedule || []).filter(s => !prevSet.has(key(s)));
}

async function runFeedsDiff() {
  const pushLog = {
    ranAt: new Date().toISOString(),
    mode: 'feeds-diff',
    subsCount: 0,
    perFeed: [],
    outcomes: {},   // 'sent' | 'cleaned' | 'error:404' などごとの件数
    totalAttempts: 0,
  };
  try {
    await runFeedsDiffInner(pushLog);
  } catch (e) {
    console.error('runFeedsDiff failed:', e);
    pushLog.error = String(e?.stack || e?.message || e);
    throw e;
  } finally {
    // 例外でも writeLog は必ず行う（push-log.json で原因が見えるように）
    await writeLog(pushLog).catch(err => console.warn('writeLog failed:', err));
  }
}

async function runFeedsDiffInner(pushLog) {
  const next = JSON.parse(await readFile(FEEDS_PATH, 'utf8'));
  const prev = await loadPrevFeeds();
  pushLog.prevAvailable = !!prev;
  if (!prev) return;  // log は finally で書く

  // 購読者一覧（oshi_code / oshi_group でマッチ）
  const { data: subs, error } = await sb.from('push_subscriptions').select('*');
  if (error) {
    console.error('fetch subs failed:', error);
    pushLog.fetchSubsError = String(error.message || error);
    return;
  }
  pushLog.subsCount = subs?.length || 0;
  if (!subs || subs.length === 0) {
    console.log('購読者なし');
    return;
  }

  let sentBlog = 0, sentSched = 0;
  const tally = (outcome) => {
    pushLog.outcomes[outcome] = (pushLog.outcomes[outcome] || 0) + 1;
    pushLog.totalAttempts++;
  };

  for (const [key, nextFeed] of Object.entries(next.feeds || {})) {
    const [group, code] = key.split(':');
    const prevFeed = prev.feeds?.[key];
    const newBlogs = diffNewBlogs(prevFeed, nextFeed);
    const newScheds = diffNewSchedules(prevFeed, nextFeed);
    if (newBlogs.length === 0 && newScheds.length === 0) continue;

    const targets = subs.filter(s =>
      s.oshi_code === code && s.oshi_group === group
    );
    const feedRow = {
      feedKey: key,
      newBlogs: newBlogs.length,
      newScheds: newScheds.length,
      subscribers: targets.length,
    };
    if (targets.length === 0) {
      feedRow.skipped = 'no subscribers';
      pushLog.perFeed.push(feedRow);
      continue;
    }

    const memberName = await lookupMemberName(group, code);
    feedRow.memberName = memberName;
    pushLog.perFeed.push(feedRow);

    // ブログ通知（最大 3 件まで 1 通ずつ）
    for (const blog of newBlogs.slice(0, 3)) {
      for (const sub of targets.filter(t => t.prefs?.blog !== false)) {
        const outcome = await sendOne(sub, {
          title: `${memberName} の新着ブログ`,
          body: blog.title,
          url: blog.url,
          tag: `blog:${key}:${blog.url}`,
        });
        tally(outcome);
        sentBlog++;
      }
    }

    // スケジュール更新通知（まとめて 1 通）
    if (newScheds.length > 0) {
      const summary = newScheds.length === 1
        ? `新しい出演: ${newScheds[0].title}`
        : `出演予定が ${newScheds.length} 件追加されました`;
      for (const sub of targets.filter(t => t.prefs?.schedule !== false)) {
        const outcome = await sendOne(sub, {
          title: `${memberName} の出演情報`,
          body: summary,
          url: APP_URL,
          tag: `schedule:${key}`,
        });
        tally(outcome);
        sentSched++;
      }
    }
  }

  console.log(`feeds-diff: sent ${sentBlog} blog, ${sentSched} schedule push`);
  pushLog.sentBlog = sentBlog;
  pushLog.sentSched = sentSched;
}

// ---------- push log ----------

/**
 * public/push-log.json に最近の実行履歴を残す（直近 14 件まで）。
 * 端点 URL や購読 ID 等の機密は含めない（feedKey, memberName, 件数のみ）。
 */
async function writeLog(latest) {
  let history = [];
  try {
    const raw = await readFile(LOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.runs)) history = parsed.runs;
  } catch { /* ファイル無し / 壊れ */ }
  history.unshift(latest);
  history = history.slice(0, 14);
  const out = { lastRunAt: latest.ranAt, runs: history };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(LOG_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
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

  const pushLog = {
    ranAt: new Date().toISOString(),
    mode: 'live-reminders',
    todayJst: todayStr,
    tomorrowJst: tomorrowStr,
    livesCount: 0,
    attendanceCount: 0,
    subsCount: 0,
    outcomes: {},
    totalAttempts: 0,
  };
  try {
    await runLiveRemindersInner(pushLog, todayStr, tomorrowStr);
  } catch (e) {
    console.error('runLiveReminders failed:', e);
    pushLog.error = String(e?.stack || e?.message || e);
    throw e;
  } finally {
    await writeLog(pushLog).catch(err => console.warn('writeLog failed:', err));
  }
}

async function runLiveRemindersInner(pushLog, todayStr, tomorrowStr) {
  const tally = (outcome) => {
    pushLog.outcomes[outcome] = (pushLog.outcomes[outcome] || 0) + 1;
    pushLog.totalAttempts++;
  };

  const { data: lives, error: livesErr } = await sb
    .from('lives')
    .select('id,name,venue,date_start,date_end')
    .or(`date_start.eq.${todayStr},date_start.eq.${tomorrowStr}`);
  if (livesErr) { pushLog.error = String(livesErr.message||livesErr); return; }
  pushLog.livesCount = lives?.length || 0;
  if (!lives || lives.length === 0) { console.log('対象ライブなし'); return; }

  const liveIds = lives.map(l => l.id);
  const { data: attendance, error: attErr } = await sb
    .from('attendance')
    .select('live_id,member_id,status')
    .in('live_id', liveIds)
    .eq('status', 'going');
  if (attErr) { pushLog.error = String(attErr.message||attErr); return; }
  if (!attendance || attendance.length === 0) { console.log('going 参戦者なし'); return; }
  pushLog.attendanceCount = attendance.length;

  const memberIds = [...new Set(attendance.map(a => a.member_id))];
  const { data: subs, error: subsErr } = await sb
    .from('push_subscriptions')
    .select('*')
    .in('member_id', memberIds);
  if (subsErr) { pushLog.error = String(subsErr.message||subsErr); return; }
  pushLog.subsCount = subs?.length || 0;
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
      const outcome = await sendOne(sub, {
        title: `${prefixLabel} ${live.name}`,
        body: live.venue ? `会場: ${live.venue}` : '参戦予定のライブです',
        url: APP_URL,
        tag: `live:${live.id}:${prefKey}`,
      });
      tally(outcome);
      sent++;
    }
  }
  console.log(`live-reminders: sent ${sent} push (today=${todayStr}, tomorrow=${tomorrowStr})`);
  pushLog.sent = sent;
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
