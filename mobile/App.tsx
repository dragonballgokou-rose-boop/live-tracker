import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
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

// ---- Tab definitions ----
const TAB_ITEMS = [
  { name: 'TOP',   iconFocused: 'home'        as const, iconUnfocused: 'home-outline'         as const, label: 'TOP' },
  { name: '集計表', iconFocused: 'stats-chart' as const, iconUnfocused: 'stats-chart-outline'  as const, label: '集計表' },
  { name: 'グラフ', iconFocused: 'bar-chart'   as const, iconUnfocused: 'bar-chart-outline'    as const, label: 'グラフ' },
  { name: 'ライブ', iconFocused: 'star'         as const, iconUnfocused: 'star-outline'         as const, label: 'ライブ' },
  { name: 'メンバー', iconFocused: 'people'    as const, iconUnfocused: 'people-outline'       as const, label: 'メンバー' },
  { name: '設定',  iconFocused: 'settings'    as const, iconUnfocused: 'settings-outline'     as const, label: '設定' },
];

// ---- Custom Tab Bar ----
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[tabBarStyles.container, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const tab = TAB_ITEMS.find(t => t.name === route.name) ?? TAB_ITEMS[0];
        const iconColor = focused ? '#ffffff' : 'rgba(255,255,255,0.45)';
        const labelColor = focused ? '#ffffff' : 'rgba(255,255,255,0.45)';

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <TouchableOpacity
            key={route.key}
            style={[tabBarStyles.tabItem, focused && tabBarStyles.tabItemActive]}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={descriptors[route.key].options.tabBarAccessibilityLabel}
          >
            <Ionicons
              name={focused ? tab.iconFocused : tab.iconUnfocused}
              size={22}
              color={iconColor}
            />
            <Text style={[tabBarStyles.label, { color: labelColor }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tabBarStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: Colors.tabBarBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.tabBarBorder,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  tabItemActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

// ---- Lives Stack ----
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
          tabBar={(props) => <CustomTabBar {...props} />}
          screenOptions={{
            headerStyle: { backgroundColor: Colors.bgSecondary },
            headerTintColor: Colors.textPrimary,
            headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          }}
        >
          <Tab.Screen name="TOP"    component={DashboardScreen}    options={{ title: 'ダッシュボード' }} />
          <Tab.Screen name="集計表" component={TallyScreen}        options={{ title: '集計表' }} />
          <Tab.Screen name="グラフ" component={ChartScreen}        options={{ title: 'グラフ' }} />
          <Tab.Screen name="ライブ" component={LivesStackNavigator} options={{ headerShown: false }} />
          <Tab.Screen name="メンバー" component={MembersScreen}    options={{ title: 'メンバー' }} />
          <Tab.Screen name="設定"   component={SettingsScreen}     options={{ title: '設定' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
