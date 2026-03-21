import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../utils/theme';
import { getMembers, getLives, getAttendanceStatus, getDatesForLive, getDayAttendanceStatus } from '../store';
import { Member, Live } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32 - 28; // padding 16*2 + section padding 14*2

interface MemberStat {
  member: Member;
  goingCount: number;
  totalLives: number;
  rate: number;
}

interface MonthStat {
  month: string;
  label: string;
  goingCount: number;
}

export default function ChartScreen() {
  const [memberStats, setMemberStats] = useState<MemberStat[]>([]);
  const [monthStats, setMonthStats] = useState<MonthStat[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(false);

  const loadData = useCallback(async () => {
    const [members, lives] = await Promise.all([getMembers(), getLives()]);

    if (members.length === 0 || lives.length === 0) {
      setIsEmpty(true);
      return;
    }
    setIsEmpty(false);

    // ---- メンバー別参戦数 (ライブ単位) ----
    const stats: MemberStat[] = [];
    for (const member of members) {
      let goingCount = 0;
      for (const live of lives) {
        const s = await getAttendanceStatus(live.id, member.id);
        if (s === 'going') goingCount++;
      }
      stats.push({
        member,
        goingCount,
        totalLives: lives.length,
        rate: lives.length > 0 ? Math.round((goingCount / lives.length) * 100) : 0,
      });
    }
    stats.sort((a, b) => b.goingCount - a.goingCount);
    setMemberStats(stats);

    // ---- 月別参戦数推移 ----
    const monthMap: Record<string, number> = {};
    for (const live of lives) {
      const dates = getDatesForLive(live);
      for (const d of dates) {
        const month = d.dateStr.slice(0, 7);
        if (!monthMap[month]) monthMap[month] = 0;
        let anyGoing = false;
        for (const member of members) {
          const s = await getDayAttendanceStatus(live.id, d.dateStr, member.id);
          if (s === 'going') { anyGoing = true; break; }
        }
        if (anyGoing) monthMap[month]++;
      }
    }
    const sortedMonths = Object.keys(monthMap).sort().slice(-12);
    setMonthStats(sortedMonths.map((m) => ({
      month: m,
      label: m.slice(5) + '月',
      goingCount: monthMap[m],
    })));
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const maxMember = Math.max(...memberStats.map((s) => s.goingCount), 1);
  const maxMonth = Math.max(...monthStats.map((s) => s.goingCount), 1);
  const BAR_HEIGHT = 28;
  const MONTH_BAR_MAX_HEIGHT = 100;

  if (isEmpty) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyText}>ライブとメンバーを登録するとグラフが表示されます</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accentPurple} />}
    >
      {/* メンバー別参戦数 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>メンバー別 参戦数</Text>
        {memberStats.map((s) => {
          const barWidth = maxMember > 0 ? (s.goingCount / maxMember) * CHART_WIDTH : 0;
          return (
            <View key={s.member.id} style={styles.barRow}>
              <View style={[styles.memberDot, { backgroundColor: s.member.color }]}>
                <Text style={styles.memberDotText}>{s.member.name.charAt(0)}</Text>
              </View>
              <View style={styles.barArea}>
                <Text style={styles.barLabel} numberOfLines={1}>{s.member.name}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: barWidth, backgroundColor: s.member.color, height: BAR_HEIGHT },
                    ]}
                  />
                  <Text style={styles.barValue}>{s.goingCount}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* 月別参戦数 */}
      {monthStats.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>月別 参戦日数推移</Text>
          <View style={styles.monthChart}>
            {monthStats.map((s) => {
              const barH = maxMonth > 0 ? (s.goingCount / maxMonth) * MONTH_BAR_MAX_HEIGHT : 0;
              return (
                <View key={s.month} style={styles.monthCol}>
                  <Text style={styles.monthValue}>{s.goingCount}</Text>
                  <View style={[styles.monthBarWrap, { height: MONTH_BAR_MAX_HEIGHT }]}>
                    <View
                      style={[
                        styles.monthBar,
                        { height: barH, backgroundColor: Colors.accentPurple },
                      ]}
                    />
                  </View>
                  <Text style={styles.monthLabel}>{s.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: Colors.bgPrimary },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
  section: { backgroundColor: Colors.bgCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.borderColor },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  memberDot: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  memberDotText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  barArea: { flex: 1 },
  barLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 3 },
  barTrack: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barFill: { borderRadius: 4 },
  barValue: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  monthChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, flexWrap: 'wrap' },
  monthCol: { alignItems: 'center', minWidth: 36 },
  monthValue: { fontSize: 11, color: Colors.textSecondary, marginBottom: 4 },
  monthBarWrap: { justifyContent: 'flex-end', width: 28 },
  monthBar: { width: 28, borderRadius: 4, minHeight: 4 },
  monthLabel: { fontSize: 10, color: Colors.textTertiary, marginTop: 4 },
});
