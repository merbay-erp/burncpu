import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, API_ORIGIN, type SecurityInfo, type TwoFaStatus } from '@/api';
import { useMe, logout } from '@/auth';
import { registerPasskey, listPasskeys, deletePasskey, passkeySupported, type PasskeyInfo } from '@/passkey';
import { fonts, radius, useTheme, type Palette, type Scheme } from '@/theme';
import { shareText } from '@/util';
import { t, useLocale, setLocale, type Locale } from '@/i18n';

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
  const [exporting, setExporting] = useState(false);
  const [delName, setDelName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  const loadPasskeys = () => listPasskeys().then(setPasskeyList).catch(() => {});

  useEffect(() => {
    if (!me) return;
    api.get<SecurityInfo>('/users/me/security').then((r) => setSessions(r.sessions?.length ?? 0)).catch(() => {});
    api.get<TwoFaStatus>('/auth/2fa/status').then((r) => setTwofa(!!r.confirmed)).catch(() => {});
    loadPasskeys();
  }, [me]);

  // refresh status when returning to this screen
  useEffect(() => {
    const id = setInterval(() => {
      if (!me) return;
      api.get<TwoFaStatus>('/auth/2fa/status').then((r) => setTwofa(!!r.confirmed)).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
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

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await fetch(`${API_ORIGIN}/api/v1/users/me/export`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      // Share the JSON via the OS sheet (Save to Files / Copy / send anywhere).
      await shareText(text, 'burncpu export');
    } catch {
      Alert.alert('burncpu', t('common.error'));
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (!me || delName.trim() !== me.username || delBusy) return;
    setDelBusy(true);
    try {
      const r = await fetch(`${API_ORIGIN}/api/v1/users/me`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-Confirm-Username': me.username },
      });
      if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
      await logout();
      Alert.alert('burncpu', t('account.deleted'));
      router.replace('/');
    } catch {
      Alert.alert('burncpu', t('common.error'));
      setDelBusy(false);
    }
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

  const NavRow = ({ icon, label, value, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; onPress: () => void; danger?: boolean }) => (
    <Pressable style={({ pressed }) => [s.navRow, pressed && { backgroundColor: colors.surfaceLow }]} onPress={onPress}>
      <Ionicons name={icon} size={19} color={danger ? colors.error : colors.onSurfaceVariant} />
      <Text style={[s.navLabel, danger && { color: colors.error }]}>{label}</Text>
      {value ? <Text style={s.navValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.fg3} />
    </Pressable>
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

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
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
            <NavRow
              icon="lock-closed-outline"
              label={t('settings.twofa')}
              value={twofa == null ? '…' : twofa ? t('settings.on') : t('settings.off')}
              onPress={() => router.push('/settings/twofa')}
            />
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
            <NavRow
              icon="phone-portrait-outline"
              label={t('settings.sessions')}
              value={sessions == null ? '…' : String(sessions)}
              onPress={() => router.push('/settings/sessions')}
            />

            <Text style={s.section}>{t('nav.profile')}</Text>
            <NavRow icon="bookmark-outline" label={t('nav.bookmarks')} onPress={() => router.push('/bookmarks')} />
            <NavRow icon="stats-chart-outline" label={t('settings.activity')} onPress={() => router.push('/activity')} />
            <NavRow icon="trash-outline" label={t('settings.trash')} onPress={() => router.push('/trash')} />

            <Text style={s.section}>{t('settings.developer')}</Text>
            <NavRow icon="ticket-outline" label={t('settings.invites')} onPress={() => router.push('/settings/invites')} />
            <NavRow icon="key-outline" label={t('settings.tokens')} onPress={() => router.push('/settings/tokens')} />
            <NavRow icon="git-network-outline" label={t('settings.webhooks')} onPress={() => router.push('/settings/webhooks')} />
            <NavRow icon="document-text-outline" label={t('docs.title')} onPress={() => router.push('/docs')} />

            {me.role === 'admin' ? (
              <>
                <Text style={s.section}>{t('admin.title')}</Text>
                <NavRow icon="shield-half-outline" label={t('admin.title')} onPress={() => router.push('/admin')} />
              </>
            ) : null}

            <Text style={s.section}>{t('settings.account')}</Text>
            <InfoRow label="@" value={me.username} c={colors} />
            <NavRow icon="create-outline" label={t('profile.edit')} onPress={() => router.push('/profile/edit')} />
            <NavRow icon="download-outline" label={exporting ? t('common.loading') : t('settings.export')} onPress={exportData} />
            <Pressable style={s.logout} onPress={logout}>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={s.logoutText}>{t('nav.logout')}</Text>
            </Pressable>

            {/* Danger zone */}
            {deleting ? (
              <View style={s.danger}>
                <Text style={s.dangerNote}>{t('account.delete_confirm')}</Text>
                <TextInput
                  style={s.delInput}
                  value={delName}
                  onChangeText={setDelName}
                  placeholder={me.username}
                  placeholderTextColor={colors.fg3}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable style={s.delCancel} onPress={() => { setDeleting(false); setDelName(''); }}>
                    <Text style={s.delCancelText}>{t('common.cancel')}</Text>
                  </Pressable>
                  <Pressable
                    style={[s.delConfirm, (delName.trim() !== me.username || delBusy) && { opacity: 0.4 }]}
                    onPress={deleteAccount}
                    disabled={delName.trim() !== me.username || delBusy}
                  >
                    <Text style={s.delConfirmText}>{t('account.delete_btn')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={s.dangerLink} onPress={() => setDeleting(true)}>
                <Text style={s.dangerLinkText}>{t('settings.delete_account')}</Text>
              </Pressable>
            )}
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
    navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    navLabel: { flex: 1, color: c.onBackground, fontSize: 15 },
    navValue: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 13 },
    segmented: { flexDirection: 'row', backgroundColor: c.surfaceLow, borderRadius: radius, padding: 3, gap: 3 },
    seg: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
    segActive: { backgroundColor: c.primary },
    segText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 13 },
    segTextActive: { color: c.onPrimary },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    addText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    logout: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 16, marginTop: 8 },
    logoutText: { color: c.error, fontFamily: fonts.semibold, fontSize: 15 },
    dangerLink: { paddingHorizontal: 16, paddingVertical: 14, marginTop: 20 },
    dangerLinkText: { color: c.fg3, fontFamily: fonts.mono, fontSize: 13 },
    danger: { margin: 16, marginTop: 24, padding: 16, borderColor: `${c.error}59`, borderWidth: 1, borderRadius: 12, gap: 12, backgroundColor: `${c.error}10` },
    dangerNote: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19 },
    delInput: { backgroundColor: c.background, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 11, color: c.onSurface, fontFamily: fonts.mono, fontSize: 15 },
    delCancel: { flex: 1, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingVertical: 12, alignItems: 'center' },
    delCancelText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 14 },
    delConfirm: { flex: 2, backgroundColor: c.error, borderRadius: radius, paddingVertical: 12, alignItems: 'center' },
    delConfirmText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  });
