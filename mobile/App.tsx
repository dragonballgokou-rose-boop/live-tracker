import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import DashboardScreen from './src/screens/DashboardScreen';
import TallyScreen from './src/screens/TallyScreen';
import LivesScreen from './src/screens/LivesScreen';
import MembersScreen from './src/screens/MembersScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { Colors } from './src/utils/theme';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: {
            backgroundColor: Colors.bgSecondary,
            borderBottomColor: Colors.borderColor,
            borderBottomWidth: 1,
          },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          tabBarStyle: {
            backgroundColor: Colors.tabBarBg,
            borderTopColor: Colors.tabBarBorder,
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 8,
            paddingTop: 6,
          },
          tabBarActiveTintColor: Colors.accentPurpleLight,
          tabBarInactiveTintColor: Colors.textTertiary,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
          component={LivesScreen}
          options={{ title: 'ライブ一覧', tabBarLabel: 'ライブ' }}
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
  );
}
