/**
 * TallyScreen - 集計表
 *
 * デザイン方針:
 * - 縦スクロールなし: 画面全体を flex で分割し、常に全体が見える
 * - ライブ選択: 上部の横スクロールタブ（コンパクト）
 * - 日程選択: ライブ選択の下に横並びボタン（複数日の場合）
 * - メンバー一覧: 残りの領域を FlatList で埋める
 * - 各セルは大きめのタップ領域で操作しやすく
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, formatDateRange } from '../utils/theme';
import {
  getLives,
  getMembers,
  getDatesForLive,
  setDayAttendance,
  getDayAttendanceStatus,
} from '../store';
import { Live, Member, AttendanceStatus, DateEntry } from '../types';
import { Ionicons } from '@expo/vector-icons';

const STATUS_CYCLE: AttendanceStatus[] = ['undecided', 'going', 'notgoing'];
const STATUS_ICON: Record<AttendanceStatus, string> = {
  going: '○',
  notgoing: '×',
  undecided: '△',
};
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  going: Colors.going,
  notgoing: Colors.notgoing,
  undecided: Colors.undecided,
};
const STATUS_BG: Record<AttendanceStatus, string> = {
  going: Colors.going + '22',
  notgoing: Colors.notgoing + '18',
  undecided: 'transparent',
};

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function TallyScreen() {
  const [lives, setLives] = useState<Live[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dates, setDates] = useState<DateEntry[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [ls, ms] = await Promise.all([getLives(), getMembers()]);
    setLives(ls);
    setMembers(ms);
    if (ls.length > 0) {
      const liveId = selectedLiveId && ls.find((l) => l.id === selectedLiveId)
        ? selectedLiveId
        : ls[0].id;
      await selectLive(liveId, ls, ms);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const selectLive = async (liveId: string, ls: Live[], ms: Member[]) => {
    const live = ls.find((l) => l.id === liveId);
    if (!live) return;
    const ds = getDatesForLive(live);
    setSelectedLiveId(liveId);
    setDates(ds);
    const firstDate = ds[0]?.dateStr ?? null;
    setSelectedDate(firstDate);
    if (firstDate) await loadAttendance(liveId, firstDate, ms);
  };

  const loadAttendance = async (liveId: string, dateStr: string, ms: Member[]) => {
    const map: Record<string, AttendanceStatus> = {};
    for (const m of ms) {
      map[m.id] = await getDayAttendanceStatus(liveId, dateStr, m.id);
    }
    setAttendanceMap(map);
  };

  const handleSelectLive = async (liveId: string) => {
    await selectLive(liveId, lives, members);
  };

  const handleSelectDate = async (dateStr: string) => {
    setSelectedDate(dateStr);
    if (selectedLiveId) await loadAttendance(selectedLiveId, dateStr, members);
  };

  const handleToggle = async (memberId: string) => {
    if (!selectedLiveId || !selectedDate) return;
    const current = attendanceMap[memberId] || 'undecided';
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setAttendanceMap((prev) => ({ ...prev, [memberId]: next }));
    await setDayAttendance(selectedLiveId, selectedDate, memberId, next);
  };

  // Summary counts
  const goingCount = Object.values(attendanceMap).filter((s) => s === 'going').length;
  const notgoingCount = Object.values(attendanceMap).filter((s) => s === 'notgoing').length;
  const undecidedCount = members.length - goingCount - notgoingCount;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accentPurple} />
      </View>
    );
  }

  if (lives.length === 0 || members.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>{lives.length === 0 ? '🎵' : '👥'}</Text>
        <Text style={styles.emptyText}>
          {lives.length === 0 ? 'まずライブを追加してください' : 'まずメンバーを追加してください'}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* ── ライブ選択タブ ── */}
      <View style={styles.livePickerWrapper}>
        <FlatList
          data={lives}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.livePickerContent}
          renderItem={({ item }) => {
            const active = selectedLiveId === item.id;
            return (
              <TouchableOpacity
                style={[styles.liveTab, active && styles.liveTabActive]}
                onPress={() => handleSelectLive(item.id)}
              >
                <Text style={[styles.liveTabName, active && styles.liveTabNameActive]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.liveTabDate, active && styles.liveTabDateActive]}>
                  {formatDateRange(item)}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* ── 日程選択（複数日のみ） ── */}
      {dates.length > 1 && (
        <View style={styles.dateSelectorWrapper}>
          <FlatList
            data={dates}
            keyExtractor={(item) => item.dateStr}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateSelectorContent}
            renderItem={({ item }) => {
              const active = selectedDate === item.dateStr;
              return (
                <TouchableOpacity
                  style={[styles.dateBtn, active && styles.dateBtnActive]}
                  onPress={() => handleSelectDate(item.dateStr)}
                >
                  <Text style={[styles.dateBtnDay, active && styles.dateBtnTextActive]}>
                    Day {item.dayNum}
                  </Text>
                  <Text style={[styles.dateBtnDate, active && styles.dateBtnTextActive]}>
                    {item.dateStr.slice(5)}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* ── サマリーバー ── */}
      <View style={styles.summaryBar}>
        <SummaryItem color={Colors.going} icon="checkmark-circle" label="参戦" count={goingCount} />
        <View style={styles.summaryDivider} />
        <SummaryItem color={Colors.notgoing} icon="close-circle" label="不参戦" count={notgoingCount} />
        <View style={styles.summaryDivider} />
        <SummaryItem color={Colors.undecided} icon="help-circle" label="未定" count={undecidedCount} />
        <View style={styles.summaryDivider} />
        <Text style={styles.summaryHint}>タップで切替</Text>
      </View>

      {/* ── メンバーリスト（残り全領域） ── */}
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.memberListContent}
        renderItem={({ item }) => {
          const status = attendanceMap[item.id] || 'undecided';
          return (
            <TouchableOpacity
              style={[styles.memberRow, { backgroundColor: STATUS_BG[status] }]}
              onPress={() => handleToggle(item.id)}
              activeOpacity={0.65}
            >
              {/* Avatar */}
              <View style={[styles.avatar, { backgroundColor: item.color }]}>
                <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
              </View>
              {/* Name */}
              <View style={styles.memberNameWrapper}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.nickname ? (
                  <Text style={styles.memberNickname} numberOfLines={1}>
                    {item.nickname}
                  </Text>
                ) : null}
              </View>
              {/* Status Button */}
              <View style={[styles.statusBtn, { borderColor: STATUS_COLOR[status] }]}>
                <Text style={[styles.statusIcon, { color: STATUS_COLOR[status] }]}>
                  {STATUS_ICON[status]}
                </Text>
                <Text style={[styles.statusLabel, { color: STATUS_COLOR[status] }]}>
                  {status === 'going' ? '参戦' : status === 'notgoing' ? '不参戦' : '未定'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

function SummaryItem({ color, icon, label, count }: { color: string; icon: any; label: string; count: number }) {
  return (
    <View style={styles.summaryItem}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.summaryCount, { color }]}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.bgPrimary, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },

  // ライブ選択
  livePickerWrapper: {
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderColor,
  },
  livePickerContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  liveTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.borderColor,
    maxWidth: SCREEN_WIDTH * 0.55,
  },
  liveTabActive: { backgroundColor: Colors.accentPurple + '30', borderColor: Colors.accentPurple },
  liveTabName: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  liveTabNameActive: { color: Colors.accentPurpleLight },
  liveTabDate: { fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  liveTabDateActive: { color: Colors.accentPurple },

  // 日程選択
  dateSelectorWrapper: {
    backgroundColor: Colors.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderColor,
  },
  dateSelectorContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
  dateBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.borderColor,
    alignItems: 'center',
    minWidth: 60,
  },
  dateBtnActive: { backgroundColor: Colors.accentPurple + '30', borderColor: Colors.accentPurple },
  dateBtnDay: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  dateBtnDate: { fontSize: 10, color: Colors.textTertiary },
  dateBtnTextActive: { color: Colors.accentPurpleLight },

  // サマリーバー
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderColor,
    gap: 10,
  },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryCount: { fontSize: 16, fontWeight: '800' },
  summaryLabel: { fontSize: 12, color: Colors.textSecondary },
  summaryDivider: { width: 1, height: 16, backgroundColor: Colors.borderColor },
  summaryHint: { marginLeft: 'auto', fontSize: 11, color: Colors.textTertiary },

  // メンバーリスト
  memberListContent: { paddingVertical: 4 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberNameWrapper: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  memberNickname: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    width: 96,
    justifyContent: 'center',
  },
  statusIcon: { fontSize: 17, fontWeight: '800' },
  statusLabel: { fontSize: 13, fontWeight: '700' },
  separator: { height: 1, backgroundColor: Colors.borderColor, marginLeft: 68 },
});
