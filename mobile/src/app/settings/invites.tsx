import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, API_ORIGIN, type Invite, type InviteCreated } from '@/api';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { relTime, shareText } from '@/util';
import { t, useLocale } from '@/i18n';

export default function Invites() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [items, setItems] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<Invite[]>('/invites')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    if (me) load();
  }, [me]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const inv = await api.post<InviteCreated>('/invites');
      await shareText(inv.url, t('invites.title'));
      load();
    } catch (e) {
      Alert.alert('burncpu', (e as Error).message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const copy = (code: string) => shareText(`${API_ORIGIN}/invite/${code}`, t('invites.title'));

  const revoke = (code: string) => {
    setItems((prev) => prev.filter((i) => i.code !== code));
    api.del(`/invites/${code}`).catch(() => load());
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('invites.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.code}
          contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
          ListHeaderComponent={
            <View style={s.top}>
              <Text style={s.note}>{t('invites.note')}</Text>
              <Pressable style={[s.create, busy && { opacity: 0.5 }]} onPress={create} disabled={busy}>
                <Ionicons name="add" size={18} color={colors.onPrimary} />
                <Text style={s.createText}>{t('invites.create')}</Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={<Text style={s.empty}>{t('invites.empty')}</Text>}
          renderItem={({ item }) => {
            const used = !!item.redeemed_at;
            return (
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.code, used && { color: colors.fg3, textDecorationLine: 'line-through' }]} selectable>
                    {item.code}
                  </Text>
                  <Text style={s.meta}>
                    {used ? t('invites.redeemed') : `${t('invites.unused')} · ${t('invites.expires')} ${relTime(item.expires_at)}`}
                  </Text>
                </View>
                {!used ? (
                  <>
                    <Pressable onPress={() => copy(item.code)} hitSlop={8} style={s.action}>
                      <Ionicons name="share-outline" size={20} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={() => revoke(item.code)} hitSlop={8} style={s.action}>
                      <Ionicons name="trash-outline" size={19} color={colors.error} />
                    </Pressable>
                  </>
                ) : (
                  <Ionicons name="checkmark-circle" size={20} color={colors.fg3} />
                )}
              </View>
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    top: { padding: 16, gap: 14 },
    note: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19 },
    create: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.primary, borderRadius: radius, paddingVertical: 12 },
    createText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    code: { color: c.onBackground, fontFamily: fonts.mono, fontSize: 16, letterSpacing: 1 },
    meta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12, marginTop: 3 },
    action: { padding: 2 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 30, fontFamily: fonts.mono, fontSize: 13 },
  });
