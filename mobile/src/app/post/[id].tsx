import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import Post from '@/components/Post';
import { api, type PostView, type Timeline } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function PostDetail() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  useLocale();
  const s = styles(colors);

  const [post, setPost] = useState<PostView | null>(null);
  const [replies, setReplies] = useState<PostView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api.get<PostView>(`/posts/${id}`),
        api.get<Timeline | PostView[]>(`/posts/${id}/replies`),
      ]);
      setPost(p);
      setReplies(Array.isArray(r) ? r : r.posts);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('post.reply')}</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : !post ? (
        <Text style={s.empty}>—</Text>
      ) : (
        <FlatList
          data={replies}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={
            <View style={s.mainPost}>
              <Post post={post} detail />
            </View>
          }
          renderItem={({ item }) => <Post post={item} />}
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.outlineVariant,
    },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 16 },
    mainPost: { borderBottomWidth: 6, borderBottomColor: c.surfaceLow },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono },
  });
