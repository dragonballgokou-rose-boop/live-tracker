import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, formatDateRange } from '../utils/theme';
import { getLives, getMembers, getStats, getDatesForLive, getDayAttendanceStatus, fetchFromGAS } from '../store';
import { Live, Member, Stats } from '../types';

export default function DashboardScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [upcomingLives, setUpcomingLives] = useState<Live[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    const [s, lives, mems] = await Promise.all([getStats(), getLives(), getMembers()]);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const upcoming = lives
      .filter((l) => new Date(l.dateEnd || l.dateStart || l.date || '') >= now)
      .slice(0, 5);
    setStats(s);
    setUpcomingLives(upcoming);
    setMembers(mems);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    setSyncing(true);
    await fetchFromGAS();
    await loadData();
    setSyncing(false);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accentPurple} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.accentPurple}
        />
      }
    >
      {syncing && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncText}>☁️ クラウドと同期中...</Text>
        </View>
      )}

      {/* Stats Cards */}
      <View style={styles.statsGrid}>
        <StatCard label="総ライブ数" value={stats?.totalLives ?? 0} color={Colors.accentPurple} />
        <StatCard label="メンバー数" value={stats?.totalMembers ?? 0} color={Colors.accentPink} />
        <StatCard label="参戦数" value={stats?.totalGoing ?? 0} color={Colors.accentGreen} />
        <StatCard label="参戦率" value={`${stats?.attendanceRate ?? 0}%`} color={Colors.accentAmber} />
      </View>

      {/* Upcoming Lives */}
      <SectionHeader title="直近のライブ" />
      {upcomingLives.length === 0 ? (
        <EmptyState text="予定されているライブはありません" />
      ) : (
        upcomingLives.map((live) => (
          <LiveCard key={live.id} live={live} members={members} />
        ))
      )}
    </ScrollView>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function LiveCard({ live, members }: { live: Live; members: Member[] }) {
  const [goingMembers, setGoingMembers] = useState<Member[]>([]);

  useEffect(() => {
    (async () => {
      const dates = getDatesForLive(live);
      const going: Member[] = [];
      for (const m of members) {
        for (const d of dates) {
          const s = await getDayAttendanceStatus(live.id, d.dateStr, m.id);
          if (s === 'going') {
            going.push(m);
            break;
          }
        }
      }
      setGoingMembers(going);
    })();
  }, [live, members]);

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(live.dateStart || live.date || '');
  const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  let badgeText = '予定';
  let badgeColor = Colors.accentPurple;
  if (start <= now && end >= now) {
    badgeText = '開催中！';
    badgeColor = Colors.accentGreen;
  } else if (end < now) {
    badgeText = '終了';
    badgeColor = Colors.textTertiary;
  }

  return (
    <View style={styles.liveCard}>
      <View style={styles.liveDateBadge}>
        <Text style={styles.liveMonth}>
          {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][start.getMonth()]}
        </Text>
        <Text style={styles.liveDay}>{start.getDate()}</Text>
      </View>
      <View style={styles.liveInfo}>
        <Text style={styles.liveName} numberOfLines={1}>{live.name}</Text>
        <Text style={styles.liveMeta} numberOfLines={1}>
          🎤 {live.artist || '未設定'} · 📍 {live.venue || '未設定'}
        </Text>
        <View style={styles.liveFooter}>
          <View style={[styles.badge, { backgroundColor: badgeColor + '33', borderColor: badgeColor }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeText}</Text>
          </View>
          {goingMembers.length > 0 && (
            <View style={styles.memberChips}>
              {goingMembers.slice(0, 4).map((m) => (
                <View key={m.id} style={[styles.memberDot, { backgroundColor: m.color }]} />
              ))}
              {goingMembers.length > 4 && (
                <Text style={styles.memberMore}>+{goingMembers.length - 4}</Text>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary },
  syncBanner: {
    backgroundColor: Colors.accentPurple + '22',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  syncText: { color: Colors.accentPurpleLight, fontSize: 13 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 16,
    borderTopWidth: 3,
    borderColor: Colors.borderColor,
  },
  statValue: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  statLabel: { fontSize: 12, color: Colors.textSecondary },
  sectionHeader: { marginBottom: 10, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyState: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },
  liveCard: {
    flexDirection: 'row',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderColor,
    gap: 12,
  },
  liveDateBadge: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentPurple + '22',
    borderRadius: 8,
    padding: 6,
  },
  liveMonth: { fontSize: 10, color: Colors.accentPurpleLight, fontWeight: '600' },
  liveDay: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  liveInfo: { flex: 1, gap: 4 },
  liveName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  liveMeta: { fontSize: 12, color: Colors.textSecondary },
  liveFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  memberChips: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  memberDot: { width: 14, height: 14, borderRadius: 7 },
  memberMore: { fontSize: 11, color: Colors.textTertiary },
});
