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
const MEMBERS_PATH     = resolve(__dirname, '..', 'public', 'official-members.json');
const DIAG_PATH        = resolve(__dirname, '..', 'public', 'photo-rates-diag.json');

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

// 直近 N ヶ月のみ JSON に残す（それ以前のシリーズは自動 discovery の対象外）
const RECENT_MONTHS = 24;

// 1 回の実行で新規追加するシリーズの上限（暴走防止）
const MAX_NEW_SERIES = 30;

// 日本人名っぽい 2〜4 文字＋スペース＋2〜4 文字 のゆるいフィルタ
const NAME_RE = /([一-龥々ぁ-んァ-ヶー]{1,5})\s*[・\s]?\s*([一-龥々ぁ-んァ-ヶー]{1,6})/g;

// ---------- fetch ----------

// 複数の UA を試す（Bot UA を弾かれた場合のため）
const UA_VARIANTS = [
  UA,
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

async function fetchText(url) {
  let lastErr = null;
  for (const ua of UA_VARIANTS) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja-JP,ja;q=0.9',
        },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('fetch failed');
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
  // href が /rate-/ 系のページ（乃木坂・日向・櫻）からキーワードで絞る
  const candidates = links.filter(l => /\/rate-|\/hinatarate-|\/sakurate-/i.test(l.href));
  const hit = candidates.find(l => {
    const combined = `${l.text} ${l.href}`;
    if (target.allOf && !target.allOf.every(kw => combined.includes(kw))) return false;
    if (target.anyOf && !target.anyOf.some(kw => combined.toLowerCase().includes(kw.toLowerCase()))) return false;
    return true;
  });
  return hit ? new URL(hit.href, INDEX_URL).toString() : null;
}

/**
 * インデックスから rate-... 系の全リンクを取って、{url, label, slug} として返す。
 * 自動 discovery 用。既存 TARGETS にヒットしたものは別扱いで除外する前提。
 */
