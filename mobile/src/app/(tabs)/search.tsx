import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import Avatar from '@/components/Avatar';
import { api } from '@/api';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';

interface Hit {
  id: string;
  author_username: string;
  author_display_name?: string;
  author_avatar_url?: string | null;
  body: string;
  created_at: number | string;
}
interface SearchResponse {
  hits: Hit[];
}

export default function Search() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLocale();
  const s = styles(colors);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (!query) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.get<SearchResponse>(`/search?q=${encodeURIComponent(query)}`);
        setHits(r.hits ?? []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.searchBar}>
        <Ionicons name="search" size={18} color={colors.fg3} />
        <TextInput
          style={s.input}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.fg3}
          autoCapitalize="none"
          autoCorrect={false}
          value={q}
          onChangeText={setQ}
          returnKeyType="search"
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.fg3} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
      ) : (
        <FlatList
          data={hits}
          keyExtractor={(h) => h.id}
          ListEmptyComponent={
            <Text style={s.empty}>{q.trim() ? '—' : t('search.empty')}</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/post/${item.id}`)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceLow }]}
            >
              <Avatar uri={item.author_avatar_url} name={item.author_display_name ?? item.author_username} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.handle}>
                  @{item.author_username}{' '}
                  <Text style={s.time}>· {relTime(typeof item.created_at === 'number' ? new Date(item.created_at * 1000).toISOString() : item.created_at)}</Text>
                </Text>
                <Text style={s.body} numberOfLines={2}>
                  {item.body}
                </Text>
              </View>
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
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 14,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor: c.surfaceLow,
      borderRadius: radius,
      borderWidth: 1,
      borderColor: c.outlineVariant,
    },
    input: { flex: 1, color: c.onSurface, fontFamily: fonts.mono, fontSize: 14, padding: 0 },
    row: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    handle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
    time: { color: c.fg3 },
    body: { color: c.onSurface, fontSize: 14, lineHeight: 19, marginTop: 2 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
