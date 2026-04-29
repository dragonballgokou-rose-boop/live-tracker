// ============================================
// Photo Rates — ユーザ手動編集の上書き
// ============================================
// scraper の生死に依存せず、ユーザが localStorage に自分用の正確なレート
// データを持てるようにする。シリーズ単位の "完全置換" でモデル化（差分管理は
// 複雑になるため避けた）：
//   - シリーズ id がユーザ編集にあれば、その rates を採用（seed は無視）
//   - 無ければ seed のまま
//   - seed に存在しない id でも、ユーザは新規シリーズを作成できる
//
// localStorage に置く理由:
//   - サーバ scraper の状況に左右されない
//   - 端末ごとのプライベート編集（共有が必要なら将来 Supabase 同期で）

import type { Rank, RatesFile, SeriesEntry } from './photoRates.js';

const STORAGE_KEY = 'livetracker:user-photo-rates';

export interface UserSeriesOverride {
  id: string;
  label: string;
  saleDate?: string;          // "YYYY-MM"
  saleYear?: number;
  group?: 'nogi' | 'saku' | 'hina';
  rates: { memberName: string; rank: Rank }[];
}

interface UserOverrides {
  version: '1';
  series: Record<string, UserSeriesOverride>;
}

function readRaw(): UserOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: '1', series: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== '1' || typeof parsed.series !== 'object') {
      return { version: '1', series: {} };
    }
    return parsed as UserOverrides;
  } catch {
    return { version: '1', series: {} };
  }
}

function writeRaw(data: UserOverrides): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getUserOverrides(): UserOverrides {
  return readRaw();
}

export function setUserSeries(override: UserSeriesOverride): void {
  const data = readRaw();
  data.series[override.id] = override;
  writeRaw(data);
}

export function clearUserSeries(seriesId: string): void {
  const data = readRaw();
  delete data.series[seriesId];
  writeRaw(data);
}

export function isUserOverridden(seriesId: string): boolean {
  return Boolean(readRaw().series[seriesId]);
}

/**
 * seed の series 配列に対してユーザ上書きを merge した結果を返す。
 * - seed に存在し override にもあれば override を採用
 * - override 専用の新シリーズはそのまま追加
 * - seed のみのシリーズはそのまま残す
 *
 * 戻り値の各 series には _userOverridden が立つので UI で「編集済み」表示に使える。
 */
export type MergedSeries = SeriesEntry & { _userOverridden?: boolean };

export function mergeSeedWithOverrides(seedFile: RatesFile): MergedSeries[] {
  const overrides = readRaw();
  const seedById = new Map<string, SeriesEntry>(seedFile.series.map(s => [s.id, s]));
  const result: MergedSeries[] = [];

  // 1. seed 順を尊重しつつ override で置換
  const seenIds = new Set<string>();
  for (const seed of seedFile.series) {
    seenIds.add(seed.id);
    const ov = overrides.series[seed.id];
    if (ov) {
      result.push({
        ...seed,
        label:    ov.label    ?? seed.label,
        saleDate: ov.saleDate ?? seed.saleDate,
        saleYear: ov.saleYear ?? seed.saleYear,
        group:    ov.group    ?? seed.group,
        rates:    ov.rates,
        _userOverridden: true,
      });
    } else {
      result.push(seed);
    }
  }

  // 2. seed に無い user 専用シリーズを追加
  for (const [id, ov] of Object.entries(overrides.series)) {
    if (seenIds.has(id)) continue;
    result.push({
      id,
      label: ov.label,
      group: ov.group ?? 'nogi',
      saleDate: ov.saleDate,
      saleYear: ov.saleYear,
      rates: ov.rates,
      _userOverridden: true,
    });
  }

  return result;
}

/** 「シリーズ X のメンバー Y を rank Z に設定」のショートカット。空 rank は削除。 */
export function upsertRate(
  seedFile: RatesFile,
  seriesId: string,
  memberName: string,
  rank: Rank | null,
): void {
  const data = readRaw();
  // 既存上書きが無ければ seed をベースに作る
  let ov = data.series[seriesId];
  if (!ov) {
    const seed = seedFile.series.find(s => s.id === seriesId);
    if (seed) {
      ov = {
        id: seed.id,
        label: seed.label,
        saleDate: seed.saleDate,
        saleYear: seed.saleYear,
        group: seed.group,
        rates: seed.rates.map(r => ({ ...r })),
      };
    } else {
      // seed に無いシリーズへの upsert は呼び出し側で createSeries 経由が前提
      return;
    }
  }
  const idx = ov.rates.findIndex(r => normalizeName(r.memberName) === normalizeName(memberName));
  if (rank === null) {
    if (idx >= 0) ov.rates.splice(idx, 1);
  } else if (idx >= 0) {
    ov.rates[idx] = { memberName, rank };
  } else {
    ov.rates.push({ memberName, rank });
  }
  data.series[seriesId] = ov;
  writeRaw(data);
}

/** 新規ユーザシリーズを作成（既存 id とは衝突させない呼び出し側で重複チェック推奨）。 */
export function createSeries(input: {
  id: string;
  label: string;
  saleDate?: string;
  group?: 'nogi' | 'saku' | 'hina';
}): void {
  const data = readRaw();
  if (data.series[input.id]) return;
  data.series[input.id] = {
    id: input.id,
    label: input.label,
    saleDate: input.saleDate,
    saleYear: input.saleDate ? parseInt(input.saleDate.slice(0, 4), 10) : undefined,
    group: input.group ?? 'nogi',
    rates: [],
  };
  writeRaw(data);
}

function normalizeName(s: string): string {
  return String(s).replace(/\s+/g, '').normalize('NFKC');
}
