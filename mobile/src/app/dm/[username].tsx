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
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api';
import { openEventStream } from '@/sse';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';
import { refreshUnread } from '@/unread';

interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  body_html?: string;
  read_at?: string | null;
  created_at: string;
}

// GET /dm/threads/{u} returns a ThreadView object, not a bare array.
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

  // Live typing indicator via SSE. A "typing" event from the other user shows
  // the badge; when it stops (3s quiet) we clear it + refetch (they likely sent).
  useEffect(() => {
    const close = openEventStream('/notifications/stream', (e) => {
      const ev = e as { kind?: string; actor_username?: string };
      if (ev?.kind === 'typing' && ev.actor_username === username) {
        setTyping(true);
        if (typingClear.current) clearTimeout(typingClear.current);
        typingClear.current = setTimeout(() => {
          setTyping(false);
          load();
        }, 3000);
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

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText('');
    try {
      const msg = await api.post<DmMessage>(`/dm/threads/${username}`, { body });
      setMessages((m) => [...m, msg]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      setText(body);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={s.screen}
    >
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
          contentContainerStyle={{ padding: 12, gap: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.sender_id === me?.user_id;
            return (
              <View style={[s.bubbleRow, mine ? s.right : s.left]}>
                <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
                  <Text style={mine ? s.textMine : s.textOther}>
                    {item.body}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      <View style={[s.inputRow, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={s.input}
          placeholder="…"
          placeholderTextColor={colors.fg3}
          value={text}
          onChangeText={onType}
          multiline
        />
        <Pressable style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]} onPress={send} disabled={!text.trim() || sending}>
          <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>
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
    bubble: { maxWidth: '78%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16 },
    bubbleMine: { backgroundColor: c.primary, borderBottomRightRadius: 4 },
    bubbleOther: { backgroundColor: c.surfaceHigh, borderBottomLeftRadius: 4 },
    textMine: { color: c.onPrimary, fontSize: 15, lineHeight: 20 },
    textOther: { color: c.onSurface, fontSize: 15, lineHeight: 20 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    input: { flex: 1, maxHeight: 120, backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, color: c.onSurface, fontSize: 15 },
    sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  });
