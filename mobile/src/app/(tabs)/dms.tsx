import { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import ScreenHeader from '@/components/ScreenHeader';
import LoginGate from '@/components/LoginGate';
import Avatar from '@/components/Avatar';
import { api, lookupUsers, type Author } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';
import { refreshUnread } from '@/unread';

// Matches the server's ThreadSummary (flat fields, not a nested `other`).
interface DmThread {
  id: string;
  other_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_url?: string | null;
  last_body?: string | null;
  last_sender_id?: string | null;
  last_message_at: string;
  unread_count: number;
}

export default function DMs() {
  const { colors } = useTheme();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [threads, setThreads] = useState<DmThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Author[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setThreads(await api.get<DmThread[]>('/dm/threads'));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (me) {
        load();
        refreshUnread();
      } else {
        setLoading(false);
      }
    }, [me, load]),
  );

  const onQuery = (v: string) => {
    setQuery(v);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const q = v.trim();
    if (!q) {
      setResults([]);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      try {
        const r = await lookupUsers(q);
        setResults(r.filter((u) => u.username !== me?.username));
      } catch {
        setResults([]);
      }
    }, 180);
  };

  const openThread = (username: string) => {
    setComposing(false);
    setQuery('');
    setResults([]);
    router.push(`/dm/${username}`);
  };

  const deleteThread = (th: DmThread) => {
    Alert.alert(t('dm.delete_conv'), t('dm.delete_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('post.delete'),
        style: 'destructive',
        onPress: async () => {
          setThreads((ts) => ts.filter((x) => x.id !== th.id));
          try {
            await api.del(`/dm/threads/${th.other_username}`);
            refreshUnread();
          } catch {
            load();
          }
        },
      },
    ]);
  };

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setThreads((ts) => ts.filter((x) => !selected.has(x.id)));
    setSelected(new Set<string>());
    setSelectMode(false);
    try {
      await api.post('/dm/threads/clear', { ids });
      refreshUnread();
    } catch {
      load();
    }
  };

  if (!me) return <LoginGate />;

  return (
    <View style={s.screen}>
      <ScreenHeader title={t('nav.dms')} />

      <View style={s.toolbar}>
        {selectMode ? (
          <>
            <Pressable onPress={bulkDelete} disabled={selected.size === 0} style={[s.toolBtn, s.toolBtnDanger, selected.size === 0 && { opacity: 0.4 }]}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={[s.toolBtnText, { color: colors.error }]}>
                {t('dm.delete_selected')}
                {selected.size > 0 ? ` (${selected.size})` : ''}
              </Text>
            </Pressable>
            <Pressable onPress={() => { setSelectMode(false); setSelected(new Set<string>()); }} style={s.toolBtn}>
              <Text style={s.toolBtnText}>{t('common.cancel')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={() => { setComposing((v) => !v); setQuery(''); setResults([]); }} style={[s.toolBtn, s.toolBtnPrimary]}>
              <Ionicons name={composing ? 'close' : 'create-outline'} size={16} color={colors.onPrimary} />
              <Text style={[s.toolBtnText, { color: colors.onPrimary }]}>{composing ? t('common.cancel') : t('dm.new')}</Text>
            </Pressable>
            {threads.length > 0 ? (
              <Pressable onPress={() => setSelectMode(true)} style={s.toolBtn}>
                <Ionicons name="ellipsis-horizontal-circle-outline" size={16} color={colors.onSurfaceVariant} />
                <Text style={s.toolBtnText}>{t('dm.select')}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      {composing ? (
        <View style={s.composeBox}>
          <TextInput
            style={s.searchInput}
            placeholder={t('dm.search_user')}
            placeholderTextColor={colors.fg3}
            value={query}
            onChangeText={onQuery}
            autoFocus
            autoCapitalize="none"
          />
          {results.map((u) => (
            <Pressable key={u.id} onPress={() => openThread(u.username)} style={s.resultRow}>
              <Avatar uri={u.avatar_url} name={u.display_name} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{u.display_name}</Text>
                <Text style={s.preview} numberOfLines={1}>@{u.username}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(th) => th.id}
          extraData={`${selectMode}-${selected.size}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
          }
          ListEmptyComponent={<Text style={s.empty}>{t('dm.empty')}</Text>}
          renderItem={({ item }) => {
            const sel = selected.has(item.id);
            return (
              <Pressable
                onPress={() => (selectMode ? toggleSel(item.id) : router.push(`/dm/${item.other_username}`))}
                onLongPress={() => (selectMode ? toggleSel(item.id) : deleteThread(item))}
                style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceLow }]}
              >
                {selectMode ? (
                  <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={22} color={sel ? colors.primary : colors.onSurfaceVariant} />
                ) : null}
                <Avatar uri={item.other_avatar_url} name={item.other_display_name} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={s.line}>
                    <Text style={s.name} numberOfLines={1}>{item.other_display_name}</Text>
                    {item.last_message_at ? <Text style={s.time}>{relTime(item.last_message_at)}</Text> : null}
                  </View>
                  <Text style={s.preview} numberOfLines={1}>{item.last_body ?? `@${item.other_username}`}</Text>
                </View>
                {item.unread_count > 0 && !selectMode ? <View style={s.dot} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.outlineVariant },
    toolBtnPrimary: { backgroundColor: c.primary, borderColor: c.primary },
    toolBtnDanger: { borderColor: c.error },
    toolBtnText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 13 },
    composeBox: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.outlineVariant, gap: 6 },
    searchInput: { backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: c.onSurface, fontSize: 14 },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    name: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 14, flex: 1 },
    time: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11 },
    preview: { color: c.onSurfaceVariant, fontSize: 13, marginTop: 2 },
    dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
