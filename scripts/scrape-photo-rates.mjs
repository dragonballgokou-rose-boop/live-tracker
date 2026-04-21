#!/usr/bin/env node
// ============================================
// Photo Rate scraper
// ============================================
// 乃木坂46 生写真のレート集計ページ（nogizakaworld.com）を取得し、
// public/photo-rates.json の rates 配列を更新する。
//
// 構造上の前提:
//   - nogizakaworld.com/rate/ に全シリーズのインデックス (Birthday Live セクションあり)
//   - 各シリーズは /rate-{slug}/ の個別ページに飛ぶ（slug は BD ごとに異なるため、
//     ここでは「キーワード」で引き当てる — 記念/アニバ/Tシャツ/スタジャン/アニマル 等）
//
// 失敗時は既存 JSON を保持するガードを入れて破壊的上書きを防ぐ。
//
// 使い方:
//   node scripts/scrape-photo-rates.mjs
//
// GitHub Actions (update-photo-rates.yml) から毎日実行される想定。

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH         = resolve(__dirname, '..', 'public', 'photo-rates.json');
const MOBILE_COPY_PATH = resolve(__dirname, '..', 'mobile', 'src', 'data', 'photo-rates.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const INDEX_URL = 'https://nogizakaworld.com/rate/';

// ---------- 追跡対象シリーズ ----------
// id は public/photo-rates.json 内の series.id と揃える。
// keywords: インデックスページのリンクテキストから該当ページを引き当てるためのキーワード。
//   すべて含む or いずれか含む のどちらでも動くよう allOf / anyOf を使う。
const TARGETS = [
  {
    id: '13th-birthday-anniv',
    allOf: ['13'],
    anyOf: ['記念', 'アニバ', 'anniv', 'Anniversary'],
  },
  {
    id: '13th-birthday-tshirt',
    allOf: ['13'],
    anyOf: ['Tシャツ', 'ＴシャツライブT', 'ライブT'],
  },
  {
    id: '12th-birthday-anniv',
    allOf: ['12'],
    anyOf: ['記念', 'アニバ', 'anniv', 'Anniversary'],
  },
  {
    id: '12th-birthday-animal',
    allOf: ['12'],
    anyOf: ['アニマル', 'ルームウェア'],
  },
  {
    id: '11th-birthday-varsity',
    allOf: ['11'],
    anyOf: ['スタジャン', 'スタジアム', 'Varsity'],
  },
  {
    id: '11th-birthday-anniv',
    allOf: ['11'],
    anyOf: ['記念', 'アニバ', 'anniv', 'Anniversary'],
  },
  {
    id: '10th-birthday-anniv',
    allOf: ['10'],
    anyOf: ['記念', 'アニバ', 'anniv', 'ソロ'],
  },
];

const VALID_RANKS = new Set(['S+', 'S', 'S-', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C']);

// 日本人名っぽい 2〜4 文字＋スペース＋2〜4 文字 のゆるいフィルタ
const NAME_RE = /([一-龥々ぁ-んァ-ヶー]{1,5})\s*[・\s]?\s*([一-龥々ぁ-んァ-ヶー]{1,6})/g;

// ---------- fetch ----------

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ---------- インデックス解析 ----------

/**
 * nogizakaworld.com/rate/ から <a href> のリストを抽出する。
 * Birthday Live セクションに限定したいところだが、DOM 構造に依存しない方が壊れにくいため、
 * ページ内のすべてのリンクをテキスト + href のペアで返し、マッチングで絞り込む。
 */
function extractLinks(html) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripTags(m[2]).trim();
    if (!text) continue;
    links.push({ href, text });
  }
  return links;
}

function matchTarget(links, target) {
  // Birthday Live 系のページに限定: href が /rate-/ 系 + テキストに BD 匂い
  const candidates = links.filter(l => {
    const h = l.href;
    if (!/\/rate-|\/hinatarate-|\/sakurate-/i.test(h)) return false;
    const combined = l.text;
    // 「周年」 or 「BD」 or 「Birthday」 を含まないと BD ライブではない
    if (!/周年|バースデー|Birthday|BD|バースデイ/i.test(combined)) return false;
    return true;
  });

  const hit = candidates.find(l => {
    const combined = `${l.text} ${l.href}`;
    if (target.allOf && !target.allOf.every(kw => combined.includes(kw))) return false;
    if (target.anyOf && !target.anyOf.some(kw => combined.toLowerCase().includes(kw.toLowerCase()))) return false;
    return true;
  });

  return hit ? new URL(hit.href, INDEX_URL).toString() : null;
}

// ---------- 個別ページ解析 ----------

/**
 * HTML から「rank ラベル + メンバー名」を拾う緩いパーサ。
 * テーブルの <td> / <th> / <tr> を走査し、行ごとに「先頭セルが rank、残りがメンバー名列挙」
 * というレート集計サイトの典型パターンを狙う。
 * 構造が違っても壊れないように、見つからなければ空配列を返す。
 */
function parseRates(html) {
  const results = [];

  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  if (rows.length === 0) return results;

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m =>
      stripTags(m[1]).trim()
    );
    if (cells.length < 2) continue;

    const rankRaw = cells[0].replace(/\s+/g, '').toUpperCase();
    const rank = normalizeRank(rankRaw);
    if (!rank) continue;

    const rest = cells.slice(1).join(' ');
    const names = extractNames(rest);
    for (const memberName of names) {
      results.push({ memberName, rank });
    }
  }

  return results;
}

