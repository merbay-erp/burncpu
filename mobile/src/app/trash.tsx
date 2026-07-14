import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, type TrashedPost } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';

export default function Trash() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [items, setItems] = useState<TrashedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = () =>
    api
      .get<TrashedPost[]>('/users/me/trash')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    if (me) load();
  }, [me]);

  const restore = async (id: string) => {
    setRestoring(id);
    try {
      await api.post(`/posts/${id}/restore`);
      setItems((prev) => prev.filter((p) => p.id !== id));
    } catch {
      /* ignore */
    } finally {
      setRestoring(null);
    }
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('trash.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListHeaderComponent={<Text style={s.note}>{t('trash.note')}</Text>}
          ListEmptyComponent={<Text style={s.empty}>{t('trash.empty')}</Text>}
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.body} numberOfLines={3}>
                  {item.body || '—'}
                </Text>
                <Text style={s.meta}>
                  {t('trash.deleted')} {relTime(item.deleted_at)}
                </Text>
              </View>
              <Pressable style={[s.restore, restoring === item.id && { opacity: 0.5 }]} onPress={() => restore(item.id)} disabled={restoring === item.id}>
                <Ionicons name="arrow-undo-outline" size={15} color={colors.onPrimary} />
                <Text style={s.restoreText}>{t('trash.restore')}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    note: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19, padding: 16 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    body: { color: c.onSurface, fontSize: 14, lineHeight: 20 },
    meta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12, marginTop: 5 },
    restore: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    restoreText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 30, fontFamily: fonts.mono, fontSize: 13 },
  });
