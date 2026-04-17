// ============================================
// Official Lives — fetch + diff logic
// ============================================
// 公式ライブ情報（GitHub Actions で毎日更新される JSON）を
// ローカル DB の lives と比較し、新規/差分/一致に分類する。
//
// 重要ポリシー:
//   ・ローカルのライブを勝手に削除しない
//   ・自動上書きもしない — 必ずユーザーが確認してから反映

import { getLives, addLive, updateLive } from './store.js';

const OFFICIAL_URL = './official-lives.json';

// 比較対象のフィールド（officialLive と localLive 間で差分判定する）
// 注: name と dateStart は「同一性の判定」に使うので diff 対象には入れない
export const DIFF_FIELDS = [
  'venue',
  'prefecture',
  'dateEnd',
  'eventType',
];

// ---------- fetch ----------

let _cached = null;
export async function fetchOfficialLives({ noCache = false } = {}) {
  if (_cached && !noCache) return _cached;
  const url = `${OFFICIAL_URL}?v=${Date.now()}`; // cache-bust
  const res = await fetch(url);
  if (!res.ok) throw new Error(`公式データの取得に失敗しました (${res.status})`);
  const data = await res.json();
  _cached = data;
  return data;
}

// ---------- 正規化 ----------

// よく混入するアーティスト名のプレフィックス候補
const ARTIST_PREFIX_RE = /^(?:乃木坂46|櫻坂46|欅坂46|日向坂46|sakurazaka46|nogizaka46)\s*/i;

