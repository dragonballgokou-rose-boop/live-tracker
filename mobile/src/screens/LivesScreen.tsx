import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, formatDateRange, MEMBER_COLORS } from '../utils/theme';
import { getLives, addLive, updateLive, deleteLive } from '../store';
import { Live } from '../types';
import { Ionicons } from '@expo/vector-icons';

export default function LivesScreen() {
  const [lives, setLives] = useState<Live[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Live | null>(null);
  const [form, setForm] = useState({ name: '', artist: '', venue: '', dateStart: '', dateEnd: '', memo: '' });

  const loadData = useCallback(async () => {
    setLives(await getLives());
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const openAdd = () => {
    setEditTarget(null);
    setForm({ name: '', artist: '', venue: '', dateStart: '', dateEnd: '', memo: '' });
    setModalVisible(true);
  };

  const openEdit = (live: Live) => {
    setEditTarget(live);
    setForm({
      name: live.name,
      artist: live.artist || '',
      venue: live.venue || '',
      dateStart: live.dateStart || live.date || '',
      dateEnd: live.dateEnd || '',
      memo: live.memo || '',
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.dateStart.trim()) {
      Alert.alert('入力エラー', 'ライブ名と開始日は必須です');
      return;
    }
    if (editTarget) {
      await updateLive(editTarget.id, {
        name: form.name.trim(),
        artist: form.artist.trim(),
        venue: form.venue.trim(),
        dateStart: form.dateStart.trim(),
        dateEnd: form.dateEnd.trim() || undefined,
        memo: form.memo.trim(),
      });
    } else {
      await addLive({
        name: form.name.trim(),
        artist: form.artist.trim(),
        venue: form.venue.trim(),
        dateStart: form.dateStart.trim(),
        dateEnd: form.dateEnd.trim() || undefined,
        memo: form.memo.trim(),
      });
    }
    setModalVisible(false);
    await loadData();
  };

  const handleDelete = (live: Live) => {
    Alert.alert('削除確認', `「${live.name}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteLive(live.id);
          await loadData();
        },
      },
    ]);
  };

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accentPurple} />}
      >
        <View style={styles.header}>
          <Text style={styles.count}>全 {lives.length} 件</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addBtnText}>ライブを追加</Text>
          </TouchableOpacity>
        </View>

        {lives.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🎵</Text>
            <Text style={styles.emptyText}>ライブがまだ登録されていません</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Text style={styles.addBtnText}>最初のライブを追加</Text>
            </TouchableOpacity>
          </View>
        ) : (
          lives.map((live) => {
            const start = new Date(live.dateStart || live.date || '');
            const end = live.dateEnd ? new Date(live.dateEnd) : new Date(start);
            start.setHours(0, 0, 0, 0);
            end.setHours(0, 0, 0, 0);
            let badgeText = '予定';
            let badgeColor = Colors.accentPurple;
            if (start <= now && end >= now) { badgeText = '開催中！'; badgeColor = Colors.accentGreen; }
            else if (end < now) { badgeText = '終了'; badgeColor = Colors.textTertiary; }

            return (
              <View key={live.id} style={styles.card}>
                <View style={styles.cardDateBadge}>
                  <Text style={styles.cardMonth}>
                    {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][start.getMonth()]}
                  </Text>
                  <Text style={styles.cardDay}>{start.getDate()}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName} numberOfLines={1}>{live.name}</Text>
                  <Text style={styles.cardMeta}>🎤 {live.artist || '未設定'}</Text>
                  <Text style={styles.cardMeta}>📍 {live.venue || '未設定'}</Text>
                  <Text style={styles.cardMeta}>📅 {formatDateRange(live)}</Text>
                  <View style={[styles.badge, { backgroundColor: badgeColor + '33', borderColor: badgeColor }]}>
                    <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeText}</Text>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <TouchableOpacity onPress={() => openEdit(live)} style={styles.iconBtn}>
                    <Ionicons name="pencil" size={18} color={Colors.accentPurpleLight} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(live)} style={styles.iconBtn}>
                    <Ionicons name="trash" size={18} color={Colors.accentRed} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTarget ? 'ライブを編集' : 'ライブを追加'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <FormField label="ライブ名 *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="例: 乃木坂46 真夏の全国ツアー" />
              <FormField label="アーティスト" value={form.artist} onChangeText={(v) => setForm({ ...form, artist: v })} placeholder="例: 乃木坂46" />
              <FormField label="会場" value={form.venue} onChangeText={(v) => setForm({ ...form, venue: v })} placeholder="例: 東京ドーム" />
              <FormField label="開始日 * (YYYY-MM-DD)" value={form.dateStart} onChangeText={(v) => setForm({ ...form, dateStart: v })} placeholder="2026-08-01" keyboardType="numbers-and-punctuation" />
              <FormField label="終了日 (YYYY-MM-DD)" value={form.dateEnd} onChangeText={(v) => setForm({ ...form, dateEnd: v })} placeholder="2026-08-03 (複数日の場合)" keyboardType="numbers-and-punctuation" />
              <FormField label="メモ" value={form.memo} onChangeText={(v) => setForm({ ...form, memo: v })} placeholder="メモを入力" multiline />
            </ScrollView>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>{editTarget ? '更新' : '追加'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FormField({ label, value, onChangeText, placeholder, multiline, keyboardType }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: any;
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        style={[styles.formInput, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textTertiary}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  count: { color: Colors.textSecondary, fontSize: 14 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.accentPurple, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, gap: 4 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: Colors.textSecondary, fontSize: 15 },
  card: { flexDirection: 'row', backgroundColor: Colors.bgCard, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.borderColor, gap: 12 },
  cardDateBadge: { width: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.accentPurple + '22', borderRadius: 8, padding: 6 },
  cardMonth: { fontSize: 10, color: Colors.accentPurpleLight, fontWeight: '600' },
  cardDay: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, marginBottom: 2 },
  cardMeta: { fontSize: 12, color: Colors.textSecondary },
  cardActions: { justifyContent: 'center', gap: 8 },
  iconBtn: { padding: 6 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.bgSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  formField: { marginBottom: 14 },
  formLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6, fontWeight: '500' },
  formInput: { backgroundColor: Colors.bgCard, borderRadius: 8, padding: 12, color: Colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: Colors.borderColor },
  saveBtn: { backgroundColor: Colors.accentPurple, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
