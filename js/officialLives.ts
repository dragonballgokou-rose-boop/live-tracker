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
  ChildReconcileItem, ChildReconcileField,
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

/** 差分判定: フィールドに応じた正規化を適用した比較
 *  ルール: ローカルに値があって公式が空/null なら「差分」とはみなさない。
 *  （公式に情報が無いだけでローカルを空にするのは破壊的なので提案しない）
 */
function fieldsDiffer(field: DiffFieldName, a: unknown, b: unknown): boolean {
  if (field === 'eventType') {
    return normalizeEventType(a) !== normalizeEventType(b);
  }
  const aStr = String(a ?? '').trim();
  const bStr = String(b ?? '').trim();
  // ローカルに値があるのに公式が空 → 上書き提案しない
  if (aStr && !bStr) return false;
  return aStr !== bStr;
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
 * レグ形式（dateStart〜dateEnd）にも対応するため、範囲重なり判定で存在チェック。
 * 既に重なる日程が 1 日でもあれば既存扱いとして提案しない。
 */
function findNewOfficialChildren(
  official: OfficialLive, parentLocal: Live, localLives: Live[],
) {
  if (official.eventType !== 'tour' || !Array.isArray(official.children)) return [];
  const existingRanges = localLives
    .filter(l => l.parentId === parentLocal.id)
    .map(l => ({
      start: (l.dateStart || l.date || '').slice(0, 10),
      end:   (l.dateEnd   || l.dateStart || l.date || '').slice(0, 10),
    }))
    .filter(r => r.start);
  return official.children.filter(c => {
    const s = (c.dateStart || '').slice(0, 10);
    const e = (c.dateEnd   || c.dateStart || '').slice(0, 10);
    if (!s) return false;
    // 既存レンジのいずれかと1日でも重なれば "既存"
    const overlaps = existingRanges.some(r => s <= r.end && r.start <= e);
    return !overlaps;
  });
}

/**
 * ツアー: 公式 child と日付重なりのある既存 local 子公演を突き合わせ、
 * venue / prefecture / dateEnd / 時刻 / dayTimes が空または不足している
 * ものを「補完で埋められる」候補として返す。
 *
 * 典型ケース: 昔のスクレイプで venue=null, dateEnd=dateStart で作られた
 * 子が残っており、現在の公式には venue と 2days の dateEnd が揃っている。
 *
 * 1 つの公式 child に 2 以上の local 子が重なる場合は競合とみなし提案しない。
 */
function findChildrenToReconcile(
  official: OfficialLive, parentLocal: Live, localLives: Live[],
): ChildReconcileItem[] {
  if (official.eventType !== 'tour' || !Array.isArray(official.children)) return [];
  const localChildren = localLives.filter(l => l.parentId === parentLocal.id);
  const results: ChildReconcileItem[] = [];
  for (const c of official.children) {
    const s = (c.dateStart || '').slice(0, 10);
    const e = (c.dateEnd   || c.dateStart || '').slice(0, 10);
    if (!s) continue;
    const matches = localChildren.filter(l => {
      const ls = (l.dateStart || l.date || '').slice(0, 10);
      const le = (l.dateEnd   || l.dateStart || l.date || '').slice(0, 10);
      if (!ls) return false;
      return ls <= e && s <= le;
    });
    if (matches.length !== 1) continue;
    const localChild = matches[0];
    const fieldsToFill: ChildReconcileField[] = [];
    if (!localChild.venue      && !!c.venue)      fieldsToFill.push('venue');
    if (!localChild.prefecture && !!c.prefecture) fieldsToFill.push('prefecture');
    const localEnd = (localChild.dateEnd || localChild.dateStart || localChild.date || '').slice(0, 10);
    if (e && localEnd && localEnd < e)            fieldsToFill.push('dateEnd');
    if (!localChild.openTime   && !!c.openTime)   fieldsToFill.push('openTime');
    if (!localChild.startTime  && !!c.startTime)  fieldsToFill.push('startTime');
    if ((!localChild.dayTimes || localChild.dayTimes.length === 0)
        && Array.isArray(c.dayTimes) && c.dayTimes.length > 0) {
      fieldsToFill.push('dayTimes');
    }
    if (fieldsToFill.length > 0) {
      results.push({ localChild, officialChild: c, fieldsToFill });
    }
  }
  return results;
}

/** 単一の child reconciliation を反映する */
export function applyChildReconciliation(item: ChildReconcileItem): Live | null {
  const { localChild, officialChild: c, fieldsToFill } = item;
  const updates: Partial<Live> = {};
  for (const f of fieldsToFill) {
    if      (f === 'venue')      updates.venue      = c.venue      ?? null;
    else if (f === 'prefecture') updates.prefecture = c.prefecture ?? null;
    else if (f === 'dateEnd')    updates.dateEnd    = c.dateEnd    ?? c.dateStart ?? null;
    else if (f === 'openTime')   updates.openTime   = c.openTime   ?? null;
    else if (f === 'startTime')  updates.startTime  = c.startTime  ?? null;
    else if (f === 'dayTimes')   updates.dayTimes   = c.dayTimes   ?? null;
  }
  return updateLive(localChild.id, updates);
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
    // ツアー: 既存のローカル子公演で公式と重なるが venue/dateEnd 等が不足しているもの
    const childUpdates = findChildrenToReconcile(official, local, localLives);

    // 種別が違う場合は差分扱い（ユーザーがモーダルで種別を切替できるように toUpdate に流す）
    // 常にではなく、実際にアクションが必要そうな時のみフラグする:
    //   - 公式がツアーでローカルが非ツアー（ツアー化候補）
    //   - ローカルと公式の両方が明示設定されていて違う時
    // 例外: ローカルが 'stage'（舞台）は ユーザーが明示的に選んだ結果なので
    //       通常は再プロンプトしないが、venue/時刻などが空で公式から埋められる
    //       場合のみ 差分あり に出して吸収できるようにする
    const localType    = normalizeEventType(local.eventType);
    const officialType = normalizeEventType(official.eventType);
    const userExplicitStage = localType === 'stage';
    const firstChild = Array.isArray(official.children) ? official.children[0] : null;
    const canAbsorbVenue =
      userExplicitStage &&
      officialType === 'tour' &&
      (
        (!local.venue      && !!firstChild?.venue) ||
        (!local.prefecture && !!firstChild?.prefecture)
      );
    const typeMismatch = (
      !userExplicitStage && (
        (officialType === 'tour' && localType !== 'tour') ||
        (!!officialType && !!localType && localType !== officialType)
      )
    ) || canAbsorbVenue;

    if (diffs.length === 0 && newChildren.length === 0 && childUpdates.length === 0 && !typeMismatch) {
      toSkip.push({ official, local });
    } else {
      toUpdate.push({ official, local, diffs, newChildren, canAbsorbVenue, childUpdates });
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
      openTime:   c.openTime            ?? null,
      startTime:  c.startTime           ?? null,
      dayTimes:   c.dayTimes            ?? null,
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
    openTime:   official.openTime     ?? null,
    startTime:  official.startTime    ?? null,
    dayTimes:   official.dayTimes     ?? null,
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
 *
 * @param eventTypeOverride ユーザーが同期モーダルで選び直した種別。
 *   指定がない場合は official.eventType を使う。
 *   'stage'（舞台）を選んだ場合、親の種別のみ上書きし子公演は 'live' のまま。
 */
export function applyAddition(official: OfficialLive, eventTypeOverride?: string | null): Live {
  const effectiveType = (eventTypeOverride || official.eventType || 'live') as string;
  // ツアーを舞台/ライブ/イベントに切り替えた場合:
  //   公式ツアー親は venue が null だが、舞台は会場固定の公演なので
  //   最初の child の venue/prefecture/時刻を親に吸収して情報欠落を防ぐ
  const absorbingTourIntoSingle =
    official.eventType === 'tour' &&
    effectiveType !== 'tour' &&
    Array.isArray(official.children) && official.children.length > 0;
  const firstChild = absorbingTourIntoSingle ? official.children![0] : null;

  const parent = addLive({
    name:       official.name,
    artist:     official.artist       ?? null,
    venue:      firstChild?.venue     ?? official.venue        ?? null,
    prefecture: firstChild?.prefecture?? official.prefecture   ?? null,
    dateStart:  official.dateStart    ?? null,
    dateEnd:    official.dateEnd      ?? null,
    eventType:  effectiveType,
    iconImg:    official.iconImg      ?? null,
    openTime:   firstChild?.openTime  ?? official.openTime     ?? null,
    startTime:  firstChild?.startTime ?? official.startTime    ?? null,
    dayTimes:   (absorbingTourIntoSingle
                  ? official.children!
                      .filter(c => c.openTime || c.startTime)
                      .map(c => ({
                        date: c.dateStart,
                        openTime: c.openTime || undefined,
                        startTime: c.startTime || undefined,
                      }))
                  : official.dayTimes) ?? null,
    memo:       buildEvidenceMemo(official),
    officialId: official.officialId   ?? null,
  });

  // ツアー(children 2件以上) の場合、子公演をそれぞれ個別の live として追加して parentId で繋ぐ
  // 舞台などへユーザーが種別変更した場合、children は親に紐づけず展開しない
  const keepTourChildren = effectiveType === 'tour';
  if (keepTourChildren && Array.isArray(official.children) && official.children.length > 0) {
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
        openTime:   child.openTime        ?? null,
        startTime:  child.startTime       ?? null,
        dayTimes:   child.dayTimes        ?? null,
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
 *
 * ライブ→ツアーへの種別変更時（eventTypeOverride === 'tour'）:
 * - 既存の venue / prefecture はツアー親には不要なので null に畳む
 *   （各公演は children 側に残る）
 * - 公式に children があればそれを子ライブとして追加して parentId で紐付ける
 *   （既に parentId で紐づく子がある場合は重複追加しないよう date 範囲で判定）
 */
export function applyUpdate(
  localLive: Live, official: OfficialLive, fieldsToApply: string[],
  eventTypeOverride?: string | null,
): Live | null {
  const updates: Partial<Live> = {};
  for (const field of fieldsToApply) {
    (updates as any)[field] = (official as any)[field] ?? null;
  }
  if (eventTypeOverride) {
    (updates as any).eventType = eventTypeOverride;
  }
  const wasNotTour = localLive.eventType !== 'tour';
  const becomingTour = eventTypeOverride === 'tour';
  if (becomingTour && wasNotTour) {
    // ツアー親は venue を持たない想定。既存 venue/prefecture は children へ委譲
    (updates as any).venue      = null;
    (updates as any).prefecture = null;
    (updates as any).openTime   = null;
    (updates as any).startTime  = null;
    (updates as any).dayTimes   = null;
  }

  // 公式がツアー(children持ち) なのにユーザーが舞台/ライブ/イベント に
  // 切り替えた場合、親の venue が空のまま残らないよう children から吸収する。
  // これで「同じ劇場の連続公演を 舞台 にした」系の場所情報欠落を防ぐ。
  // eventTypeOverride が無くても（既に 舞台 の item を再反映する場合）吸収する。
  const effectiveType = eventTypeOverride || localLive.eventType;
  const absorbingTourIntoSingle =
    official.eventType === 'tour' &&
    !!effectiveType && effectiveType !== 'tour' &&
    Array.isArray(official.children) && official.children.length > 0;
  if (absorbingTourIntoSingle) {
    const firstChild = official.children![0];
    if (!localLive.venue      && firstChild.venue)      (updates as any).venue      = firstChild.venue;
    if (!localLive.prefecture && firstChild.prefecture) (updates as any).prefecture = firstChild.prefecture;
    if (!localLive.openTime   && firstChild.openTime)   (updates as any).openTime   = firstChild.openTime;
    if (!localLive.startTime  && firstChild.startTime)  (updates as any).startTime  = firstChild.startTime;
    if (!localLive.dayTimes || localLive.dayTimes.length === 0) {
      const dayTimes = official.children!
        .filter(c => c.openTime || c.startTime)
        .map(c => ({
          date: c.dateStart,
          openTime: c.openTime || undefined,
          startTime: c.startTime || undefined,
        }));
      if (dayTimes.length > 0) (updates as any).dayTimes = dayTimes;
    }
  }
  const appendedMemo = appendEvidenceMemo(localLive.memo, official);
  if (appendedMemo !== localLive.memo) updates.memo = appendedMemo;
  updates.officialId = localLive.officialId || official.officialId || null;

  const updated = updateLive(localLive.id, updates);
  if (!updated) return null;

  // ツアーへ変換したら公式 children を子公演として追加
  if (becomingTour && wasNotTour && Array.isArray(official.children) && official.children.length > 0) {
    // 既にこの親に紐づく子ライブ（他経路で追加されている可能性）があれば重複回避
    const existingChildRanges = getLives()
      .filter(l => l.parentId === updated.id)
      .map(l => ({
        start: (l.dateStart || l.date || '').slice(0, 10),
        end:   (l.dateEnd   || l.dateStart || l.date || '').slice(0, 10),
      }))
      .filter(r => r.start);
    // ローカル自身の旧 venue/日付を吸収した子（Day1 相当）を作るかどうか:
    // 公式の children に既存ローカルの日付と重なるものが無い場合のみ、
    // 「元の live を Day として残す」子を作る
    const localStart = (localLive.dateStart || localLive.date || '').slice(0, 10);
    const localEnd   = (localLive.dateEnd   || localStart || '').slice(0, 10);
    const overlapsWithOfficial = official.children.some(c => {
      const s = (c.dateStart || '').slice(0, 10);
      const e = (c.dateEnd   || s).slice(0, 10);
      return !!(localStart && s && localStart <= e && s <= localEnd);
    });
    if (!overlapsWithOfficial && localStart && (localLive.venue || localLive.openTime)) {
      addLive({
        name:       localLive.name,
        artist:     localLive.artist      ?? official.artist ?? null,
        venue:      localLive.venue       ?? null,
        prefecture: localLive.prefecture  ?? null,
        dateStart:  localStart,
        dateEnd:    localEnd || localStart,
        eventType:  'live',
        iconImg:    localLive.iconImg     ?? official.iconImg ?? null,
        parentId:   updated.id,
        openTime:   localLive.openTime    ?? null,
        startTime:  localLive.startTime   ?? null,
        dayTimes:   localLive.dayTimes    ?? null,
        memo:       null,
        officialId: null,
      });
      existingChildRanges.push({ start: localStart, end: localEnd || localStart });
    }
    for (const c of official.children) {
      const s = (c.dateStart || '').slice(0, 10);
      const e = (c.dateEnd   || s).slice(0, 10);
      if (!s) continue;
      const dup = existingChildRanges.some(r => s <= r.end && r.start <= e);
      if (dup) continue;
      addLive({
        name:       official.name,
        artist:     official.artist       ?? localLive.artist ?? null,
        venue:      c.venue               ?? null,
        prefecture: c.prefecture          ?? null,
        dateStart:  c.dateStart,
        dateEnd:    c.dateEnd ?? c.dateStart,
        eventType:  'live',
        iconImg:    official.iconImg      ?? null,
        parentId:   updated.id,
        openTime:   c.openTime            ?? null,
        startTime:  c.startTime           ?? null,
        dayTimes:   c.dayTimes            ?? null,
        memo:       c.dayLabel ? `${c.dayLabel}` : null,
        officialId: official.officialId
          ? `${official.officialId}-${c.dateStart}`
          : null,
      });
    }
  }

  return updated;
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
