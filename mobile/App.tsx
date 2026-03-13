import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import DashboardScreen from './src/screens/DashboardScreen';
import TallyScreen from './src/screens/TallyScreen';
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
          screenOptions={({ route }) => ({
            headerStyle: {
              backgroundColor: Colors.bgSecondary,
            },
            headerTintColor: Colors.textPrimary,
            headerTitleStyle: { fontWeight: '700', fontSize: 17 },
            tabBarStyle: {
              backgroundColor: Colors.tabBarBg,
              borderTopColor: Colors.tabBarBorder,
              borderTopWidth: 1,
              paddingBottom: 4,
              paddingTop: 4,
              height: 58,
            },
            tabBarActiveTintColor: Colors.accentPurpleLight,
            tabBarInactiveTintColor: Colors.textTertiary,
            tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
            tabBarIcon: ({ focused, color, size }) => {
              let iconName: keyof typeof Ionicons.glyphMap = 'home-outline';
              if (route.name === 'TOP') {
                iconName = focused ? 'home' : 'home-outline';
              } else if (route.name === '集計表') {
                iconName = focused ? 'stats-chart' : 'stats-chart-outline';
              } else if (route.name === 'ライブ') {
                iconName = focused ? 'star' : 'star-outline';
              } else if (route.name === 'メンバー') {
                iconName = focused ? 'people' : 'people-outline';
              } else if (route.name === '設定') {
                iconName = focused ? 'settings' : 'settings-outline';
              }
              return <Ionicons name={iconName} size={size} color={color} />;
            },
          })}
        >
          <Tab.Screen
            name="TOP"
            component={DashboardScreen}
            options={{ title: 'ダッシュボード', tabBarLabel: 'TOP' }}
          />
          <Tab.Screen
            name="集計表"
            component={TallyScreen}
            options={{ title: '集計表', tabBarLabel: '集計表' }}
          />
          <Tab.Screen
            name="ライブ"
            component={LivesStackNavigator}
            options={{ headerShown: false, tabBarLabel: 'ライブ' }}
          />
          <Tab.Screen
            name="メンバー"
            component={MembersScreen}
            options={{ title: 'メンバー', tabBarLabel: 'メンバー' }}
          />
          <Tab.Screen
            name="設定"
            component={SettingsScreen}
            options={{ title: '設定', tabBarLabel: '設定' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
