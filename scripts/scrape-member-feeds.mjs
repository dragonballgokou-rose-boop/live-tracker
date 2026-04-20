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
    schedule: code => `https://www.nogizaka46.com/s/n46/artist/SCHEDULE/${encodeURIComponent(code)}?ima=0000`,
  },
  saku: {
    host: 'https://sakurazaka46.com',
    referer: 'https://sakurazaka46.com/s/s46',
    blogList: code => `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&ct=${encodeURIComponent(code)}`,
    schedule: code => `https://sakurazaka46.com/s/s46/artist/SCHEDULE/${encodeURIComponent(code)}?ima=0000`,
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
 * MEMBER'S SCHEDULE HTML から 直近スケジュールを抽出する。
 * 構造例:
 *   <div class="sc--day">
 *     <p class="sc--day__d">02</p>
 *     <p class="sc--day__w">Thu</p>
 *   </div>
 *   <ul class="sc--lists">
 *     <li class="sc--list">
 *       <p class="sc--list__cate">ラジオ</p>
 *       <p class="sc--list__ttl">TOKYO FM「SCHOOL OF LOCK!...」</p>
 *     </li>
 *   </ul>
 *
 * 「直近スケジュール」のみ（過去は除く）。年月は URL パラメータ `yy=YYYY&mm=MM`
 * でページに反映されるが、デフォルトで現在月が返ると想定する。
 */
function parseSchedule(html) {
  const results = [];
  // <li class="sc--list"> ...  </li> の塊を拾う
  const liRe = /<li[^>]+class=["'][^"']*sc--list[^"']*["'][^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const inner = m[1];
    const cate = cleanText(
      (inner.match(/class=["'][^"']*(?:sc--list__cate|cate)[^"']*["'][^>]*>([^<]+)</i) || [])[1] || ''
    ) || null;
    const title = cleanText(
      (inner.match(/class=["'][^"']*(?:sc--list__ttl|ttl|title)[^"']*["'][^>]*>([^<]+)</i) || [])[1] || ''
    );
    if (!title) continue;
    // liRe で見つけた範囲の直前までさかのぼって "sc--day" ブロックを探す
    const beforeIdx = m.index;
    const head = html.slice(Math.max(0, beforeIdx - 800), beforeIdx);
    const dayMatch = head.match(/class=["'][^"']*sc--day__d[^"']*["'][^>]*>\s*(\d{1,2})\s*</);
    const day = dayMatch ? dayMatch[1] : null;

    results.push({
      cate,
      title,
      dayOfMonth: day ? Number(day) : null,
    });
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

async function scrapeMemberFeeds(m, cfg) {
  const entry = { blog: [], schedule: [], errors: [] };

  // ブログ
  try {
    const html = await fetchHtml(cfg.blogList(m.code), cfg.referer);
    entry.blog = parseBlogList(html, cfg.host);
  } catch (e) {
    entry.errors.push(`blog: ${e.message}`);
  }
  await sleep(THROTTLE_MS);

  // スケジュール
  try {
    const html = await fetchHtml(cfg.schedule(m.code), cfg.referer);
    entry.schedule = parseSchedule(html);
  } catch (e) {
    entry.errors.push(`schedule: ${e.message}`);
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
