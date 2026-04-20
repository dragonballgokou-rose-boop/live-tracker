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
    // 確認済: SPA が叩いている本物の API は
    //   /api/list/schedule?list[]=<code>&dy=YYYYMM
    // （PHP 配列形式のパラメータ。ct= ではない）
    scheduleCandidates: code => {
      const ym = currentYyyymm();
      const nextYm = nextMonthYyyymm();
      return [
        `https://www.nogizaka46.com/s/n46/api/list/schedule?list[]=${encodeURIComponent(code)}&dy=${ym}`,
        `https://www.nogizaka46.com/s/n46/api/list/schedule?list[]=${encodeURIComponent(code)}&dy=${nextYm}`,
        `https://www.nogizaka46.com/s/n46/artist/${encodeURIComponent(code)}?ima=0000`,
        `https://www.nogizaka46.com/s/n46/api/list/schedule?ct=${encodeURIComponent(code)}`,
      ];
    },
  },
  saku: {
    host: 'https://sakurazaka46.com',
    referer: 'https://sakurazaka46.com/s/s46',
    blogList: code => `https://sakurazaka46.com/s/s46/diary/blog/list?ima=0000&ct=${encodeURIComponent(code)}`,
    scheduleCandidates: code => {
      const ym = currentYyyymm();
      const nextYm = nextMonthYyyymm();
      return [
        `https://sakurazaka46.com/s/s46/api/list/schedule?list[]=${encodeURIComponent(code)}&dy=${ym}`,
        `https://sakurazaka46.com/s/s46/api/list/schedule?list[]=${encodeURIComponent(code)}&dy=${nextYm}`,
        `https://sakurazaka46.com/s/s46/artist/${encodeURIComponent(code)}?ima=0000`,
        `https://sakurazaka46.com/s/s46/api/list/schedule?ct=${encodeURIComponent(code)}`,
      ];
    },
  },
};

function currentYyyymm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextMonthYyyymm() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- fetch ----------

