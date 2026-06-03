import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, WEBHOOK_EVENTS, type Webhook, type WebhookCreated, type WebhookDelivery } from '@/api';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { relTime, shareText } from '@/util';
import { t, useLocale } from '@/i18n';

export default function Webhooks() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [items, setItems] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['reaction', 'reply', 'mention']);
  const [fresh, setFresh] = useState<WebhookCreated | null>(null);
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);

  const load = () =>
    api
      .get<Webhook[]>('/webhooks')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    if (me) load();
  }, [me]);

  const toggleEvent = (e: string) => setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  const create = async () => {
    if (!url.trim().startsWith('https://')) {
      Alert.alert('burncpu', 'HTTPS URL');
      return;
    }
    if (events.length === 0) {
      Alert.alert('burncpu', t('webhooks.pick_event'));
      return;
    }
    setBusy(true);
    try {
      const wh = await api.post<WebhookCreated>('/webhooks', { url: url.trim(), events, active: true });
      setFresh(wh);
      setUrl('');
      load();
    } catch (e) {
      Alert.alert('burncpu', (e as Error).message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (w: Webhook) => {
    setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, active: !x.active } : x)));
    await api.patch(`/webhooks/${w.id}`, { active: !w.active }).catch(() => load());
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (openDeliveries === id) setOpenDeliveries(null);
    api.del(`/webhooks/${id}`).catch(() => load());
  };

  const test = async (id: string) => {
    try {
      await api.post(`/webhooks/${id}/test`);
      Alert.alert('burncpu', '✓');
    } catch (e) {
      Alert.alert('burncpu', (e as Error).message || t('common.error'));
    }
  };

  const showDeliveries = async (id: string) => {
    if (openDeliveries === id) {
      setOpenDeliveries(null);
      return;
    }
    setOpenDeliveries(id);
    setDeliveries([]);
    try {
      setDeliveries(await api.get<WebhookDelivery[]>(`/webhooks/${id}/deliveries?limit=20`));
    } catch {
      /* ignore */
    }
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('webhooks.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {fresh ? (
            <View style={s.freshCard}>
              <Text style={s.freshTitle}>{t('webhooks.secret_once')}</Text>
              <Text style={s.freshSecret} selectable>
                {fresh.secret}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Pressable style={s.copyBtn} onPress={() => shareText(fresh.secret, 'webhook secret')}>
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
              <Text style={s.label}>{t('webhooks.url')}</Text>
              <TextInput
                style={s.input}
                value={url}
                onChangeText={setUrl}
                placeholder={t('webhooks.url_ph')}
                placeholderTextColor={colors.fg3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                inputMode="url"
              />
              <Text style={[s.label, { marginTop: 12 }]}>{t('webhooks.events')}</Text>
              <View style={s.chips}>
                {WEBHOOK_EVENTS.map((e) => {
                  const on = events.includes(e);
                  return (
                    <Pressable key={e} style={[s.chip, on && s.chipOn]} onPress={() => toggleEvent(e)}>
                      <Text style={[s.chipText, on && s.chipTextOn]}>{e}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable style={[s.create, busy && { opacity: 0.5 }]} onPress={create} disabled={busy}>
                <Ionicons name="add" size={18} color={colors.onPrimary} />
                <Text style={s.createText}>{t('webhooks.create')}</Text>
              </Pressable>
            </View>
          )}

          {items.length === 0 ? (
            <Text style={s.empty}>{t('webhooks.empty')}</Text>
          ) : (
            items.map((w) => (
              <View key={w.id} style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={s.url} numberOfLines={1} selectable>
                    {w.url}
                  </Text>
                  <Pressable onPress={() => toggleActive(w)} hitSlop={6} style={[s.badge, w.active ? s.badgeOn : s.badgeOff]}>
                    <Text style={[s.badgeText, { color: w.active ? colors.primary : colors.fg3 }]}>
                      {w.active ? t('webhooks.active') : t('webhooks.inactive')}
                    </Text>
                  </Pressable>
                </View>
                <Text style={s.meta}>
                  {w.events.join(', ')}
                  {w.last_status != null ? ` · ${w.last_status}` : ''}
                  {w.failure_streak > 0 ? ` · ${w.failure_streak} ${t('webhooks.fail_streak')}` : ''}
                </Text>
                <View style={s.actions}>
                  <Pressable onPress={() => test(w.id)} style={s.actionBtn}>
                    <Ionicons name="paper-plane-outline" size={15} color={colors.onSurfaceVariant} />
                    <Text style={s.actionText}>{t('webhooks.test')}</Text>
                  </Pressable>
                  <Pressable onPress={() => showDeliveries(w.id)} style={s.actionBtn}>
                    <Ionicons name={openDeliveries === w.id ? 'chevron-up' : 'list-outline'} size={15} color={colors.onSurfaceVariant} />
                    <Text style={s.actionText}>{t('webhooks.deliveries')}</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(w.id)} style={s.actionBtn} hitSlop={6}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </Pressable>
                </View>
                {openDeliveries === w.id ? (
                  <View style={s.deliveries}>
                    {deliveries.length === 0 ? (
                      <Text style={s.deliveryEmpty}>{t('webhooks.no_deliveries')}</Text>
                    ) : (
                      deliveries.map((d, i) => (
                        <View key={i} style={s.deliveryRow}>
                          <Ionicons name={d.ok ? 'checkmark-circle' : 'close-circle'} size={14} color={d.ok ? colors.primary : colors.error} />
                          <Text style={s.deliveryEvent}>
                            {d.event} {d.status != null ? `· ${d.status}` : ''}
                          </Text>
                          <Text style={s.deliveryTime}>{relTime(d.created_at)}</Text>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
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
    createBox: { padding: 16, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    label: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
    input: { backgroundColor: c.background, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 11, color: c.onSurface, fontFamily: fonts.mono, fontSize: 14 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipOn: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 12 },
    chipTextOn: { color: c.onPrimary },
    create: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.primary, borderRadius: radius, paddingVertical: 12, marginTop: 14 },
    createText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    freshCard: { margin: 16, padding: 16, backgroundColor: `${c.primary}14`, borderColor: `${c.primary}59`, borderWidth: 1, borderRadius: 14 },
    freshTitle: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 13, marginBottom: 8 },
    freshSecret: { color: c.onSurface, fontFamily: fonts.mono, fontSize: 13, backgroundColor: c.surfaceLow, borderRadius: 8, padding: 12 },
    copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 10 },
    copyText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 13 },
    doneBtn: { borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
    doneText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 13 },
    card: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.outlineVariant, gap: 6 },
    url: { flex: 1, color: c.onBackground, fontFamily: fonts.mono, fontSize: 13 },
    badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    badgeOn: { backgroundColor: `${c.primary}26` },
    badgeOff: { backgroundColor: c.surfaceLow },
    badgeText: { fontFamily: fonts.semibold, fontSize: 10 },
    meta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
    actions: { flexDirection: 'row', gap: 18, marginTop: 4 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    actionText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 12 },
    deliveries: { marginTop: 8, backgroundColor: c.surface, borderRadius: radius, padding: 10, gap: 6 },
    deliveryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    deliveryEvent: { flex: 1, color: c.onSurface, fontFamily: fonts.mono, fontSize: 12 },
    deliveryTime: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11 },
    deliveryEmpty: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 30, fontFamily: fonts.mono, fontSize: 13 },
  });
