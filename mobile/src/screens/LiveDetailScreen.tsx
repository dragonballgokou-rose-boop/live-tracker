import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors, formatDateRange } from '../utils/theme';
import {
  getLiveById,
  getMembers,
  getDatesForLive,
  getDayAttendanceStatus,
  setDayAttendance,
  deleteLive,
} from '../store';
import { Live, Member, DateEntry, AttendanceStatus } from '../types';
import { LivesStackParamList } from '../../App';

type Props = NativeStackScreenProps<LivesStackParamList, 'LiveDetail'>;

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  going: '○ 参戦',
  notgoing: '× 不参戦',
  undecided: '△ 未定',
};
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  going: Colors.going,
  notgoing: Colors.notgoing,
  undecided: Colors.undecided,
};
const STATUS_CYCLE: AttendanceStatus[] = ['undecided', 'going', 'notgoing'];

export default function LiveDetailScreen({ route, navigation }: Props) {
  const { liveId } = route.params;
  const [live, setLive] = useState<Live | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [dates, setDates] = useState<DateEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [l, ms] = await Promise.all([getLiveById(liveId), getMembers()]);
    if (!l) return;
    const ds = getDatesForLive(l);
    setLive(l);
    setMembers(ms);
    setDates(ds);
    const firstDate = ds[0]?.dateStr ?? null;
    setSelectedDate(firstDate);
    if (firstDate) {
      await loadAttendance(l, ms, firstDate);
    }
    setLoading(false);
  }, [liveId]);

  const loadAttendance = async (l: Live, ms: Member[], dateStr: string) => {
    const map: Record<string, AttendanceStatus> = {};
    for (const m of ms) {
      map[m.id] = await getDayAttendanceStatus(l.id, dateStr, m.id);
    }
    setAttendanceMap(map);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectDate = async (dateStr: string) => {
    setSelectedDate(dateStr);
    if (live) await loadAttendance(live, members, dateStr);
  };

  const handleToggle = async (memberId: string) => {
    if (!live || !selectedDate) return;
    const current = attendanceMap[memberId] || 'undecided';
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setAttendanceMap((prev) => ({ ...prev, [memberId]: next }));
    await setDayAttendance(live.id, selectedDate, memberId, next);
  };

  const handleDelete = () => {
    Alert.alert('削除確認', `「${live?.name}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          if (live) await deleteLive(live.id);
          navigation.goBack();
        },
      },
    ]);
  };

  if (loading || !live) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accentPurple} />
      </View>
    );
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(live.dateStart || live.date || '');
  const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  let statusText = '予定';
  let statusColor = Colors.accentPurple;
  if (start <= now && end >= now) { statusText = '開催中！'; statusColor = Colors.accentGreen; }
  else if (end < now) { statusText = '終了'; statusColor = Colors.textTertiary; }

  // Count going members for selected date
  const goingCount = Object.values(attendanceMap).filter((s) => s === 'going').length;
  const notgoingCount = Object.values(attendanceMap).filter((s) => s === 'notgoing').length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Hero Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroDateBadge}>
            <Text style={styles.heroMonth}>
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][start.getMonth()]}
            </Text>
            <Text style={styles.heroDay}>{start.getDate()}</Text>
            <Text style={styles.heroYear}>{start.getFullYear()}</Text>
          </View>
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{live.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '33', borderColor: statusColor }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusText}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={20} color={Colors.accentRed} />
          </TouchableOpacity>
        </View>

        {/* Meta info */}
        <View style={styles.metaGrid}>
          <MetaItem icon="musical-notes-outline" label="アーティスト" value={live.artist || '未設定'} />
          <MetaItem icon="location-outline" label="会場" value={live.venue || '未設定'} />
          <MetaItem icon="calendar-outline" label="日程" value={formatDateRange(live)} />
          {live.memo ? <MetaItem icon="document-text-outline" label="メモ" value={live.memo} /> : null}
        </View>
      </View>

      {/* Date Selector (multi-day) */}
      {dates.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>日程を選択</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateTabs}>
            {dates.map((d) => (
              <TouchableOpacity
                key={d.dateStr}
                style={[styles.dateTab, selectedDate === d.dateStr && styles.dateTabActive]}
                onPress={() => handleSelectDate(d.dateStr)}
              >
                <Text style={[styles.dateTabDay, selectedDate === d.dateStr && styles.dateTabTextActive]}>
                  Day {d.dayNum}
                </Text>
                <Text style={[styles.dateTabDate, selectedDate === d.dateStr && styles.dateTabTextActive]}>
                  {d.dateStr.slice(5)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <SummaryChip icon="checkmark-circle" color={Colors.going} label="参戦" count={goingCount} />
        <SummaryChip icon="close-circle" color={Colors.notgoing} label="不参戦" count={notgoingCount} />
        <SummaryChip icon="help-circle" color={Colors.undecided} label="未定" count={members.length - goingCount - notgoingCount} />
      </View>

      {/* Member Attendance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>メンバー参戦状況</Text>
        <Text style={styles.sectionHint}>タップで ○ → × → △ と切り替えます</Text>
        {members.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>メンバーが登録されていません</Text>
          </View>
        ) : (
          <View style={styles.memberGrid}>
            {members.map((member) => {
              const status = attendanceMap[member.id] || 'undecided';
              return (
                <TouchableOpacity
                  key={member.id}
                  style={[styles.memberCard, { borderColor: STATUS_COLOR[status] + '66' }]}
                  onPress={() => handleToggle(member.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.memberAvatar, { backgroundColor: member.color }]}>
                    <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.nickname || member.name}
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[status] + '22' }]}>
                    <Text style={[styles.statusPillText, { color: STATUS_COLOR[status] }]}>
                      {STATUS_LABEL[status]}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function MetaItem({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={16} color={Colors.accentPurpleLight} />
      <View style={styles.metaText}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
    </View>
  );
}

function SummaryChip({ icon, color, label, count }: { icon: any; color: string; label: string; count: number }) {
  return (
    <View style={[styles.summaryChip, { backgroundColor: color + '18', borderColor: color + '55' }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.summaryCount, { color }]}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary },

  heroCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.borderColor,
  },
  heroHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  heroDateBadge: {
    width: 56,
    alignItems: 'center',
    backgroundColor: Colors.accentPurple + '22',
    borderRadius: 10,
    padding: 8,
  },
  heroMonth: { fontSize: 11, color: Colors.accentPurpleLight, fontWeight: '700' },
  heroDay: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, lineHeight: 30 },
  heroYear: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  heroInfo: { flex: 1, gap: 6 },
  heroName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, lineHeight: 22 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  deleteBtn: { padding: 6 },

  metaGrid: { gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  metaText: { flex: 1 },
  metaLabel: { fontSize: 11, color: Colors.textTertiary, marginBottom: 1 },
  metaValue: { fontSize: 14, color: Colors.textPrimary },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  sectionHint: { fontSize: 12, color: Colors.textTertiary, marginBottom: 10 },

  dateTabs: { gap: 8, paddingVertical: 4 },
  dateTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.borderColor,
    alignItems: 'center',
    minWidth: 70,
  },
  dateTabActive: { backgroundColor: Colors.accentPurple + '33', borderColor: Colors.accentPurple },
  dateTabDay: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  dateTabDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  dateTabTextActive: { color: Colors.accentPurpleLight },

  summaryBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  summaryChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  summaryCount: { fontSize: 18, fontWeight: '800' },
  summaryLabel: { fontSize: 12, color: Colors.textSecondary },

  memberGrid: { gap: 8 },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1.5,
    gap: 10,
  },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  memberAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusPillText: { fontSize: 13, fontWeight: '700' },

  emptyState: { padding: 24, alignItems: 'center' },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },
});
