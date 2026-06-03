import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import Avatar from '@/components/Avatar';
import { api, type TrendingPost } from '@/api';
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
type Win = '24h' | '7d' | '30d';

export default function Search() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLocale();
  const s = styles(colors);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [win, setWin] = useState<Win>('24h');
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [trendPosts, setTrendPosts] = useState<TrendingPost[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // trending (discovery) for the selected window
  useEffect(() => {
    api.get<{ tag: string; count: number }[]>(`/trending/hashtags?window=${win}`).then(setTags).catch(() => {});
    api.get<TrendingPost[]>(`/trending/posts?window=${win}`).then(setTrendPosts).catch(() => {});
  }, [win]);

  // debounced search
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

  const searching = q.trim().length > 0;

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

      {searching ? (
        loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
        ) : (
          <FlatList
            data={hits}
            keyExtractor={(h) => h.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={s.empty}>—</Text>}
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
        )
      ) : (
        // ── Discovery / Trending hub ──
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <View style={s.windows}>
            {(['24h', '7d', '30d'] as Win[]).map((w) => (
              <Pressable key={w} style={[s.win, win === w && s.winActive]} onPress={() => setWin(w)}>
                <Text style={[s.winText, win === w && s.winTextActive]}>{t(`win.${w}`)}</Text>
              </Pressable>
            ))}
          </View>

          {tags.length > 0 ? (
            <View style={s.trendWrap}>
              <Text style={s.trendTitle}>{t('trending.hashtags')}</Text>
              <View style={s.chips}>
                {tags.map((h) => (
                  <Pressable key={h.tag} style={s.chip} onPress={() => router.push(`/tag/${h.tag}`)}>
                    <Text style={s.chipText}>#{h.tag}</Text>
                    <Text style={s.chipCount}>{h.count}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {trendPosts.length > 0 ? (
            <>
              <Text style={[s.trendTitle, { paddingHorizontal: 16, marginTop: 18 }]}>{t('trending.posts')}</Text>
              {trendPosts.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.push(`/post/${p.id}`)}
                  style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceLow }]}
                >
                  <Avatar uri={p.author_avatar_url} name={p.author_display_name} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.handle} numberOfLines={1}>
                      <Text style={s.dname}>{p.author_display_name}</Text> @{p.author_username}{' '}
                      <Text style={s.time}>· {relTime(p.created_at)}</Text>
                    </Text>
                    <Text style={s.body} numberOfLines={3}>
                      {p.body}
                    </Text>
                    <View style={s.metaRow}>
                      <Text style={s.metaItem}>🐢 {p.reactions_count}</Text>
                      <Text style={s.metaItem}>💬 {p.replies_count}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
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
    windows: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
    win: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: c.surfaceLow },
    winActive: { backgroundColor: c.primary },
    winText: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurfaceVariant },
    winTextActive: { color: c.onPrimary },
    row: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    handle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
    dname: { color: c.onBackground, fontFamily: fonts.bold },
    time: { color: c.fg3 },
    body: { color: c.onSurface, fontSize: 14, lineHeight: 19, marginTop: 2 },
    metaRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
    metaItem: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
    trendWrap: { paddingHorizontal: 16, paddingTop: 4 },
    trendTitle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipText: { color: c.primary, fontFamily: fonts.semibold, fontSize: 13 },
    chipCount: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11 },
  });
