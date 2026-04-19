#!/usr/bin/env node
// ============================================
// Official members scraper (乃木坂46 / 櫻坂46)
// ============================================
// 公式メンバー一覧を取得して public/official-members.json を更新する。
// 1. Sony Music CMS の API (JSONP 風 JSON) を優先
// 2. 失敗した場合は search/artist HTML ページを正規表現でパース
// 3. どちらも失敗したらエラー情報付きで JSON を書き込む（UI は空フォールバックに遷移）
//
// 出力 schema:
//   { version, updatedAt, sources: {nogi, saku}, members: OfficialMember[], errors? }

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
    host: 'https://www.nogizaka46.com',
    referer: 'https://www.nogizaka46.com/s/n46/search/artist',
    blogBase: 'https://www.nogizaka46.com/s/n46/diary/MEMBER/list?ima=0000&ct=',
    detailBase: 'https://www.nogizaka46.com/s/n46/artist/',
    apiCandidates: [
      'https://www.nogizaka46.com/s/n46/api/list/member?callback=res&ima=0000',
      'https://www.nogizaka46.com/s/n46/api/list/member?ima=0000',
      'https://www.nogizaka46.com/s/n46/api/list/member',
      'https://www.nogizaka46.com/s/n46/api/member?ima=0000',
    ],
    htmlCandidates: [
      'https://www.nogizaka46.com/s/n46/search/artist?ima=0000',
      'https://www.nogizaka46.com/s/n46/search/artist',
    ],
  },
  {
    group: 'saku',
    artist: '櫻坂46',
    host: 'https://sakurazaka46.com',
    referer: 'https://sakurazaka46.com/s/s46/search/artist',
    blogBase: 'https://sakurazaka46.com/s/s46/diary/MEMBER/list?ima=0000&ct=',
    detailBase: 'https://sakurazaka46.com/s/s46/artist/',
    apiCandidates: [
      'https://sakurazaka46.com/s/s46/api/list/member?callback=res&ima=0000',
      'https://sakurazaka46.com/s/s46/api/list/member?ima=0000',
      'https://sakurazaka46.com/s/s46/api/list/member',
      'https://sakurazaka46.com/s/s46/api/member?ima=0000',
    ],
    htmlCandidates: [
      'https://sakurazaka46.com/s/s46/search/artist?ima=0000',
      'https://sakurazaka46.com/s/s46/search/artist',
    ],
  },
];

// ---------- fetch ----------

async function fetchResource(url, { referer, kind = 'api' } = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept': kind === 'api'
      ? 'application/json, text/plain, */*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
  };
  if (kind === 'api') headers['X-Requested-With'] = 'XMLHttpRequest';
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

// ---------- helpers ----------

function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')              // strip tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
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

// ---------- JSON API parser ----------

function extractApiList(body) {
  let text = String(body).trim();
  const jsonpMatch = text.match(/^[a-zA-Z_][\w$]*\s*\(([\s\S]*)\);?\s*$/);
  if (jsonpMatch) text = jsonpMatch[1];
  const data = JSON.parse(text);
  const list = Array.isArray(data)
    ? data
    : (data.list || data.data || data.items || data.result || data.results
       || data.member || data.members || []);
  if (!Array.isArray(list)) {
    throw new Error(`no list array (top-level keys: ${Object.keys(data || {}).join(',')})`);
  }
  return list;
}

function mapApiMember(item, src) {
  const code = cleanText(item.code || item.memberCode || item.member_code || item.id);
  if (!code) return null;
  const name =
    cleanText(item.name || item.memberName || item.member_name || item.title) || null;
  const kana =
    cleanText(item.kana || item.ruby || item.nameKana || item.name_kana) || null;
  const eng =
    cleanText(item.eng || item.english || item.nameEn || item.name_en) || null;
  const imgUrl = absoluteUrl(
    item.img || item.image || item.imgUrl || item.picture || item.thumbnail || null,
    src.host,
  );
  const generation = cleanText(item.group || item.generation || item.kisei) || null;
  const graduated = /YES|1|true/i.test(String(item.graduation || item.graduated || '0'));
  const detailUrl = item.link
    ? absoluteUrl(item.link, src.host)
    : `${src.detailBase}${encodeURIComponent(code)}`;
  return {
    code, group: src.group, artist: src.artist,
    name, kana, eng, imgUrl, generation, graduated,
    detailUrl, blogUrl: `${src.blogBase}${encodeURIComponent(code)}`,
  };
}

// ---------- HTML parser ----------

/**
 * Sony Music CMS のメンバー一覧ページは、URL が /s/<code>/artist/<メンバーcode> の形で
 * 並んでいる。正規表現でリンクと周辺情報を拾う。HTML 構造が多少変わっても耐えるよう
 * "link + 近接の名前/画像" を広めにスキャンする。
 */
