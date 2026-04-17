#!/usr/bin/env node
// ============================================
// Official schedule scraper
// ============================================
// 乃木坂46 / 櫻坂46 の公式スケジュールを取得し
// public/official-lives.json を更新します。
//
// 公式サイトの HTML 構造は予告なく変わるので、パースが失敗した場合は
// 既存の JSON を保持（空データで上書きしない）するガードを入れています。
//
// 使い方:
//   node scripts/scrape-official.mjs
//
// GitHub Actions から毎日実行 → 変化があればコミット。

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = resolve(__dirname, '..', 'public', 'official-lives.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// 各サイトで試す URL 候補。最初に 200 を返したものを採用する。
// CMS の URL 構造は予告なく変わるので、よくあるパターンを並べて耐性を上げる。
const SOURCES = [
  {
    artist: '乃木坂46',
    idPrefix: 'nogi',
    candidates: [
      'https://www.nogizaka46.com/s/n46/media/list/schedule',
      'https://www.nogizaka46.com/s/n46/calendar',
      'https://www.nogizaka46.com/s/n46/schedule',
      'https://www.nogizaka46.com/s/n46/news/list/schedule',
      'https://www.nogizaka46.com/s/n46/news/calendar',
      'https://www.nogizaka46.com/s/n46/diary/schedule',
      'https://www.nogizaka46.com/calendar',
      'https://www.nogizaka46.com/schedule',
    ],
  },
  {
    artist: '櫻坂46',
    idPrefix: 'saku',
    candidates: [
      'https://sakurazaka46.com/s/s46/media/list/schedule',
      'https://sakurazaka46.com/s/s46/calendar',
      'https://sakurazaka46.com/s/s46/schedule',
      'https://sakurazaka46.com/s/s46/news/list/schedule',
      'https://sakurazaka46.com/s/s46/news/calendar',
      'https://sakurazaka46.com/s/s46/diary/schedule',
      'https://sakurazaka46.com/calendar',
      'https://sakurazaka46.com/schedule',
    ],
  },
];

// ---------- 汎用 fetch ----------

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return { html: await res.text(), finalUrl: res.url };
}

/**
 * 候補URLを順番に試して、最初に 200 を返したものを使う。
 * 失敗したURLは理由とともにログに残す。
 */
async function fetchAnyCandidate(candidates) {
  const errors = [];
  for (const url of candidates) {
    try {
      const { html, finalUrl } = await fetchHtml(url);
      console.log(`  ↳ fetched ${url} → ${finalUrl} (${html.length} bytes)`);
      return { html, finalUrl, url };
    } catch (e) {
      console.warn(`  ↳ tried ${url} → ${e.message}`);
      errors.push({ url, error: e.message });
    }
  }
  const err = new Error(`all ${candidates.length} candidates failed`);
  err.details = errors;
  throw err;
}

// ---------- パース ----------

/**
 * 公式スケジュールページの HTML から JSON-LD / data-date 属性 /
 * リスト要素の組合せを探して lives 配列に変換する。
 *
 * 両サイトは「欅坂46系」テンプレートを共有しているので、
 * .b-media-list__body に日付+タイトル+カテゴリが並ぶ。
 * 構造が一致しない場合は空配列を返す（＝壊れた scrape は無視）。
 */
