import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import Post from '@/components/Post';
import { api, normalizePost, type PostView } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function Hashtag() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  const { tag } = useLocalSearchParams<{ tag: string }>();
  useLocale();
  const s = styles(colors);

  const [posts, setPosts] = useState<PostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      // /hashtags/{tag} returns a Meilisearch response: { hits: [...] } with FLAT
      // author fields. Read `.hits` and normalize each into a PostView.
      const data = await api.get<{ hits?: Record<string, unknown>[]; posts?: Record<string, unknown>[] }>(`/hashtags/${tag}`);
      const raw = Array.isArray(data) ? data : (data.hits ?? data.posts ?? []);
      setPosts(raw.map(normalizePost));
      if (me) {
        try {
          const st = await api.get<{ following: boolean }>(`/hashtags/${tag}/follow`);
          setFollowing(st.following);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [tag, me]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async () => {
    if (!me) return router.push('/login');
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.post(`/hashtags/${tag}/follow`);
      else await api.del(`/hashtags/${tag}/follow`);
    } catch {
      setFollowing(!next);
    }
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>#{tag}</Text>
        {following === null ? (
          <View style={{ width: 70 }} />
        ) : (
          <Pressable style={following ? s.outlineBtn : s.solidBtn} onPress={toggleFollow}>
            <Text style={following ? s.outlineText : s.solidText}>
              {following ? t('profile.following') : t('profile.follow')}
            </Text>
          </Pressable>
        )}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <Post post={item} />}
          ListEmptyComponent={<Text style={s.empty}>{t('home.empty')}</Text>}
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
    solidBtn: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
    solidText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    outlineBtn: { borderColor: c.outline, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    outlineText: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 12 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
