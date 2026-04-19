// ============================================
// Official Members — 公式メンバー一覧の取得
// ============================================
// 日次バッチ (scripts/scrape-members.mjs) で更新される
// public/official-members.json を読み込み、UI でピッカーを提供する。

import type { OfficialMember, OfficialMembersFile } from './types.js';

const OFFICIAL_URL = './official-members.json';

let _cached: OfficialMembersFile | null = null;
let _byKey: Map<string, OfficialMember> | null = null;

export async function fetchOfficialMembers(
  opts: { noCache?: boolean } = {},
): Promise<OfficialMembersFile> {
  if (_cached && !opts.noCache) return _cached;
  const url = `${OFFICIAL_URL}?v=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`公式メンバー一覧の取得に失敗しました (${res.status})`);
  const data = await res.json() as OfficialMembersFile;
  _cached = data;
  _byKey = new Map();
  for (const m of data.members || []) {
    _byKey.set(`${m.group}:${m.code}`, m);
  }
  return data;
}

/** 既に fetch 済みなら同期で取れる。未 fetch なら null */
export function getOfficialMemberSync(
  code?: string | null, group?: string | null,
): OfficialMember | null {
  if (!_byKey || !code || !group) return null;
  return _byKey.get(`${group}:${code}`) || null;
}

/** グループコード → 公式サイト URL（詳細ページ）を組み立てるためのマッピング */
const BLOG_BASE: Record<string, string> = {
  nogi: 'https://www.nogizaka46.com/s/n46/diary/MEMBER/list?ima=0000&ct=',
  saku: 'https://sakurazaka46.com/s/s46/diary/MEMBER/list?ima=0000&ct=',
};

/**
 * 保存された officialCode / officialGroup から公式ブログ URL を組み立てる。
 * 両方揃わない時は null。
 */
export function buildOfficialBlogUrl(
  code?: string | null, group?: string | null,
): string | null {
  if (!code || !group) return null;
  const base = BLOG_BASE[group];
  if (!base) return null;
  return `${base}${encodeURIComponent(code)}`;
}

/** 名前で近い公式メンバーを探す（ピッカーでのサジェスト用） */
export function findOfficialMemberByName(
  name: string, members: OfficialMember[],
): OfficialMember | null {
  if (!name) return null;
  const q = name.trim();
  // 1) 完全一致
  const exact = members.find(m =>
    (m.name || '').trim() === q || (m.eng || '').trim() === q
  );
  if (exact) return exact;
  // 2) 部分一致（name / eng / kana）
  const partial = members.find(m =>
    (m.name && m.name.includes(q)) ||
    (m.kana && m.kana.includes(q)) ||
    (m.eng  && m.eng.toLowerCase().includes(q.toLowerCase()))
  );
  return partial || null;
}