function normalize(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    // 全角→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 記号統一
    .replace(/[〜～]/g, '-')
    .replace(/[（）]/g, m => (m === '（' ? '(' : ')'))
    .replace(/[「」『』"']/g, '')
    // 空白・区切り記号を除去（マッチング用）
    .replace(/[\s\-_:：、。・／\/]+/g, '');
}

/** アーティスト名プレフィックスをタイトルから取り除いた形で正規化する */
function normalizeName(name) {
  if (!name) return '';
  const stripped = String(name).trim().replace(ARTIST_PREFIX_RE, '');
  return normalize(stripped);
}

/** 「一致候補」をいくつか作る — 同じライブでもフィールドのズレを吸収 */
function nameCandidates(live) {
  const candidates = new Set();
  const rawName = live.name || '';
  candidates.add(normalizeName(rawName));
  candidates.add(normalize(rawName));
  // サブタイトルや日数表記 (Day1/Day2) を削った形も候補に
  candidates.add(normalize(rawName.replace(/\s*(day\s*\d+|第\d+日|\d+日目)/gi, '')));
  candidates.delete('');
  return [...candidates];
}

/** 日付範囲が重なるかチェック（date range overlap） */
function datesOverlap(aStart, aEnd, bStart, bEnd) {
  const s1 = (aStart || '').slice(0, 10);
  const e1 = (aEnd   || aStart || '').slice(0, 10);
  const s2 = (bStart || '').slice(0, 10);
  const e2 = (bEnd   || bStart || '').slice(0, 10);
  if (!s1 || !s2) return false;
  return s1 <= e2 && s2 <= e1;
}

/** あいまい類似検索: 明確な同一ではないが「似ている」ローカルライブを列挙する */
export function findSimilarLocalLives(officialLive, localLives) {
  const officialNames = nameCandidates(officialLive);
  const officialArtist = normalize(officialLive.artist);
  const results = [];
  for (const local of localLives) {
    // 厳密な「同じ」は別タブで扱うので除外
    if (isSameLive(local, officialLive)) continue;

    const localArtist = normalize(local.artist);
    // アーティストが両方あって違えば非類似
    if (localArtist && officialArtist && localArtist !== officialArtist) continue;

    const localNames = nameCandidates(local);
    // タイトルに 4文字以上の共通部分があれば「似てる」とみなす
    const nameSimilar = localNames.some(ln =>
      officialNames.some(on => {
        if (!ln || !on) return false;
        if (ln === on) return true;
        const shorter = ln.length < on.length ? ln : on;
        const longer  = ln.length < on.length ? on : ln;
        return shorter.length >= 4 && longer.includes(shorter);
      })
    );
    if (!nameSimilar) continue;

    // 日付が近い (90日以内) か、一方が同じ年・月か
    const lDate = (local.dateStart || local.date || '').slice(0, 10);
    const oDate = (officialLive.dateStart || '').slice(0, 10);
    if (!lDate || !oDate) continue;
    const diffDays = Math.abs((new Date(lDate) - new Date(oDate)) / 86400000);
    if (!isFinite(diffDays) || diffDays > 120) continue;

    results.push({ local, diffDays: Math.round(diffDays) });
  }
  return results.sort((a, b) => a.diffDays - b.diffDays);
}

/** 2つのライブが「同じ」と判定できるか */
function isSameLive(localLive, officialLive) {
  const localArtist    = normalize(localLive.artist);
  const officialArtist = normalize(officialLive.artist);
  // アーティスト片方でも空なら無視、両方あれば一致してる必要
  if (localArtist && officialArtist && localArtist !== officialArtist) return false;

  const localNames    = nameCandidates(localLive);
  const officialNames = nameCandidates(officialLive);
  // 名前候補のどれか1ペアが一致するか、substring 関係にあれば OK
  const nameMatch = localNames.some(ln =>
    officialNames.some(on =>
      ln === on ||
      (ln.length >= 6 && on.includes(ln)) ||
      (on.length >= 6 && ln.includes(on))
    )
  );
  if (!nameMatch) return false;

  return datesOverlap(
    localLive.dateStart || localLive.date,
    localLive.dateEnd   || localLive.date,
    officialLive.dateStart,
    officialLive.dateEnd,
  );
}

// ---------- diff ----------

/**
 * @returns {{
 *   toAdd:    Array<{ official }>,
 *   toUpdate: Array<{ official, local, diffs: Array<{ field, from, to }> }>,
 *   toSkip:   Array<{ official, local }>,
 * }}
 */
export function computeDiff(officialLives, localLives) {
  const toAdd = [];
  const toUpdate = [];
  const toSkip = [];

  for (const official of officialLives) {
    // localLives を全走査してマッチ探索（柔軟マッチ優先）
    const local = localLives.find(l => isSameLive(l, official));
    if (!local) {
      // 厳密には一致しないが類似したローカルライブがあれば警告用に添える
      const similar = findSimilarLocalLives(official, localLives);
      toAdd.push({ official, similar });
      continue;
    }
    const diffs = [];
    for (const field of DIFF_FIELDS) {
      const a = local[field] ?? '';
      const b = official[field] ?? '';
      if (String(a).trim() !== String(b).trim()) {
        diffs.push({ field, from: a, to: b });
      }
    }
    if (diffs.length === 0) {
      toSkip.push({ official, local });
    } else {
      toUpdate.push({ official, local, diffs });
    }
  }

  return { toAdd, toUpdate, toSkip };
}

// ---------- 反映 ----------

/**
 * 公式の新規ライブをローカルに追加する。
 * officialId を保存して将来の再照合に使えるようにする。
 */
export function applyAddition(official) {
  return addLive({
    name:       official.name,
    artist:     official.artist       ?? null,
    venue:      official.venue        ?? null,
    prefecture: official.prefecture   ?? null,
    dateStart:  official.dateStart    ?? null,
    dateEnd:    official.dateEnd      ?? null,
    eventType:  official.eventType    ?? 'live',
    iconImg:    official.iconImg      ?? null,
    memo:       buildEvidenceMemo(official),
    officialId: official.officialId   ?? null,
  });
}

/**
 * ローカルのライブを公式データで部分更新する。
 * 選択された field のみ上書き（全上書きではない）。
 */
export function applyUpdate(localLive, official, fieldsToApply) {
  const updates = {};
  for (const field of fieldsToApply) {
    updates[field] = official[field] ?? null;
  }
  // 既存 memo に根拠追記（上書きしない）
  const appendedMemo = appendEvidenceMemo(localLive.memo, official);
  if (appendedMemo !== localLive.memo) updates.memo = appendedMemo;
  updates.officialId = localLive.officialId || official.officialId || null;

  return updateLive(localLive.id, updates);
}

/**
 * 類似警告された既存ローカルライブに、公式データをマージして統合する。
 * - 空のフィールドは公式で埋める
 * - 既存値がある場合は既存優先（勝手に上書きしない）
 * - iconImg / 根拠 memo は追記
 */
export function mergeIntoExisting(localLive, official) {
  const updates = {};
  // 空フィールドだけ埋める戦略
  const fillIfEmpty = (field, value) => {
    const cur = localLive[field];
    if ((cur == null || cur === '') && value) updates[field] = value;
  };
  fillIfEmpty('artist', official.artist);
  fillIfEmpty('venue', official.venue);
  fillIfEmpty('prefecture', official.prefecture);
  fillIfEmpty('dateStart', official.dateStart);
  fillIfEmpty('dateEnd', official.dateEnd);
  fillIfEmpty('eventType', official.eventType);
  fillIfEmpty('iconImg', official.iconImg);

  updates.memo       = appendEvidenceMemo(localLive.memo, official);
  updates.officialId = localLive.officialId || official.officialId || null;

  return updateLive(localLive.id, updates);
}

// ---------- 根拠（evidence）記録 ----------

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  } catch { return iso.slice(0, 10); }
}

function buildEvidenceMemo(official) {
  const src = official.sourceUrl || '';
  const at  = formatDate(official.scrapedAt);
  return `[公式データ由来] ${at} 取得\nソース: ${src}`;
}

function appendEvidenceMemo(existing, official) {
  const note = `[公式データ由来] ${formatDate(official.scrapedAt)} 取得 — ${official.sourceUrl || ''}`;
  if (!existing) return note;
  if (existing.includes('[公式データ由来]')) return existing; // 既に記録済み
  return `${existing}\n${note}`;
}
