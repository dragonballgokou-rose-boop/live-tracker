// ============================================
// 共有型定義
// ============================================

/** ライブの種別。Supabase の lives_event_type_check 制約と一致。 */
export type EventType = 'live' | 'event' | 'tour' | 'stage';

/** 参戦ステータス。Supabase の status_check と一致。 */
export type AttendanceStatus = 'going' | 'not_going' | 'undecided' | 'planned';

/** ローカル/Supabase 共通のライブエントリ */
export interface Live {
  id: string;
  name: string;
  artist?: string | null;
  venue?: string | null;
  /** 開催開始日 YYYY-MM-DD */
  dateStart?: string | null;
  /** 開催終了日 YYYY-MM-DD。単日なら dateStart と同じ */
  dateEnd?: string | null;
  /** 旧フィールド（dateStart への移行前の後方互換） */
  date?: string | null;
  memo?: string | null;
  icon?: string | null;
  iconImg?: string | null;
  color?: string | null;
  prefecture?: string | null;
  eventType?: EventType | string | null;
  /** ツアーの親 ID（子ライブがツアーを参照） */
  parentId?: string | null;
  openTime?: string | null;
  startTime?: string | null;
  /** 日付別の開場・開演時刻マップ（JSON 文字列ではなくオブジェクトで保持） */
  dayTimes?: { date: string; openTime?: string; startTime?: string }[] | null;
  /** 公式データ由来の場合の stable ID。memo 内の `[official-id:xxx]` にも記録される */
  officialId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface Member {
  id: string;
  name: string;
  nickname?: string | null;
  color?: string | null;
  avatar?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** 公式メンバーとのリンク（localStorage 側のサイドカー、端末毎） */
export interface MemberOfficialLink {
  memberId: string;
  /** 公式 API の code。例 "46001" */
  officialCode: string;
  /** 'nogi' | 'saku' などグループ識別 */
  officialGroup: string;
}

/** 公式メンバー一覧 JSON（public/official-members.json の各エントリ） */
export interface OfficialMember {
  code: string;
  group: 'nogi' | 'saku' | string;
  artist: string;
  name: string | null;
  kana: string | null;
  eng: string | null;
  imgUrl: string | null;
  generation: string | null;
  graduated: boolean;
  detailUrl: string;
  blogUrl: string;
}

export interface OfficialMembersFile {
  version: string;
  updatedAt: string;
  sources: Record<string, string>;
  members: OfficialMember[];
  errors?: { group: string; artist: string; error: string }[];
}

/** 公式メンバー個別のブログエントリ */
export interface OfficialBlogEntry {
  url: string;
  title: string;
  date: string | null;
  thumbnail: string | null;
}

/** 公式メンバー個別のスケジュールエントリ */
export interface OfficialScheduleEntry {
  cate: string | null;
  title: string;
  dayOfMonth: number | null;
}

/** 公式メンバーの追加プロフィール（身長 / 血液型 / 誕生日 / 出身地 等） */
export interface OfficialMemberProfile {
  birthday?: string | null;       // "YYYY-MM-DD" or "MM-DD"
  height?: string | null;         // "162cm" など
  bloodType?: string | null;      // "A" / "B" / "AB" / "O"
  birthplace?: string | null;     // 都道府県名
  zodiac?: string | null;         // 星座
}

export interface OfficialMemberFeedEntry {
  blog: OfficialBlogEntry[];
  schedule: OfficialScheduleEntry[];
  profile?: OfficialMemberProfile;
  errors?: string[];
}

export interface OfficialMemberFeedsFile {
  version: string;
  updatedAt: string;
  /** key = `${group}:${code}` */
  feeds: Record<string, OfficialMemberFeedEntry>;
}

export interface Attendance {
  id: string;
  liveId: string;
  memberId: string;
  status: AttendanceStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** 公式ライブ JSON の子公演エントリ（ツアー内の個別日程） */
export interface OfficialChildPerformance {
  /** 個別公演の日（YYYY-MM-DD）。通常 dateStart/dateEnd は同日 */
  dateStart: string;
  dateEnd?: string;
  venue?: string | null;
  prefecture?: string | null;
  /** 表示ラベル補助（例: "Day1"、無くても可） */
  dayLabel?: string | null;
  /** 開場時刻 "HH:MM" */
  openTime?: string | null;
  /** 開演時刻 "HH:MM" */
  startTime?: string | null;
  /** 複数日レグで日毎に時刻が違うとき */
  dayTimes?: { date: string; openTime?: string; startTime?: string }[];
}

/** 公式ライブ JSON（public/official-lives.json の各エントリ） */
export interface OfficialLive {
  officialId: string;
  artist: string;
  name: string;
  venue?: string | null;
  prefecture?: string | null;
  /** 単独公演なら公演日、ツアーなら開始日（最小日付） */
  dateStart: string;
  /** 単独公演なら dateStart と同日、ツアーなら終了日（最大日付） */
  dateEnd: string;
  eventType: EventType | string;
  iconImg?: string | null;
  sourceUrl: string;
  scrapedAt: string;
  /**
   * 子公演（複数レグツアーの個別日程）。
   * これが 2 件以上なら scraper はこの live を「ツアー」として扱い、
   * 追加時に parentId でリンクされた子 live も同時に作成する。
   */
  children?: OfficialChildPerformance[];
  /** 単独公演の場合の開場時刻 */
  openTime?: string | null;
  /** 単独公演の場合の開演時刻 */
  startTime?: string | null;
  /** multi-day 単独ライブでの日別時刻 */
  dayTimes?: { date: string; openTime?: string; startTime?: string }[];
}

export interface OfficialLivesFile {
  version: string;
  updatedAt: string;
  sources: Record<string, string>;
  lives: OfficialLive[];
  errors?: { artist: string; error: string }[];
  note?: string;
}

// ============================================
// Supabase 行レベルの型（snake_case）
// ============================================

export interface LiveRow {
  id: string;
  name: string;
  artist: string | null;
  venue: string | null;
  date_start: string | null;
  date_end: string | null;
  date: string | null;
  memo: string | null;
  icon: string | null;
  icon_img: string | null;
  color: string | null;
  prefecture: string | null;
  event_type: string | null;
  parent_id: string | null;
  open_time: string | null;
  start_time: string | null;
  day_times: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface MemberRow {
  id: string;
  name: string;
  nickname: string | null;
  color: string | null;
  avatar: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AttendanceRow {
  id: string;
  live_id: string;
  member_id: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

// ============================================
// 公式同期モーダル関連
// ============================================

export type DiffFieldName = 'venue' | 'prefecture' | 'dateEnd' | 'eventType';

export interface FieldDiff {
  field: DiffFieldName;
  from: unknown;
  to: unknown;
}

export interface SimilarLocalLive {
  local: Live;
  diffDays: number;
}

export interface DiffAddItem {
  official: OfficialLive;
  similar?: SimilarLocalLive[];
}

/** 子公演の不足フィールド（venue 等）を公式 child で補完する場合の 1 件 */
export type ChildReconcileField =
  | 'venue' | 'prefecture' | 'dateStart' | 'dateEnd'
  | 'openTime' | 'startTime' | 'dayTimes';

export interface ChildReconcileItem {
  localChild: Live;
  officialChild: OfficialChildPerformance;
  fieldsToFill: ChildReconcileField[];
}

export interface DiffUpdateItem {
  official: OfficialLive;
  local: Live;
  diffs: FieldDiff[];
  /** ツアー: 公式の children の中でローカルにまだ存在しない日程 */
  newChildren?: OfficialChildPerformance[];
  /** 公式ツアー→ローカル舞台/ライブ等で、会場情報を children から吸収できる場合 true */
  canAbsorbVenue?: boolean;
  /** 既存のローカル子公演で、公式 child と重なるが会場/時刻/dateEnd が足りないもの */
  childUpdates?: ChildReconcileItem[];
}

export interface DiffSkipItem {
  official: OfficialLive;
  local: Live;
}

export interface DiffResult {
  toAdd: DiffAddItem[];
  toUpdate: DiffUpdateItem[];
  toSkip: DiffSkipItem[];
}

// ============================================
// Sync result
// ============================================

export type SyncResult =
  | { ok: true }
  | { ok: false; reason: 'supabase-not-configured' }
  | { ok: false; reason: 'sync-failed'; error: unknown };