async function fetchHtml(url, referer) {
  // Sony Music CMS の /api/ 系は XHR として振る舞う必要がある（scrape-official.mjs と同じ戦略）
  const isApi = /\/api\//.test(url);
  const headers = {
    'User-Agent': UA,
    'Accept': isApi
      ? 'application/json, text/plain, */*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9',
    'Referer': referer,
  };
  if (isApi) headers['X-Requested-With'] = 'XMLHttpRequest';
  const res = await fetch(url, { redirect: 'follow', headers });
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

const CAT_KEYWORDS = 'ラジオ|テレビ|ＴＶ|TV|ライブ|イベント|雑誌|ネット|MC|ファンミ|舞台|配信|CM|写真集|書籍|リリース|コンサート|WEB|ウェブ|新聞|映画';
const CAT_ONLY_RE = new RegExp(`^(?:${CAT_KEYWORDS}|SCHEDULE|MEMBER)$`, 'i');

/**
 * スケジュールページかどうかを判定する。
 * MEMBER'S SCHEDULE ヘッダや schedule 専用のマーカーが見えなければ false。
 */
function looksLikeSchedulePage(html) {
  if (!html) return false;
  if (/MEMBER.{0,5}SCHEDULE/i.test(html)) return true;
  if (/class=["'][^"']*(?:sc--|schedule|sched-day|sc-day|sc__)[^"']*["']/i.test(html)) return true;
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(html)
      && new RegExp(`(${CAT_KEYWORDS})`).test(html)) {
    return true;
  }
  return false;
}

/** JSON API レスポンス（Sony Music CMS 互換の JSONP/JSON）を items 配列へ正規化 */
function parseScheduleJson(body) {
  let text = String(body || '').trim();
  if (!text) return [];
  const jsonp = text.match(/^[a-zA-Z_][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (jsonp) text = jsonp[1];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(data) ? data
    : (data.list || data.data || data.items || data.result || data.results || []);
  if (!Array.isArray(list) || list.length === 0) return [];

  const results = [];
  const seen = new Set();
  for (const item of list) {
    const cate = cleanText(item.cate || item.category || item.type || '') || '';
    const title = cleanText(item.title || item.name || item.subject || '');
    if (!title || CAT_ONLY_RE.test(title)) continue;
    // 日付は "YYYY.MM.DD" / "YYYY-MM-DD" / item.day
    const dateRaw = item.date || item.day || item.startDate || item.start_date || '';
    const dm = String(dateRaw).match(/(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    const day = dm ? Number(dm[3]) : (Number(item.day) || null);
    if (!day || day < 1 || day > 31) continue;
    const key = `${day}|${cate}|${title.slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ cate: cate || 'その他', title, dayOfMonth: day });
    if (results.length >= MAX_ITEMS) break;
  }
  return results;
}

/**
 * HTML 内の「日付アンカー」を全て見つける。
 * 表示は以下のような DOM になりがち:
 *   <p class="sc--day"><span>02</span><span>Thu</span></p>
 *   <dt class="a-sche__dt">02 <span>Thu</span></dt>
 *   <time datetime="2026-04-02">02</time>  ← 曜日はテキストにない
 *   2026.4.2（木）  ← 日本語曜日
 * 共通するのは「日を示す 1〜2 桁」なので、以下の 3 戦略で OR マッチ:
 *   1) day + 英語3文字曜日（Mon..Sun）が 200 文字以内に近接
 *   2) day + 日本語曜日括弧（月火水木金土日）
 *   3) <time datetime="YYYY-MM-DD"> から day を直接抽出
 */
function findDayAnchors(html) {
  const anchors = [];
  const pushAnchor = (index, endIdx, day) => {
    if (!day || day < 1 || day > 31) return;
    const ctx = html.slice(Math.max(0, index - 6), index);
    if (/[.\/\-]$/.test(ctx)) return;
    anchors.push({ index, end: endIdx, day });
  };

  // 1) 数字 + 英語 or 日本語曜日 (200 文字以内に近接)
  // 日数字の前は要素の開き括弧 `>`、空白、or 先頭のみ受理（<h1> の "1" など
  // タグ名中の数字を排除）
  const weekdayRe = /(?<=>|\s|^)(\d{1,2})(?!\d)[\s\S]{0,200}?(?:\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|[（(][月火水木金土日][）)])/g;
  let m;
  while ((m = weekdayRe.exec(html)) !== null) {
    pushAnchor(m.index, weekdayRe.lastIndex, Number(m[1]));
  }

  // 2) <time datetime="YYYY-MM-DD"> が schedule セクション内にあれば day を抽出
  const timeRe = /<time[^>]+datetime=["'](\d{4})[-\/](\d{1,2})[-\/](\d{1,2})["']/gi;
  while ((m = timeRe.exec(html)) !== null) {
    pushAnchor(m.index, timeRe.lastIndex, Number(m[3]));
  }

  // index でユニーク化（複数戦略が同じ地点で当たった場合の重複を排除）
  // 近接した anchor (差 10 文字以内) も同じとみなす
  anchors.sort((a, b) => a.index - b.index);
  const deduped = [];
  for (const a of anchors) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(a.index - last.index) < 10 && last.day === a.day) continue;
    deduped.push(a);
  }
  return deduped;
}

/**
 * MEMBER'S SCHEDULE HTML から 直近スケジュールを抽出する。
 * 戦略:
 *   A) 日付アンカーを全て見つけ、隣接する 2 アンカー間のセクションに
 *      カテゴリキーワード + タイトル が含まれていれば 1 エントリとして採用。
 *      これが最も頑強で、Sony Music CMS のクラス名変更に耐える。
 *   B) アンカーが全く見つからない旧テンプレでは、カテゴリキーワード起点の
 *      旧ロジックをフォールバックで使う（厳しめの day 照合）。
 */
function parseSchedule(html) {
  if (!looksLikeSchedulePage(html)) return [];

  const results = [];
  const seen = new Set();
  const catRe = new RegExp(`(${CAT_KEYWORDS})`, 'g');
  const titleInAfter = after => {
    let tm = after.match(/class=["'][^"']*(?:ttl|title|name|subject)[^"']*["'][^>]*>([^<]{3,200})</i);
    if (!tm) tm = after.match(/<(?:p|span|h[1-6]|dd|dt|a)[^>]*>([^<]{5,200})</i);
    if (!tm) return null;
    const t = cleanText(tm[1]);
    if (!t || CAT_ONLY_RE.test(t)) return null;
    return t;
  };

  // Strategy A: 日付アンカー → 次のアンカーまでをセクションとして走査
  const anchors = findDayAnchors(html);
  if (anchors.length > 0) {
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const sectionEnd = (i + 1 < anchors.length) ? anchors[i + 1].index : Math.min(html.length, a.end + 4000);
      const section = html.slice(a.end, sectionEnd);
      let cm;
      catRe.lastIndex = 0;
      while ((cm = catRe.exec(section)) !== null) {
        const cate = cm[1];
        const after = section.slice(cm.index + cate.length, cm.index + cate.length + 1500);
        const title = titleInAfter(after);
        if (!title) continue;
        const key = `${a.day}|${cate}|${title.slice(0, 30)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ cate, title, dayOfMonth: a.day });
        if (results.length >= MAX_ITEMS) return results;
      }
    }
    if (results.length > 0) return results;
  }

  // Strategy B: カテゴリ起点フォールバック
  let m;
  catRe.lastIndex = 0;
  while ((m = catRe.exec(html)) !== null) {
    const cate = m[1];
    const before = html.slice(Math.max(0, m.index - 2000), m.index);
    // 緩めの day 照合（class 名は問わず、近接した数字+曜日 or class hint）
    const dayMatch =
      before.match(/class=["'][^"']*(?:sc|sched|day|date)[^"']*["'][^>]*>\s*(\d{1,2})\b/i)
      || before.match(/(\d{1,2})[\s\S]{0,60}\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b(?![\s\S]{0,300}<\/tr)/i);
    if (!dayMatch) continue;
    const day = Number(dayMatch[1]);
    if (!day || day < 1 || day > 31) continue;

    const after = html.slice(m.index + cate.length, m.index + cate.length + 1500);
    const title = (function() {
      let tm = after.match(/class=["'][^"']*(?:ttl|title|name|subject)[^"']*["'][^>]*>([^<]{3,200})</i);
      if (!tm) tm = after.match(/<(?:p|span|h[1-6]|dd|dt|a)[^>]*>([^<]{5,200})</i);
      if (!tm) return null;
      const t = cleanText(tm[1]);
      if (!t || CAT_ONLY_RE.test(t)) return null;
      return t;
    })();
    if (!title) continue;

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

/** parseSchedule の結果からメンバー名 / 短すぎる汎用語のタイトルを除外 */
function sanitizeScheduleItems(items, memberName) {
  const trimmedName = (memberName || '').replace(/\s+/g, '').trim();
  return items.filter(it => {
    const t = (it.title || '').replace(/\s+/g, '').trim();
    if (!t) return false;
    // タイトルがメンバー名と一致 or メンバー名のみ → 誤抽出
    if (trimmedName && t === trimmedName) return false;
    // 「2026.03.19」みたいな日付文字列が title に混入したケース
    if (/^\d{4}[.\/\-]\d{1,2}[.\/\-]\d{1,2}$/.test(t)) return false;
    return true;
  });
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
  // 最初に items が取れたものを採用。全て失敗なら最後の診断を errors に残す。
  const scheduleDiag = [];
  for (const url of cfg.scheduleCandidates(m.code)) {
    const short = url.replace(cfg.host, '').replace(/\?.*$/, '');
    try {
      const html = await fetchHtml(url, cfg.referer);
      // JSON API っぽければ JSON パースを先に試す
      const trimmed = html.trim();
      const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
        || /^[a-zA-Z_][\w$]*\s*\(/.test(trimmed);
      let parsed = [];
      if (looksJson) parsed = parseScheduleJson(html);
      if (parsed.length === 0) parsed = parseSchedule(html);
      // 誤抽出（title = メンバー名 等）をサニタイズ
      parsed = sanitizeScheduleItems(parsed, m.name);
      if (parsed.length > 0) {
        entry.schedule = parsed;
        scheduleDiag.length = 0;
        break;
      }
      const kind = looksJson ? 'json' : (looksLikeSchedulePage(html) ? 'sched-html' : 'other-html');
      // 小さい応答は内容まで見せる（空エラー JSON の正体特定用）
      let preview = '';
      if (looksJson && html.length < 200) {
        preview = ` body=${trimmed.replace(/\s+/g, ' ').slice(0, 120)}`;
      } else if (!looksJson && html.length < 400) {
        preview = ` body=${html.replace(/\s+/g, ' ').slice(0, 120)}`;
      } else if (kind === 'sched-html') {
        // SPA で schedule が後から JS で挿入されるケースでは、
        // 初期 HTML 内の API URL / 関連 script を探して診断に残す
        const hints = [];
        // MEMBER'S SCHEDULE（アポストロフィ付き）ヘッダー直後をサンプル
        const hdrIdx = html.search(/MEMBER['\u2019]S?\s*SCHEDULE/i);
        if (hdrIdx >= 0) {
          hints.push('hdr=' + html.slice(hdrIdx, hdrIdx + 400).replace(/\s+/g, ' ').slice(0, 160));
        }
        // /api/ URL 参照（SPA がフェッチしている可能性）
        const apiUrls = [...new Set(
          [...html.matchAll(/["'](\/s\/n46\/api\/[^"']{0,80})["']/gi)].map(x => x[1])
        )].slice(0, 4);
        if (apiUrls.length) hints.push('api=' + apiUrls.join(','));
        // data-* 属性に埋め込まれた URL / endpoint
        const dataAttrs = [...new Set(
          [...html.matchAll(/data-(?:url|endpoint|src|ajax)=["']([^"']{1,100})["']/gi)].map(x => x[1])
        )].slice(0, 3);
        if (dataAttrs.length) hints.push('data=' + dataAttrs.join(','));
        if (hints.length) preview = ' ' + hints.join(' | ');
      }
      scheduleDiag.push(`${short}: 0 items (${kind}, ${html.length}b)${preview}`);
    } catch (e) {
      scheduleDiag.push(`${short}: ${e.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  if (entry.schedule.length === 0 && scheduleDiag.length > 0) {
    entry.errors.push(`schedule: ${scheduleDiag.join(' | ')}`);
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
