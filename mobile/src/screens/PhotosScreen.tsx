import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../utils/theme';
// web 側 public/photo-rates.json のコピー（scripts/scrape-photo-rates.mjs が両方に書き出す）
import rawRates from '../data/photo-rates.json';

type Rank = 'S+' | 'S' | 'S-' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C';
interface RateEntry { memberName: string; rank: Rank; }
interface SeriesEntry {
  id: string;
  label: string;
  saleYear?: number;
  price?: number;
  rates: RateEntry[];
}
interface RatesFile {
  version: string;
  generatedAt: string;
  sources: string[];
  rankPriceYen: Record<Rank, { low: number; high: number }>;
  series: SeriesEntry[];
}

const DATA = rawRates as RatesFile;
const WATCH_KEY = 'livetracker:photo-watchlist';

const RANK_ORDER: Record<Rank, number> = {
  'S+': 0, 'S': 1, 'S-': 2,
  'A+': 3, 'A': 4, 'A-': 5,
  'B+': 6, 'B': 7, 'B-': 8, 'C': 9,
};

function watchKey(seriesId: string, memberName: string): string {
  return `${seriesId}::${memberName}`;
}

function rankColor(rank: Rank) {
  if (rank.startsWith('S')) return { bg: '#f59e0b', fg: '#3b2a00' };
  if (rank.startsWith('A')) return { bg: '#8b5cf6', fg: '#1a0b3b' };
  if (rank.startsWith('B')) return { bg: '#3b82f6', fg: '#0b1a3b' };
  return { bg: 'rgba(255,255,255,0.1)', fg: Colors.textSecondary };
}

