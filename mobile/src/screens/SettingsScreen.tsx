import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { Colors } from '../utils/theme';
import { exportData, fetchFromGAS, GAS_URL } from '../store';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen() {
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const json = await exportData();
      await Share.share({
        message: json,
        title: 'live-tracker-backup.json',
      });
    } catch (e: any) {
      Alert.alert('エラー', e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const ok = await fetchFromGAS();
      Alert.alert(ok ? '同期完了' : '同期失敗', ok ? 'クラウドからデータを取得しました' : 'GASとの同期に失敗しました');
    } catch (e: any) {
      Alert.alert('エラー', e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>データ管理</Text>

      <SettingRow
        icon="cloud-download-outline"
        iconColor={Colors.accentPurple}
        title="クラウドから同期"
        subtitle="Google Apps Script から最新データを取得"
        onPress={handleSync}
        loading={syncing}
      />

      <SettingRow
        icon="share-outline"
        iconColor={Colors.accentGreen}
        title="データをエクスポート"
        subtitle="JSON 形式でバックアップを共有"
        onPress={handleExport}
        loading={exporting}
      />

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>アプリ情報</Text>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>バージョン</Text>
        <Text style={styles.infoValue}>1.0.0 (Expo)</Text>
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>GAS エンドポイント</Text>
        <Text style={styles.infoValue} numberOfLines={2}>{GAS_URL ? '設定済み ✅' : '未設定'}</Text>
      </View>

      <View style={styles.divider} />
      <Text style={styles.hint}>
        ⬆️ 下にスワイプして各画面を更新するとクラウドとの自動同期が行われます。{'\n'}
        データを変更すると 2 秒後に自動的にクラウドへ送信されます。
      </Text>
    </ScrollView>
  );
}

function SettingRow({
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
  loading,
}: {
  icon: any;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress} disabled={loading}>
      <View style={[styles.settingIcon, { backgroundColor: iconColor + '22' }]}>
        {loading ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Ionicons name={icon} size={22} color={iconColor} />
        )}
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgPrimary },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 4 },
  settingRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.borderColor, gap: 12 },
  settingIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  settingInfo: { flex: 1 },
  settingTitle: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  settingSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.borderColor, marginVertical: 16 },
  infoCard: { backgroundColor: Colors.bgCard, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.borderColor, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 14, color: Colors.textSecondary },
  infoValue: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  hint: { fontSize: 13, color: Colors.textTertiary, lineHeight: 20, backgroundColor: Colors.bgCard, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: Colors.borderColor },
});
