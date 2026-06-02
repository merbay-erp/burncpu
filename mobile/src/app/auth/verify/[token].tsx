import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/api';
import { probeSession } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

// Reached when a magic-link (https://burncpu.com/auth/verify/{token}) opens the
// app via a universal/app link. Consumes the token → session cookie → home.

export default function Verify() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  useLocale();
  const s = styles(colors);
  const [status, setStatus] = useState<'pending' | 'err'>('pending');

  useEffect(() => {
    (async () => {
      try {
        await api.post(`/auth/verify/${token}`);
        await probeSession();
        router.replace('/');
      } catch {
        setStatus('err');
      }
    })();
  }, [token, router]);

  return (
    <View style={s.screen}>
      {status === 'pending' ? (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.text}>🔥 {t('login.sending')}</Text>
        </>
      ) : (
        <>
          <Text style={s.text}>{t('login.error')}</Text>
          <Pressable style={s.btn} onPress={() => router.replace('/login')}>
            <Text style={s.btnText}>{t('nav.login')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', gap: 16 },
    text: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 14 },
    btn: { backgroundColor: c.primary, borderRadius: radius, paddingHorizontal: 24, paddingVertical: 11 },
    btnText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
  });