export default function PhotosScreen() {
  const [activeSeries, setActiveSeries] = useState<string | null>(null);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(WATCH_KEY).then(raw => {
      if (!raw) return;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setWatchlist(new Set(arr));
      } catch { /* ignore */ }
    });
  }, []);

  const toggleWatch = (key: string) => {
    setWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      AsyncStorage.setItem(WATCH_KEY, JSON.stringify([...next])).catch(() => { /* ignore */ });
      return next;
    });
  };

  const sorted = useMemo(() => {
    const flat = DATA.series.flatMap(s =>
      s.rates.map(r => ({ ...r, seriesId: s.id, seriesLabel: s.label, saleYear: s.saleYear ?? 0 })),
    );
    const filtered = flat.filter(r => {
      if (activeSeries && r.seriesId !== activeSeries) return false;
      if (watchlistOnly && !watchlist.has(watchKey(r.seriesId, r.memberName))) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const rd = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
      if (rd !== 0) return rd;
      return (b.saleYear ?? 0) - (a.saleYear ?? 0);
    });
    return filtered;
  }, [activeSeries, watchlistOnly, watchlist]);

  const generated = new Date(DATA.generatedAt);
  const updated = `${generated.getFullYear()}/${String(generated.getMonth()+1).padStart(2,'0')}/${String(generated.getDate()).padStart(2,'0')}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Ionicons name="camera-outline" size={18} color={Colors.textPrimary} />
          <Text style={styles.headerTitle}>生写真レート</Text>
          <Text style={styles.headerUpdated}>更新: {updated}</Text>
        </View>
        <Text style={styles.headerDesc}>
          歴代 BIRTHDAY LIVE の個別生写真レート。価格帯はランクベースの参考値です。
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <Chip label="すべて" active={activeSeries === null} onPress={() => setActiveSeries(null)} />
        {DATA.series.map(s => (
          <Chip
            key={s.id}
            label={s.saleYear ? `${s.label} '${String(s.saleYear).slice(2)}` : s.label}
            active={activeSeries === s.id}
            onPress={() => setActiveSeries(s.id)}
          />
        ))}
      </ScrollView>

      <View style={styles.toolbar}>
        <TouchableOpacity
          style={[styles.watchToggle, watchlistOnly && styles.watchToggleActive]}
          onPress={() => setWatchlistOnly(v => !v)}
        >
          <Ionicons name={watchlistOnly ? 'heart' : 'heart-outline'} size={14} color={watchlistOnly ? '#f472b6' : Colors.textSecondary} />
          <Text style={[styles.watchToggleText, watchlistOnly && { color: '#f472b6' }]}>
            ウォッチ中{watchlist.size > 0 ? `（${watchlist.size}）` : ''}
          </Text>
        </TouchableOpacity>
        <Text style={styles.countText}>{sorted.length}件</Text>
      </View>

      {sorted.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {watchlistOnly ? 'ウォッチリストは空です。♥ ボタンで推しを追加してください。' : '該当するレートがありません。'}
          </Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {sorted.map((r, i) => {
            const key = watchKey(r.seriesId, r.memberName);
            const watching = watchlist.has(key);
            const c = rankColor(r.rank);
            const p = DATA.rankPriceYen[r.rank];
            return (
              <View key={`${key}-${i}`} style={[styles.row, i === sorted.length - 1 && styles.rowLast]}>
                <View style={[styles.rankBadge, { backgroundColor: c.bg }]}>
                  <Text style={[styles.rankText, { color: c.fg }]}>{r.rank}</Text>
                </View>
                <View style={styles.rowLeft}>
                  <Text style={styles.memberName} numberOfLines={1}>{r.memberName}</Text>
                  <Text style={styles.seriesLabel} numberOfLines={1}>{r.seriesLabel}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.price}>
                    {p ? `¥${p.low.toLocaleString()}〜¥${p.high.toLocaleString()}` : '—'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => toggleWatch(key)}
                  style={[styles.watchBtn, watching && styles.watchBtnActive]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={watching ? 'heart' : 'heart-outline'}
                    size={16}
                    color={watching ? '#f472b6' : Colors.textTertiary}
                  />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.footer}>
        データ出典: {DATA.sources.map(s => {
          try { return new URL(s).hostname; } catch { return s; }
        }).join('、')}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content:   { padding: 16, paddingBottom: 140 },

  headerCard: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.borderColor,
  },
  headerRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  headerTitle:   { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  headerUpdated: { color: Colors.textTertiary, fontSize: 11 },
  headerDesc:    { color: Colors.textTertiary, fontSize: 12, lineHeight: 18 },

  filterRow: { marginBottom: 10 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: Colors.borderColor,
    marginRight: 6,
  },
  chipActive:     { backgroundColor: 'rgba(167,139,250,0.2)', borderColor: '#A78BFA' },
  chipText:       { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#A78BFA' },

  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2 },
  watchToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: Colors.borderColor,
  },
  watchToggleActive: { backgroundColor: 'rgba(236,72,153,0.18)', borderColor: 'rgba(236,72,153,0.4)' },
  watchToggleText:   { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  countText:         { color: Colors.textTertiary, fontSize: 11 },

  emptyCard: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: 14, padding: 24,
    borderWidth: 1, borderColor: Colors.borderColor,
    alignItems: 'center',
  },
  emptyText: { color: Colors.textTertiary, fontSize: 13, textAlign: 'center' },

  listCard: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: 14,
    borderWidth: 1, borderColor: Colors.borderColor,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.borderColor,
  },
  rowLast: { borderBottomWidth: 0 },
  rankBadge: {
    minWidth: 36, height: 24, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  rankText:     { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  rowLeft:      { flex: 1, minWidth: 0 },
  memberName:   { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  seriesLabel:  { color: Colors.textTertiary, fontSize: 11, marginTop: 2 },
  rowRight:     { alignItems: 'flex-end', minWidth: 110 },
  price:        { color: Colors.textPrimary, fontSize: 12, fontWeight: '700' },

  watchBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: Colors.borderColor,
  },
  watchBtnActive: { backgroundColor: 'rgba(236,72,153,0.18)', borderColor: 'rgba(236,72,153,0.4)' },

  footer: { color: Colors.textTertiary, fontSize: 11, marginTop: 14, lineHeight: 18 },
});
