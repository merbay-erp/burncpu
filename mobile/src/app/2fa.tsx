import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { twoFaChallenge } from '@/api';
import { probeSession, logout } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

// Shown after a passkey/magic-link login that left the session in pending_2fa.
// A valid TOTP (or recovery) code clears the flag and finishes sign-in.
export default function TwoFaChallenge() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLocale();
  const s = styles(colors);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const verify = async () => {
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await twoFaChallenge(code);
      await probeSession();
      router.replace('/');
    } catch {
      setErr(t('twofa.bad_code'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await logout();
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.screen}>
      <Pressable style={[s.close, { top: insets.top + 12 }]} onPress={cancel} hitSlop={10}>
        <Ionicons name="close" size={24} color={colors.onSurfaceVariant} />
      </Pressable>
      <View style={s.card}>
        <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
        <Text style={s.title}>{t('twofa.challenge_title')}</Text>
        <Text style={s.note}>{t('twofa.challenge_note')}</Text>
        <TextInput
          style={s.input}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
          keyboardType="number-pad"
          placeholder="000000"
          placeholderTextColor={colors.fg3}
          maxLength={8}
          autoFocus
        />
        {err ? <Text style={s.err}>{err}</Text> : null}
        <Pressable style={[s.verify, (code.length < 6 || busy) && { opacity: 0.4 }]} onPress={verify} disabled={code.length < 6 || busy}>
          <Text style={s.verifyText}>{busy ? t('login.passkey_busy') : t('twofa.verify')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background, justifyContent: 'center', padding: 20 },
    close: { position: 'absolute', right: 16, zIndex: 2 },
    card: { backgroundColor: c.surfaceHigh, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 18, padding: 24, alignItems: 'center', gap: 10 },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 20, marginTop: 4 },
    note: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 8 },
    input: { alignSelf: 'stretch', backgroundColor: c.background, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingVertical: 14, color: c.onSurface, fontFamily: fonts.mono, fontSize: 24, letterSpacing: 8, textAlign: 'center' },
    err: { color: c.error, fontFamily: fonts.mono, fontSize: 13 },
    verify: { alignSelf: 'stretch', backgroundColor: c.primary, borderRadius: radius, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    verifyText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 15 },
  });
