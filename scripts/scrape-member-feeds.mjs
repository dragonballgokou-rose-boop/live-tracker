#!/usr/bin/env node
// ============================================
// Member feeds scraper
// ============================================
// 公式メンバー一覧 (public/official-members.json) の各メンバーについて、
// 最新ブログ 10 件 と 直近スケジュール 10 件 を取得し
// public/official-member-feeds.json に書き出す。
//
// 取得元:
//   - 乃木坂46 / 櫻坂46 の mobile HTML ページを正規表現でパース
//     blog:  /s/<g>/diary/MEMBER/list?ct=<code>&ima=0000
//     sched: /s/<g>/artist/SCHEDULE/<code>?ima=0000
//
// Sony Music CMS の HTML 構造は比較的安定だが、壊れた場合は
// そのメンバーを skip し他に影響を出さない。
//
// GitHub Actions で毎日実行予定（時間は members scraper の後続）。

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMBERS_PATH = resolve(__dirname, '..', 'public', 'official-members.json');
const OUT_PATH     = resolve(__dirname, '..', 'public', 'official-member-feeds.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const THROTTLE_MS = 120;           // 連続リクエスト間の待ち
const MAX_ITEMS   = 10;

const GROUP_CONFIG = {
  nogi: {
    host: 'https://www.nogizaka46.com',
    referer: 'https://www.nogizaka46.com/s/n46',
    blogList: code => `https://www.nogizaka46.com/s/n46/diary/MEMBER/list?ima=0000&ct=${encodeURIComponent(code)}`,
    // スケジュールは複数 URL パターンを試す（Sony Music CMS は変更しがち）
    scheduleCandidates: code => [
      `https://www.nogizaka46.com/s/n46/artist/${encodeURIComponent(code)}/SCHEDULE?ima=0000`,
      `https://www.nogizaka46.com/s/n46/artist/${encodeURIComponent(code)}/schedule?ima=0000`,
      `https://www.nogizaka46.com/s/n46/artist/${encodeURIComponent(code)}?ima=0000&page=schedule`,
      `https://www.nogizaka46.com/s/n46/schedule/list?ima=0000&ct=${encodeURIComponent(code)}`,
    ],
  },
  saku: {
    host: 'https://sakurazaka46.com',
    referer: 'https://sakurazaka46.com/s/s46',
    blogList: code => `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&ct=${encodeURIComponent(code)}`,
    scheduleCandidates: code => [
      `https://sakurazaka46.com/s/s46/artist/${encodeURIComponent(code)}/SCHEDULE?ima=0000`,
      `https://sakurazaka46.com/s/s46/artist/${encodeURIComponent(code)}/schedule?ima=0000`,
      `https://sakurazaka46.com/s/s46/schedule/list?ima=0000&ct=${encodeURIComponent(code)}`,
    ],
  },
};

// ---------- fetch ----------

async function fetchHtml(url, referer) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9',
      'Referer': referer,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- helpers ----------

function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(u, host) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('/') ? host + s : host + '/' + s;
}

/**
 * 日時を ISO 風文字列に正規化する。入力例:
 *   "2026.04.12 17:40"  / "2026/04/12 17:40"  / "2026-04-12 17:40:00"
 */