function parseScheduleHtml(html, { artist, idPrefix, url }) {
  const results = [];
  const debug = { jsonLdEvents: 0, htmlPatterns: {} };

  // 1) JSON-LD が埋め込まれていれば優先する
  const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const node of arr) {
        if (!node) continue;
        // @graph の場合
        const items = node['@graph'] || [node];
        for (const item of items) {
          const type = item['@type'];
          if (type === 'Event' || type === 'MusicEvent' || type === 'ConcertEvent'
              || (Array.isArray(type) && type.some(t => /Event/i.test(t)))) {
            const live = fromJsonLdEvent(item, { artist, idPrefix, url });
            if (live) {
              results.push(live);
              debug.jsonLdEvents++;
            }
          }
        }
      }
    } catch { /* ignore JSON parse errors */ }
  }

  if (results.length > 0) {
    console.log(`  ↳ JSON-LD events: ${debug.jsonLdEvents}`);
    return results;
  }

  // 2) HTML パターン群を順に試す
  const patterns = [
    {
      name: 'b-media-list',
      itemRe: /<li[^>]*class=["'][^"']*b-media-list__item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
      fields: {
        date:  /b-media-list__date[^>]*>([\s\S]*?)</i,
        title: /b-media-list__ttl[^>]*>([\s\S]*?)</i,
        place: /b-media-list__place[^>]*>([\s\S]*?)</i,
        cate:  /b-media-list__cate[^>]*>([\s\S]*?)</i,
      },
    },
    {
      name: 'sc-list (sakura)',
      itemRe: /<li[^>]*class=["'][^"']*(?:sc-list__item|p-schedule__item|js-schedule-item)[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
      fields: {
        date:  /(?:sc|p-schedule)__(?:date|day)[^>]*>([\s\S]*?)</i,
        title: /(?:sc|p-schedule)__(?:ttl|title)[^>]*>([\s\S]*?)</i,
        place: /(?:sc|p-schedule)__(?:place|venue)[^>]*>([\s\S]*?)</i,
        cate:  /(?:sc|p-schedule)__(?:cate|category)[^>]*>([\s\S]*?)</i,
      },
    },
    {
      name: 'time-element',
      itemRe: /<(?:li|article|div)[^>]*>([\s\S]*?<time[^>]*datetime=[\s\S]*?<\/(?:li|article|div)>)/gi,
      fields: {
        date:  /<time[^>]*datetime=["']([^"']+)["']/i,
        title: /<(?:h[1-6]|p|span)[^>]*>([\s\S]*?)<\/(?:h[1-6]|p|span)>/i,
        place: /(?:venue|place|会場)[^>]*>([\s\S]*?)</i,
        cate:  /(?:cate|type|種別)[^>]*>([\s\S]*?)</i,
      },
    },
  ];

  for (const pat of patterns) {
    const matched = [];
    let mm;
    pat.itemRe.lastIndex = 0;
    while ((mm = pat.itemRe.exec(html)) !== null) {
      const inner = mm[1];
      const dateRaw = pick(inner, pat.fields.date);
      const title   = pick(inner, pat.fields.title);
      const place   = pick(inner, pat.fields.place);
      const cate    = pick(inner, pat.fields.cate);
      if (!dateRaw || !title) continue;
      const dateStart = normalizeDate(dateRaw);
      if (!dateStart) continue;
      matched.push({
        officialId: `${idPrefix}-${dateStart}-${slugify(title)}`,
        artist,
        name: cleanText(title),
        venue: cleanText(place) || null,
        prefecture: null,
        dateStart,
        dateEnd: dateStart,
        eventType: mapCategory(cate),
        sourceUrl: url,
        scrapedAt: new Date().toISOString(),
      });
    }
    debug.htmlPatterns[pat.name] = matched.length;
    if (matched.length > 0) {
      console.log(`  ↳ HTML pattern matched: ${pat.name} (${matched.length})`);
      results.push(...matched);
      break;
    }
  }

  // 3) 失敗時は HTML の構造ヒントを出して終了
  if (results.length === 0) {
    console.warn(`  ↳ Failed to parse. JSON-LD events=0, HTML patterns: ${JSON.stringify(debug.htmlPatterns)}`);
    // 主要クラス名のヒントを表示（次の調整に役立てる）
    const classes = [...new Set(
      [...html.matchAll(/class=["']([^"']{1,80})["']/g)]
        .map(x => x[1].split(/\s+/))
        .flat()
        .filter(c => /(list|item|schedule|date|venue|event|live)/i.test(c))
    )].slice(0, 25);
    console.warn(`  ↳ Classes containing list/item/schedule/date/venue/event/live (top 25):`);
    console.warn(`     ${classes.join(', ')}`);
  }

  return results;
}

function fromJsonLdEvent(node, { artist, idPrefix, url }) {
  const name = node.name;
  const start = node.startDate;
  if (!name || !start) return null;
  const dateStart = String(start).slice(0, 10);
  const dateEnd = node.endDate ? String(node.endDate).slice(0, 10) : dateStart;
  const venue = node.location?.name || node.location?.address?.name || null;
  const prefecture = node.location?.address?.addressRegion || null;
  return {
    officialId: `${idPrefix}-${dateStart}-${slugify(name)}`,
    artist,
    name: cleanText(name),
    venue: cleanText(venue),
    prefecture: cleanText(prefecture),
    dateStart,
    dateEnd,
    eventType: mapCategory(node.eventType || ''),
    sourceUrl: url,
    scrapedAt: new Date().toISOString(),
  };
}

function pick(s, re) {
  const m = re.exec(s);
  return m ? m[1] : '';
}

function cleanText(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(s) {
  return cleanText(s)
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .slice(0, 40) || 'x';
}

function normalizeDate(raw) {
  if (!raw) return null;
  const s = cleanText(raw);
  // "2026.02.20" / "2026/02/20" / "2026-02-20" / "2026年2月20日"
  const m = s.match(/(\d{4})[.\/\-年](\d{1,2})[.\/\-月](\d{1,2})/);
  if (!m) return null;
  const y = m[1];
  const mm = String(m[2]).padStart(2, '0');
  const dd = String(m[3]).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function mapCategory(raw) {
  const s = cleanText(raw).toLowerCase();
  if (!s) return 'ライブ';
  if (s.includes('live') || s.includes('ライブ') || s.includes('コンサート')) return 'ライブ';
  if (s.includes('ミーグリ') || s.includes('握手') || s.includes('ファン')) return 'イベント';
  if (s.includes('event') || s.includes('イベント')) return 'イベント';
  return 'ライブ';
}

// ---------- main ----------

async function main() {
  const allLives = [];
  const errors = [];

  for (const src of SOURCES) {
    console.log(`[${src.artist}] trying ${src.candidates.length} URL candidates...`);
    try {
      const { html, url: workingUrl } = await fetchAnyCandidate(src.candidates);
      const lives = parseScheduleHtml(html, { ...src, url: workingUrl });
      console.log(`[${src.artist}] parsed ${lives.length} entries (from ${workingUrl})`);
      allLives.push(...lives);
    } catch (e) {
      console.error(`[${src.artist}] all candidates failed`);
      if (e.details) e.details.forEach(d => console.error(`  - ${d.url} → ${d.error}`));
      errors.push({ artist: src.artist, error: e.message });
    }
  }

  // パースが完全失敗した場合は既存の JSON を維持（空配列で上書きしない）
  if (allLives.length === 0) {
    console.warn('No lives parsed from any source. Keeping existing JSON.');
    return;
  }

  // 同じ officialId の重複を除去
  const byId = new Map();
  for (const l of allLives) byId.set(l.officialId, l);
  const deduped = [...byId.values()]
    .sort((a, b) => (a.dateStart || '').localeCompare(b.dateStart || ''));

  // 既存ファイル読み込み
  let existing = null;
  try {
    existing = JSON.parse(await readFile(OUT_PATH, 'utf-8'));
  } catch { /* new file */ }

  const out = {
    version: '1',
    updatedAt: new Date().toISOString(),
    sources: Object.fromEntries(SOURCES.map(s => [
      s.artist === '乃木坂46' ? 'nogizaka46' : 'sakurazaka46',
      s.candidates[0],
    ])),
    errors: errors.length ? errors : undefined,
    lives: deduped,
  };

  // 中身が変わってなければ updatedAt だけ更新しない（不要コミット回避）
  const existingBody = existing && JSON.stringify({ ...existing, updatedAt: null, errors: null });
  const newBody      = JSON.stringify({ ...out, updatedAt: null, errors: null });
  if (existingBody === newBody) {
    console.log('No changes — skipping write.');
    return;
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${deduped.length} lives to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
