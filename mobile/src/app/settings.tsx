import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Alert } from 'react-native';
import { api } from '@/api';
import { useMe, logout } from '@/auth';
import { registerPasskey, listPasskeys, deletePasskey, passkeySupported, type PasskeyInfo } from '@/passkey';
import { fonts, radius, useTheme, type Palette, type Scheme } from '@/theme';
import { t, useLocale, setLocale, type Locale } from '@/i18n';

interface SecurityInfo {
  sessions?: unknown[];
  events?: unknown[];
}

export default function Settings() {
  const { colors, scheme, setScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  const locale = useLocale();
  const s = styles(colors);

  const [sessions, setSessions] = useState<number | null>(null);
  const [twofa, setTwofa] = useState<boolean | null>(null);
  const [passkeyList, setPasskeyList] = useState<PasskeyInfo[]>([]);
  const [pkBusy, setPkBusy] = useState(false);

  const loadPasskeys = () => listPasskeys().then(setPasskeyList).catch(() => {});

  useEffect(() => {
    if (!me) return;
    api.get<SecurityInfo>('/users/me/security').then((r) => setSessions(r.sessions?.length ?? 0)).catch(() => {});
    api.get<{ confirmed?: boolean }>('/auth/2fa/status').then((r) => setTwofa(!!r.confirmed)).catch(() => {});
    loadPasskeys();
  }, [me]);

  const addPasskey = async () => {
    if (pkBusy) return;
    setPkBusy(true);
    try {
      await registerPasskey();
      loadPasskeys();
    } catch (e) {
      const m = (e as Error).message;
      if (m && m !== 'cancelled') Alert.alert('burncpu', t('settings.passkey_error'));
    } finally {
      setPkBusy(false);
    }
  };
  const removePasskey = async (id: string) => {
    await deletePasskey(id);
    loadPasskeys();
  };

  const Segmented = <T extends string>({
    value,
    options,
    onChange,
  }: {
    value: T;
    options: { v: T; label: string }[];
    onChange: (v: T) => void;
  }) => (
    <View style={s.segmented}>
      {options.map((o) => (
        <Pressable key={o.v} style={[s.seg, value === o.v && s.segActive]} onPress={() => onChange(o.v)}>
          <Text style={[s.segText, value === o.v && s.segTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('nav.settings')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <Text style={s.section}>{t('settings.appearance')}</Text>
        <View style={s.row}>
          <Text style={s.rowLabel}>{t('settings.theme')}</Text>
          <Segmented<Scheme>
            value={scheme}
            options={[
              { v: 'dark', label: t('settings.dark') },
              { v: 'light', label: t('settings.light') },
            ]}
            onChange={setScheme}
          />
        </View>
        <View style={s.row}>
          <Text style={s.rowLabel}>{t('settings.language')}</Text>
          <Segmented<Locale>
            value={locale}
            options={[
              { v: 'tr', label: 'TR' },
              { v: 'en', label: 'EN' },
            ]}
            onChange={setLocale}
          />
        </View>

        {me ? (
          <>
            <Text style={s.section}>{t('settings.security')}</Text>
            <InfoRow label={t('settings.twofa')} value={twofa == null ? '…' : twofa ? t('settings.on') : t('settings.off')} c={colors} />
            {passkeySupported() ? (
              <>
                <View style={s.row}>
                  <Text style={s.rowLabel}>{t('settings.passkeys')}</Text>
                  <Pressable style={[s.addBtn, pkBusy && { opacity: 0.5 }]} onPress={addPasskey} disabled={pkBusy}>
                    <Ionicons name="add" size={15} color={colors.onPrimary} />
                    <Text style={s.addText}>{t('settings.add_passkey')}</Text>
                  </Pressable>
                </View>
                {passkeyList.map((pk) => (
                  <View key={pk.id} style={[s.row, { borderTopWidth: 1, borderTopColor: colors.outlineVariant }]}>
                    <Text style={s.rowLabel}>🔑 {pk.name || t('settings.passkey')}</Text>
                    <Pressable onPress={() => removePasskey(pk.id)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>
                ))}
              </>
            ) : (
              <InfoRow label={t('settings.passkeys')} value={String(passkeyList.length)} c={colors} />
            )}
            <InfoRow label={t('settings.sessions')} value={sessions == null ? '…' : String(sessions)} c={colors} />

            <Text style={s.section}>{t('settings.account')}</Text>
            <InfoRow label="@" value={me.username} c={colors} />
            <Pressable style={[s.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]} onPress={() => router.push('/profile/edit')}>
              <Text style={s.rowLabel}>{t('profile.edit')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.fg3} />
            </Pressable>
            <Pressable style={[s.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]} onPress={() => router.push('/bookmarks')}>
              <Text style={s.rowLabel}>{t('nav.bookmarks')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.fg3} />
            </Pressable>
            <Pressable style={s.logout} onPress={logout}>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={s.logoutText}>{t('nav.logout')}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value, c }: { label: string; value: string; c: Palette }) {
  return (
    <View style={[styles(c).row, { borderBottomWidth: 1, borderBottomColor: c.outlineVariant }]}>
      <Text style={styles(c).rowLabel}>{label}</Text>
      <Text style={styles(c).rowValue}>{value}</Text>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    section: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
    rowLabel: { color: c.onBackground, fontSize: 15 },
    rowValue: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 14 },
    segmented: { flexDirection: 'row', backgroundColor: c.surfaceLow, borderRadius: radius, padding: 3, gap: 3 },
    seg: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
    segActive: { backgroundColor: c.primary },
    segText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 13 },
    segTextActive: { color: c.onPrimary },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    addText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    logout: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 16, marginTop: 8 },
    logoutText: { color: c.error, fontFamily: fonts.semibold, fontSize: 15 },
  });
