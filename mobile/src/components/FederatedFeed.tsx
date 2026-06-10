import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Linking,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Avatar from './Avatar';
import { api, mediaUrl } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t } from '@/i18n';

interface RemotePost {
  uri: string;
  actor_uri: string;
  actor_handle: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  content_html: string;
  url: string | null;
  published_at: string;
}

interface FederatedResponse {
  posts: RemotePost[];
  next_before: string | null;
}

// The federated explore timeline (GET /feed/federated) — read-only remote posts
// the instance consumed from the fediverse. Server-side the HTML is already
// ammonia-sanitized; RN has no HTML renderer, so we flatten it to plain text and
// link out to the original for the full view. No reactions/replies — these are
// off-instance posts.
export default function FederatedFeed() {
  const { colors } = useTheme();
  const s = styles(colors);

  const [posts, setPosts] = useState<RemotePost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      if (!reset && (done || loading)) return;
      const qs = !reset && cursor ? `?limit=30&before=${encodeURIComponent(cursor)}` : '?limit=30';
      try {
        const data = await api.get<FederatedResponse>(`/feed/federated${qs}`);
        setPosts((p) => (reset ? data.posts : [...p, ...data.posts]));
        setCursor(data.next_before);
        setDone(!data.next_before || data.posts.length === 0);
      } catch {
        setDone(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [cursor, done, loading],
  );

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setCursor(null);
    setDone(false);
    load(true);
  };

  const who = (p: RemotePost) => p.actor_name || p.actor_handle || hostOf(p.actor_uri) || '…';

  if (loading && posts.length === 0) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.uri}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      onEndReachedThreshold={0.6}
      onEndReached={() => load(false)}
      ListEmptyComponent={<Text style={s.empty}>{t('federated.empty')}</Text>}
      renderItem={({ item }) => (
        <View style={s.card}>
          <View style={s.head}>
            <Avatar uri={mediaUrl(item.actor_avatar)} name={who(item)} size={36} />
            <View style={s.names}>
              <Text style={s.name} numberOfLines={1}>
                {who(item)}
              </Text>
              {item.actor_handle ? (
                <Text style={s.handle} numberOfLines={1}>
                  {item.actor_handle}
                </Text>
              ) : null}
            </View>
            <Text style={s.time}>{relTime(item.published_at)}</Text>
          </View>
          <Text style={s.body}>{htmlToText(item.content_html)}</Text>
          {item.url ? (
            <Pressable style={s.original} onPress={() => Linking.openURL(item.url!)}>
              <Ionicons name="open-outline" size={14} color={colors.primary} />
              <Text style={s.originalText}>{t('federated.original')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    />
  );
}

function hostOf(uri: string): string | null {
  const m = uri.match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : null;
}

/// Flatten sanitized HTML to readable plain text: paragraph/line tags become
/// newlines, other tags are stripped, the few entities ammonia emits decoded.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 14,
      marginTop: 12,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.outlineVariant,
      backgroundColor: c.surfaceLowest,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    names: { flex: 1, minWidth: 0 },
    name: { fontFamily: fonts.semibold, fontSize: 14.5, color: c.onSurface },
    handle: { fontFamily: fonts.mono, fontSize: 11.5, color: c.onSurfaceVariant },
    time: { fontFamily: fonts.mono, fontSize: 11.5, color: c.onSurfaceVariant },
    body: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21, color: c.onSurface, marginTop: 8 },
    original: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
    originalText: { fontFamily: fonts.semibold, fontSize: 12.5, color: c.primary },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
