// ============================================
// Theme Constants (matching the Web app's CSS variables)
// ============================================

export const Colors = {
  bgPrimary: '#0f0f1a',
  bgSecondary: '#1a1a2e',
  bgCard: '#16213e',
  bgCardHover: '#1e2a4a',
  borderColor: 'rgba(139, 92, 246, 0.15)',
  accentPurple: '#8B5CF6',
  accentPurpleLight: '#a78bfa',
  accentPink: '#EC4899',
  accentAmber: '#F59E0B',
  accentGreen: '#10B981',
  accentRed: '#EF4444',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  tabBarBg: '#1a1a2e',
  tabBarBorder: 'rgba(139, 92, 246, 0.3)',
  going: '#10B981',
  notgoing: '#EF4444',
  undecided: '#64748b',
};

export const MEMBER_COLORS = [
  '#8B5CF6', '#EC4899', '#22D3EE', '#34D399', '#FBBF24',
  '#F87171', '#6366F1', '#14B8A6', '#F97316', '#A78BFA',
  '#FB7185', '#38BDF8', '#4ADE80', '#FACC15', '#E879F9',
  '#2DD4BF', '#818CF8', '#FB923C',
];

export const Fonts = {
  regular: undefined, // system default
  bold: undefined,
};

export function formatDateRange(live: { dateStart?: string; date?: string; dateEnd?: string }): string {
  const start = new Date(live.dateStart || live.date || '');
  const end = live.dateEnd ? new Date(live.dateEnd) : null;
  const fmt = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  if (end && end.getTime() !== start.getTime()) {
    return `${fmt(start)} 〜 ${fmt(end)}`;
  }
  return fmt(start);
}
