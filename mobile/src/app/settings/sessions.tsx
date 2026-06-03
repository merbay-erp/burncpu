import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, type SecurityInfo, type SessionView, type SecurityEvent } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { relTime } from '@/util';
import { t, useLocale } from '@/i18n';

export default function Sessions() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [data, setData] = useState<SecurityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<SecurityInfo>('/users/me/security')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    if (me) load();
  }, [me]);

  const revoke = async (id: string) => {
    setData((d) => (d ? { ...d, sessions: d.sessions.filter((x) => x.id !== id) } : d));
    await api.del(`/users/me/sessions/${id}`).catch(() => load());
  };

  const revokeOthers = () => {
    const others = (data?.sessions ?? []).filter((x) => !x.current).length;
    if (!others || busy) return;
    Alert.alert(t('sessions.revoke_others'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('sessions.revoke'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api.del<{ revoked: number }>('/users/me/sessions');
            load();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('settings.sessions')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
          {(data?.sessions ?? []).length === 0 ? (
            <Text style={s.empty}>{t('sessions.empty')}</Text>
          ) : (
            (data?.sessions ?? []).map((sess) => <SessionRow key={sess.id} sess={sess} onRevoke={revoke} c={colors} />)
          )}

          {(data?.sessions ?? []).some((x) => !x.current) ? (
            <Pressable style={[s.revokeAll, busy && { opacity: 0.5 }]} onPress={revokeOthers} disabled={busy}>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={s.revokeAllText}>{t('sessions.revoke_others')}</Text>
            </Pressable>
          ) : null}

          {(data?.events ?? []).length > 0 ? (
            <>
              <Text style={s.section}>{t('sessions.events')}</Text>
              {(data?.events ?? []).slice(0, 25).map((e, i) => (
                <EventRow key={i} e={e} c={colors} />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Bilinmeyen cihaz';
  if (/burncpu|okhttp|expo/i.test(ua)) return 'burncpu (mobil)';
  if (/iphone/i.test(ua)) return 'iPhone · Safari';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  if (/mac os x|macintosh/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows';
  if (/linux/i.test(ua)) return 'Linux';
  return ua.slice(0, 40);
}

function SessionRow({ sess, onRevoke, c }: { sess: SessionView; onRevoke: (id: string) => void; c: Palette }) {
  const s = styles(c);
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.device}>{deviceLabel(sess.last_seen_ua)}</Text>
          {sess.current ? (
            <View style={s.badge}>
              <Text style={s.badgeText}>{t('sessions.current')}</Text>
            </View>
          ) : null}
          {sess.flagged ? <Ionicons name="warning" size={14} color={c.error} /> : null}
        </View>
        <Text style={s.meta}>
          {sess.last_seen_ip ?? '—'} · {relTime(sess.last_seen_at)}
        </Text>
      </View>
      {!sess.current ? (
        <Pressable onPress={() => onRevoke(sess.id)} hitSlop={8}>
          <Text style={s.revoke}>{t('sessions.revoke')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EventRow({ e, c }: { e: SecurityEvent; c: Palette }) {
  const s = styles(c);
  const ok = e.outcome === 'ok' || e.outcome === 'success';
  return (
    <View style={s.eventRow}>
      <Ionicons name={ok ? 'shield-checkmark-outline' : 'alert-circle-outline'} size={16} color={ok ? c.onSurfaceVariant : c.error} />
      <Text style={s.eventKind}>
        {e.kind} · {e.outcome}
      </Text>
      <Text style={s.eventMeta}>
        {e.ip ?? ''} {relTime(e.ts)}
      </Text>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    section: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 26, paddingBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.outlineVariant, gap: 10 },
    device: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 15 },
    meta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12, marginTop: 3 },
    badge: { backgroundColor: `${c.primary}26`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { color: c.primary, fontFamily: fonts.semibold, fontSize: 10 },
    revoke: { color: c.error, fontFamily: fonts.semibold, fontSize: 13 },
    revokeAll: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 16, marginTop: 6 },
    revokeAllText: { color: c.error, fontFamily: fonts.semibold, fontSize: 15 },
    eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 9 },
    eventKind: { flex: 1, color: c.onSurface, fontFamily: fonts.mono, fontSize: 12 },
    eventMeta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