function normalizeDateTime(s) {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return t;
  const [, y, mo, d, hh, mm, ss] = m;
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${y}-${pad(mo)}-${pad(d)}`;
  if (hh == null) return datePart;
  return `${datePart}T${pad(hh)}:${pad(mm)}:${pad(ss || '00')}`;
}

// ---------- blog parser ----------

/**
 * Sony Music CMS blog list HTML から エントリを抽出する。
 * 構造例 (乃木坂):
 *   <article class="a-bl__item">
 *     <a href="/s/n46/diary/detail/XXX?..."><img src="..."></a>
 *     <p class="ttl">...</p>
 *     <time datetime="2026.04.12 17:40">2026.04.12 17:40</time>
 *   </article>
 * CSS class は変わりがちなので、a[href*="/diary/detail/"] を
 * アンカーにして周辺をスキャンする。
 */
function parseBlogList(html, host) {
  const results = [];
  const linkRe = /<a[^>]+href=["']([^"']*\/diary\/detail\/[^"']+)["'][^>]*>/g;
  const seenUrls = new Set();
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const url = absoluteUrl(m[1], host);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    // 周辺 ~3000 文字を取得（image が anchor の前後どちらにあっても拾えるよう）
    const start = Math.max(0, m.index - 1000);
    const end   = Math.min(html.length, m.index + 2500);
    const chunk = html.slice(start, end);

    // タイトル候補（class 属性バリエーション）
    let title = null;
    const titleMatch =
      chunk.match(/class=["'][^"']*(?:ttl|title|bl__ttl|a-list__name|name)[^"']*["'][^>]*>([^<]+)</i) ||
      chunk.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/);
    if (titleMatch) title = cleanText(titleMatch[1]);

    // 日付候補
    let date = null;
    const dateMatch =
      chunk.match(/<time[^>]*datetime=["']([^"']+)["']/i) ||
      chunk.match(/<time[^>]*>([^<]+)<\/time>/i) ||
      chunk.match(/class=["'][^"']*(?:date|bl__date|a-list__date)[^"']*["'][^>]*>([^<]+)</i) ||
      chunk.match(/(\d{4}[\.\/\-]\d{1,2}[\.\/\-]\d{1,2}(?:[ T]+\d{1,2}:\d{2})?)/);
    if (dateMatch) date = normalizeDateTime(dateMatch[1]);

    // サムネイル: <img> の src/data-src/data-original or background-image:url(...)
    // Sony Music CMS は lazyload で多種属性を使うので幅広に
    let thumbnail = null;
    const imgMatch =
      chunk.match(/<img[^>]+(?:src|data-src|data-original|data-lazy-src|data-image)=["']([^"']+)["']/i)
      || chunk.match(/background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/i);
    if (imgMatch) {
      const candidate = imgMatch[1];
      // 1x1 pixel placeholder や spacer は除外
      if (!/spacer|blank|loading|placeholder/i.test(candidate)) {
        thumbnail = absoluteUrl(candidate, host);
      }
    }

    if (!title) continue;
    results.push({ url, title, date, thumbnail });
    if (results.length >= MAX_ITEMS) break;
  }
  return results;
}

// ---------- schedule parser ----------

/**
 * スケジュールページかどうかを判定する。
 * MEMBER'S SCHEDULE ヘッダや schedule 専用のマーカーが見えなければ false。
 */
function looksLikeSchedulePage(html) {
  if (!html) return false;
  // 明確なマーカー
  if (/MEMBER.{0,5}SCHEDULE/i.test(html)) return true;
  if (/class=["'][^"']*(?:sc--|schedule|sched-day|sc-day)[^"']*["']/i.test(html)) return true;
  // 月ナビ ("<span>04</span> Apr") + カテゴリ両方
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(html)
      && /(ラジオ|テレビ|ライブ|イベント)/.test(html)) {
    return true;
  }
  return false;
}

/**
 * MEMBER'S SCHEDULE HTML から 直近スケジュールを抽出する。
 * スケジュールページだと判定できた場合のみパース。
 * カテゴリキーワードの周辺に 1〜2 桁の日付があり、まともなタイトルが続く
 * ことを要件にして、他ページで偶然マッチした「乃木坂工事中」などを除外する。
 */
function parseSchedule(html) {
  if (!looksLikeSchedulePage(html)) return [];

  const results = [];
  const catRe = /(ラジオ|テレビ|ＴＶ|TV|ライブ|イベント|雑誌|ネット|MC|ファンミ|舞台|配信|CM|写真集|書籍|リリース|コンサート)/g;
  const seen = new Set();
  let m;
  while ((m = catRe.exec(html)) !== null) {
    const cate = m[1];
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    // day: より厳格に schedule 日付要素に見えるもののみ
    const dayMatch =
      before.match(/class=["'][^"']*(?:sc[-_][^"']*__?d|sched[-_]?d|day[-_]?num|date[-_]?d)[^"']*["'][^>]*>\s*(\d{1,2})\s*</i)
      || before.match(/<(?:p|span|div|dt)[^>]*>\s*(\d{1,2})\s*<\/(?:p|span|div|dt)>\s*<(?:p|span|div)[^>]*>\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
    if (!dayMatch) continue; // day が取れない = 疑似
    const day = Number(dayMatch[1]);
    if (!day || day < 1 || day > 31) continue;

    const after = html.slice(m.index + cate.length, m.index + cate.length + 1200);
    let titleMatch = after.match(/class=["'][^"']*(?:ttl|title|name)[^"']*["'][^>]*>([^<]{3,200})</i);
    if (!titleMatch) titleMatch = after.match(/<(?:p|span|h[1-6]|dd|dt)[^>]*>([^<]{5,200})</i);
    if (!titleMatch) continue;
    const title = cleanText(titleMatch[1]);
    if (!title) continue;
    // ノイズ除外
    if (/^(ラジオ|テレビ|ライブ|イベント|SCHEDULE|MEMBER)$/i.test(title)) continue;

    const key = `${day}|${cate}|${title.slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ cate, title, dayOfMonth: day });
    if (results.length >= MAX_ITEMS) break;
  }
  return results;
}

