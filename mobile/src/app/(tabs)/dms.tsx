import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import LoginGate from '@/components/LoginGate';
import Avatar from '@/components/Avatar';
import { api } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';

// Matches the server's ThreadSummary (flat fields, not a nested `other`).
interface DmThread {
  id: string;
  other_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_url?: string | null;
  last_body?: string | null;
  last_sender_id?: string | null;
  last_message_at: string;
  unread_count: number;
}

export default function DMs() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [threads, setThreads] = useState<DmThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setThreads(await api.get<DmThread[]>('/dm/threads'));
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

  return (
    <View style={s.screen}>
      <ScreenHeader title={t('nav.dms')} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(th) => th.id}
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
          ListEmptyComponent={<Text style={s.empty}>—</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/dm/${item.other_username}`)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceLow }]}
            >
              <Avatar uri={item.other_avatar_url} name={item.other_display_name} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.line}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.other_display_name}
                  </Text>
                  {item.last_message_at ? <Text style={s.time}>{relTime(item.last_message_at)}</Text> : null}
                </View>
                <Text style={s.preview} numberOfLines={1}>
                  {item.last_body ?? `@${item.other_username}`}
                </Text>
              </View>
              {item.unread_count > 0 ? <View style={s.dot} /> : null}
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
    row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    name: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 14, flex: 1 },
    time: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11 },
    preview: { color: c.onSurfaceVariant, fontSize: 13, marginTop: 2 },
    dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
