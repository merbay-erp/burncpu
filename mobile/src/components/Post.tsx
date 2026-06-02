import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import Avatar from './Avatar';
import RichText from './RichText';
import Sheet from './Sheet';
import LinkCard from './LinkCard';
import { api, mediaUrl, type PostView, type PostEditVersion } from '@/api';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { relTime, firstUrl } from '@/util';
import { t, useLocale } from '@/i18n';

const REACTION = '🐢';
const IMG_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

function splitMedia(body: string): { text: string; images: string[] } {
  const images: string[] = [];
  const text = body.replace(IMG_RE, (_full, url: string) => {
    images.push(url);
    return '';
  });
  return { text: text.trim(), images };
}

export default function Post({ post }: { post: PostView }) {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [reacted, setReacted] = useState(!!post.viewer_reacted);
  const [reactions, setReactions] = useState(post.reactions_count);
  const [bookmarked, setBookmarked] = useState(!!post.viewer_bookmarked);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PostEditVersion[] | null>(null);
  const [historyErr, setHistoryErr] = useState(false);
  const [cwOpen, setCwOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [hideLinkUrl, setHideLinkUrl] = useState(false);
  const media = splitMedia(post?.body ?? '');
  const linkUrl = firstUrl(media.text);
  const bodyText = hideLinkUrl && linkUrl ? media.text.replace(linkUrl, '').trim() : media.text;
  const mine = post?.author?.id === me?.user_id;

  const reactWith = async (emoji: string) => {
    if (!me) return router.push('/login');
    if (!reacted) {
      setReacted(true);
      setReactions((n) => n + 1);
    }
    try {
      await api.post(`/posts/${post.id}/react`, { emoji });
    } catch {
      /* keep optimistic */
    }
  };

  const confirmDelete = () =>
    Alert.alert(t('post.delete_confirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('post.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/posts/${post.id}`);
            setDeleted(true);
          } catch {
            Alert.alert('burncpu', t('common.error'));
          }
        },
      },
    ]);

  const report = async () => {
    try {
      await api.post('/reports', { target_kind: 'post', target_id: post.id, reason: 'inappropriate' });
      Alert.alert('burncpu', t('post.reported'));
    } catch {
      /* ignore */
    }
  };

  if (deleted || !post?.author) return null;

  const react = async () => {
    if (!me) return router.push('/login');
    const next = !reacted;
    setReacted(next);
    setReactions((n) => n + (next ? 1 : -1));
    try {
      if (next) await api.post(`/posts/${post.id}/react`, { emoji: REACTION });
      else await api.del(`/posts/${post.id}/react`);
    } catch {
      setReacted(!next);
      setReactions((n) => n + (next ? -1 : 1));
    }
  };

  const bookmark = async () => {
    if (!me) return router.push('/login');
    const next = !bookmarked;
    setBookmarked(next);
    try {
      if (next) await api.post(`/bookmarks/${post.id}`);
      else await api.del(`/bookmarks/${post.id}`);
    } catch {
      setBookmarked(!next);
    }
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null) {
      try {
        setHistory(await api.get<PostEditVersion[]>(`/posts/${post.id}/history`));
      } catch {
        setHistoryErr(true);
      }
    }
  };

  return (
    <Pressable
      onPress={() => router.push(`/post/${post.id}`)}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: colors.surfaceLow }]}
    >
      <Pressable style={s.menuBtn} onPress={() => setMenuOpen(true)} hitSlop={8}>
        <Ionicons name="ellipsis-horizontal" size={16} color={colors.onSurfaceVariant} />
      </Pressable>
      <View style={s.row}>
        <Pressable onPress={() => router.push(`/u/${post.author.username}`)}>
          <Avatar uri={post.author.avatar_url} name={post.author.display_name} size={42} />
        </Pressable>
        <View style={s.main}>
          <View style={s.headerLine}>
            <Text style={s.name} numberOfLines={1}>
              {post.author.display_name}
            </Text>
            <Text style={s.handle} numberOfLines={1}>
              @{post.author.username}
            </Text>
            <Text style={s.meta}> · {relTime(post.created_at)}</Text>
            {post.edited_at ? (
              <Pressable onPress={toggleHistory} hitSlop={6}>
                <Text style={s.meta}> · {t('post.edit_marker')}</Text>
              </Pressable>
            ) : null}
          </View>

          {post.content_warning && !cwOpen ? (
            <Pressable style={s.cw} onPress={() => setCwOpen(true)}>
              <Text style={s.cwLabel}>⚠ {post.content_warning}</Text>
              <Text style={s.cwShow}>{t('post.cw_show')} ↓</Text>
            </Pressable>
          ) : (
            <>
              {bodyText ? <RichText body={bodyText} style={s.body} /> : null}
              {media.images.map((url, i) => (
                <Image
                  key={i}
                  source={{ uri: mediaUrl(url) }}
                  style={s.media}
                  contentFit="cover"
                  transition={120}
                />
              ))}
              {linkUrl ? <LinkCard url={linkUrl} onResolved={setHideLinkUrl} /> : null}
            </>
          )}

          {showHistory ? (
            <View style={s.history}>
              <Text style={s.historyTitle}>{t('post.history_title')}</Text>
              {historyErr ? <Text style={s.historyErr}>{t('post.history_error')}</Text> : null}
              {history === null && !historyErr ? <Text style={s.meta}>…</Text> : null}
              {history && history.length === 0 ? (
                <Text style={s.meta}>{t('post.history_empty')}</Text>
              ) : null}
              {(history ?? []).map((v, i) => (
                <View key={i} style={s.historyItem}>
                  <Text style={s.historyTime}>{relTime(v.edited_at)}</Text>
                  <Text style={s.historyBody}>{v.body}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={s.footer}>
            <Pressable
              style={s.action}
              onPress={() => router.push(me ? `/compose?replyTo=${post.id}` : '/login')}
              hitSlop={6}
            >
              <Ionicons name="chatbubble-outline" size={17} color={colors.onSurfaceVariant} />
              {post.replies_count > 0 ? <Text style={s.count}>{post.replies_count}</Text> : null}
            </Pressable>
            <Pressable style={s.action} onPress={react} onLongPress={() => setReactOpen(true)} hitSlop={6}>
              <Text style={{ fontSize: 16, opacity: reacted ? 1 : 0.5 }}>{REACTION}</Text>
              {reactions > 0 ? (
                <Text style={[s.count, reacted && { color: colors.primary }]}>{reactions}</Text>
              ) : null}
            </Pressable>
            <Pressable style={s.action} onPress={bookmark} hitSlop={6}>
              <Ionicons
                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                size={17}
                color={bookmarked ? colors.primary : colors.onSurfaceVariant}
              />
            </Pressable>
          </View>
        </View>
      </View>

      <Sheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        options={
          mine
            ? [
                { label: t('post.edit'), icon: 'create-outline', onPress: () => router.push(`/compose?editId=${post.id}`) },
                { label: t('post.delete'), icon: 'trash-outline', danger: true, onPress: confirmDelete },
              ]
            : [{ label: t('post.report'), icon: 'flag-outline', onPress: report }]
        }
      />
      <Sheet
        visible={reactOpen}
        onClose={() => setReactOpen(false)}
        title={t('post.react')}
        options={['🐢', '❤️', '😂', '🔥', '👀', '🎉'].map((e) => ({ label: e, onPress: () => reactWith(e) }))}
      />
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    menuBtn: { position: 'absolute', top: 10, right: 10, padding: 4, zIndex: 2 },
    row: { flexDirection: 'row', gap: 10 },
    main: { flex: 1, minWidth: 0 },
    headerLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
    name: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 14, maxWidth: '55%' },
    handle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12, marginLeft: 4 },
    meta: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
    body: { color: c.onSurface, fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, marginTop: 4 },
    cw: { marginTop: 6, padding: 10, backgroundColor: c.surface, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius },
    cwLabel: { color: c.primary, fontFamily: fonts.mono, fontSize: 12 },
    cwShow: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, marginTop: 6 },
    media: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius, marginTop: 8, backgroundColor: c.surfaceHigh },
    history: { marginTop: 8, padding: 10, backgroundColor: c.surface, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius },
    historyTitle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
    historyErr: { color: c.error, fontFamily: fonts.mono, fontSize: 12 },
    historyItem: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    historyTime: { color: c.fg3, fontFamily: fonts.mono, fontSize: 10, marginBottom: 2 },
    historyBody: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 18 },
    footer: { flexDirection: 'row', gap: 22, marginTop: 10 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    count: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
  });
