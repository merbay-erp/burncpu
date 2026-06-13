import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';

import { api, mediaUrl, type PostView, type Timeline } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

// The "Reels"/Shorts tab — a full-screen, vertically-paged video feed backed by
// GET /feed/videos (public posts carrying a clip). One clip per swipe; the
// on-screen clip plays muted+looping, tap toggles sound. The normal timeline
// stays a mixed feed — this is the deliberate home for "kaydırma".

const VIDEO_RE = /!\[[^\]]*\]\((\/media\/[^)\s]+\.(?:mp4|webm|mov))\)/i;
const MEDIA_RE = /!\[[^\]]*\]\([^)]*\)/g;
const REACTION = '🐢';

function firstVideo(body: string): string | null {
  const m = VIDEO_RE.exec(body);
  return m ? m[1] : null;
}
function caption(body: string): string {
  return body.replace(MEDIA_RE, '').trim();
}

export default function Videos() {
  const { colors } = useTheme();
  useLocale();
  const s = styles(colors);

  const [posts, setPosts] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<{ before: string; id?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [h, setH] = useState(0);

  const load = useCallback(
    async (reset: boolean) => {
      if (!reset && (done || loading)) return;
      const qs =
        !reset && cursor
          ? `?limit=8&before=${encodeURIComponent(cursor.before)}${cursor.id ? `&before_id=${cursor.id}` : ''}`
          : '?limit=8';
      try {
        const data = await api.get<Timeline>(`/feed/videos${qs}`);
        const batch = data.posts.filter((p) => firstVideo(p.body));
        setPosts((p) => (reset ? batch : [...p, ...batch]));
        setCursor(data.next_before ? { before: data.next_before, id: data.next_before_id ?? undefined } : null);
        setDone(!data.next_before || data.posts.length === 0);
      } catch {
        setDone(true);
      } finally {
        setLoading(false);
      }
    },
    [cursor, done, loading],
  );

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The first ≥80%-visible page is the active one — only its video plays.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewRef = useRef((info: { viewableItems: Array<{ item?: PostView }> }) => {
    const first = info.viewableItems[0]?.item?.id;
    if (first) setActiveId(first);
  });

  return (
    <View style={s.screen} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {loading && posts.length === 0 ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />
      ) : posts.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="film-outline" size={44} color="rgba(255,255,255,0.4)" />
          <Text style={s.emptyTitle}>{t('videos.empty_title')}</Text>
          <Text style={s.emptyBody}>{t('videos.empty_body')}</Text>
        </View>
      ) : h > 0 ? (
        <FlatList
          style={s.list}
          data={posts}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <Slide post={item} height={h} active={activeId === item.id} />}
          extraData={activeId}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: h, offset: h * index, index })}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewRef.current}
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={1}
          removeClippedSubviews
          onEndReachedThreshold={1.2}
          onEndReached={() => load(false)}
        />
      ) : null}
    </View>
  );
}

function Slide({ post, height, active }: { post: PostView; height: number; active: boolean }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();

  const uri = mediaUrl(firstVideo(post.body)) ?? '';
  const text = caption(post.body);

  const [muted, setMuted] = useState(true);
  const [reacted, setReacted] = useState(!!post.viewer_reacted);
  const [reactions, setReactions] = useState(post.reactions_count);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);

  const toggleReact = async () => {
    if (!me) {
      router.push('/login');
      return;
    }
    if (reacted) {
      setReacted(false);
      setReactions((n) => Math.max(0, n - 1));
      await api.del(`/posts/${post.id}/react`).catch(() => {});
    } else {
      setReacted(true);
      setReactions((n) => n + 1);
      await api.post(`/posts/${post.id}/react`, { emoji: REACTION }).catch(() => {});
    }
  };

  const avatar = mediaUrl(post.author.avatar_url);

  return (
    <View style={[s.slide, { height }]}>
      <Pressable style={s.fill} onPress={() => setMuted((m) => !m)}>
        <VideoView style={s.fill} player={player} contentFit="contain" nativeControls={false} />
      </Pressable>

      {/* mute hint */}
      {muted ? (
        <View style={[s.muteHint, { top: insets.top + 10 }]}>
          <Ionicons name="volume-mute" size={14} color="#fff" />
          <Text style={s.muteText}>{t('videos.tap_sound')}</Text>
        </View>
      ) : null}

      {/* author + caption */}
      <View style={s.meta} pointerEvents="box-none">
        <Pressable style={s.author} onPress={() => router.push(`/u/${post.author.username}`)}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={{ fontSize: 14 }}>🐢</Text>
            </View>
          )}
          <View>
            <Text style={s.name}>{post.author.display_name || post.author.username}</Text>
            <Text style={s.handle}>@{post.author.username}</Text>
          </View>
        </Pressable>
        {text ? (
          <Text style={s.caption} numberOfLines={3}>
            {text}
          </Text>
        ) : null}
      </View>

      {/* react rail */}
      <View style={s.rail} pointerEvents="box-none">
        <Pressable style={s.railBtn} onPress={toggleReact}>
          <Text style={{ fontSize: 30, opacity: reacted ? 1 : 0.55 }}>{REACTION}</Text>
          <Text style={s.railCount}>{reactions}</Text>
        </Pressable>
        <Pressable style={s.railBtn} onPress={() => router.push(`/post/${post.id}`)}>
          <Ionicons name="chatbubble" size={28} color="#fff" />
          <Text style={s.railCount}>{post.replies_count}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = (_c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#000' },
    list: { flex: 1 },
    fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
    emptyTitle: { color: 'rgba(255,255,255,0.9)', fontFamily: fonts.semibold, fontSize: 15, marginTop: 12 },
    emptyBody: { color: 'rgba(255,255,255,0.55)', fontFamily: fonts.sans, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
    slide: { width: '100%', backgroundColor: '#000', justifyContent: 'center' },
    muteHint: {
      position: 'absolute',
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    muteText: { color: '#fff', fontFamily: fonts.mono, fontSize: 11 },
    meta: { position: 'absolute', left: 14, right: 80, bottom: 24 },
    author: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)' },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    name: { color: '#fff', fontFamily: fonts.bold, fontSize: 14, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
    handle: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.mono, fontSize: 11 },
    caption: {
      color: 'rgba(255,255,255,0.92)',
      fontFamily: fonts.sans,
      fontSize: 14,
      lineHeight: 19,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowRadius: 4,
    },
    rail: { position: 'absolute', right: 12, bottom: 28, alignItems: 'center', gap: 18 },
    railBtn: { alignItems: 'center', gap: 3 },
    railCount: { color: '#fff', fontFamily: fonts.mono, fontSize: 12, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  });
