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

function normalize(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    // 全角→半角の軽微な正規化
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 記号統一
    .replace(/[〜～]/g, '-')
    .replace(/[（）]/g, m => (m === '（' ? '(' : ')'));
}

function matchKey(live) {
  const name = normalize(live.name);
  const date = (live.dateStart || live.date || '').slice(0, 10);
  const artist = normalize(live.artist);
  return `${artist}|${name}|${date}`;
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
  const localByKey = new Map();
  for (const live of localLives) {
    localByKey.set(matchKey(live), live);
  }

  const toAdd = [];
  const toUpdate = [];
  const toSkip = [];

  for (const official of officialLives) {
    const key = matchKey(official);
    const local = localByKey.get(key);
    if (!local) {
      toAdd.push({ official });
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
    eventType:  official.eventType    ?? 'ライブ',
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
