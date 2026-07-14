import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function LoginGate() {
  const { colors } = useTheme();
  const router = useRouter();
  useLocale();
  const s = styles(colors);
  return (
    <View style={s.wrap}>
      <Ionicons name="lock-closed-outline" size={42} color={colors.fg3} />
      <Text style={s.title}>{t('login.gate_title')}</Text>
      <Text style={s.body}>{t('login.gate_body')}</Text>
      <Pressable
        style={s.btn}
        onPress={() => router.push('/login')}
        accessibilityRole="button"
        accessibilityLabel={t('nav.login')}
      >
        <Text style={s.btnText}>{t('nav.login')}</Text>
      </Pressable>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 17, textAlign: 'center' },
    body: { color: c.onSurfaceVariant, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
    btn: { backgroundColor: c.primary, borderRadius: radius, paddingHorizontal: 24, paddingVertical: 11, marginTop: 6 },
    btnText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
  });
