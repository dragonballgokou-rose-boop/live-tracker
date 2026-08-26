// ============================================
// ニュース欄からの「発表済みツアー」抽出（純粋関数のみ）
// ============================================
// 公式のライブ一覧 API (/api/list/live) は、ライブ個別ページが作られるまで
// 公演を返さない。一方ツアーの開催決定はニュース欄で先に告知される。
// （例: 6期生全国ツアー2026 は news/detail/102198 で告知されたが、
//   チケット先行が始まるまで live API には現れなかった）
//
// このモジュールはニュース本文から公演日程・会場を「暫定的に」抽出する。
// ネットワークアクセスは行わないので単体テストできる。
//   → scripts/test-news-tours.mjs で検証

/** 都道府県。ラベル「【神奈川公演】」等から推定するのに使う */
const PREFECTURES = [
  '北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島',
  '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
  '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知',
  '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
  '鳥取', '島根', '岡山', '広島', '山口',
  '徳島', '香川', '愛媛', '高知',
  '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄',
];

/** 会場名に含まれがちな語。行が会場行かどうかの判定に使う */
const VENUE_KEYWORDS =
  /(Zepp|ゼップ|アリーナ|ARENA|ドーム|DOME|ホール|HALL|会館|スタジアム|STADIUM|劇場|シアター|THEATER|THEATRE|フォーラム|メッセ|コロシアム|体育館|武道館|プラザ|文化センター|市民会館|県民|サンドーム|ガーデン|Garden|グランド|パーク)/i;

/** ツアー/ライブ告知っぽいニュースかの判定に使う語 */
const LIVE_WORDS   = /(ツアー|TOUR|LIVE|ライブ|コンサート|CONCERT|公演)/i;
const DECIDE_WORDS = /(開催決定|開催が決定|公演決定|開催determined|開催)/;
/** 明らかに日程告知ではないニュース */
const EXCLUDE_WORDS =
  /(グッズ|物販|配信決定|放送|生配信|中止|延期|払い戻し|払戻|再販|アーカイブ|ダイジェスト|レポート|写真集|CD|シングル発売|アルバム発売)/;

/**
 * HTML をプレーンテキストへ。改行構造は保持する（告知は行単位で意味を持つため）。
 * NFKC 正規化で全角数字や康熙部首（⽊ → 木）も揃える。
 */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .normalize('NFKC')
    .replace(/[ \t　]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** ニュースのタイトルが「ツアー/ライブの日程告知」らしいか */
export function looksLikeTourAnnouncement(title) {
  const t = String(title || '').normalize('NFKC').trim();
  if (!t) return false;
  if (EXCLUDE_WORDS.test(t)) return false;
  if (!LIVE_WORDS.test(t)) return false;
  return DECIDE_WORDS.test(t);
}

/** 「【神奈川公演】」「＜大阪公演＞」等から都道府県を推定 */
export function inferPrefecture(line) {
  const s = String(line || '').normalize('NFKC');
  for (const p of PREFECTURES) {
    // ラベル内、または「〇〇公演」の形で登場するもののみ採用
    const re = new RegExp(`[【\\[<＜(（]?\\s*${p}(?:都|府|県)?\\s*公演`);
    if (re.test(s)) return p === '北海道' ? '北海道' : suffixed(p);
  }
  return null;
}

function suffixed(p) {
  if (p === '東京') return '東京都';
  if (p === '大阪' || p === '京都') return `${p}府`;
  if (p === '北海道') return '北海道';
  return `${p}県`;
}

/** 会場行らしいか */
export function looksLikeVenue(line) {
  const s = String(line || '').trim();
  if (!s || s.length > 40) return false;
  if (/(開場|開演|受付|発売|チケット|問い合わせ|お問合せ)/.test(s)) return false;
  return VENUE_KEYWORDS.test(s);
}

/**
 * 1 行から公演日を抜き出す。
 * 「2026年10月26日(月)・27日(火)」のように年月が省略される continuation にも対応。
 * carry は直前に確定した {year, month} を引き継ぐためのもの。
 */
export function extractDatesFromLine(line, carry = {}) {
  const s = String(line || '').normalize('NFKC');
  const dates = [];
  let year = carry.year || null;
  let month = carry.month || null;

  const re = /(?:(\d{4})\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    // 「3日間」「10日前」等は公演日ではない
    const after = s.slice(re.lastIndex, re.lastIndex + 1);
    if (after === '間' || after === '前' || after === '後') continue;

    if (m[1]) year = parseInt(m[1], 10);
    if (m[2]) month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);

    // 年か月が一度も確定していない断片は捨てる（誤検出防止）
    if (!year || !month) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    dates.push(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  return { dates, carry: { year, month } };
}

/**
 * ニュース本文テキストから公演（日程 + 会場）の一覧を抽出する。
 * 返り値: [{ dateStart, dateEnd, dates, venue, prefecture }]
 */
export function extractPerformances(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let carry = {};
  let pendingPref = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const pref = inferPrefecture(line);
    if (pref) pendingPref = pref;

    const { dates, carry: nextCarry } = extractDatesFromLine(line, carry);
    carry = nextCarry;
    if (dates.length === 0) continue;

    // 会場は同じ行、無ければ後続数行から探す
    let venue = looksLikeVenue(line) ? line.trim() : null;
    if (!venue) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const cand = lines[j];
        if (!cand.trim()) continue;
        // 次の日付行に達したら打ち切り
        if (extractDatesFromLine(cand, carry).dates.length > 0) break;
        if (looksLikeVenue(cand)) { venue = cand.trim(); break; }
      }
    }

    const sorted = [...new Set(dates)].sort();
    out.push({
      dates: sorted,
      dateStart: sorted[0],
      dateEnd: sorted[sorted.length - 1],
      venue: venue ? cleanVenue(venue) : null,
      prefecture: pendingPref,
    });
  }

  return dedupePerformances(out);
}