function extractHtmlMembers(html, src) {
  const results = new Map();
  // 例: /s/n46/artist/46003?ima=... または /s/s46/artist/1234?ima=...
  const pathRe = /\/s\/(?:n46|s46)\/artist\/([A-Za-z0-9_\-]+)(?:\?[^"'<>]*)?/g;
  const seen = new Set();
  let m;
  while ((m = pathRe.exec(html)) !== null) {
    const code = m[1];
    if (!code || seen.has(code)) continue;
    seen.add(code);
    // 周辺 ~1500 文字から名前と画像を拾う
    const start = Math.max(0, m.index - 800);
    const end   = Math.min(html.length, m.index + 1500);
    const chunk = html.slice(start, end);

    // 画像: <img src="..." または data-src="..."
    const imgMatch = chunk.match(/<img[^>]+(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    const imgUrl = imgMatch ? absoluteUrl(imgMatch[1], src.host) : null;

    // 名前: 代表的な class 属性を幅広く
    let nameMatch = chunk.match(/class="[^"]*(?:m--mem__name|member__name|name[_-]ja)[^"]*"[^>]*>([^<]+)</i);
    if (!nameMatch) {
      // alt 属性から
      const altMatch = chunk.match(/<img[^>]+alt=["']([^"']{2,30})["']/i);
      if (altMatch && !/loading|logo|icon/i.test(altMatch[1])) {
        nameMatch = [null, altMatch[1]];
      }
    }
    const name = nameMatch ? cleanText(nameMatch[1]) : null;

    // かな / ruby
    const kanaMatch = chunk.match(/class="[^"]*(?:m--mem__kn|kana|ruby)[^"]*"[^>]*>([^<]+)</i);
    const kana = kanaMatch ? cleanText(kanaMatch[1]) : null;

    // 期
    const genMatch = chunk.match(/([0-9]+期生|新[0-9]+期生|研究生)/);
    const generation = genMatch ? cleanText(genMatch[1]) : null;

    if (!name) continue;

    results.set(code, {
      code,
      group: src.group,
      artist: src.artist,
      name,
      kana,
      eng: null,
      imgUrl,
      generation,
      graduated: false, // HTML からは判定が難しい。active 前提で扱う
      detailUrl: `${src.detailBase}${encodeURIComponent(code)}`,
      blogUrl:   `${src.blogBase}${encodeURIComponent(code)}`,
    });
  }
  return [...results.values()];
}

// ---------- scrape per source ----------

async function scrapeGroup(src) {
  // 1) API を試す
  try {
    const { body, finalUrl } = await fetchAnyCandidate(src.apiCandidates, { referer: src.referer, kind: 'api' });
    try {
      const list = extractApiList(body);
      const mapped = list.map(item => mapApiMember(item, src)).filter(Boolean);
      console.log(`  [API] mapped ${mapped.length} members`);
      if (mapped.length > 0) {
        return { finalUrl, members: mapped, via: 'api' };
      }
      if (list.length > 0) {
        console.warn(`  [API] sample raw item: ${JSON.stringify(list[0]).slice(0, 500)}`);
      }
    } catch (e) {
      console.warn(`  [API] parse failed: ${e.message}`);
      console.warn(`  body preview: ${body.slice(0, 400).replace(/\n/g, ' ')}`);
    }
  } catch (e) {
    console.warn(`  [API] all candidates failed: ${e.message}`);
  }

  // 2) HTML フォールバック
  try {
    const { body, finalUrl } = await fetchAnyCandidate(src.htmlCandidates, { referer: src.referer, kind: 'html' });
    const mapped = extractHtmlMembers(body, src);
    console.log(`  [HTML] extracted ${mapped.length} members`);
    if (mapped.length > 0) {
      return { finalUrl, members: mapped, via: 'html' };
    }
  } catch (e) {
    console.warn(`  [HTML] all candidates failed: ${e.message}`);
  }

  throw new Error(`failed to scrape ${src.group}`);
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
      const { finalUrl, members, via } = await scrapeGroup(src);
      sources[src.group] = `${finalUrl} (via ${via})`;
      allMembers.push(...members);
    } catch (e) {
      console.error(`  ✘ FAIL: ${e.message}`);
      errors.push({ group: src.group, artist: src.artist, error: e.message });
    }
  }

  // 取れなかったグループは既存を維持（空で上書きしない）
  if (existing && Array.isArray(existing.members)) {
    for (const src of SOURCES) {
      const gotAny = allMembers.some(m => m.group === src.group);
      if (!gotAny) {
        const keep = existing.members.filter(m => m.group === src.group);
        if (keep.length > 0) {
          console.log(`  ↳ keeping ${keep.length} existing ${src.group} members (this run failed)`);
          allMembers.push(...keep);
          if (!sources[src.group] && existing.sources?.[src.group]) {
            sources[src.group] = existing.sources[src.group];
          }
        }
      }
    }
  }

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
    ...(errors.length > 0 ? { errors } : {}),
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`\n✓ wrote ${allMembers.length} members to ${OUT_PATH}`);
  if (errors.length > 0) {
    console.log(`  (with ${errors.length} group error${errors.length > 1 ? 's' : ''})`);
  }
}

main().catch(e => {
  console.error('UNCAUGHT:', e);
  process.exit(1);
});
