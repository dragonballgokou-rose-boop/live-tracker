#!/usr/bin/env node
// ============================================
// Official members scraper (乃木坂46 / 櫻坂46)
// ============================================
// 公式メンバー一覧を取得して public/official-members.json を更新する。
// Sony Music CMS の API (JSONP 風 JSON) を第一候補、HTML パースをフォールバックに使う。
//
// 出力 schema:
//   { updatedAt, sources: { nogi, saku }, members: OfficialMember[], errors }
// OfficialMember:
//   { code, group: 'nogi'|'saku', name, kana, eng, imgUrl, blogUrl, detailUrl, generation, graduated }
//
// GitHub Actions から毎日 1 回実行し、変化があれば public/official-members.json をコミット。

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = resolve(__dirname, '..', 'public', 'official-members.json');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const SOURCES = [
  {
    group: 'nogi',
    artist: '乃木坂46',
    referer: 'https://www.nogizaka46.com/s/n46/search/artist',
    blogBase: 'https://www.nogizaka46.com/s/n46/diary/MEMBER/list?ima=0000&ct=',
    detailBase: 'https://www.nogizaka46.com/s/n46/artist/',
    candidates: [
      'https://www.nogizaka46.com/s/n46/api/list/member?callback=res&ima=0000',
      'https://www.nogizaka46.com/s/n46/api/list/member?ima=0000',
      'https://www.nogizaka46.com/s/n46/api/list/member',
    ],
  },
  {
    group: 'saku',
    artist: '櫻坂46',
    referer: 'https://sakurazaka46.com/s/s46/search/artist',
    blogBase: 'https://sakurazaka46.com/s/s46/diary/MEMBER/list?ima=0000&ct=',
    detailBase: 'https://sakurazaka46.com/s/s46/artist/',
    candidates: [
      'https://sakurazaka46.com/s/s46/api/list/member?callback=res&ima=0000',
      'https://sakurazaka46.com/s/s46/api/list/member?ima=0000',
      'https://sakurazaka46.com/s/s46/api/list/member',
    ],
  },
];

// ---------- fetch ----------

async function fetchResource(url, { referer } = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (referer) headers['Referer'] = referer;
  const res = await fetch(url, { redirect: 'follow', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`);
  const body = await res.text();
  return { body, finalUrl: res.url };
}

async function fetchAnyCandidate(candidates, opts = {}) {
  const errors = [];
  for (const url of candidates) {
    try {
      const { body, finalUrl } = await fetchResource(url, opts);
      console.log(`  ↳ ${url} → ${finalUrl} (${body.length} bytes)`);
      return { body, finalUrl, url };
    } catch (e) {
      console.warn(`  ↳ tried ${url} → ${e.message}`);
      errors.push({ url, error: e.message });
    }
  }
  const err = new Error(`all ${candidates.length} candidates failed`);
  err.details = errors;
  throw err;
}

// ---------- parser ----------

function cleanText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(u, group) {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const host = group === 'nogi' ? 'https://www.nogizaka46.com' : 'https://sakurazaka46.com';
  return s.startsWith('/') ? host + s : host + '/' + s;
}

/**
 * JSONP/JSON 両対応で配列を取り出す。
 * 想定レスポンス:
 *   res({ code: "500", data: [...] })
 *   { data: [...] }
 *   [...]
 */
function extractList(body) {
  let text = String(body).trim();
  const jsonpMatch = text.match(/^[a-zA-Z_][\w$]*\s*\(([\s\S]*)\);?\s*$/);
  if (jsonpMatch) text = jsonpMatch[1];
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }
  const list = Array.isArray(data)
    ? data
    : (data.list || data.data || data.items || data.result || data.results
       || data.member || data.members || []);
  if (!Array.isArray(list)) {
    throw new Error(`no list array (top-level keys: ${Object.keys(data || {}).join(',')})`);
  }
  return list;
}

/**
 * API 項目 → 統一 OfficialMember
 * Sony Music CMS の API はフィールド名が微妙にバージョンで違うので
 * よくある別名を全部試す。
 */
function mapMember(item, src) {
  const code = cleanText(item.code || item.memberCode || item.member_code || item.id);
  if (!code) return null;
  const name =
    cleanText(item.name || item.memberName || item.member_name || item.title || '') || null;
  const kana =
    cleanText(item.kana || item.ruby || item.nameKana || item.name_kana || '') || null;
  const eng =
    cleanText(item.eng || item.english || item.nameEn || item.name_en || '') || null;
  const imgUrl = absoluteUrl(
    item.img || item.image || item.imgUrl || item.picture || item.thumbnail || null,
    src.group,
  );
  const generation = cleanText(item.group || item.generation || item.kisei || '') || null;
  const graduated = /YES|1|true/i.test(String(item.graduation || item.graduated || '0'));
  const detailUrl = item.link
    ? absoluteUrl(item.link, src.group)
    : `${src.detailBase}${encodeURIComponent(code)}`;
  const blogUrl = `${src.blogBase}${encodeURIComponent(code)}`;

  return {
    code,
    group: src.group,
    artist: src.artist,
    name,
    kana,
    eng,
    imgUrl,
    generation,
    graduated,
    detailUrl,
    blogUrl,
  };
}

// ---------- main ----------

async function readExisting() {
  try {
    const text = await readFile(OUT_PATH, 'utf-8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const existing = await readExisting();
  const errors = [];
  const allMembers = [];
  const sources = {};

  for (const src of SOURCES) {
    console.log(`\n=== ${src.artist} (${src.group}) ===`);
    try {
      const { body, finalUrl } = await fetchAnyCandidate(src.candidates, { referer: src.referer });
      sources[src.group] = finalUrl;
      const list = extractList(body);
      console.log(`  ↳ list loaded: ${list.length} items`);
      const mapped = list.map(item => mapMember(item, src)).filter(Boolean);
      console.log(`  ↳ mapped: ${mapped.length} members`);
      if (mapped.length === 0 && list.length > 0) {
        console.warn(`  ↳ sample raw item: ${JSON.stringify(list[0]).slice(0, 500)}`);
      }
      allMembers.push(...mapped);
    } catch (e) {
      console.error(`  ↳ FAIL: ${e.message}`);
      errors.push({ group: src.group, artist: src.artist, error: e.message });
    }
  }

  // 何も取れなかった → 既存を保持（空で上書きしない）
  if (allMembers.length === 0) {
    if (existing && Array.isArray(existing.members) && existing.members.length > 0) {
      console.warn('\n⚠ No members scraped this run — keeping existing JSON as-is.');
      return;
    }
    console.error('\n✘ No members scraped and no existing JSON. Writing empty placeholder.');
  }

  // 既存メンバーと比較して差分を pre-merge（取れなかったグループは既存を維持）
  if (existing && Array.isArray(existing.members)) {
    for (const src of SOURCES) {
      const scraped = allMembers.some(m => m.group === src.group);
      if (!scraped) {
        const keep = existing.members.filter(m => m.group === src.group);
        if (keep.length > 0) {
          console.log(`  ↳ keeping ${keep.length} existing ${src.group} members`);
          allMembers.push(...keep);
        }
      }
    }
  }

  // ソート: group → generation → code
  allMembers.sort((a, b) =>
    a.group.localeCompare(b.group) ||
    String(a.generation || '').localeCompare(String(b.generation || '')) ||
    a.code.localeCompare(b.code)
  );

  const out = {
    version: '1',
    updatedAt: new Date().toISOString(),
    sources,
    members: allMembers,
    errors: errors.length > 0 ? errors : undefined,
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ wrote ${allMembers.length} members to ${OUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
