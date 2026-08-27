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

import {
  htmlToText,
  looksLikeTourAnnouncement,
  extractPerformances,
  buildProvisionalLive,
  dropSupersededProvisionals,
  dedupeProvisionals,
  buildFailureDiagnostic,
  parseNewsList,
} from './lib/news-tours.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = resolve(__dirname, '..', 'public', 'official-lives.json');

// ニュース詳細を取りに行く最大件数（公式サイトへの負荷と実行時間の上限）
const NEWS_MAX_DETAILS = 12;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// 各サイトで試す URL 候補。最初に 200 を返したものを採用する。
// CMS の URL 構造は予告なく変わるので、よくあるパターンを並べて耐性を上げる。
const SOURCES = [
  {
    artist: '乃木坂46',
    idPrefix: 'nogi',
    referer: 'https://www.nogizaka46.com/s/n46/live',
    candidates: [
      // HTML 内で発見した API エンドポイント — JSON 返却の想定
      'https://www.nogizaka46.com/s/n46/api/list/live',
      'https://www.nogizaka46.com/s/n46/api/list/live?ima=0000',
      // フォールバック: HTML ページ（la--list は JS で populate されてる）
      'https://www.nogizaka46.com/s/n46/live',
      'https://www.nogizaka46.com/s/n46/live?ima=0000',
    ],
    // ライブ API 未登録の「発表済みツアー」を拾うためのニュース欄
    news: {
      candidates: [
        'https://www.nogizaka46.com/s/n46/api/list/news',
        'https://www.nogizaka46.com/s/n46/api/list/news?ima=0000',
        'https://www.nogizaka46.com/s/n46/news/list',
        'https://www.nogizaka46.com/s/n46/news/list?ima=0000',
      ],
      detail: id => `https://www.nogizaka46.com/s/n46/news/detail/${id}?ima=0000`,
      detailPathRe: /\/s\/n46\/news\/detail\/(\d+)/g,
    },
  },
  {
    artist: '櫻坂46',
    idPrefix: 'saku',
    referer: 'https://sakurazaka46.com/',
    candidates: [
      // Sony Music CMS API（nogi と同構造の JSONP or JSON を返す想定）
      // ← 優先: 会場情報が入っているのでこちらから取れれば解決
      'https://sakurazaka46.com/s/s46/api/list/live',
      'https://sakurazaka46.com/s/s46/api/list/live?ima=0000',
      // 新デザインの公開ページ（スクショで確認された見た目）
      'https://sakurazaka46.com/live/',
      'https://sakurazaka46.com/live/index.html',
      'https://sakurazaka46.com/ja/live',
      'https://sakurazaka46.com/ja/live/',
      'https://sakurazaka46.com/live.html',
      // CMS 旧 URL: HTML ページだが venue が取れない場合がある
      'https://sakurazaka46.com/s/s46/diary/live_page/list?ima=0000',
      'https://sakurazaka46.com/s/s46/diary/event_page/list?ima=0000',
    ],
    news: {
      candidates: [
        'https://sakurazaka46.com/s/s46/api/list/news',
        'https://sakurazaka46.com/s/s46/api/list/news?ima=0000',
        'https://sakurazaka46.com/s/s46/news/list?ima=0000',
      ],
      detail: id => `https://sakurazaka46.com/s/s46/news/detail/${id}?ima=0000`,
      detailPathRe: /\/s\/s46\/news\/detail\/(\d+)/g,
    },
  },
];

// ---------- 汎用 fetch ----------

