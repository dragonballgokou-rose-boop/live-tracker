import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, formatDateRange } from '../utils/theme';
import { getLives, getMembers, getDatesForLive, setDayAttendance, getDayAttendanceStatus } from '../store';
import { Live, Member, AttendanceStatus } from '../types';

const STATUS_ICONS: Record<AttendanceStatus, string> = {
  going: '○',
  notgoing: '×',
  undecided: '△',
};

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  going: Colors.going,
  notgoing: Colors.notgoing,
  undecided: Colors.undecided,
};

const STATUS_CYCLE: AttendanceStatus[] = ['undecided', 'going', 'notgoing'];

export default function TallyScreen() {
  const [lives, setLives] = useState<Live[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [ls, ms] = await Promise.all([getLives(), getMembers()]);
    setLives(ls);
    setMembers(ms);
    if (ls.length > 0) {
      const firstId = selectedLiveId && ls.find((l) => l.id === selectedLiveId) ? selectedLiveId : ls[0].id;
      setSelectedLiveId(firstId);
      await loadAttendance(firstId, ls, ms);
    }
  }, [selectedLiveId]);

  const loadAttendance = async (liveId: string, ls: Live[], ms: Member[]) => {
    const live = ls.find((l) => l.id === liveId);
    if (!live) return;
    const dates = getDatesForLive(live);
    const map: Record<string, AttendanceStatus> = {};
    for (const d of dates) {
      for (const m of ms) {
        const key = `${liveId}_${d.dateStr}_${m.id}`;
        map[key] = await getDayAttendanceStatus(liveId, d.dateStr, m.id);
      }
    }
    setAttendanceMap(map);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSelectLive = async (liveId: string) => {
    setSelectedLiveId(liveId);
    await loadAttendance(liveId, lives, members);
  };

  const handleToggle = async (liveId: string, dateStr: string, memberId: string) => {
    const key = `${liveId}_${dateStr}_${memberId}`;
    const current = attendanceMap[key] || 'undecided';
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setAttendanceMap((prev) => ({ ...prev, [key]: next }));
    await setDayAttendance(liveId, dateStr, memberId, next);
  };

  const selectedLive = lives.find((l) => l.id === selectedLiveId);
  const dates = selectedLive ? getDatesForLive(selectedLive) : [];

  if (lives.length === 0 || members.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyText}>
          {lives.length === 0 ? 'まずライブを追加してください' : 'まずメンバーを追加してください'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Live Selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.livePicker}
        contentContainerStyle={styles.livePickerContent}
      >
        {lives.map((live) => (
          <TouchableOpacity
            key={live.id}
            style={[styles.liveTab, selectedLiveId === live.id && styles.liveTabActive]}
            onPress={() => handleSelectLive(live.id)}
          >
            <Text
              style={[styles.liveTabText, selectedLiveId === live.id && styles.liveTabTextActive]}
              numberOfLines={1}
            >
              {live.name}
            </Text>
            <Text style={styles.liveTabDate}>{formatDateRange(live)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tally Table */}
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accentPurple} />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={true}>
          <View style={styles.table}>
            {/* Header Row */}
            <View style={styles.tableRow}>
              <View style={[styles.tableCell, styles.headerCell, styles.memberHeaderCell]}>
                <Text style={styles.headerText}>メンバー</Text>
              </View>
              {dates.map((d) => (
                <View key={d.dateStr} style={[styles.tableCell, styles.headerCell, styles.dateCell]}>
                  <Text style={styles.headerText}>Day{d.dayNum}</Text>
                  <Text style={styles.dateCellSub}>{d.dateStr.slice(5)}</Text>
                </View>
              ))}
            </View>

            {/* Member Rows */}
            {members.map((member) => (
              <View key={member.id} style={styles.tableRow}>
                <View style={[styles.tableCell, styles.memberCell]}>
                  <View style={[styles.memberDot, { backgroundColor: member.color }]} />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.nickname || member.name}
                  </Text>
                </View>
                {dates.map((d) => {
                  const key = `${selectedLiveId}_${d.dateStr}_${member.id}`;
                  const status = attendanceMap[key] || 'undecided';
                  return (
                    <TouchableOpacity
                      key={d.dateStr}
                      style={[styles.tableCell, styles.statusCell]}
                      onPress={() => handleToggle(selectedLiveId!, d.dateStr, member.id)}
                    >
                      <Text style={[styles.statusIcon, { color: STATUS_COLORS[status] }]}>
                        {STATUS_ICONS[status]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Legend */}
        <View style={styles.legend}>
          {(Object.entries(STATUS_ICONS) as [AttendanceStatus, string][]).map(([s, icon]) => (
            <View key={s} style={styles.legendItem}>
              <Text style={[styles.legendIcon, { color: STATUS_COLORS[s] }]}>{icon}</Text>
              <Text style={styles.legendLabel}>
                {s === 'going' ? '参戦' : s === 'notgoing' ? '不参戦' : '未定'}
              </Text>
            </View>
          ))}
          <Text style={styles.legendHint}>タップで切り替え</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: Colors.textSecondary, fontSize: 15 },
  livePicker: { maxHeight: 80, backgroundColor: Colors.bgSecondary, borderBottomWidth: 1, borderBottomColor: Colors.borderColor },
  livePickerContent: { padding: 10, gap: 8 },
  liveTab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.borderColor, minWidth: 120 },
  liveTabActive: { backgroundColor: Colors.accentPurple + '33', borderColor: Colors.accentPurple },
  liveTabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  liveTabTextActive: { color: Colors.accentPurpleLight },
  liveTabDate: { fontSize: 10, color: Colors.textTertiary, marginTop: 2 },
  table: { margin: 12 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.borderColor },
  tableCell: { justifyContent: 'center', alignItems: 'center', padding: 8, borderRightWidth: 1, borderRightColor: Colors.borderColor },
  headerCell: { backgroundColor: Colors.bgSecondary },
  memberHeaderCell: { width: 100, alignItems: 'flex-start' },
  dateCell: { width: 56 },
  dateCellSub: { fontSize: 10, color: Colors.textTertiary },
  headerText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  memberCell: { width: 100, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-start', backgroundColor: Colors.bgCard },
  memberDot: { width: 10, height: 10, borderRadius: 5 },
  memberName: { fontSize: 12, color: Colors.textPrimary, flex: 1 },
  statusCell: { width: 56, backgroundColor: Colors.bgCard },
  statusIcon: { fontSize: 18, fontWeight: '700' },
  legend: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 16, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendIcon: { fontSize: 16, fontWeight: '700' },
  legendLabel: { fontSize: 12, color: Colors.textSecondary },
  legendHint: { fontSize: 11, color: Colors.textTertiary, marginLeft: 'auto' },
});
