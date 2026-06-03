import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, type ApiToken, type ApiTokenCreated } from '@/api';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { relTime, shareText } from '@/util';
import { t, useLocale } from '@/i18n';

export default function Tokens() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [items, setItems] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<ApiTokenCreated | null>(null);

  const load = () =>
    api
      .get<ApiToken[]>('/tokens')
      .then((r) => setItems(r.filter((tk) => !tk.revoked_at)))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    if (me) load();
  }, [me]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const tk = await api.post<ApiTokenCreated>('/tokens', { name: name.trim(), scope: 'all' });
      setFresh(tk);
      setName('');
      load();
    } catch (e) {
      Alert.alert('burncpu', (e as Error).message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const copyFresh = () => {
    if (fresh) shareText(fresh.token, 'burncpu API token');
  };

  const revoke = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    api.del(`/tokens/${id}`).catch(() => load());
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('tokens.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {fresh ? (
            <View style={s.freshCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="warning" size={16} color={colors.primary} />
                <Text style={s.freshTitle}>{t('tokens.once')}</Text>
              </View>
              <Text style={s.freshToken} selectable>
                {fresh.token}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Pressable style={s.copyBtn} onPress={copyFresh}>
                  <Ionicons name="share-outline" size={16} color={colors.onPrimary} />
                  <Text style={s.copyText}>{t('common.share')}</Text>
                </Pressable>
                <Pressable style={s.doneBtn} onPress={() => setFresh(null)}>
                  <Text style={s.doneText}>{t('common.done')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={s.createBox}>
              <Text style={s.label}>{t('tokens.name')}</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder={t('tokens.name_ph')}
                placeholderTextColor={colors.fg3}
                autoCapitalize="none"
              />
              <Pressable style={[s.create, (!name.trim() || busy) && { opacity: 0.4 }]} onPress={create} disabled={!name.trim() || busy}>
                <Ionicons name="add" size={18} color={colors.onPrimary} />
                <Text style={s.createText}>{t('tokens.create')}</Text>
              </Pressable>
            </View>
          )}

          {items.length === 0 ? (
            <Text style={s.empty}>{t('tokens.empty')}</Text>
          ) : (
            items.map((tk) => (
              <View key={tk.id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{tk.name}</Text>
                  <Text style={s.meta}>
                    {tk.scope} · {tk.last_used_at ? `${t('tokens.last_used')} ${relTime(tk.last_used_at)}` : t('tokens.never')}
                  </Text>
                </View>
                <Pressable onPress={() => revoke(tk.id)} hitSlop={8}>
                  <Text style={s.revoke}>{t('tokens.revoke')}</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    createBox: { padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    label: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2 },
    input: { backgroundColor: c.background, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 11, color: c.onSurface, fontFamily: fonts.sans, fontSize: 15 },
    create: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.primary, borderRadius: radius, paddingVertical: 12, marginTop: 4 },
    createText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    freshCard: { margin: 16, padding: 16, backgroundColor: `${c.primary}14`, borderColor: `${c.primary}59`, borderWidth: 1, borderRadius: 14 },
    freshTitle: { flex: 1, color: c.onBackground, fontFamily: fonts.semibold, fontSize: 13 },
    freshToken: { color: c.onSurface, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, backgroundColor: c.surfaceLow, borderRadius: 8, padding: 12 },
    copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 10 },
    copyText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 13 },
    doneBtn: { borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
    doneText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    name: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 15 },
    meta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12, marginTop: 3 },
    revoke: { color: c.error, fontFamily: fonts.semibold, fontSize: 13 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 30, fontFamily: fonts.mono, fontSize: 13 },
  });
