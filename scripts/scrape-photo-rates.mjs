#!/usr/bin/env node
// ============================================
// Photo Rate scraper
// ============================================
// 乃木坂46 生写真のレート集計ページ（nogizakaworld.com / nogizakarate.com 等）
// を取得し、public/photo-rates.json の rates 配列を更新する。
//
// 公式サイトと違い、レート集計サイトの HTML 構造は記事ごとに揺れがあるので、
// 「テーブル or 順位付きリストから rank ラベル + メンバー名を拾う」緩いパーサに
// 留め、失敗時は既存 JSON を保持するガードを入れる（破壊的上書きを防ぐ）。
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

// ---------- 追跡対象シリーズ ----------
// id は public/photo-rates.json 内の series.id と揃える。
// 一つのシリーズにつき複数 URL 候補を指定し、最初に 200 を返したものを使う。
const TARGETS = [
  {
    id: '13th-birthday-anniv',
    label: '13周年記念',
    candidates: [
      'https://nogizakaworld.com/rate-13thbd-anniv/',
      'https://nogizakarate.com/phototype-13thbd-anniv/',
    ],
  },
  {
    id: '13th-birthday-tshirt',
    label: '13th BDライブTシャツ',
    candidates: [
      'https://nogizakaworld.com/rate-13thbd-tshirt/',
      'https://nogizakarate.com/phototype-13thbd-tshirt/',
    ],
  },
  {
    id: '12th-birthday-anniv',
    label: '12周年記念',
    candidates: [
      'https://nogizakaworld.com/rate-12thbd-anniv/',
      'https://nogizakarate.com/phototype-12thbd-anniv/',
    ],
  },
  {
    id: '12th-birthday-animal',
    label: 'アニマルルームウェア',
    candidates: [
      'https://nogizakaworld.com/rate-12thbd-animal/',
      'https://nogizakarate.com/phototype-12thbd-animal/',
    ],
  },
  {
    id: '11th-birthday-varsity',
    label: 'スタジャン',
    candidates: [
      'https://nogizakaworld.com/rate-11thbd-varsity/',
      'https://nogizakarate.com/phototype-11thbd-varsity/',
    ],
  },
  {
    id: '11th-birthday-anniv',
    label: '11周年記念',
    candidates: [
      'https://nogizakaworld.com/rate-11thbd-anniv/',
      'https://nogizakarate.com/phototype-11thbd-anniv/',
    ],
  },
  {
    id: '10th-birthday-anniv',
    label: '10周年記念（ソロカット）',
    candidates: [
      'https://nogizakaworld.com/rate-10thbd-anniv/',
      'https://nogizakarate.com/phototype-10thbd-anniv/',
    ],
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

async function fetchFirst(candidates) {
  const errors = [];
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      console.log(`  ↳ fetched ${url} (${html.length} bytes)`);
      return { html, url };
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  throw new Error(`all candidates failed:\n     ${errors.join('\n     ')}`);
}

// ---------- 解析 ----------

/**
 * HTML から「rank ラベル + メンバー名」を拾う緩いパーサ。
 * テーブルの <td> / <th> / <tr> を走査し、行ごとに「先頭セルが rank、残りがメンバー名列挙」
 * というレート集計サイトの典型パターンを狙う。
 * 構造が違っても壊れないように、見つからなければ空配列を返す。
 */
function parseRates(html) {
  const results = [];

  // すべての <tr>...</tr> を抽出
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  if (rows.length === 0) return results;

  for (const row of rows) {
    // セルを剥がす
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m =>
      stripTags(m[1]).trim()
    );
    if (cells.length < 2) continue;

    // 先頭セルに rank ラベルがある？
    const rankRaw = cells[0].replace(/\s+/g, '').toUpperCase();
    const rank = normalizeRank(rankRaw);
    if (!rank) continue;

    // 残りセルをメンバー名として抽出
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
  // "S+" "S" "S-" "A+" "A" "A-" ... を受ける
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
    // ノイズ除外: "ライブ" "センター" 等はメンバー名とみなさない
    if (/ライブ|センター|ランダム|シリーズ|衣装|生写真|サイン|メンバー|全[員カット種類]/.test(full)) continue;
    seen.add(full);
    names.push(full);
  }
  return names;
}

// ---------- main ----------

async function main() {
  // 既存 JSON を読み込み（破壊的更新を避けるため必ず最初に読む）
  let existing;
  try {
    existing = JSON.parse(await readFile(OUT_PATH, 'utf8'));
  } catch (e) {
    console.error(`failed to read existing ${OUT_PATH}: ${e.message}`);
    process.exit(1);
  }

  const bySeriesId = new Map(existing.series.map(s => [s.id, s]));
  let updated = 0;
  let skipped = 0;

  for (const target of TARGETS) {
    console.log(`\n[${target.id}] ${target.label}`);
    const existingSeries = bySeriesId.get(target.id);
    if (!existingSeries) {
      console.warn(`  ↳ series ${target.id} not declared in photo-rates.json; skipping`);
      skipped++;
      continue;
    }

    try {
      const { html, url } = await fetchFirst(target.candidates);
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
