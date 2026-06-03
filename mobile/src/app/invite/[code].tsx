import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import Brand from '@/components/Brand';
import { checkInvite, type InviteCheck } from '@/api';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function InviteLanding() {
  const { colors } = useTheme();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  useLocale();
  const s = styles(colors);

  const [check, setCheck] = useState<InviteCheck | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) return;
    checkInvite(code)
      .then(setCheck)
      .catch(() => setCheck({ code: code!, valid: false, reason: 'not_found', inviter_username: null, expires_at: null }))
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <View style={s.screen}>
      <Pressable style={s.close} onPress={() => router.replace('/')} hitSlop={10}>
        <Ionicons name="close" size={24} color={colors.onSurfaceVariant} />
      </Pressable>

      <View style={s.brandWrap}>
        <Brand size={30} />
        <Text style={s.tagline}>1 VPS YETER</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : check?.valid ? (
        <View style={s.card}>
          <Text style={{ fontSize: 34 }}>🔥</Text>
          <Text style={s.title}>
            {check.inviter_username ? (
              <>
                <Text style={s.inviter}>@{check.inviter_username}</Text> {t('invite.valid_from')}
              </>
            ) : (
              t('invite.continue')
            )}
          </Text>
          <View style={s.codePill}>
            <Text style={s.code}>{check.code}</Text>
          </View>
          <Pressable style={s.cta} onPress={() => router.replace(`/login?invite=${encodeURIComponent(check.code)}`)}>
            <Text style={s.ctaText}>{t('invite.continue')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.card}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.error} />
          <Text style={s.title}>{t('invite.invalid')}</Text>
          <Text style={s.reason}>{t(`invite.reason_${check?.reason ?? 'not_found'}`)}</Text>
          <Pressable style={s.ctaOutline} onPress={() => router.replace('/login')}>
            <Text style={s.ctaOutlineText}>{t('nav.login')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background, padding: 20, justifyContent: 'center' },
    close: { position: 'absolute', top: 16, right: 16, zIndex: 2 },
    brandWrap: { alignItems: 'center', marginBottom: 24 },
    tagline: { color: c.fg3, fontFamily: fonts.mono, fontSize: 9, letterSpacing: 3, marginTop: 6 },
    card: { backgroundColor: c.surfaceHigh, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 19, textAlign: 'center' },
    inviter: { color: c.primary },
    codePill: { backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 },
    code: { color: c.onSurface, fontFamily: fonts.mono, fontSize: 15, letterSpacing: 1 },
    reason: { color: c.onSurfaceVariant, fontSize: 14, textAlign: 'center' },
    cta: { alignSelf: 'stretch', backgroundColor: c.primary, borderRadius: radius, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    ctaText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 15 },
    ctaOutline: { alignSelf: 'stretch', borderColor: c.outline, borderWidth: 1, borderRadius: radius, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
    ctaOutlineText: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 14 },
  });
