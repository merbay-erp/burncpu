import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import Post from '@/components/Post';
import Brand from '@/components/Brand';
import SuggestedAccounts from '@/components/SuggestedAccounts';
import ProfileNudge from '@/components/ProfileNudge';
import FederatedFeed from '@/components/FederatedFeed';
import { api, type PostView, type Timeline } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

type Tab = 'foryou' | 'global' | 'federated';

export default function Home() {
  const { colors, toggle } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [tab, setTab] = useState<Tab>(me ? 'foryou' : 'global');
  const [posts, setPosts] = useState<PostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState<{ before: string; id?: string } | null>(null);
  const [done, setDone] = useState(false);

  const path = tab === 'foryou' ? '/feed' : '/posts';

  const load = useCallback(
    async (reset: boolean) => {
      if (!reset && (done || loading)) return;
      const qs = !reset && cursor ? `?before=${encodeURIComponent(cursor.before)}${cursor.id ? `&before_id=${cursor.id}` : ''}` : '';
      try {
        const data = await api.get<Timeline | PostView[]>(`${path}${qs}`);
        const batch = Array.isArray(data) ? data : data.posts;
        const nb = Array.isArray(data) ? null : data.next_before;
        const nbid = Array.isArray(data) ? undefined : data.next_before_id ?? undefined;
        setPosts((p) => (reset ? batch : [...p, ...batch]));
        setCursor(nb ? { before: nb, id: nbid ?? undefined } : null);
        setDone(!nb || batch.length === 0);
      } catch {
        setDone(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path, cursor, done, loading],
  );

  // Which posts are on-screen → their videos autoplay (muted). FlatList requires
  // the viewability callback + config to be stable refs across renders.
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 60 }), []);
  const onViewableItemsChanged = useCallback((info: { viewableItems: { item?: PostView }[] }) => {
    setVisibleIds(new Set(info.viewableItems.map((v) => v.item?.id).filter((x): x is string => !!x)));
  }, []);

  // reload when the tab changes (the federated tab manages its own list)
  useEffect(() => {
    if (tab === 'federated') return;
    setPosts([]);
    setCursor(null);
    setDone(false);
    setLoading(true);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onRefresh = () => {
    setRefreshing(true);
    setCursor(null);
    setDone(false);
    load(true);
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      {/* Brand bar */}
      <View style={s.topbar}>
        <Brand size={22} />
        <View style={s.topActions}>
          <Pressable onPress={toggle} hitSlop={8} style={s.iconBtn}>
            <Ionicons name="contrast-outline" size={20} color={colors.onSurfaceVariant} />
          </Pressable>
          {me ? (
            <Pressable onPress={() => router.push('/compose')} hitSlop={8} style={s.iconBtn}>
              <Ionicons name="add-circle" size={24} color={colors.primary} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/login')} hitSlop={8} style={s.iconBtn}>
              <Ionicons name="log-in-outline" size={22} color={colors.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {me ? (
          <Pressable
            style={[s.tab, tab === 'foryou' && s.tabActive]}
            onPress={() => setTab('foryou')}
          >
            <Text style={[s.tabText, tab === 'foryou' && s.tabTextActive]}>{t('home.foryou')}</Text>
          </Pressable>
        ) : null}
        <Pressable style={[s.tab, tab === 'global' && s.tabActive]} onPress={() => setTab('global')}>
          <Text style={[s.tabText, tab === 'global' && s.tabTextActive]}>{t('home.global')}</Text>
        </Pressable>
        <Pressable
          style={[s.tab, tab === 'federated' && s.tabActive]}
          onPress={() => setTab('federated')}
        >
          <Text style={[s.tabText, tab === 'federated' && s.tabTextActive]}>{t('home.federated')}</Text>
        </Pressable>
      </View>

      {tab === 'federated' ? (
        <FederatedFeed />
      ) : loading && posts.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <Post post={item} playing={visibleIds.has(item.id)} />}
          extraData={visibleIds}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onEndReachedThreshold={0.6}
          onEndReached={() => load(false)}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListHeaderComponent={<ProfileNudge />}
          ListEmptyComponent={
            <View>
              <Text style={s.empty}>{t('home.empty')}</Text>
              {tab === 'foryou' && me ? <SuggestedAccounts limit={6} /> : null}
            </View>
          }
          ListFooterComponent={
            done && posts.length > 0 ? <Text style={s.end}>{t('home.end')}</Text> : null
          }
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    topbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    brand: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5 },
    topActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    iconBtn: { padding: 2 },
    tabs: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 14,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.outlineVariant,
    },
    tab: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: c.surfaceLow },
    tabActive: { backgroundColor: c.primary },
    tabText: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurfaceVariant },
    tabTextActive: { color: c.onPrimary },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
    end: { color: c.fg3, textAlign: 'center', padding: 24, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1 },
  });
