// ============================================
// Photo Rates — 生写真レートの読み込み・検索
// ============================================
// public/photo-rates.json をロードし、ユーザの localStorage 上書きと merge して
// メンバー名で履歴を引くためのヘルパ。Photos ビュー / ダッシュボード / メンバー
// 詳細モーダル のいずれもこのモジュール経由で読むので、編集が即時に全画面へ反映される。

import { mergeSeedWithOverrides } from './photoRatesUser.js';

export type Rank = 'S+' | 'S' | 'S-' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C';

export interface RateEntry { memberName: string; rank: Rank; }
export interface SeriesEntry {
  id: string;
  label: string;
  group: 'nogi' | 'saku' | 'hina';
  event?: string;
  saleYear?: number;
  saleDate?: string;      // "YYYY-MM" — scraper が埋める。無ければ saleYear + 06 で代替
  price?: number;
  sourceUrl?: string;
  rates: RateEntry[];
}
export interface RatesFile {
  version: string;
  generatedAt: string;
  sources: string[];
  rankPriceYen: Record<Rank, { low: number; high: number }>;
  series: SeriesEntry[];
}

export interface MemberRatePoint {
  seriesId: string;
  seriesLabel: string;
  saleDate: string;       // normalized YYYY-MM
  rank: Rank;
}

export const RANK_ORDER: Record<Rank, number> = {
  'S+': 0, 'S': 1, 'S-': 2,
  'A+': 3, 'A': 4, 'A-': 5,
  'B+': 6, 'B': 7, 'B-': 8,
  'C':  9,
};

let _seedCache: RatesFile | null = null;
let _inflight: Promise<RatesFile | null> | null = null;

/** seed JSON のみをロード（user 編集は merge しない、内部用）。 */
async function loadSeed(opts: { noCache?: boolean } = {}): Promise<RatesFile | null> {
  if (_seedCache && !opts.noCache) return _seedCache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch(`./photo-rates.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      _seedCache = (await res.json()) as RatesFile;
      return _seedCache;
    } catch (e) {
      console.warn('[photoRates] load failed', e);
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/**
 * seed JSON にユーザ編集を merge した結果を返す。
 * - 各画面はこれを呼ぶだけで「seed + ユーザ編集」を見れる
 * - ユーザ編集が変わった直後は noCache:true で再 merge
 */
export async function fetchPhotoRates(opts: { noCache?: boolean } = {}): Promise<RatesFile | null> {
  const seed = await loadSeed(opts);
  if (!seed) return null;
  return {
    ...seed,
    series: mergeSeedWithOverrides(seed),
  };
}

export function getPhotoRatesSync(): RatesFile | null {
  if (!_seedCache) return null;
  return {
    ..._seedCache,
    series: mergeSeedWithOverrides(_seedCache),
  };
}

/** seed (read-only, ユーザ編集無視) を返す — 編集 UI のベース表示用。 */
export function getPhotoRatesSeedSync(): RatesFile | null {
  return _seedCache;
}

function normalizeName(s: string): string {
  return String(s).replace(/\s+/g, '').normalize('NFKC');
}

function effectiveSaleDate(s: SeriesEntry): string {
  if (s.saleDate && /^\d{4}-\d{2}$/.test(s.saleDate)) return s.saleDate;
  if (s.saleYear) return `${s.saleYear}-06`;
  return '0000-00';
}

/**
 * 指定メンバーの直近 months ヶ月分のレート履歴を古い→新しい順で返す。
 * 表記揺れ (全角/半角スペース) は正規化済みで比較する。
 */
export function getMemberRateHistory(
  data: RatesFile,
  memberName: string,
  _monthsIgnored: number = 24,
): MemberRatePoint[] {
  const target = normalizeName(memberName);
  // 「直近2年」= 今年・去年・一昨年の 1 月以降（月粒度で比較）
  const cutoffKey = `${new Date().getFullYear() - 2}-01`;

  const points: MemberRatePoint[] = [];
  for (const s of data.series) {
    const sd = effectiveSaleDate(s);
    if (sd < cutoffKey) continue;
    const hit = s.rates.find(r => normalizeName(r.memberName) === target);
    if (!hit) continue;
    points.push({
      seriesId: s.id,
      seriesLabel: s.label,
      saleDate: sd,
      rank: hit.rank,
    });
  }
  points.sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  return points;
}

export function rankClass(rank: Rank): string {
  if (rank.startsWith('S')) return 'rank-s';
  if (rank.startsWith('A')) return 'rank-a';
  if (rank.startsWith('B')) return 'rank-b';
  return 'rank-c';
}
