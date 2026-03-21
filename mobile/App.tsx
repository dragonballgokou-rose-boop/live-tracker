import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import DashboardScreen from './src/screens/DashboardScreen';
import TallyScreen from './src/screens/TallyScreen';
import ChartScreen from './src/screens/ChartScreen';
import LivesScreen from './src/screens/LivesScreen';
import LiveDetailScreen from './src/screens/LiveDetailScreen';
import MembersScreen from './src/screens/MembersScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { Colors } from './src/utils/theme';

// ---- Type definitions for navigation ----
export type LivesStackParamList = {
  LivesList: undefined;
  LiveDetail: { liveId: string };
};

const Tab = createBottomTabNavigator();
const LivesStack = createNativeStackNavigator<LivesStackParamList>();

// ---- Liquid UI Tab Button ----
// Apple Music / GitHub スタイル: 固定サイズのピルでアイコンのみをラップし、
// ラベルをピルの外に配置することで、全タブで均一なサイズを保証する
type LiquidTabButtonProps = BottomTabBarButtonProps & {
  iconFocused: keyof typeof Ionicons.glyphMap;
  iconUnfocused: keyof typeof Ionicons.glyphMap;
  label: string;
};

function LiquidTabButton({
  style,
  onPress,
  onLongPress,
  accessibilityState,
  iconFocused,
  iconUnfocused,
  label,
}: LiquidTabButtonProps) {
  const focused = accessibilityState?.selected ?? false;
  const tintColor = focused ? Colors.accentPurpleLight : Colors.textTertiary;

  return (
    <TouchableOpacity
      style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }, style]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityState={accessibilityState}
      activeOpacity={0.7}
    >
      {/* 固定サイズのピル — アイコンのみ */}
      <View style={{
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(167, 139, 250, 0.22)' : 'transparent',
        borderRadius: 16,
        width: 56,
        height: 32,
        marginBottom: 3,
      }}>
        <Ionicons
          name={focused ? iconFocused : iconUnfocused}
          size={22}
          color={tintColor}
        />
      </View>
      {/* ラベルはピルの外側 — 全タブで同じスタイル */}
      <Text style={{
        fontSize: 10,
        fontWeight: '600',
        color: tintColor,
        letterSpacing: 0.2,
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function LivesStackNavigator() {
  return (
    <LivesStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.bgSecondary },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: Colors.bgPrimary },
      }}
    >
      <LivesStack.Screen
        name="LivesList"
        component={LivesScreen}
        options={{ title: 'ライブ一覧' }}
      />
      <LivesStack.Screen
        name="LiveDetail"
        component={LiveDetailScreen}
        options={{ title: 'ライブ詳細' }}
      />
    </LivesStack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerStyle: {
              backgroundColor: Colors.bgSecondary,
            },
            headerTintColor: Colors.textPrimary,
            headerTitleStyle: { fontWeight: '700', fontSize: 17 },
            tabBarStyle: {
              backgroundColor: Colors.tabBarBg,
              borderTopColor: Colors.tabBarBorder,
              borderTopWidth: 1,
              height: 60,
            },
            // アイコン・ラベルは LiquidTabButton が自前で描画するため非表示
            tabBarShowLabel: false,
            tabBarIcon: () => null,
          }}
        >
          <Tab.Screen
            name="TOP"
            component={DashboardScreen}
            options={{
              title: 'ダッシュボード',
              tabBarButton: (props) => (
                <LiquidTabButton {...props} iconFocused="home" iconUnfocused="home-outline" label="TOP" />
              ),
            }}
          />
          <Tab.Screen
            name="集計表"
            component={TallyScreen}
            options={{
              title: '集計表',
              tabBarButton: (props) => (
                <LiquidTabButton {...props} iconFocused="stats-chart" iconUnfocused="stats-chart-outline" label="集計表" />
              ),
            }}
          />
          <Tab.Screen
            name="グラフ"
            component={ChartScreen}
            options={{
              title: 'グラフ',
              tabBarButton: (props) => (
                <LiquidTabButton {...props} iconFocused="bar-chart" iconUnfocused="bar-chart-outline" label="グラフ" />
              ),
            }}
          />
          <Tab.Screen
            name="ライブ"
            component={LivesStackNavigator}
            options={{
              headerShown: false,
              tabBarButton: (props) => (
                <LiquidTabButton {...props} iconFocused="star" iconUnfocused="star-outline" label="ライブ" />
              ),
            }}
          />
          <Tab.Screen
            name="メンバー"
            component={MembersScreen}
            options={{
              title: 'メンバー',
              tabBarButton: (props) => (
                <LiquidTabButton {...props} iconFocused="people" iconUnfocused="people-outline" label="メンバー" />
              ),
            }}
          />
          <Tab.Screen
            name="設定"
            component={SettingsScreen}
            options={{
              title: '設定',
              tabBarButton: (props) => (
                <LiquidTabButton {...props} iconFocused="settings" iconUnfocused="settings-outline" label="設定" />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
