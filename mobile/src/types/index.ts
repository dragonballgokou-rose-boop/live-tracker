// ============================================
// Type Definitions
// ============================================

export interface Live {
  id: string;
  name: string;
  artist?: string;
  venue?: string;
  dateStart: string;
  dateEnd?: string;
  date?: string; // legacy
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  name: string;
  nickname?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export type AttendanceStatus = 'going' | 'notgoing' | 'undecided';

export interface Attendance {
  id: string;
  liveId: string;
  memberId: string;
  status: AttendanceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DateEntry {
  dateStr: string;
  dayNum: number;
  date: Date;
}

export interface Stats {
  totalLives: number;
  upcomingLives: number;
  pastLives: number;
  totalMembers: number;
  totalGoing: number;
  attendanceRate: number;
}
