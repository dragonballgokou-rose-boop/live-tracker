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
import { Colors, MEMBER_COLORS } from '../utils/theme';
import { getMembers, addMember, updateMember, deleteMember, getLives, getDatesForLive, getDayAttendanceStatus } from '../store';
import { Member } from '../types';
import { Ionicons } from '@expo/vector-icons';

export default function MembersScreen() {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberStats, setMemberStats] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [form, setForm] = useState({ name: '', nickname: '', color: MEMBER_COLORS[0] });

  const loadData = useCallback(async () => {
    const [mems, lives] = await Promise.all([getMembers(), getLives()]);
    setMembers(mems);
    // Compute going count per member
    const stats: Record<string, number> = {};
    for (const m of mems) {
      let count = 0;
      for (const live of lives) {
        const dates = getDatesForLive(live);
        for (const d of dates) {
          const s = await getDayAttendanceStatus(live.id, d.dateStr, m.id);
          if (s === 'going') count++;
        }
      }
      stats[m.id] = count;
    }
    setMemberStats(stats);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const openAdd = () => {
    setEditTarget(null);
    const usedColors = members.map((m) => m.color);
    const nextColor = MEMBER_COLORS.find((c) => !usedColors.includes(c)) || MEMBER_COLORS[0];
    setForm({ name: '', nickname: '', color: nextColor });
    setModalVisible(true);
  };

  const openEdit = (member: Member) => {
    setEditTarget(member);
    setForm({ name: member.name, nickname: member.nickname || '', color: member.color });
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('入力エラー', 'メンバー名は必須です');
      return;
    }
    if (editTarget) {
      await updateMember(editTarget.id, { name: form.name.trim(), nickname: form.nickname.trim(), color: form.color });
    } else {
      await addMember({ name: form.name.trim(), nickname: form.nickname.trim(), color: form.color });
    }
    setModalVisible(false);
    await loadData();
  };

  const handleDelete = (member: Member) => {
    Alert.alert('削除確認', `「${member.name}」を削除しますか？\n関連する参戦記録も削除されます。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteMember(member.id);
          await loadData();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accentPurple} />}
      >
        <View style={styles.header}>
          <Text style={styles.count}>全 {members.length} 名</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="person-add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>メンバーを追加</Text>
          </TouchableOpacity>
        </View>

        {members.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyText}>メンバーがまだ登録されていません</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Text style={styles.addBtnText}>最初のメンバーを追加</Text>
            </TouchableOpacity>
          </View>
        ) : (
          members.map((member) => (
            <View key={member.id} style={styles.card}>
              <View style={[styles.avatar, { backgroundColor: member.color }]}>
                <Text style={styles.avatarText}>{member.name.charAt(0)}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{member.name}</Text>
                {member.nickname ? (
                  <Text style={styles.cardNickname}>「{member.nickname}」</Text>
                ) : null}
                <Text style={styles.cardStat}>
                  <Text style={{ color: Colors.accentGreen, fontWeight: '700' }}>
                    {memberStats[member.id] ?? 0}
                  </Text>
                  {' '}参戦
                </Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => openEdit(member)} style={styles.iconBtn}>
                  <Ionicons name="pencil" size={18} color={Colors.accentPurpleLight} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(member)} style={styles.iconBtn}>
                  <Ionicons name="trash" size={18} color={Colors.accentRed} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTarget ? 'メンバーを編集' : 'メンバーを追加'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>名前 *</Text>
              <TextInput
                style={styles.formInput}
                value={form.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
                placeholder="例: 山田太郎"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>ニックネーム</Text>
              <TextInput
                style={styles.formInput}
                value={form.nickname}
                onChangeText={(v) => setForm({ ...form, nickname: v })}
                placeholder="例: たろちゃん"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>カラー</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.colorPicker}>
                  {MEMBER_COLORS.map((color) => (
                    <TouchableOpacity
                      key={color}
                      style={[
                        styles.colorDot,
                        { backgroundColor: color },
                        form.color === color && styles.colorDotSelected,
                      ]}
                      onPress={() => setForm({ ...form, color })}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
            {/* Preview */}
            <View style={styles.previewRow}>
              <View style={[styles.avatar, { backgroundColor: form.color }]}>
                <Text style={styles.avatarText}>{form.name.charAt(0) || '?'}</Text>
              </View>
              <Text style={styles.previewName}>{form.name || '名前未入力'}</Text>
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>{editTarget ? '更新' : '追加'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  card: { flexDirection: 'row', backgroundColor: Colors.bgCard, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.borderColor, alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  cardNickname: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cardStat: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  cardActions: { gap: 8 },
  iconBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.bgSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  formField: { marginBottom: 14 },
  formLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6, fontWeight: '500' },
  formInput: { backgroundColor: Colors.bgCard, borderRadius: 8, padding: 12, color: Colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: Colors.borderColor },
  colorPicker: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  colorDot: { width: 32, height: 32, borderRadius: 16 },
  colorDotSelected: { borderWidth: 3, borderColor: '#fff' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, padding: 12, backgroundColor: Colors.bgCard, borderRadius: 10 },
  previewName: { fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  saveBtn: { backgroundColor: Colors.accentPurple, borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