async function fetchResource(url, { referer } = {}) {
  const isApi = /\/api\//.test(url);
  const headers = {
    'User-Agent': UA,
    'Accept': isApi
      ? 'application/json, text/plain, */*'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
  };
  if (isApi) {
    // Sony Music CMS の内部API呼び出しは JS からの XHR として振る舞う必要がある
    headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  if (referer) headers['Referer'] = referer;

  const res = await fetch(url, { redirect: 'follow', headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const body = await res.text();
  return { body, finalUrl: res.url, contentType };
}

/**
 * 候補URLを順番に試して、最初に 200 を返したものを使う。
 * 失敗したURLは理由とともにログに残す。
 */
async function fetchAnyCandidate(candidates, opts = {}) {
  const errors = [];
  for (const url of candidates) {
    try {
      const { body, finalUrl, contentType } = await fetchResource(url, opts);
      console.log(`  ↳ fetched ${url} → ${finalUrl} (${body.length} bytes, ${contentType || 'no-ct'})`);
      return { body, finalUrl, contentType, url };
    } catch (e) {
      console.warn(`  ↳ tried ${url} → ${e.message}`);
      errors.push({ url, error: e.message });
    }
  }
  const err = new Error(`all ${candidates.length} candidates failed`);
  err.details = errors;
  throw err;
}

// ---------- JSON API パース ----------

/**
 * 内部API のレスポンスを公式ライブ形式にマッピングする。
 * Sony Music CMS は JSONP (`res({...})` 形式) で返すことが多いので、
 * 先に wrapper を剥がしてからパースする。
 */
function parseScheduleJson(body, { artist, idPrefix, url }) {
  // JSONP ラッパーを剥がす: res({...}) / callback({...}) / anyName({...})
  let text = body.trim();
  const jsonpMatch = text.match(/^[a-zA-Z_][\w$]*\s*\(([\s\S]*)\);?\s*$/);
  if (jsonpMatch) {
    text = jsonpMatch[1];
    console.log(`  ↳ stripped JSONP wrapper`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.warn(`  ↳ JSON parse failed: ${e.message}`);
    console.warn(`  ↳ body preview:\n     ${text.slice(0, 400).replace(/\n/g, ' ')}`);
    return [];
  }

  const list = Array.isArray(data)
    ? data
    : (data.list || data.data || data.items || data.result || data.results
       || data.kouen || []);

  if (!Array.isArray(list) || list.length === 0) {
    console.warn(`  ↳ JSON loaded but no list array. Top-level keys: ${Object.keys(data || {}).join(', ')}`);
    console.warn(`  ↳ body preview:\n     ${text.slice(0, 400).replace(/\n/g, ' ')}`);
    return [];
  }

  console.log(`  ↳ JSON list loaded: ${list.length} items`);

  const results = [];
  for (const item of list) {
    // Nogizaka CMS 固有: item.kouen[] に個別公演が入る
    // 各 kouen から dateStart/dateEnd を計算して1つのツアーエントリにまとめる
    const title = cleanText(
      item.title || item.name || item.subject || item.liveName || item.live_name || ''
    );
    if (!title) continue;

    const kouenArr = Array.isArray(item.kouen) ? item.kouen
                    : Array.isArray(item.performances) ? item.performances
                    : null;

    if (kouenArr && kouenArr.length > 0) {
      // 各 kouen を個別日程として保持（連続日でないツアーを正しく扱うため）
      const perKouen = kouenArr
        .map(k => {
          const date = normalizeDate(k.date || k.day);
          if (!date) return null;
          return {
            dateStart:  date,
            dateEnd:    date,
            venue:      cleanText(k.place || k.venue || k.hall || '') || null,
            prefecture: cleanText(k.area || k.prefecture || k.pref || '') || null,
            openTime:   normalizeTime(k.open || k.kaijo || k.door || k.open_time || k.doorOpen || k.gate || k.kaijyo) || null,
            startTime:  normalizeTime(k.start || k.kaien || k.start_time || k.show || k.showStart || k.performance) || null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
      if (perKouen.length === 0) continue;

      const dateStart = perKouen[0].dateStart;
      const dateEnd   = perKouen[perKouen.length - 1].dateStart;

      // 同一会場かつ連続日付なら multi-day single live 扱い（例: XX BIRTHDAY LIVE Day1-3）
      const isMultiDaySingleLive = perKouen.length > 1
        && isSameVenueConsecutive(perKouen);

      if (perKouen.length === 1 || isMultiDaySingleLive) {
        const first = perKouen[0];
        // カテゴリ判定: 名前に舞台系キーワードがある時だけ 'stage'
        // （ライブ系キーワードやデフォルトはすべて 'live'）
        const eventType = looksLikeStage(title)
          ? 'stage'
          : mapCategory(item.cate || item.category || '');
        // multi-day 単独ライブの場合、各日の open/start を dayTimes にまとめる
        const dayTimes = [];
        for (const k of perKouen) {
          if (k.openTime || k.startTime) {
            dayTimes.push({
              date: k.dateStart,
              openTime:  k.openTime  || undefined,
              startTime: k.startTime || undefined,
            });
          }
        }
        const hasDayTimes = dayTimes.length > 0;
        results.push({
          officialId: `${idPrefix}-${item.code || dateStart}-${slugify(title)}`,
          artist,
          name: title,
          venue: first.venue,
          prefecture: first.prefecture,
          dateStart,
          dateEnd,   // multi-day の場合は最終日
          eventType,
          iconImg: item.img || item.image || item.thumbnail || null,
          sourceUrl: item.link || url,
          scrapedAt: new Date().toISOString(),
          openTime:  perKouen.length === 1 ? (first.openTime  || null) : null,
          startTime: perKouen.length === 1 ? (first.startTime || null) : null,
          dayTimes:  hasDayTimes ? dayTimes : undefined,
        });
      } else {
        // 複数会場 or 非連続日 → 本物のツアー
        // 連続同一会場の日程を「レグ」に畳む
        // 例: 7/14福井, 7/15福井, 7/17宮城, 7/18宮城
        //     → 福井 7/14〜7/15 / 宮城 7/17〜7/18 の 2 レグ
        const legs = groupIntoLegs(perKouen);

        results.push({
          officialId: `${idPrefix}-${item.code || dateStart}-${slugify(title)}`,
          artist,
          name: title,
          venue: null,
          prefecture: null,
          dateStart,
          dateEnd,
          eventType: 'tour',
          iconImg: item.img || item.image || item.thumbnail || null,
          sourceUrl: item.link || url,
          scrapedAt: new Date().toISOString(),
          children: legs.map((leg) => ({
            dateStart:  leg.dateStart,
            dateEnd:    leg.dateEnd,
            venue:      leg.venue,
            prefecture: leg.prefecture,
            openTime:   leg.openTime  || null,
            startTime:  leg.startTime || null,
            dayTimes:   leg.dayTimes  || undefined,
          })),
        });
      }
    } else {
      // 単独公演フォーマット（API により違う）
      const dateRaw = item.startDate || item.start_date || item.date || item.day;
      const dateStart = normalizeDate(dateRaw);
      if (!dateStart) continue;
      const dateEnd = normalizeDate(
        item.endDate || item.end_date || item.dateEnd || dateRaw
      );
      const venue = cleanText(item.venue || item.place || item.location || item.hall || '');

      results.push({
        officialId: `${idPrefix}-${item.code || dateStart}-${slugify(title)}`,
        artist,
        name: title,
        venue: venue || null,
        prefecture: cleanText(item.prefecture || item.pref || item.area || '') || null,
        dateStart,
        dateEnd: dateEnd || dateStart,
        eventType: mapCategory(item.cate || item.category || item.type || ''),
        iconImg: item.img || item.image || item.thumbnail || null,
        sourceUrl: item.link || url,
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  if (results.length === 0 && list.length > 0) {
    console.warn(`  ↳ JSON items parsed 0 — sample item:\n     ${JSON.stringify(list[0]).slice(0, 600)}`);
  }

  return results;
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
      // 乃木坂46 / 欅坂系 CMS — la--list__in / la--list__date などのクラス名
      name: 'la--list',
      itemRe: /<(?:li|a|div)[^>]*class=["'][^"']*la--list__(?:in|item)[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|a|div)>/gi,
      fields: {
        date:  /la--list__(?:date|day)[^>]*>([\s\S]*?)</i,
        title: /la--list__(?:ttl|title|name)[^>]*>([\s\S]*?)</i,
        place: /la--list__(?:place|venue|loc)[^>]*>([\s\S]*?)</i,
        cate:  /la--list__(?:cate|category|tag)[^>]*>([\s\S]*?)</i,
      },
    },
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

  // 3) テキストベースのフォールバック（櫻坂新デザイン向け）
  // 「〜」内のタイトル + YYYY.M.D（曜）形式の日付 + @会場 のパターンを
  // HTML タグを剥がしたプレーンテキストから抽出する
  if (results.length === 0) {
    const textResults = parsePlainTextFallback(html, { artist, idPrefix, url });
    if (textResults.length > 0) {
      console.log(`  ↳ plain-text fallback matched: ${textResults.length}`);
      results.push(...textResults);
    }
  }

  // 3) 失敗時は HTML の構造ヒントを出して終了
  if (results.length === 0) {
    console.warn(`  ↳ Failed to parse. JSON-LD events=0, HTML patterns: ${JSON.stringify(debug.htmlPatterns)}`);

    // クラス名ヒント（次の正規表現調整用）
    const classes = [...new Set(
      [...html.matchAll(/class=["']([^"']{1,100})["']/g)]
        .map(x => x[1].split(/\s+/))
        .flat()
        .filter(c => /(list|item|schedule|date|venue|event|live|sche|cale)/i.test(c))
    )].slice(0, 40);
    console.warn(`  ↳ Candidate classes:\n     ${classes.join(', ')}`);

    // API エンドポイントヒント（JSで動的ロードしてる場合）
    const apiUrls = [...new Set(
      [...html.matchAll(/["']([^"']*(?:\/api\/|\/json\/|\.json|endpoint)[^"']*)["']/gi)]
        .map(x => x[1])
        .filter(u => u.length < 200 && !u.includes('schema.org'))
    )].slice(0, 15);
    if (apiUrls.length > 0) {
      console.warn(`  ↳ Possible API endpoints found in HTML:\n     ${apiUrls.join('\n     ')}`);
    }

    // data-* 属性ヒント（data-endpoint など）
    const dataAttrs = [...new Set(
      [...html.matchAll(/data-(?:url|endpoint|api|src|href)=["']([^"']+)["']/gi)]
        .map(x => x[1])
        .filter(u => u.length < 200)
    )].slice(0, 10);
    if (dataAttrs.length > 0) {
      console.warn(`  ↳ data-* URL attributes:\n     ${dataAttrs.join('\n     ')}`);
    }

    // script タグ内の URL / JSON ヒント（SPA は JS に埋め込んであるケース多い）
    const scriptUrls = [...new Set(
      [...html.matchAll(/["'](\/s\/[^"']+|https?:\/\/[^"']*(?:api|json|live|schedule|event)[^"']*)["']/gi)]
        .map(x => x[1])
        .filter(u => u.length < 200 && !u.match(/\.(png|jpg|gif|svg|css|woff|js)(\?|$)/i))
    )].slice(0, 20);
    if (scriptUrls.length > 0) {
      console.warn(`  ↳ URLs referenced in HTML/scripts:\n     ${scriptUrls.join('\n     ')}`);
    }

    // 主要クラス周辺の HTML スニペットを dump — 実際の DOM 構造を見る
    const focusClasses = [...new Set(classes.filter(c =>
      /(list.*part|livelist|livetlist|live-top|live-list|event-list|schedule)/i.test(c)
    ))].slice(0, 3);
    for (const cls of focusClasses) {
      const escaped = cls.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(`class=["'][^"']*${escaped}[^"']*["']`, 'i');
      const m = re.exec(html);
      if (!m) continue;
      const start = Math.max(0, m.index - 80);
      const end = Math.min(html.length, m.index + 1200);
      const snippet = html.slice(start, end).replace(/\n/g, ' ').replace(/\s+/g, ' ');
      console.warn(`  ↳ HTML snippet around .${cls} (~${end - start} chars):\n     ${snippet.slice(0, 1500)}`);
    }

    // <script> 内の embedded JSON ヒント（window.__DATA__, var lives = {...} など）
    const scriptBodyMatches = [...html.matchAll(/<script[^>]*>([\s\S]{0,4000})<\/script>/gi)];
    for (const sm of scriptBodyMatches) {
      const s = sm[1].trim();
      if (s.length < 100) continue;
      // 有用そうなもののみ: live/event/schedule/kouen を含む
      if (!/live|event|kouen|schedule/i.test(s)) continue;
      console.warn(`  ↳ relevant <script> content (first 500 chars):\n     ${s.slice(0, 500).replace(/\n/g, ' ')}`);
      break;
    }
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

/**
 * 櫻坂46 の live ページのような、構造が緩い HTML 向けフォールバック。
 *
 * スクショで確認したパターン:
 *   櫻坂46「5th YEAR ANNIVERSARY LIVE」
 *   2026.4.11（土）開場 15:00 ／開演 17:30
 *   2026.4.12（日）開場 15:00 ／開演 17:30
 *   @MUFGスタジアム（国立競技場）
 *
 * HTML タグを全部剥がしてプレーンテキストにし、
 * タイトル（「〜」）→ 日付複数行 → @会場 の塊を抜き出す。
 */
function parsePlainTextFallback(html, { artist, idPrefix, url }) {
  // タグとnbsp類を剥がして改行を保持
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(li|div|p|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ');

  const results = [];
  // タイトル行: 「...」を含む行。改行から改行までを「ブロックの先頭」とする
  const titleRe = /「([^「」\n]{3,120})」/g;
  const dateRe = /(\d{4})[.\/\-年](\d{1,2})[.\/\-月](\d{1,2})(?:日)?(?:（[^）]*）|\([^\)]*\))?/g;

  let tm;
  const positions = [];
  while ((tm = titleRe.exec(text)) !== null) {
    positions.push({ index: tm.index, title: tm[1].trim(), fullLen: tm[0].length });
  }
  if (positions.length === 0) return results;

  for (let i = 0; i < positions.length; i++) {
    const { index, title } = positions[i];
    const blockEnd = (i + 1 < positions.length) ? positions[i + 1].index : Math.min(text.length, index + 1200);
    const block = text.slice(index, blockEnd);

    // 日付を複数抽出
    const dates = [];
    let dm;
    dateRe.lastIndex = 0;
    while ((dm = dateRe.exec(block)) !== null) {
      const yyyy = dm[1];
      const mm = String(dm[2]).padStart(2, '0');
      const dd = String(dm[3]).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    if (dates.length === 0) continue;
    dates.sort();

    // 会場: @で始まる行
    const venueMatch = /@\s*([^\n@]{2,80})/.exec(block);
    const venue = venueMatch ? venueMatch[1].trim().split(/\s{2,}/)[0] : null;

    // 「ライブ」/「イベント」/「感謝祭」等の区別
    const eventType = /感謝祭|ミーグリ|お話し会|誕生|握手|イベント/.test(title) ? 'event' : 'live';

    results.push({
      officialId: `${idPrefix}-${dates[0]}-${slugify(title)}`,
      artist,
      name: title,
      venue: venue || null,
      prefecture: null,
      dateStart: dates[0],
      dateEnd: dates[dates.length - 1],
      eventType,
      sourceUrl: url,
      scrapedAt: new Date().toISOString(),
    });
  }

  return results;
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

function normalizeTime(raw) {
  if (!raw) return '';
  const s = cleanText(raw);
  // "17:30" "17時30分" "17:30:00" "5:30 PM" いずれも HH:MM に揃える
  const m = s.match(/(\d{1,2})[:時](\d{1,2})/);
  if (!m) return '';
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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

/**
 * 複数日程を「ツアー」ではなく「multi-day single live」として扱うべきか判定する。
 *
 * 14th YEAR BIRTHDAY LIVE (5/19, 5/20, 5/21 @東京ドーム) のような
 * 同一会場での連続開催は、ツアーではなく 1 つのライブの複数日程。
 *
 * 判定: 全公演の会場が同じ AND 日付が 1 日以内のギャップで連続している
 * どちらかを満たさないなら本物のツアーとして扱う。
 */
function isSameVenueConsecutive(perKouen) {
  if (perKouen.length <= 1) return true;

  // 会場が1種類に絞れるか（nullは同一扱い）
  const venues = new Set(perKouen.map(p => p.venue || '').filter(v => v !== ''));
  if (venues.size > 1) return false;

  // 日付が前日比 1 日以内で連続しているか
  for (let i = 1; i < perKouen.length; i++) {
    const prev = new Date(perKouen[i - 1].dateStart + 'T00:00:00');
    const cur  = new Date(perKouen[i].dateStart + 'T00:00:00');
    const gapDays = (cur - prev) / 86400000;
    if (!isFinite(gapDays) || gapDays > 1) return false;
  }
  return true;
}

/**
 * 名前ベースで「舞台」と判定するヒューリスティック。
 * 演目名（プリンシパル等）や 舞台/ミュージカル 等の明示的キーワードのみ。
 * - 「ライブ / LIVE / コンサート」を含む場合は舞台ではない (e.g., アンダーライブ セカンド・シーズン)
 * - 「プリンシパル / 舞台 / 演劇 / ミュージカル」等が含まれる時だけ true
 * 判定を誤ったら手動で eventType を変更可能なので、保守的にデフォルト live に倒す
 */
/**
 * 連続日付 × 同一会場 の公演をまとめて「レグ」にする。
 * 例: [7/14福井, 7/15福井, 7/17宮城, 7/18宮城, 8/14愛知]
 *     → [{dateStart:7/14, dateEnd:7/15, venue:福井},
 *         {dateStart:7/17, dateEnd:7/18, venue:宮城},
 *         {dateStart:8/14, dateEnd:8/14, venue:愛知}]
 * ツアーの children はレグ単位で持つことで、UI が「福井 6/13〜14 / 神奈川 6/24〜25」の
 * ように見やすくなり、手動で作ったツアーと同じ構造になる。
 */
function groupIntoLegs(perKouen) {
  const legs = [];
  let cur = null;
  for (const k of perKouen) {
    const sameVenue = cur && (cur.venue || '') === (k.venue || '')
                   && (cur.prefecture || '') === (k.prefecture || '');
    const consecutive = cur && (() => {
      const prev = new Date(cur.dateEnd + 'T00:00:00');
      const next = new Date(k.dateStart + 'T00:00:00');
      const gap = (next - prev) / 86400000;
      return isFinite(gap) && gap > 0 && gap <= 1;
    })();
    if (cur && sameVenue && consecutive) {
      cur.dateEnd = k.dateStart; // レグ延長
      if (k.openTime || k.startTime) {
        cur.dayTimes = cur.dayTimes || [];
        cur.dayTimes.push({
          date: k.dateStart,
          openTime:  k.openTime  || undefined,
          startTime: k.startTime || undefined,
        });
      }
    } else {
      if (cur) legs.push(cur);
      cur = {
        dateStart:  k.dateStart,
        dateEnd:    k.dateStart,
        venue:      k.venue,
        prefecture: k.prefecture,
        openTime:   k.openTime,
        startTime:  k.startTime,
      };
      if (k.openTime || k.startTime) {
        cur.dayTimes = [{
          date: k.dateStart,
          openTime:  k.openTime  || undefined,
          startTime: k.startTime || undefined,
        }];
      }
    }
  }
  if (cur) legs.push(cur);
  return legs;
}

function looksLikeStage(name) {
  if (!name) return false;
  const n = String(name);
  // ライブ系キーワードを含むなら舞台ではない
  if (/ライブ|ＬＩＶＥ|LIVE|コンサート|CONCERT|Concert|Anniversary|BIRTHDAY|Festival|フェス/i.test(n)) return false;
  // 舞台系キーワード（16人のプリンシパル など）
  if (/プリンシパル|舞台|演劇|ミュージカル|Musical|公演「|朗読劇|3Bjunior|16人の/i.test(n)) return true;
  return false;
}

function mapCategory(raw) {
  const s = cleanText(raw).toLowerCase();
  // アプリ本体が使う値に合わせる: 'live' / 'event' / 'tour'
  // Supabase の lives_event_type_check 制約もこれらの値のみ許可
  if (!s) return 'live';
  if (s.includes('live') || s.includes('ライブ') || s.includes('コンサート')) return 'live';
  if (s.includes('ミーグリ') || s.includes('握手') || s.includes('ファン')) return 'event';
  if (s.includes('event') || s.includes('イベント')) return 'event';
  return 'live';
}

// ---------- ニュース欄からの暫定ツアー抽出 ----------

/**
 * ニュース欄を走査して「発表済みだがライブ API 未登録」のツアーを暫定エントリ化する。
 * 失敗しても例外は投げず、空配列 + diag を返す（本体のライブ取得を壊さないため）。
 */
async function scrapeNewsTours(src, scrapedAt) {
  const diag = { artist: src.artist, listUrl: null, candidates: 0, matched: 0, built: 0, notes: [] };
  if (!src.news) return { lives: [], diag };

  let listBody, listCt;
  try {
    const r = await fetchAnyCandidate(src.news.candidates, { referer: src.referer });
    listBody = r.body; listCt = r.contentType; diag.listUrl = r.url;
  } catch (e) {
    diag.notes.push(`news list fetch failed: ${e.message}`);
    return { lives: [], diag };
  }

  let items = [];
  try {
    items = parseNewsList(listBody, listCt, src.news.detailPathRe);
  } catch (e) {
    diag.notes.push(`news list parse failed: ${e.message}`);
    return { lives: [], diag };
  }
  diag.candidates = items.length;

  const targets = items.filter(it => looksLikeTourAnnouncement(it.title)).slice(0, NEWS_MAX_DETAILS);
  diag.matched = targets.length;
  if (targets.length === 0) {
    diag.notes.push('no tour-announcement titles matched');
    return { lives: [], diag };
  }

  const lives = [];
  for (const it of targets) {
    const url = src.news.detail(it.id);
    try {
      const { body } = await fetchResource(url, { referer: src.referer });
      const text  = htmlToText(body);
      const perfs = extractPerformances(text).filter(p => p.venue);
      if (perfs.length === 0) {
        // 実ページの構造が想定と違う可能性が高いので、原因追跡用に抜粋を残す
        const d = buildFailureDiagnostic(text);
        diag.notes.push(
          `${it.id}: no dated performances with venue ` +
          `(dates=${d.dateHits}, venues=${d.venueHits}) | title="${it.title.slice(0, 60)}" | ${d.excerpt}`,
        );
        continue;
      }
      const live = buildProvisionalLive({
        artist: src.artist,
        idPrefix: src.idPrefix,
        newsId: it.id,
        title: it.title,
        url,
        performances: perfs,
        scrapedAt,
      });
      if (live) {
        lives.push(live);
        console.log(`  ↳ [news] provisional: ${live.name} (${live.dateStart}〜${live.dateEnd}, ${perfs.length} perfs)`);
      }
    } catch (e) {
      diag.notes.push(`${it.id}: detail fetch failed: ${e.message}`);
    }
  }
  diag.built = lives.length;
  return { lives, diag };
}

// ---------- main ----------

async function main() {
  const allLives = [];
  const errors = [];
  const provisionalRaw = [];
  const newsDiag = [];
  const scrapedAt = new Date().toISOString();

  for (const src of SOURCES) {
    console.log(`[${src.artist}] trying ${src.candidates.length} URL candidates...`);
    try {
      const { body, contentType, url: workingUrl } =
        await fetchAnyCandidate(src.candidates, { referer: src.referer });

      let lives = [];
      const trimmed = body.trim();
      const looksLikeJson =
        contentType.includes('json') ||
        trimmed.startsWith('{') ||
        trimmed.startsWith('[') ||
        /^[a-zA-Z_][\w$]*\s*\(/.test(trimmed); // JSONP wrapper

      if (looksLikeJson) {
        lives = parseScheduleJson(body, { ...src, url: workingUrl });
      } else {
        lives = parseScheduleHtml(body, { ...src, url: workingUrl });
      }
      console.log(`[${src.artist}] parsed ${lives.length} entries (from ${workingUrl})`);
      allLives.push(...lives);
    } catch (e) {
      console.error(`[${src.artist}] all candidates failed`);
      if (e.details) e.details.forEach(d => console.error(`  - ${d.url} → ${d.error}`));
      errors.push({ artist: src.artist, error: e.message });
    }

    // ニュース欄からの暫定ツアー（失敗しても本体は壊さない）
    try {
      const { lives: newsLives, diag } = await scrapeNewsTours(src, scrapedAt);
      provisionalRaw.push(...newsLives);
      newsDiag.push(diag);
      console.log(`[${src.artist}] news: ${diag.candidates} items, ${diag.matched} matched, ${diag.built} provisional`);
    } catch (e) {
      console.warn(`[${src.artist}] news scan failed: ${e.message}`);
      newsDiag.push({ artist: src.artist, notes: [`unexpected: ${e.message}`] });
    }
  }

  // パースが完全失敗した場合は既存の JSON を維持（空配列で上書きしない）
  // ニュース由来の暫定データだけでは上書きしない — 正式データが 0 件なら中断。
  if (allLives.length === 0) {
    console.warn('No lives parsed from any source. Keeping existing JSON.');
    return;
  }

  // まず暫定同士の重複を畳み、その後に正式データと重複するものを捨てる
  const provisionalUnique = dedupeProvisionals(provisionalRaw);
  const dupDropped = provisionalRaw.length - provisionalUnique.length;
  if (dupDropped > 0) console.log(`Merged ${dupDropped} duplicate provisional entries.`);

  const provisional = dropSupersededProvisionals(allLives, provisionalUnique);
  const dropped = provisionalUnique.length - provisional.length;
  if (dropped > 0) console.log(`Dropped ${dropped} provisional entries superseded by official data.`);
  if (provisional.length > 0) {
    console.log(`Adding ${provisional.length} provisional (news-derived) entries.`);
  }

  // 同じ officialId の重複を除去。
  // 暫定エントリを先に入れ、正式エントリで上書きする（正式データを優先）。
  const byId = new Map();
  for (const l of provisional) byId.set(l.officialId, l);
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
    // ニュース走査の診断。CI ログが読めなくても差分から状況が追える。
    newsScan: newsDiag.length ? newsDiag : undefined,
    lives: deduped,
  };

  // 中身が変わってなければ updatedAt だけ更新しない（不要コミット回避）
  const existingBody = existing && JSON.stringify({ ...existing, updatedAt: null, errors: null, newsScan: null });
  const newBody      = JSON.stringify({ ...out, updatedAt: null, errors: null, newsScan: null });
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
