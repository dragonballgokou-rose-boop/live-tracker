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
import type {
  Live, OfficialLive, OfficialLivesFile, OfficialChildPerformance,
  DiffFieldName, FieldDiff, DiffResult, DiffAddItem,
  DiffUpdateItem, DiffSkipItem, SimilarLocalLive,
} from './types.js';

const OFFICIAL_URL = './official-lives.json';

/**
 * 比較対象のフィールド（officialLive と localLive 間で差分判定する）
 * 注: name と dateStart は「同一性の判定」に使うので diff 対象には入れない。
 *     eventType も tour/live 転換が破壊的なため除外（applyUpdate で誤って
 *     ツアー化すると既存の参戦日程が消えるため、データ構造変更は手動で）
 */
export const DIFF_FIELDS: readonly DiffFieldName[] = [
  'venue',
  'prefecture',
  'dateEnd',
];

/** eventType は日本語/英語が混在するので等価判定を正規化する */
function normalizeEventType(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'ライブ' || s === 'live' || s === 'コンサート' || s === 'concert') return 'live';
  if (s === 'イベント' || s === 'event' || s === 'ミーグリ' || s === '握手') return 'event';
  if (s === 'ツアー' || s === 'tour') return 'tour';
  return s;
}

/** 差分判定: フィールドに応じた正規化を適用した比較 */
function fieldsDiffer(field: DiffFieldName, a: unknown, b: unknown): boolean {
  if (field === 'eventType') {
    return normalizeEventType(a) !== normalizeEventType(b);
  }
  return String(a ?? '').trim() !== String(b ?? '').trim();
}

// ---------- fetch ----------

let _cached: OfficialLivesFile | null = null;

export async function fetchOfficialLives(
  opts: { noCache?: boolean } = {},
): Promise<OfficialLivesFile> {
  if (_cached && !opts.noCache) return _cached;
  const url = `${OFFICIAL_URL}?v=${Date.now()}`; // cache-bust
  const res = await fetch(url);
  if (!res.ok) throw new Error(`公式データの取得に失敗しました (${res.status})`);
  const data = await res.json() as OfficialLivesFile;
  _cached = data;
  return data;
}

// ---------- 正規化 ----------

const ARTIST_PREFIX_RE = /^(?:乃木坂46|櫻坂46|欅坂46|日向坂46|sakurazaka46|nogizaka46)\s*/i;

