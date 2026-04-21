import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../utils/theme';

interface PhotoRate {
  seriesId: string;
  seriesLabel: string;
  memberName: string;
  price: number;
  delta: number | null;
}

const DEMO_RATES: PhotoRate[] = [
  { seriesId: '13th-birthday-anniv',   seriesLabel: '13周年記念',          memberName: '与田 祐希',    price: 2800, delta:  200 },
  { seriesId: '13th-birthday-anniv',   seriesLabel: '13周年記念',          memberName: '山下 美月',    price: 2200, delta:  -50 },
  { seriesId: '13th-birthday-tshirt',  seriesLabel: '13th BDライブTシャツ', memberName: '遠藤 さくら',  price: 1900, delta:  150 },
  { seriesId: '12th-birthday-anniv',   seriesLabel: '12周年記念',          memberName: '井上 和',      price: 3100, delta:  300 },
  { seriesId: '12th-birthday-animal',  seriesLabel: 'アニマルルームウェア', memberName: '賀喜 遥香',    price: 1500, delta:    0 },
  { seriesId: '11th-birthday-varsity', seriesLabel: 'スタジャン',          memberName: '久保 史緒里',  price: 1200, delta: -100 },
];

export default function PhotosScreen() {
  const [activeSeries, setActiveSeries] = useState<string | null>(null);

  const series = Array.from(new Map(DEMO_RATES.map(r => [r.seriesId, r.seriesLabel])).entries());
  const filtered = activeSeries ? DEMO_RATES.filter(r => r.seriesId === activeSeries) : DEMO_RATES;
  const sorted = [...filtered].sort((a, b) => b.price - a.price);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Ionicons name="camera-outline" size={18} color={Colors.textPrimary} />
          <Text style={styles.headerTitle}>生写真レート（ベータ）</Text>
        </View>
        <Text style={styles.headerDesc}>
          歴代 BIRTHDAY LIVE の個別生写真レートを追跡。データは参考値です。
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <Chip label="すべて" active={activeSeries === null} onPress={() => setActiveSeries(null)} />
        {series.map(([id, label]) => (
          <Chip key={id} label={label} active={activeSeries === id} onPress={() => setActiveSeries(id)} />
        ))}
      </ScrollView>

      <View style={styles.listCard}>
        {sorted.map((r, i) => (
          <View key={`${r.seriesId}-${r.memberName}-${i}`} style={[styles.row, i === sorted.length - 1 && styles.rowLast]}>
            <View style={styles.rowLeft}>
              <Text style={styles.memberName} numberOfLines={1}>{r.memberName}</Text>
              <Text style={styles.seriesLabel} numberOfLines={1}>{r.seriesLabel}</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.price}>¥{r.price.toLocaleString()}</Text>
              <Text style={[styles.delta, deltaColor(r.delta)]}>{deltaLabel(r.delta)}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>
        ※ MVP 画面です。今後：Supabase 連携 / 推しウォッチリスト / Push 通知を追加予定。
      </Text>
    </ScrollView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function deltaLabel(d: number | null): string {
  if (d == null) return '—';
  if (d > 0) return `▲ ¥${d.toLocaleString()}`;
  if (d < 0) return `▼ ¥${Math.abs(d).toLocaleString()}`;
  return '± ¥0';
}

function deltaColor(d: number | null) {
  if (d == null || d === 0) return { color: Colors.textTertiary };
  return { color: d > 0 ? '#ef4444' : '#22c55e' };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content:   { padding: 16, paddingBottom: 120 },

  card: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.borderColor,
  },
  headerRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  headerTitle:  { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  headerDesc:   { color: Colors.textTertiary, fontSize: 12, lineHeight: 18 },

  filterRow:    { marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: Colors.borderColor,
    marginRight: 6,
  },
  chipActive:     { backgroundColor: 'rgba(167,139,250,0.2)', borderColor: '#A78BFA' },
  chipText:       { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#A78BFA' },

  listCard: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderColor,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderColor,
  },
  rowLast:       { borderBottomWidth: 0 },
  rowLeft:       { flex: 1, minWidth: 0 },
  memberName:    { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  seriesLabel:   { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  rowRight:      { alignItems: 'flex-end', minWidth: 100 },
  price:         { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  delta:         { fontSize: 11, marginTop: 2 },

  footer: { color: Colors.textTertiary, fontSize: 11, marginTop: 14, lineHeight: 18 },
});
