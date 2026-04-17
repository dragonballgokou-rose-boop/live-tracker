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

const SOURCES = [
  {
    artist: '乃木坂46',
    idPrefix: 'nogi',
    url: 'https://www.nogizaka46.com/s/n46/media/list/schedule',
  },
  {
    artist: '櫻坂46',
    idPrefix: 'saku',
    url: 'https://sakurazaka46.com/s/s46/media/list/schedule',
  },
];

// ---------- 汎用 fetch ----------

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return await res.text();
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

  // JSON-LD が埋め込まれていれば優先する
  const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const node of arr) {
        if (!node) continue;
        const type = node['@type'];
        if (type === 'Event' || type === 'MusicEvent' || type === 'ConcertEvent') {
          const live = fromJsonLdEvent(node, { artist, idPrefix, url });
          if (live) results.push(live);
        }
      }
    } catch { /* ignore */ }
  }

  if (results.length > 0) return results;

  // JSON-LD がない場合: HTML リスト要素から抽出（欅坂46系テンプレート）
  // 例:
  //   <li class="b-media-list__item"><a href="...">
  //     <div class="b-media-list__date">2026.02.20</div>
  //     <div class="b-media-list__ttl">XX LIVE</div>
  //     <div class="b-media-list__place">東京ドーム</div>
  //     <div class="b-media-list__cate">ライブ</div>
  //   </a></li>
  const itemRe = /<li[^>]*class=["'][^"']*b-media-list__item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = itemRe.exec(html)) !== null) {
    const inner = m[1];
    const dateRaw = pick(inner, /b-media-list__date[^>]*>([\s\S]*?)</i);
    const title   = pick(inner, /b-media-list__ttl[^>]*>([\s\S]*?)</i);
    const place   = pick(inner, /b-media-list__place[^>]*>([\s\S]*?)</i);
    const cate    = pick(inner, /b-media-list__cate[^>]*>([\s\S]*?)</i);
    if (!dateRaw || !title) continue;
    const dateStart = normalizeDate(dateRaw);
    if (!dateStart) continue;
    results.push({
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
    try {
      const html = await fetchHtml(src.url);
      const lives = parseScheduleHtml(html, src);
      console.log(`[${src.artist}] parsed ${lives.length} entries`);
      allLives.push(...lives);
    } catch (e) {
      console.error(`[${src.artist}] failed:`, e.message);
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
      s.url,
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
