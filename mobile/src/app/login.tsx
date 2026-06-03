import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import Brand from '@/components/Brand';
import { api, API_ORIGIN } from '@/api';
import { probeSession } from '@/auth';
import { loginWithPasskey, passkeySupported } from '@/passkey';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  apple: 'Apple',
};
const PROVIDER_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  google: 'logo-google',
  github: 'logo-github',
  microsoft: 'logo-microsoft',
  apple: 'logo-apple',
};
const OAUTH_REDIRECT = 'burncpu://auth/oauth-callback';

export default function Login() {
  const { colors } = useTheme();
  const router = useRouter();
  useLocale();
  const s = styles(colors);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);

  useEffect(() => {
    api.get<string[]>('/oauth/providers').then(setProviders).catch(() => {});
  }, []);

  const startOAuth = async (provider: string) => {
    if (oauthBusy) return;
    setOauthBusy(provider);
    setErr(null);
    try {
      const startUrl = `${API_ORIGIN}/api/v1/oauth/${provider}/start?flow=mobile`;
      const result = await WebBrowser.openAuthSessionAsync(startUrl, OAUTH_REDIRECT);
      if (result.type !== 'success' || !result.url) return; // user dismissed
      const m = result.url.match(/[?&]code=([^&]+)/);
      const code = m ? decodeURIComponent(m[1]) : null;
      if (!code) {
        setErr(t('login.error'));
        return;
      }
      // /exchange sets the session cookie (stored in the native jar), like magic-link.
      const res = await api.post<{ pending_2fa?: boolean }>('/oauth/exchange', { code });
      if (res?.pending_2fa) {
        router.replace('/2fa');
        return;
      }
      await probeSession();
      router.back();
    } catch {
      setErr(t('login.error'));
    } finally {
      setOauthBusy(null);
    }
  };

  const passkey = async () => {
    if (pkBusy) return;
    setPkBusy(true);
    setErr(null);
    try {
      const res = await loginWithPasskey();
      if (res?.pending_2fa) {
        router.replace('/2fa');
        return;
      }
      await probeSession();
      router.back();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg && msg !== 'cancelled') setErr(t('login.passkey_error'));
    } finally {
      setPkBusy(false);
    }
  };

  const submit = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/request', { email: email.trim() });
      setSent(true);
    } catch {
      setErr(t('login.error'));
    } finally {
      setBusy(false);
    }
  };

  const hasAlternatives = providers.length > 0 || passkeySupported();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.screen}
    >
      <Pressable style={s.close} onPress={() => router.back()} hitSlop={10}>
        <Ionicons name="close" size={24} color={colors.onSurfaceVariant} />
      </Pressable>

      <View style={s.brandWrap}>
        <Brand size={30} />
        <Text style={s.tagline}>1 VPS YETER</Text>
      </View>

      <View style={s.card}>
        <Text style={s.title}>{t('nav.login')}</Text>
        <Text style={s.note}>{t('login.note')}</Text>

        {sent ? (
          <View style={s.sent}>
            <Text style={{ fontSize: 22 }}>🔥</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.sentTitle}>{t('login.sent_title')}</Text>
              <Text style={s.sentBody}>{t('login.sent_body')}</Text>
            </View>
          </View>
        ) : (
          <>
            <Text style={s.label}>{t('login.email')}</Text>
            <TextInput
              style={s.input}
              placeholder={t('login.email_placeholder')}
              placeholderTextColor={colors.fg3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
            />
            {err ? <Text style={s.err}>{err}</Text> : null}
            <Pressable
              style={[s.submit, (!email.trim() || busy) && { opacity: 0.4 }]}
              onPress={submit}
              disabled={!email.trim() || busy}
            >
              <Text style={s.submitText}>{busy ? t('login.sending') : t('login.submit')}</Text>
            </Pressable>

            {hasAlternatives ? (
              <>
                <View style={s.divider}>
                  <View style={s.line} />
                  <Text style={s.or}>{t('login.or')}</Text>
                  <View style={s.line} />
                </View>

                {providers.map((provider) => (
                  <Pressable
                    key={provider}
                    style={[s.alt, !!oauthBusy && { opacity: 0.4 }]}
                    onPress={() => startOAuth(provider)}
                    disabled={!!oauthBusy}
                  >
                    <Ionicons
                      name={PROVIDER_ICONS[provider] ?? 'log-in-outline'}
                      size={18}
                      color={colors.onBackground}
                    />
                    <Text style={s.altText}>
                      {(PROVIDER_LABELS[provider] ?? provider)} ile devam et
                    </Text>
                  </Pressable>
                ))}

                {passkeySupported() ? (
                  <Pressable style={[s.alt, pkBusy && { opacity: 0.4 }]} onPress={passkey} disabled={pkBusy}>
                    <Ionicons name="key-outline" size={18} color={colors.onBackground} />
                    <Text style={s.altText}>{pkBusy ? t('login.passkey_busy') : t('login.passkey')}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background, padding: 20, justifyContent: 'center' },
    close: { position: 'absolute', top: 16, right: 16, zIndex: 2 },
    brandWrap: { alignItems: 'center', marginBottom: 24 },
    brand: { fontFamily: fonts.bold, fontSize: 30, letterSpacing: -1 },
    tagline: { color: c.fg3, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 3, marginTop: 6 },
    card: {
      backgroundColor: c.surfaceHigh,
      borderColor: c.outlineVariant,
      borderWidth: 1,
      borderRadius: 16,
      padding: 22,
    },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 22, marginBottom: 6 },
    note: { color: c.onSurfaceVariant, fontSize: 14, lineHeight: 20, marginBottom: 18 },
    label: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
    hint: { textTransform: 'none', letterSpacing: 0, color: c.fg3 },
    input: {
      backgroundColor: c.background,
      borderColor: c.outlineVariant,
      borderWidth: 1,
      borderRadius: radius,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: c.onSurface,
      fontFamily: fonts.mono,
      fontSize: 14,
      marginBottom: 16,
    },
    err: { color: c.error, fontFamily: fonts.mono, fontSize: 13, marginBottom: 12 },
    submit: { backgroundColor: c.primary, borderRadius: radius, paddingVertical: 13, alignItems: 'center' },
    submitText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
    line: { flex: 1, height: 1, backgroundColor: c.outlineVariant },
    or: { color: c.fg3, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5 },
    alt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingVertical: 12, marginBottom: 10 },
    altText: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 14 },
    sent: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: `${c.primary}1a`, borderColor: `${c.primary}4d`, borderWidth: 1, borderRadius: 12, padding: 16 },
    sentTitle: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 14, marginBottom: 2 },
    sentBody: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19 },
  });