function stripTags(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeRank(raw) {
  const m = /^([SABC])([+\-])?$/.exec(raw);
  if (!m) return null;
  const r = m[1] + (m[2] || '');
  return VALID_RANKS.has(r) ? r : null;
}

function extractNames(text) {
  const names = [];
  const seen = new Set();
  NAME_RE.lastIndex = 0;
  let m;
  while ((m = NAME_RE.exec(text)) !== null) {
    const full = `${m[1]} ${m[2]}`;
    if (seen.has(full)) continue;
    if (/ライブ|センター|ランダム|シリーズ|衣装|生写真|サイン|メンバー|全[員カット種類]/.test(full)) continue;
    seen.add(full);
    names.push(full);
  }
  return names;
}

// ---------- main ----------

async function main() {
  let existing;
  try {
    existing = JSON.parse(await readFile(OUT_PATH, 'utf8'));
  } catch (e) {
    console.error(`failed to read existing ${OUT_PATH}: ${e.message}`);
    process.exit(1);
  }

  // 1. インデックスを取得してリンクを抽出
  let links = [];
  try {
    const indexHtml = await fetchText(INDEX_URL);
    console.log(`fetched index ${INDEX_URL} (${indexHtml.length} bytes)`);
    links = extractLinks(indexHtml);
    console.log(`extracted ${links.length} links`);
  } catch (e) {
    console.warn(`failed to fetch index: ${e.message}`);
    console.warn('keeping existing JSON as-is (no updates)');
    return;
  }

  const bySeriesId = new Map(existing.series.map(s => [s.id, s]));
  let updated = 0;
  let skipped = 0;

  for (const target of TARGETS) {
    console.log(`\n[${target.id}]`);
    const existingSeries = bySeriesId.get(target.id);
    if (!existingSeries) {
      console.warn(`  ↳ series ${target.id} not declared in photo-rates.json; skipping`);
      skipped++;
      continue;
    }

    const url = matchTarget(links, target);
    if (!url) {
      console.warn(`  ↳ no index link matched — keeping existing ${existingSeries.rates.length} rates`);
      skipped++;
      continue;
    }

    try {
      const html = await fetchText(url);
      console.log(`  ↳ fetched ${url} (${html.length} bytes)`);
      const rates = parseRates(html);
      if (rates.length < 5) {
        console.warn(`  ↳ only ${rates.length} rates parsed — keeping existing`);
        skipped++;
        continue;
      }
      existingSeries.rates = dedupe(rates);
      existingSeries.sourceUrl = url;
      console.log(`  ↳ updated: ${rates.length} rates`);
      updated++;
    } catch (e) {
      console.warn(`  ↳ fetch/parse failed: ${e.message}`);
      console.warn(`  ↳ keeping existing ${existingSeries.rates.length} rates`);
      skipped++;
    }
  }

  if (updated === 0) {
    console.log(`\nNo series updated (${skipped} skipped). Leaving file untouched.`);
    return;
  }

  existing.generatedAt = new Date().toISOString();
  const serialized = JSON.stringify(existing, null, 2) + '\n';
  await writeFile(OUT_PATH, serialized, 'utf8');
  await writeFile(MOBILE_COPY_PATH, serialized, 'utf8');
  console.log(`\n✓ wrote ${OUT_PATH} + mobile copy (${updated} updated, ${skipped} skipped)`);
}

function dedupe(rates) {
  const seen = new Set();
  const out = [];
  for (const r of rates) {
    const key = `${r.memberName}:${r.rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