function cleanVenue(s) {
  return String(s)
    .replace(/^[【\[<＜(（]\s*/, '')
    .replace(/\s*[】\]>＞)）]$/, '')
    .replace(/^(会場|場所)\s*[:：]\s*/, '')
    .trim();
}

function dedupePerformances(list) {
  const seen = new Map();
  for (const p of list) {
    const key = `${p.dateStart}_${p.dateEnd}_${p.venue || ''}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()].sort((a, b) => a.dateStart.localeCompare(b.dateStart));
}

/** タイトルから公演名を取り出す（「」内を優先、告知語尾を除去） */
export function extractLiveName(title) {
  const t = String(title || '').normalize('NFKC').trim();
  const quoted = t.match(/[「『"]([^」』"]+)[」』"]/);
  const base = quoted ? quoted[1] : t;
  return base
    .replace(/(開催決定|開催が決定|公演決定)[!！]*\s*$/, '')
    .replace(/[!！]+\s*$/, '')
    .trim();
}

/**
 * 抽出結果から OfficialLive 互換の「暫定」エントリを組み立てる。
 * provisional: true を必ず立て、正式データと区別できるようにする。
 */
export function buildProvisionalLive({
  artist, idPrefix, newsId, title, url, performances, scrapedAt,
}) {
  if (!performances || performances.length === 0) return null;

  const name = extractLiveName(title);
  if (!name) return null;

  const allDates = performances.flatMap(p => p.dates).sort();
  const dateStart = allDates[0];
  const dateEnd   = allDates[allDates.length - 1];
  if (!dateStart) return null;

  const venues = new Set(performances.map(p => p.venue).filter(Boolean));
  const isTour = venues.size > 1;

  const base = {
    officialId: `${idPrefix}-news${newsId}-${slug(name)}`,
    artist,
    name: name.startsWith(artist) ? name : `${artist} ${name}`,
    venue: isTour ? null : (performances[0].venue || null),
    prefecture: isTour ? null : (performances[0].prefecture || null),
    dateStart,
    dateEnd,
    eventType: isTour ? 'tour' : 'live',
    iconImg: null,
    sourceUrl: url,
    scrapedAt,
    // --- ニュース由来であることを示すマーカー ---
    provisional: true,
    sourceType: 'news',
  };

  if (isTour) {
    base.children = performances.map(p => ({
      dateStart: p.dateStart,
      dateEnd: p.dateEnd,
      venue: p.venue || null,
      prefecture: p.prefecture || null,
    }));
  }

  return base;
}

function slug(s) {
  return String(s)
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .slice(0, 40) || 'x';
}

/** 照合用の名前正規化（空白・記号・年号表記ゆれを吸収） */
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[「」『』"'()（）【】\-–—~〜!！?？.,、。/／]/g, '');
}

/**
 * 暫定エントリのうち、正式（API 由来）エントリと重複するものを除外する。
 * 「同じアーティストで名前が一致 or 一方が他方を含む」なら正式側を優先。
 */
export function dropSupersededProvisionals(officialLives, provisionalLives) {
  const kept = [];
  for (const prov of provisionalLives) {
    const pn = normalizeName(prov.name);
    const superseded = officialLives.some(off => {
      if (off.artist !== prov.artist) return false;
      const on = normalizeName(off.name);
      if (!on || !pn) return false;
      return on === pn || on.includes(pn) || pn.includes(on);
    });
    if (!superseded) kept.push(prov);
  }
  return kept;
}

function cleanInline(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ニュース一覧レスポンス（JSON / JSONP / HTML のいずれか）から
 * {id, title} の配列を取り出す。
 *
 * 公式 CMS のレスポンス形状は不明・変わりうるので、
 * よくあるキー名を順に試し、駄目なら HTML 内の detail リンクから拾う。
 */
export function parseNewsList(body, contentType = '', detailPathRe = null) {
  const trimmed = String(body || '').trim();
  const ct = String(contentType || '').toLowerCase();
  const looksJson =
    ct.includes('json') ||
    trimmed.startsWith('{') || trimmed.startsWith('[') ||
    /^[a-zA-Z_][\w$]*\s*\([\s\S]*\)\s*;?$/.test(trimmed);

  if (looksJson) {
    let text = trimmed;
    const jsonp = text.match(/^[a-zA-Z_][\w$]*\s*\(([\s\S]*)\)\s*;?$/);
    if (jsonp) text = jsonp[1];
    try {
      const data = JSON.parse(text);
      const list = Array.isArray(data)
        ? data
        : (data.list || data.data || data.items || data.result || data.results || data.news || []);
      if (Array.isArray(list) && list.length) {
        const mapped = list
          .map(it => ({
            id: String(it.code ?? it.id ?? it.newsId ?? it.no ?? '').trim(),
            title: cleanInline(it.title ?? it.subject ?? it.name ?? ''),
          }))
          .filter(it => it.id && it.title);
        if (mapped.length) return mapped;
      }
    } catch { /* HTML フォールバックへ落ちる */ }
  }

  if (!detailPathRe) return [];

  const out = [];
  const seen = new Set();
  const re = new RegExp(detailPathRe.source, 'g');
  let m;
  while ((m = re.exec(body)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = cleanInline(String(body).slice(m.index, m.index + 400)).slice(0, 120);
    if (title) out.push({ id, title });
  }
  return out;
}
