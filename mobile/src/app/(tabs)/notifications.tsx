import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import LoginGate from '@/components/LoginGate';
import Avatar from '@/components/Avatar';
import { api, type Notification } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';

export default function Notifications() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<Notification[]>('/notifications'));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (me) load();
    else setLoading(false);
  }, [me, load]);

  if (!me) return <LoginGate />;

  const open = (n: Notification) => {
    if (n.target_kind === 'post') router.push(`/post/${n.target_id}`);
    else if (n.actor_username) router.push(`/u/${n.actor_username}`);
  };

  return (
    <View style={s.screen}>
      <ScreenHeader title={t('nav.notifications')} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
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
    row: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    unread: { backgroundColor: `${c.primary}14` },
    text: { flex: 1, color: c.onSurface, fontSize: 14, lineHeight: 20 },
    actor: { fontFamily: fonts.semibold, color: c.onBackground },
    time: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
