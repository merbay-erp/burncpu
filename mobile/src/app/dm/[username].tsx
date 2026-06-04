import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import Sheet from '@/components/Sheet';
import { api, API_ORIGIN, mediaUrl } from '@/api';
import { openEventStream } from '@/sse';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';
import { refreshUnread } from '@/unread';

const DM_EMOJI = ['🔥', '🐢', '🤝', '🙏', '😂'];

interface DmReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  body_html?: string;
  media_url?: string | null;
  media_kind?: string | null;
  media_state?: string | null;
  media_poster_url?: string | null;
  media_duration_ms?: number | null;
  reactions?: DmReaction[];
  read_at?: string | null;
  created_at: string;
}

interface ThreadView {
  messages: DmMessage[];
}

export default function DmThread() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  const { username } = useLocalSearchParams<{ username: string }>();
  useLocale();
  const s = styles(colors);

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [actionMsg, setActionMsg] = useState<DmMessage | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const listRef = useRef<FlatList<DmMessage>>(null);
  const typingClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await api.get<ThreadView>(`/dm/threads/${username}`);
      setMessages(data.messages ?? []);
      api.patch(`/dm/threads/${username}/read`).then(() => refreshUnread()).catch(() => {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  // While any attached video is still transcoding, poll so the player swaps in
  // automatically once it's ready — no manual refresh.
  useEffect(() => {
    const pending = messages.some(
      (m) => m.media_kind === 'video' && (m.media_state === 'pending' || m.media_state === 'processing'),
    );
    if (!pending) return;
    const t = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(t);
  }, [messages, load]);

  // Live updates via SSE: typing indicator + auto-refresh when a message lands.
  useEffect(() => {
    const close = openEventStream('/notifications/stream', (e) => {
      const ev = e as { kind?: string; actor_username?: string };
      if (ev?.actor_username !== username) return;
      if (ev.kind === 'typing') {
        setTyping(true);
        if (typingClear.current) clearTimeout(typingClear.current);
        typingClear.current = setTimeout(() => setTyping(false), 3000);
      } else if (ev.kind === 'dm') {
        load();
      }
    });
    return () => {
      close();
      if (typingClear.current) clearTimeout(typingClear.current);
    };
  }, [username, load]);

  const onType = (v: string) => {
    setText(v);
    const now = Date.now();
    if (v.trim() && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      api.post(`/dm/threads/${username}/typing`).catch(() => {});
    }
  };

  const pickMedia = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const isVideo = asset.type === 'video';
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', {
        uri: asset.uri,
        name: asset.fileName ?? (isVideo ? 'video.mp4' : 'image.jpg'),
        type: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
      } as unknown as Blob);
      const r = await fetch(`${API_ORIGIN}/api/v1/media`, { method: 'POST', body: fd, credentials: 'include', headers: { Origin: API_ORIGIN } });
      if (!r.ok) throw new Error();
      const m = (await r.json()) as { url: string };
      setPendingMedia({ url: m.url, kind: isVideo ? 'video' : 'image' });
    } catch {
      Alert.alert('burncpu', t('common.error'));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && !pendingMedia) || sending) return;
    setSending(true);
    const media = pendingMedia;
    setText('');
    setPendingMedia(null);
    try {
      const msg = await api.post<DmMessage>(`/dm/threads/${username}`, {
        body,
        media_url: media?.url,
        media_kind: media?.kind,
      });
      setMessages((m) => [...m, msg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      setText(body);
      setPendingMedia(media);
    } finally {
      setSending(false);
    }
  };

  const patchMsg = (id: string, fn: (m: DmMessage) => DmMessage) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const toggleReact = async (msg: DmMessage, emoji: string) => {
    setActionMsg(null);
    const mineNow = msg.reactions?.find((r) => r.mine);
    const removing = mineNow?.emoji === emoji;
    patchMsg(msg.id, (m) => {
      let rx = (m.reactions ?? []).map((r) => ({ ...r }));
      if (mineNow) {
        rx = rx
          .map((r) => (r.emoji === mineNow.emoji ? { ...r, count: r.count - 1, mine: false } : r))
          .filter((r) => r.count > 0);
      }
      if (!removing) {
        const ex = rx.find((r) => r.emoji === emoji);
        if (ex) {
          ex.count += 1;
          ex.mine = true;
        } else {
          rx.push({ emoji, count: 1, mine: true });
        }
      }
      return { ...m, reactions: rx };
    });
    try {
      if (removing) await api.del(`/dm/messages/${msg.id}/react`);
      else await api.post(`/dm/messages/${msg.id}/react`, { emoji });
    } catch {
      load();
    }
  };

  const deleteMsg = (id: string) => {
    setActionMsg(null);
    setMessages((ms) => ms.filter((m) => m.id !== id));
    api.del(`/dm/messages/${id}`).then(() => refreshUnread()).catch(() => load());
  };

  const renderMessage = ({ item }: { item: DmMessage }) => {
    const mine = item.sender_id === me?.user_id;
    return (
      <View style={[s.bubbleRow, mine ? s.right : s.left]}>
        <View style={{ maxWidth: '82%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
          <Pressable onLongPress={() => setActionMsg(item)} style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
            {item.media_url && item.media_kind === 'image' ? (
              <Pressable onPress={() => setViewer(mediaUrl(item.media_url) ?? null)}>
                <Image source={{ uri: mediaUrl(item.media_url) }} style={s.media} contentFit="cover" />
              </Pressable>
            ) : null}
            {item.media_url && item.media_kind === 'video' ? (
              item.media_state === 'pending' || item.media_state === 'processing' ? (
                <View style={[s.media, s.videoPlaceholder]}>
                  <ActivityIndicator color="#fff" />
                  <Text style={s.videoNote}>İşleniyor…</Text>
                </View>
              ) : item.media_state === 'failed' ? (
                <View style={[s.media, s.videoPlaceholder]}>
                  <Ionicons name="warning-outline" size={30} color="#fff" />
                  <Text style={s.videoNote}>İşlenemedi</Text>
                </View>
              ) : (
                <Pressable onPress={() => Linking.openURL(mediaUrl(item.media_url) ?? '')} style={[s.media, s.videoPlaceholder]}>
                  {item.media_poster_url ? (
                    <Image source={{ uri: mediaUrl(item.media_poster_url) }} style={s.mediaAbs} contentFit="cover" />
                  ) : null}
                  <Ionicons name="play-circle" size={42} color="#fff" />
                </Pressable>
              )
            ) : null}
            {item.body ? <Text style={mine ? s.textMine : s.textOther}>{item.body}</Text> : null}
            <View style={s.metaRow}>
              <Text style={[s.metaTime, { color: mine ? colors.onPrimary : colors.onSurfaceVariant }]}>{relTime(item.created_at)}</Text>
              {mine ? (
                <Ionicons
                  name={item.read_at ? 'checkmark-done' : 'checkmark'}
                  size={15}
                  color={item.read_at ? '#38bdf8' : colors.onPrimary}
                  style={{ opacity: item.read_at ? 1 : 0.6 }}
                />
              ) : null}
            </View>
          </Pressable>
          {item.reactions && item.reactions.length > 0 ? (
            <View style={s.reactRow}>
              {item.reactions.map((r) => (
                <Pressable key={r.emoji} onPress={() => toggleReact(item, r.emoji)} style={[s.reactChip, r.mine && s.reactChipMine]}>
                  <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                  <Text style={s.reactCount}>{r.count}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0} style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Pressable onPress={() => router.push(`/u/${username}`)} style={{ alignItems: 'center' }}>
          <Text style={s.title}>@{username}</Text>
          {typing ? <Text style={s.typing}>{t('dm.typing')}</Text> : null}
        </Pressable>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={renderMessage}
        />
      )}

      {pendingMedia ? (
        <View style={s.pendingRow}>
          {pendingMedia.kind === 'video' ? (
            <View style={[s.pendingThumb, s.videoPlaceholder]}>
              <Ionicons name="videocam" size={22} color="#fff" />
            </View>
          ) : (
            <Image source={{ uri: mediaUrl(pendingMedia.url) }} style={s.pendingThumb} contentFit="cover" />
          )}
          <Pressable onPress={() => setPendingMedia(null)} hitSlop={8}>
            <Ionicons name="close-circle" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
      ) : null}

      <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable onPress={pickMedia} disabled={uploading} hitSlop={8} style={{ paddingBottom: 6 }}>
          <Ionicons name={uploading ? 'hourglass-outline' : 'image-outline'} size={24} color={uploading ? colors.fg3 : colors.primary} />
        </Pressable>
        <TextInput style={s.input} placeholder="…" placeholderTextColor={colors.fg3} value={text} onChangeText={onType} multiline />
        <Pressable
          style={[s.sendBtn, ((!text.trim() && !pendingMedia) || sending) && { opacity: 0.4 }]}
          onPress={send}
          disabled={(!text.trim() && !pendingMedia) || sending}
        >
          <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>

      <Sheet
        visible={!!actionMsg}
        onClose={() => setActionMsg(null)}
        options={[
          ...DM_EMOJI.map((e) => ({ label: e, onPress: () => actionMsg && toggleReact(actionMsg, e) })),
          ...(actionMsg && actionMsg.sender_id === me?.user_id
            ? [{ label: t('post.delete'), icon: 'trash-outline' as keyof typeof Ionicons.glyphMap, danger: true, onPress: () => actionMsg && deleteMsg(actionMsg.id) }]
            : []),
        ]}
      />

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewerBg} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={s.viewerImg} contentFit="contain" /> : null}
          <Pressable style={[s.viewerClose, { top: insets.top + 10 }]} onPress={() => setViewer(null)} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 16 },
    typing: { color: c.primary, fontFamily: fonts.mono, fontSize: 11, marginTop: 1 },
    bubbleRow: { flexDirection: 'row' },
    left: { justifyContent: 'flex-start' },
    right: { justifyContent: 'flex-end' },
    bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
    bubbleMine: { backgroundColor: c.primary, borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: c.surfaceHigh, borderBottomLeftRadius: 4 },
    textMine: { color: c.onPrimary, fontSize: 15, lineHeight: 20 },
    textOther: { color: c.onSurface, fontSize: 15, lineHeight: 20 },
    media: { width: 200, height: 200, borderRadius: 10, marginBottom: 4, backgroundColor: c.surfaceLow },
    videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
    mediaAbs: { position: 'absolute', top: 0, left: 0, width: 200, height: 200, borderRadius: 10 },
    videoNote: { color: '#fff', fontSize: 11, marginTop: 4 },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 },
    metaTime: { fontFamily: fonts.mono, fontSize: 10, opacity: 0.7 },
    reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
    reactChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: c.outlineVariant, backgroundColor: c.surfaceLow },
    reactChipMine: { borderColor: c.primary, backgroundColor: `${c.primary}1a` },
    reactCount: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11 },
    pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    pendingThumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: c.surfaceLow },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    input: { flex: 1, maxHeight: 120, backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: c.onSurface, fontSize: 15 },
    sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    viewerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
    viewerImg: { width: '100%', height: '100%' },
    viewerClose: { position: 'absolute', right: 16 },
  });