// ---------- main ----------

async function readMembers() {
  try {
    const text = await readFile(MEMBERS_PATH, 'utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.members) ? parsed.members : [];
  } catch (e) {
    console.error(`[fatal] cannot read ${MEMBERS_PATH}: ${e.message}`);
    return [];
  }
}

async function readExistingFeeds() {
  try {
    const text = await readFile(OUT_PATH, 'utf-8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ブログ詳細ページから og:image を抽出して thumbnail を埋める fallback */
async function enrichThumbnailFromDetail(blog, cfg) {
  if (!blog.url) return;
  try {
    const html = await fetchHtml(blog.url, cfg.referer);
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    if (ogMatch) {
      blog.thumbnail = absoluteUrl(ogMatch[1], cfg.host);
      return;
    }
    // og:image が無ければ 本文中の最初の img を探す
    const imgMatch = html.match(/<img[^>]+(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (imgMatch) blog.thumbnail = absoluteUrl(imgMatch[1], cfg.host);
  } catch {
    /* silent */
  }
}

async function scrapeMemberFeeds(m, cfg) {
  const entry = { blog: [], schedule: [], errors: [] };

  // ブログ一覧
  try {
    const html = await fetchHtml(cfg.blogList(m.code), cfg.referer);
    entry.blog = parseBlogList(html, cfg.host);
  } catch (e) {
    entry.errors.push(`blog: ${e.message}`);
  }
  await sleep(THROTTLE_MS);

  // サムネが無いエントリは全件、詳細ページから og:image を取りに行く
  const needThumb = entry.blog.filter(b => !b.thumbnail);
  for (const b of needThumb) {
    await enrichThumbnailFromDetail(b, cfg);
    await sleep(THROTTLE_MS);
  }

  // スケジュール（複数 URL パターンを試す）
  let scheduleOK = false;
  for (const url of cfg.scheduleCandidates(m.code)) {
    try {
      const html = await fetchHtml(url, cfg.referer);
      const parsed = parseSchedule(html);
      if (parsed.length > 0) {
        entry.schedule = parsed;
        scheduleOK = true;
        break;
      }
    } catch (e) {
      // try next candidate
    }
    await sleep(THROTTLE_MS);
  }
  if (!scheduleOK && entry.schedule.length === 0) {
    entry.errors.push(`schedule: no items from any URL`);
  }

  return entry;
}

async function main() {
  const members = await readMembers();
  // 効率化: active のみ（graduated は skip）
  const targets = members.filter(m => !m.graduated && (m.group === 'nogi' || m.group === 'saku'));
  console.log(`Scraping feeds for ${targets.length} active members (of ${members.length} total)`);

  const existing = await readExistingFeeds();
  const feedsByKey = {};
  let okCount = 0, errCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    const cfg = GROUP_CONFIG[m.group];
    if (!cfg) continue;
    const key = `${m.group}:${m.code}`;
    process.stdout.write(`  [${i + 1}/${targets.length}] ${m.name || m.code} ... `);
    try {
      const entry = await scrapeMemberFeeds(m, cfg);
      feedsByKey[key] = entry;
      if (entry.errors.length > 0) {
        console.log(`partial (${entry.blog.length}B / ${entry.schedule.length}S; err: ${entry.errors.join('; ')})`);
      } else {
        console.log(`${entry.blog.length}B / ${entry.schedule.length}S`);
      }
      okCount++;
    } catch (e) {
      console.log(`FAIL ${e.message}`);
      errCount++;
    }
    await sleep(THROTTLE_MS);
  }

  // 取れなかったメンバーは既存値をキープ
  if (existing && existing.feeds) {
    for (const [k, v] of Object.entries(existing.feeds)) {
      if (!feedsByKey[k]) feedsByKey[k] = v;
    }
  }

  const out = {
    version: '1',
    updatedAt: new Date().toISOString(),
    feeds: feedsByKey,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ wrote ${Object.keys(feedsByKey).length} member feeds to ${OUT_PATH}`);
  console.log(`  (success: ${okCount}, fail: ${errCount})`);
}

main().catch(e => {
  console.error('UNCAUGHT:', e);
  process.exit(1);
});
