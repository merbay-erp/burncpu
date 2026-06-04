import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import ScreenHeader from '@/components/ScreenHeader';
import LoginGate from '@/components/LoginGate';
import Avatar from '@/components/Avatar';
import { api, type Notification } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';
import { refreshUnread } from '@/unread';

type Tab = 'all' | 'unread';

export default function Notifications() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [items, setItems] = useState<Notification[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      // /notifications returns { notifications: [...], next_before }, not a bare array.
      const data = await api.get<{ notifications: Notification[] }>('/notifications');
      setItems(data.notifications ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Re-fetch whenever the tab regains focus (not only on first mount), so new
  // notifications show up without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      if (me) {
        load();
        refreshUnread();
      } else {
        setLoading(false);
      }
    }, [me, load]),
  );

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const shown = useMemo(() => (tab === 'unread' ? items.filter((n) => !n.read_at) : items), [items, tab]);

  if (!me) return <LoginGate />;

  const markAll = async () => {
    if (unreadCount === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    try {
      await api.patch('/notifications/read');
      refreshUnread();
    } catch {
      load(); // resync on failure
    }
  };

  const open = (n: Notification) => {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.target_kind === 'post') router.push(`/post/${n.target_id}`);
    else if (n.actor_username) router.push(`/u/${n.actor_username}`);
  };

  return (
    <View style={s.screen}>
      <ScreenHeader
        title={t('nav.notifications')}
        right={
          <Pressable onPress={markAll} hitSlop={8} disabled={unreadCount === 0} style={unreadCount === 0 && { opacity: 0.35 }}>
            <Ionicons name="checkmark-done" size={22} color={colors.primary} />
          </Pressable>
        }
      />

      <View style={s.tabs}>
        <Pressable style={[s.tab, tab === 'all' && s.tabActive]} onPress={() => setTab('all')}>
          <Text style={[s.tabText, tab === 'all' && s.tabTextActive]}>{t('notif.tab_all')}</Text>
        </Pressable>
        <Pressable style={[s.tab, tab === 'unread' && s.tabActive]} onPress={() => setTab('unread')}>
          <Text style={[s.tabText, tab === 'unread' && s.tabTextActive]}>
            {t('notif.tab_unread')}
            {unreadCount > 0 ? `  ${unreadCount}` : ''}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(n) => n.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<Text style={s.empty}>{t('notifications.empty')}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              style={({ pressed }) => [s.row, !item.read_at && s.unread, pressed && { backgroundColor: colors.surfaceLow }]}
            >
              <Avatar uri={item.actor_avatar_url} name={item.actor_username ?? '?'} size={36} />
              <Text style={s.text}>
                <Text style={s.actor}>@{item.actor_username ?? 'biri'}</Text>{' '}
                {t(`notif.${item.kind}`)} <Text style={s.time}>· {relTime(item.created_at)}</Text>
              </Text>
              {!item.read_at ? <View style={s.dot} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    tab: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: c.surfaceLow },
    tabActive: { backgroundColor: c.primary },
    tabText: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurfaceVariant },
    tabTextActive: { color: c.onPrimary },
    row: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    unread: { backgroundColor: `${c.primary}14` },
    text: { flex: 1, color: c.onSurface, fontSize: 14, lineHeight: 20 },
    actor: { fontFamily: fonts.semibold, color: c.onBackground },
    time: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
