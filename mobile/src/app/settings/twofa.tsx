import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, type TwoFaStatus, type TwoFaEnroll } from '@/api';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { shareText } from '@/util';
import { t, useLocale } from '@/i18n';

export default function TwoFa() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [status, setStatus] = useState<TwoFaStatus | null>(null);
  const [enroll, setEnroll] = useState<TwoFaEnroll | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const loadStatus = () => api.get<TwoFaStatus>('/auth/2fa/status').then(setStatus).catch(() => {});

  useEffect(() => {
    if (me) loadStatus();
  }, [me]);

  const startEnroll = async () => {
    setBusy(true);
    setErr(null);
    try {
      setEnroll(await api.post<TwoFaEnroll>('/auth/2fa/enroll'));
    } catch {
      setErr(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/2fa/confirm', { code: code.trim() });
      setEnroll(null);
      setCode('');
      await loadStatus();
      Alert.alert('burncpu', t('twofa.enabled'));
    } catch {
      setErr(t('twofa.bad_code'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/2fa/disable', { code: code.trim() });
      setDisabling(false);
      setCode('');
      await loadStatus();
    } catch {
      setErr(t('twofa.bad_code'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('twofa.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {!status ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          {status.confirmed ? (
            // ── Enabled ──
            <View style={s.card}>
              <View style={s.statusRow}>
                <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
                <Text style={s.statusOn}>{t('twofa.on')}</Text>
              </View>
              <Text style={s.note}>
                {status.recovery_codes_remaining} {t('twofa.remaining')}
              </Text>
              {disabling ? (
                <>
                  <Text style={s.lead}>{t('twofa.disable_note')}</Text>
                  <TextInput
                    style={s.codeInput}
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    placeholder="000000"
                    placeholderTextColor={colors.fg3}
                    maxLength={6}
                    autoFocus
                  />
                  {err ? <Text style={s.err}>{err}</Text> : null}
                  <Pressable style={[s.disableBtn, (code.length < 6 || busy) && { opacity: 0.4 }]} onPress={disable} disabled={code.length < 6 || busy}>
                    <Text style={s.disableText}>{t('twofa.disable')}</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable style={s.disableBtn} onPress={() => { setErr(null); setCode(''); setDisabling(true); }}>
                  <Text style={s.disableText}>{t('twofa.disable')}</Text>
                </Pressable>
              )}
            </View>
          ) : enroll ? (
            // ── Enrolling: show secret + recovery + confirm ──
            <>
              <Text style={s.lead}>{t('twofa.scan')}</Text>
              <Pressable style={s.authBtn} onPress={() => Linking.openURL(enroll.otpauth_uri).catch(() => {})}>
                <Ionicons name="open-outline" size={18} color={colors.onPrimary} />
                <Text style={s.authText}>Authenticator’a ekle</Text>
              </Pressable>

              <Text style={s.lead}>{t('twofa.manual')}</Text>
              <Pressable style={s.copyField} onPress={() => shareText(enroll.secret_base32)}>
                <Text style={s.secret} selectable>
                  {enroll.secret_base32}
                </Text>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
              </Pressable>
              <Text style={s.hint}>{t('common.copy_hint')}</Text>

              <Text style={s.lead}>{t('twofa.recovery')}</Text>
              <Text style={s.note}>{t('twofa.recovery_note')}</Text>
              <Pressable style={s.recovery} onPress={() => shareText(enroll.recovery_codes.join('\n'))}>
                {enroll.recovery_codes.map((rc) => (
                  <Text key={rc} style={s.recCode} selectable>
                    {rc}
                  </Text>
                ))}
                <View style={s.recCopy}>
                  <Ionicons name="share-outline" size={14} color={colors.primary} />
                  <Text style={s.recCopyText}>{t('common.share')}</Text>
                </View>
              </Pressable>

              <Text style={s.lead}>{t('twofa.enter_code')}</Text>
              <TextInput
                style={s.codeInput}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="000000"
                placeholderTextColor={colors.fg3}
                maxLength={6}
                autoFocus
              />
              {err ? <Text style={s.err}>{err}</Text> : null}
              <Pressable style={[s.confirmBtn, (code.length < 6 || busy) && { opacity: 0.4 }]} onPress={confirm} disabled={code.length < 6 || busy}>
                <Text style={s.confirmText}>{t('twofa.confirm')}</Text>
              </Pressable>
            </>
          ) : (
            // ── Off: offer setup ──
            <View style={s.card}>
              <View style={s.statusRow}>
                <Ionicons name="shield-outline" size={22} color={colors.onSurfaceVariant} />
                <Text style={s.statusOff}>{t('twofa.off')}</Text>
              </View>
              <Text style={s.note}>{t('settings.twofa')}</Text>
              {err ? <Text style={s.err}>{err}</Text> : null}
              <Pressable style={[s.setupBtn, busy && { opacity: 0.5 }]} onPress={startEnroll} disabled={busy}>
                <Text style={s.setupText}>{busy ? t('common.loading') : t('twofa.setup')}</Text>
              </Pressable>
            </View>
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
    card: { backgroundColor: c.surfaceHigh, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 16, padding: 20 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    statusOn: { color: c.primary, fontFamily: fonts.bold, fontSize: 18 },
    statusOff: { color: c.onSurfaceVariant, fontFamily: fonts.bold, fontSize: 18 },
    note: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19, marginBottom: 14 },
    hint: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11, marginTop: 6 },
    lead: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 14, marginTop: 18, marginBottom: 8 },
    authBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: radius, paddingVertical: 13 },
    authText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    copyField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 13 },
    secret: { flex: 1, color: c.onSurface, fontFamily: fonts.mono, fontSize: 14, letterSpacing: 1 },
    recovery: { backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, padding: 14, gap: 4 },
    recCode: { color: c.onSurface, fontFamily: fonts.mono, fontSize: 14, letterSpacing: 1 },
    recCopy: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' },
    recCopyText: { color: c.primary, fontFamily: fonts.semibold, fontSize: 12 },
    codeInput: { backgroundColor: c.background, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 16, paddingVertical: 13, color: c.onSurface, fontFamily: fonts.mono, fontSize: 22, letterSpacing: 8, textAlign: 'center' },
    err: { color: c.error, fontFamily: fonts.mono, fontSize: 13, marginTop: 12 },
    confirmBtn: { backgroundColor: c.primary, borderRadius: radius, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
    confirmText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 15 },
    setupBtn: { backgroundColor: c.primary, borderRadius: radius, paddingVertical: 13, alignItems: 'center' },
    setupText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    disableBtn: { borderColor: c.error, borderWidth: 1, borderRadius: radius, paddingVertical: 12, alignItems: 'center' },
    disableText: { color: c.error, fontFamily: fonts.semibold, fontSize: 14 },
  });
