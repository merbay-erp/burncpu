import { useEffect } from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, useTheme } from '@/theme';
import { t, useLocale } from '@/i18n';
import { useUnread, startUnreadPolling } from '@/unread';

type IoniconName = keyof typeof Ionicons.glyphMap;

function tabIcon(active: IoniconName, inactive: IoniconName) {
  const TabIcon = ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color as string} />
  );
  TabIcon.displayName = `TabIcon(${active})`;
  return TabIcon;
}

export default function TabsLayout() {
  const { colors } = useTheme();
  useLocale(); // re-render labels on locale change
  const { notif, dm } = useUnread();
  useEffect(() => startUnreadPolling(), []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: colors.surfaceLow,
          borderTopColor: colors.outlineVariant,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.2 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('nav.home'), tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: t('nav.search'), tabBarIcon: tabIcon('search', 'search-outline') }}
      />
      <Tabs.Screen
        name="videos"
        options={{ title: t('nav.videos'), tabBarIcon: tabIcon('film', 'film-outline') }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t('nav.notifications'),
          tabBarIcon: tabIcon('notifications', 'notifications-outline'),
          tabBarBadge: notif > 0 ? notif : undefined,
        }}
      />
      <Tabs.Screen
        name="dms"
        options={{ title: t('nav.dms'), tabBarIcon: tabIcon('chatbubble', 'chatbubble-outline'), tabBarBadge: dm > 0 ? dm : undefined }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('nav.profile'), tabBarIcon: tabIcon('person', 'person-outline') }}
      />
    </Tabs>
  );
}