function allRateLinks(links) {
  const out = [];
  const seen = new Set();
  for (const l of links) {
    if (!/\/rate-|\/hinatarate-|\/sakurate-/i.test(l.href)) continue;
    const url = new URL(l.href, INDEX_URL).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const slugMatch = /\/(rate-[^/?#]+|hinatarate-[^/?#]+|sakurate-[^/?#]+)/i.exec(url);
    if (!slugMatch) continue;
    out.push({ url, label: l.text, slug: slugMatch[1] });
  }
  return out;
}

/** ページ HTML から発売月 (YYYY-MM) を推定する。見つからなければ null。 */
function extractSaleDate(html) {
  // 「発売」「リリース」「販売」等の語彙の近くの日付を優先。見つからなければ文書全体から最初の日付。
  const patterns = [
    /(?:発売|リリース|販売|登場)[^<\n]{0,30}?(\d{4})[年\-./](\d{1,2})[月\-./]/,
    /(\d{4})年\s*(\d{1,2})月/,
    /(\d{4})-(\d{1,2})-\d{1,2}/,  // ISO 風
    /(\d{4})\.(\d{1,2})\./,        // YYYY.MM.
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (!m) continue;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    if (!y || !mo || mo < 1 || mo > 12) continue;
    if (y < 2000 || y > 2100) continue;
    return `${y}-${String(mo).padStart(2, '0')}`;
  }
  return null;
}

function cutoffKeyNow() {
  // 「直近2年」= 今年・去年・一昨年の 1 月 1 日。月粒度の比較なので YYYY-01 を cutoff とする
  const now = new Date();
  return `${now.getFullYear() - 2}-01`;
}

/**
 * slug から group を推定する。
 *   rate-xxx        → nogi
 *   hinatarate-xxx  → hina
 *   sakurate-xxx    → saku
 */
function groupFromSlug(slug) {
  if (slug.startsWith('hinatarate-')) return 'hina';
  if (slug.startsWith('sakurate-'))   return 'saku';
  return 'nogi';
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

async function loadGraduatedNames() {
  // 卒業済みメンバー名の集合（normalize 済み）を返す。読めなければ空集合。
  try {
    const data = JSON.parse(await readFile(MEMBERS_PATH, 'utf8'));
    const set = new Set();
    for (const m of data.members || []) {
      if (m.graduated && m.name) set.add(normalizeMemberName(m.name));
    }
    return set;
  } catch (e) {
    console.warn(`failed to read ${MEMBERS_PATH}: ${e.message} — graduate filter disabled`);
    return new Set();
  }
}

function normalizeMemberName(s) {
  return String(s).replace(/\s+/g, '').normalize('NFKC');
}

async function main() {
  // diag: 何が起きたかを毎回 public/photo-rates-diag.json に書く（CI 側で見えなくても
  // git 履歴で差分が追える）
  const diag = {
    ranAt: new Date().toISOString(),
    indexUrl: INDEX_URL,
    indexFetch: null,    // { ok: bool, status?, htmlSize?, error? }
    linkCount: 0,
    rateLinkCount: 0,
    targets: [],         // per-target: { id, matchedUrl?, fetched?, rateCount?, saleDate?, error? }
    discovered: [],      // per-new-series: { slug, saleDate, rateCount, label }
    skippedLinks: [],    // { url, reason } — 最大 10 件
    prunedFromExisting: 0,
    droppedOld: 0,
    seriesCountAfter: 0,
  };

  let existing;
  try {
    existing = JSON.parse(await readFile(OUT_PATH, 'utf8'));
  } catch (e) {
    console.error(`failed to read existing ${OUT_PATH}: ${e.message}`);
    diag.fatalError = `read existing: ${e.message}`;
    await writeFile(DIAG_PATH, JSON.stringify(diag, null, 2) + '\n', 'utf8');
    process.exit(1);
  }

  const graduatedNames = await loadGraduatedNames();
  console.log(`loaded ${graduatedNames.size} graduated members for filtering`);
  diag.graduatedCount = graduatedNames.size;

  // 0. 卒業生の一掃は毎回実施（スクレイプ成否にかかわらず既存データからも除去）
  let prunedFromExisting = 0;
  for (const s of existing.series) {
    const before = s.rates.length;
    s.rates = s.rates.filter(r => !graduatedNames.has(normalizeMemberName(r.memberName)));
    prunedFromExisting += (before - s.rates.length);
  }
  diag.prunedFromExisting = prunedFromExisting;
  if (prunedFromExisting > 0) {
    console.log(`pruned ${prunedFromExisting} graduated entries from existing JSON`);
  }

  // 1. インデックスを取得してリンクを抽出
  let links = [];
  let indexFetchOk = false;
  try {
    const indexHtml = await fetchText(INDEX_URL);
    console.log(`fetched index ${INDEX_URL} (${indexHtml.length} bytes)`);
    links = extractLinks(indexHtml);
    console.log(`extracted ${links.length} links`);
    indexFetchOk = true;
    diag.indexFetch = { ok: true, htmlSize: indexHtml.length };
    diag.linkCount = links.length;
  } catch (e) {
    console.warn(`failed to fetch index: ${e.message}`);
    console.warn('skipping scrape; may still write pruned existing JSON');
    diag.indexFetch = { ok: false, error: String(e.message || e) };
  }

  const bySeriesId = new Map(existing.series.map(s => [s.id, s]));
  let updated = 0;
  let skipped = 0;
  if (!indexFetchOk) {
    // index が取れなくても卒業生の prune 分だけはコミットしたい
    skipped = existing.series.length;
  }

  for (const target of TARGETS) {
    console.log(`\n[${target.id}]`);
    const td = { id: target.id };
    const existingSeries = bySeriesId.get(target.id);
    if (!existingSeries) {
      console.warn(`  ↳ series ${target.id} not declared in photo-rates.json; skipping`);
      td.reason = 'series not in JSON';
      diag.targets.push(td);
      skipped++;
      continue;
    }

    const url = matchTarget(links, target);
    if (!url) {
      console.warn(`  ↳ no index link matched — keeping existing ${existingSeries.rates.length} rates`);
      td.reason = 'no index link matched';
      diag.targets.push(td);
      skipped++;
      continue;
    }
    td.matchedUrl = url;

    try {
      const html = await fetchText(url);
      console.log(`  ↳ fetched ${url} (${html.length} bytes)`);
      td.fetched = true;
      td.htmlSize = html.length;
      const rates = parseRates(html).filter(r => !graduatedNames.has(normalizeMemberName(r.memberName)));
      td.rateCount = rates.length;
      if (rates.length < 5) {
        console.warn(`  ↳ only ${rates.length} rates parsed (post-grad-filter) — keeping existing`);
        td.reason = 'too few rates';
        diag.targets.push(td);
        skipped++;
        continue;
      }
      existingSeries.rates = dedupe(rates);
      existingSeries.sourceUrl = url;
      const sd = extractSaleDate(html);
      if (sd) existingSeries.saleDate = sd;
      td.saleDate = sd;
      console.log(`  ↳ updated: ${rates.length} rates${sd ? ` (saleDate=${sd})` : ''}`);
      diag.targets.push(td);
      updated++;
    } catch (e) {
      console.warn(`  ↳ fetch/parse failed: ${e.message}`);
      console.warn(`  ↳ keeping existing ${existingSeries.rates.length} rates`);
      td.error = String(e.message || e);
      diag.targets.push(td);
      skipped++;
    }
  }

  // ---------- 自動 discovery: TARGETS 以外のシリーズ ----------
  let discovered = 0;
  if (indexFetchOk) {
    const cutoff = cutoffKeyNow();
    // 既に JSON に存在する sourceUrl を避けて新規のみ処理
    const existingUrls = new Set(existing.series.map(s => s.sourceUrl).filter(Boolean));
    const existingIds  = new Set(existing.series.map(s => s.id));

    const allLinks = allRateLinks(links);
    console.log(`\ndiscovery: ${allLinks.length} candidate rate-... links in index`);
    diag.rateLinkCount = allLinks.length;

    const recordSkip = (url, reason) => {
      if (diag.skippedLinks.length < 10) diag.skippedLinks.push({ url, reason });
    };

    for (const link of allLinks) {
      if (discovered >= MAX_NEW_SERIES) break;
      if (existingUrls.has(link.url)) { recordSkip(link.url, 'already in JSON'); continue; }
      if (existingIds.has(link.slug)) { recordSkip(link.url, 'slug already in JSON'); continue; }

      try {
        const html = await fetchText(link.url);
        const sd = extractSaleDate(html);
        if (!sd) { recordSkip(link.url, 'no saleDate parsed'); continue; }
        if (sd < cutoff) { recordSkip(link.url, `older than cutoff (${sd} < ${cutoff})`); continue; }
        const rates = parseRates(html).filter(r => !graduatedNames.has(normalizeMemberName(r.memberName)));
        if (rates.length < 5) { recordSkip(link.url, `too few rates (${rates.length})`); continue; }

        const series = {
          id: link.slug,
          label: link.label || link.slug,
          group: groupFromSlug(link.slug),
          saleDate: sd,
          saleYear: parseInt(sd.slice(0, 4), 10),
          sourceUrl: link.url,
          rates: dedupe(rates),
        };
        existing.series.push(series);
        existingIds.add(link.slug);
        existingUrls.add(link.url);
        discovered++;
        diag.discovered.push({ slug: link.slug, saleDate: sd, rateCount: rates.length, label: link.label });
        console.log(`  + discovered ${link.slug} (${sd}, ${rates.length} rates) "${link.label}"`);
      } catch (e) {
        recordSkip(link.url, `fetch/parse error: ${e.message}`);
      }
    }
    console.log(`discovery: ${discovered} new series added`);
  }

  // ---------- 2年より古いシリーズは JSON から削除 ----------
  let droppedOld = 0;
  const cutoff = cutoffKeyNow();
  const before = existing.series.length;
  existing.series = existing.series.filter(s => {
    const sd = s.saleDate || (s.saleYear ? `${s.saleYear}-06` : null);
    if (!sd) return true;                     // saleDate 不明は残す（手動エントリ保護）
    if (sd >= cutoff) return true;
    return false;
  });
  droppedOld = before - existing.series.length;
  if (droppedOld > 0) console.log(`\npruned ${droppedOld} series older than ${cutoff}`);
  diag.droppedOld = droppedOld;
  diag.seriesCountAfter = existing.series.length;
  diag.summary = { updated, discovered, skipped, prunedFromExisting, droppedOld };

  // diag は毎回書く（CI から見えないログの代わり）
  await writeFile(DIAG_PATH, JSON.stringify(diag, null, 2) + '\n', 'utf8');

  if (updated === 0 && prunedFromExisting === 0 && discovered === 0 && droppedOld === 0) {
    console.log(`\nNo rate changes. diag written.`);
    return;
  }

  existing.generatedAt = new Date().toISOString();
  const serialized = JSON.stringify(existing, null, 2) + '\n';
  await writeFile(OUT_PATH, serialized, 'utf8');
  await writeFile(MOBILE_COPY_PATH, serialized, 'utf8');
  console.log(`\n✓ wrote ${OUT_PATH} + mobile copy (${updated} updated, ${discovered} discovered, ${droppedOld} pruned-old, ${skipped} skipped)`);
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