function normalize(str: unknown): string {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[〜～]/g, '-')
    .replace(/[（）]/g, m => (m === '（' ? '(' : ')'))
    .replace(/[「」『』"']/g, '')
    .replace(/[\s\-_:：、。・／\/]+/g, '');
}

function normalizeName(name: unknown): string {
  if (!name) return '';
  const stripped = String(name).trim().replace(ARTIST_PREFIX_RE, '');
  return normalize(stripped);
}

type LiveLike = Pick<Live, 'name' | 'artist' | 'dateStart' | 'dateEnd' | 'date' | 'officialId'>;

function nameCandidates(live: Pick<LiveLike, 'name'>): string[] {
  const candidates = new Set<string>();
  const rawName = live.name || '';
  candidates.add(normalizeName(rawName));
  candidates.add(normalize(rawName));
  candidates.add(normalize(rawName.replace(/\s*(day\s*\d+|第\d+日|\d+日目)/gi, '')));
  candidates.delete('');
  return [...candidates];
}

function datesOverlap(
  aStart?: string | null, aEnd?: string | null,
  bStart?: string | null, bEnd?: string | null,
): boolean {
  const s1 = (aStart || '').slice(0, 10);
  const e1 = (aEnd || aStart || '').slice(0, 10);
  const s2 = (bStart || '').slice(0, 10);
  const e2 = (bEnd || bStart || '').slice(0, 10);
  if (!s1 || !s2) return false;
  return s1 <= e2 && s2 <= e1;
}

/** あいまい類似検索: 明確な同一ではないが「似ている」ローカルライブを列挙する */
export function findSimilarLocalLives(
  officialLive: OfficialLive, localLives: Live[],
): SimilarLocalLive[] {
  const officialNames = nameCandidates(officialLive);
  const officialArtist = normalize(officialLive.artist);
  const results: SimilarLocalLive[] = [];
  for (const local of localLives) {
    if (isSameLive(local, officialLive)) continue;

    const localArtist = normalize(local.artist);
    if (localArtist && officialArtist && localArtist !== officialArtist) continue;

    const localNames = nameCandidates(local);
    const nameSimilar = localNames.some(ln =>
      officialNames.some(on => {
        if (!ln || !on) return false;
        if (ln === on) return true;
        const shorter = ln.length < on.length ? ln : on;
        const longer  = ln.length < on.length ? on : ln;
        return shorter.length >= 4 && longer.includes(shorter);
      }),
    );
    if (!nameSimilar) continue;

    const lDate = (local.dateStart || local.date || '').slice(0, 10);
    const oDate = (officialLive.dateStart || '').slice(0, 10);
    if (!lDate || !oDate) continue;
    const diffDays = Math.abs((+new Date(lDate) - +new Date(oDate)) / 86400000);
    if (!isFinite(diffDays) || diffDays > 120) continue;

    results.push({ local, diffDays: Math.round(diffDays) });
  }
  return results.sort((a, b) => a.diffDays - b.diffDays);
}

/** 2つのライブが「同じ」と判定できるか */
function isSameLive(localLive: Live, officialLive: OfficialLive): boolean {
  if (localLive.officialId && officialLive.officialId &&
      localLive.officialId === officialLive.officialId) {
    return true;
  }

  const localArtist    = normalize(localLive.artist);
  const officialArtist = normalize(officialLive.artist);
  if (localArtist && officialArtist && localArtist !== officialArtist) return false;

  const localNames    = nameCandidates(localLive);
  const officialNames = nameCandidates(officialLive);
  const nameMatch = localNames.some(ln =>
    officialNames.some(on =>
      ln === on ||
      (ln.length >= 6 && on.includes(ln)) ||
      (on.length >= 6 && ln.includes(on)),
    ),
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
 * ツアー: 公式 children のうち、ローカルにまだ存在しない日程を抽出する。
 * ローカル側の子公演は parentId で紐付いた live を対象にし、dateStart 一致で判定。
 * 既に存在する日程は提案しない（上書き/重複を避ける）。
 */
function findNewOfficialChildren(
  official: OfficialLive, parentLocal: Live, localLives: Live[],
) {
  if (official.eventType !== 'tour' || !Array.isArray(official.children)) return [];
  const existingDates = new Set(
    localLives
      .filter(l => l.parentId === parentLocal.id)
      .map(l => (l.dateStart || '').slice(0, 10))
      .filter(Boolean),
  );
  return official.children.filter(c => {
    const d = (c.dateStart || '').slice(0, 10);
    return d && !existingDates.has(d);
  });
}

export function computeDiff(
  officialLives: OfficialLive[], localLives: Live[],
): DiffResult {
  const toAdd: DiffAddItem[] = [];
  const toUpdate: DiffUpdateItem[] = [];
  const toSkip: DiffSkipItem[] = [];

  for (const official of officialLives) {
    const local = localLives.find(l => isSameLive(l, official));
    if (!local) {
      const similar = findSimilarLocalLives(official, localLives);
      toAdd.push({ official, similar });
      continue;
    }
    const diffs: FieldDiff[] = [];
    for (const field of DIFF_FIELDS) {
      const a = (local as any)[field] ?? '';
      const b = (official as any)[field] ?? '';
      if (fieldsDiffer(field, a, b)) {
        diffs.push({ field, from: a, to: b });
      }
    }
    // ツアー: 公式に新しく追加された子公演があれば差分として扱う
    const newChildren = findNewOfficialChildren(official, local, localLives);

    if (diffs.length === 0 && newChildren.length === 0) {
      toSkip.push({ official, local });
    } else {
      toUpdate.push({ official, local, diffs, newChildren });
    }
  }

  return { toAdd, toUpdate, toSkip };
}

// ---------- 反映 ----------

/**
 * ツアー親 (local) に、公式から新しく追加された children[] を子公演として追加する。
 * 既存の local 子公演は触らない。
 */
export function applyNewTourChildren(
  parent: Live, official: OfficialLive, children: OfficialChildPerformance[],
): number {
  let n = 0;
  for (const c of children) {
    if (!c.dateStart) continue;
    addLive({
      name:       official.name,
      artist:     official.artist       ?? parent.artist ?? null,
      venue:      c.venue               ?? null,
      prefecture: c.prefecture          ?? null,
      dateStart:  c.dateStart,
      dateEnd:    c.dateEnd ?? c.dateStart,
      eventType:  'live',
      iconImg:    official.iconImg      ?? null,
      parentId:   parent.id,
      memo:       c.dayLabel ? `${c.dayLabel}` : null,
      officialId: official.officialId
        ? `${official.officialId}-${c.dateStart}`
        : null,
    });
    n++;
  }
  return n;
}

/**
 * 公式の単発ライブをローカルの既存ツアーの子公演として追加する。
 * 例: 「真夏の全国ツアー2025」がローカルにツアー登録済みで、
 *     「真夏の全国ツアー2025 ~ツアーファイナル~」が公式から別エントリで来た場合に
 *     これを呼んで parentId で紐付ける。
 */
export function applyAdditionAsChild(official: OfficialLive, parentTour: Live): Live {
  return addLive({
    name:       official.name,
    artist:     official.artist       ?? parentTour.artist ?? null,
    venue:      official.venue        ?? null,
    prefecture: official.prefecture   ?? null,
    dateStart:  official.dateStart    ?? null,
    dateEnd:    official.dateEnd      ?? null,
    eventType:  'live',
    iconImg:    official.iconImg      ?? null,
    parentId:   parentTour.id,
    memo:       buildEvidenceMemo(official),
    officialId: official.officialId   ?? null,
  });
}

/**
 * 公式ライブの名前が、ローカルにある既存ツアーの名前で始まるかを調べて
 * 「追加公演として入れられる」候補のツアーを返す。
 * 例: ローカルに tour 「真夏の全国ツアー2025」があり、
 *     official.name が 「真夏の全国ツアー2025 ~ツアーファイナル~」なら match。
 * - 公式自体がツアー(children持ち)の場合は候補としない（親に親はない）
 * - 複数該当する時は最も長い（= より具体的な）名前の tour を優先
 */
export function findCandidateTourParent(official: OfficialLive, localLives: Live[]): Live | null {
  if (official.eventType === 'tour') return null;
  const oName = (official.name || '').trim();
  if (!oName) return null;
  const oArtist = normalize(official.artist);

  const matches = localLives.filter(l => {
    if (l.eventType !== 'tour') return false;
    const ln = (l.name || '').trim();
    if (!ln || ln.length >= oName.length) return false;
    if (!oName.startsWith(ln)) return false;
    // suffix が空白・記号で始まる（本当に拡張された名前）ことを軽く確認
    const suffix = oName.slice(ln.length);
    if (!/^[\s〜~\-_（(【「『]/.test(suffix)) return false;
    // アーティストが両方ある時だけ一致必須
    const la = normalize(l.artist);
    if (oArtist && la && oArtist !== la) return false;
    return true;
  });

  return matches.sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0))[0] || null;
}

/**
 * 公式の新規ライブをローカルに追加する。
 * officialId を保存して将来の再照合に使えるようにする。
 * ツアー（children 付き）の場合は親 tour + 子 live をまとめて登録する。
 */
export function applyAddition(official: OfficialLive): Live {
  const parent = addLive({
    name:       official.name,
    artist:     official.artist       ?? null,
    venue:      official.venue        ?? null,
    prefecture: official.prefecture   ?? null,
    dateStart:  official.dateStart    ?? null,
    dateEnd:    official.dateEnd      ?? null,
    eventType:  (official.eventType   ?? 'live') as string,
    iconImg:    official.iconImg      ?? null,
    memo:       buildEvidenceMemo(official),
    officialId: official.officialId   ?? null,
  });

  // ツアー(children 2件以上) の場合、子公演をそれぞれ個別の live として追加して parentId で繋ぐ
  if (Array.isArray(official.children) && official.children.length > 0) {
    for (const child of official.children) {
      addLive({
        name:       official.name, // 同じ名前を継承（表示はツアー側でラベル補助）
        artist:     official.artist       ?? null,
        venue:      child.venue           ?? null,
        prefecture: child.prefecture      ?? null,
        dateStart:  child.dateStart,
        dateEnd:    child.dateEnd ?? child.dateStart,
        eventType:  'live',
        iconImg:    official.iconImg      ?? null,
        parentId:   parent.id,
        memo:       child.dayLabel ? `${child.dayLabel}` : null,
        officialId: official.officialId
          ? `${official.officialId}-${child.dateStart}`
          : null,
      });
    }
  }

  return parent;
}

/**
 * ローカルのライブを公式データで部分更新する。
 * 選択された field のみ上書き（全上書きではない）。
 */
export function applyUpdate(
  localLive: Live, official: OfficialLive, fieldsToApply: string[],
): Live | null {
  const updates: Partial<Live> = {};
  for (const field of fieldsToApply) {
    (updates as any)[field] = (official as any)[field] ?? null;
  }
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
export function mergeIntoExisting(localLive: Live, official: OfficialLive): Live | null {
  const updates: Partial<Live> = {};
  const fillIfEmpty = <K extends keyof Live>(field: K, value: Live[K] | undefined) => {
    const cur = localLive[field];
    if ((cur == null || cur === '') && value) {
      (updates as any)[field] = value;
    }
  };
  fillIfEmpty('artist',     official.artist);
  fillIfEmpty('venue',      official.venue);
  fillIfEmpty('prefecture', official.prefecture);
  fillIfEmpty('dateStart',  official.dateStart);
  fillIfEmpty('dateEnd',    official.dateEnd);
  fillIfEmpty('eventType',  official.eventType);
  fillIfEmpty('iconImg',    official.iconImg);

  updates.memo       = appendEvidenceMemo(localLive.memo, official);
  updates.officialId = localLive.officialId || official.officialId || null;

  return updateLive(localLive.id, updates);
}

// ---------- evidence memo ----------

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  } catch {
    return String(iso).slice(0, 10);
  }
}

function buildEvidenceMemo(official: OfficialLive): string {
  const src = official.sourceUrl || '';
  const at  = formatDate(official.scrapedAt);
  const oid = official.officialId ? `\n[official-id:${official.officialId}]` : '';
  return `[公式データ由来] ${at} 取得\nソース: ${src}${oid}`;
}

function appendEvidenceMemo(existing: string | null | undefined, official: OfficialLive): string {
  const oidTag = official.officialId ? ` [official-id:${official.officialId}]` : '';
  const note = `[公式データ由来] ${formatDate(official.scrapedAt)} 取得 — ${official.sourceUrl || ''}${oidTag}`;
  if (!existing) return note;
  if (official.officialId && existing.includes(`[official-id:${official.officialId}]`)) return existing;
  if (!official.officialId && existing.includes('[公式データ由来]')) return existing;
  return `${existing}\n${note}`;
}
