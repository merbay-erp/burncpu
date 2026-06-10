import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { t } from '@/i18n';

const KEY = 'burncpu.profileNudgeDismissed';

// Mobile parity for the web profile-completion nudge. Signed-in users without an
// avatar get a gentle, dismissible banner above the feed pointing at the profile
// editor. Starts hidden until AsyncStorage resolves so a previously-dismissed
// nudge never flashes. Renders nothing once an avatar is set or it's dismissed.
export default function ProfileNudge() {
  const { colors } = useTheme();
  const s = styles(colors);
  const router = useRouter();
  const me = useMe();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (alive) setDismissed(v === '1');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!me || me.avatar_url || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(KEY, '1').catch(() => {});
  };

  return (
    <View style={s.card}>
      <Ionicons name="person-circle-outline" size={26} color={colors.primary} />
      <View style={s.body}>
        <Text style={s.title}>{t('nudge.profile_title')}</Text>
        <Text style={s.sub}>{t('nudge.profile_body')}</Text>
      </View>
      <Pressable style={s.cta} onPress={() => router.push('/profile/edit')}>
        <Text style={s.ctaText}>{t('nudge.profile_cta')}</Text>
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={8} style={s.close}>
        <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
      </Pressable>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 14,
      marginTop: 12,
      padding: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.primary + '55',
      backgroundColor: c.primary + '14',
    },
    body: { flex: 1, minWidth: 0 },
    title: { fontFamily: fonts.semibold, fontSize: 14, color: c.onSurface },
    sub: { fontFamily: fonts.sans, fontSize: 12, color: c.onSurfaceVariant, marginTop: 1 },
    cta: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.primary },
    ctaText: { fontFamily: fonts.bold, fontSize: 12, color: c.onPrimary },
    close: { padding: 2 },
  });
