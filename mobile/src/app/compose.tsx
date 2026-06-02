import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, type CreateResponse } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

const MAX = 5000;

export default function Compose() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLocale();
  const s = styles(colors);

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await api.post<CreateResponse>('/posts', { body: text, visibility: 'public' });
      if (res?.quarantined) Alert.alert('burncpu', t('compose.pending'));
      router.back();
    } catch {
      Alert.alert('burncpu', t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const over = body.length > MAX;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.screen}
    >
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={s.cancel}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          style={[s.post, (!body.trim() || busy || over) && { opacity: 0.4 }]}
          onPress={submit}
          disabled={!body.trim() || busy || over}
        >
          <Text style={s.postText}>{busy ? t('compose.posting') : t('compose.post')}</Text>
        </Pressable>
      </View>
      <TextInput
        style={s.input}
        placeholder={t('compose.placeholder')}
        placeholderTextColor={colors.fg3}
        multiline
        autoFocus
        value={body}
        onChangeText={setBody}
        textAlignVertical="top"
      />
      <View style={s.footer}>
        <Ionicons name="image-outline" size={22} color={colors.onSurfaceVariant} />
        <Text style={[s.count, over && { color: colors.error }]}>
          {body.length}/{MAX}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.outlineVariant,
    },
    cancel: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 14 },
    post: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
    postText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    input: { flex: 1, color: c.onSurface, fontSize: 17, lineHeight: 24, padding: 16, fontFamily: fonts.sans },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: c.outlineVariant,
    },
    count: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
  });
