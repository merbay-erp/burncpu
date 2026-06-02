import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api, API_ORIGIN, mediaUrl, type CreateResponse } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

const MAX = 5000;

interface MediaResp {
  url: string;
}

export default function Compose() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { replyTo } = useLocalSearchParams<{ replyTo?: string }>();
  useLocale();
  const s = styles(colors);

  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.length) return;
    setUploading(true);
    try {
      for (const asset of res.assets) {
        const fd = new FormData();
        fd.append('file', {
          uri: asset.uri,
          name: asset.fileName ?? 'image.jpg',
          type: asset.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
        const r = await fetch(`${API_ORIGIN}/api/v1/media`, {
          method: 'POST',
          body: fd,
          credentials: 'include',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const m = (await r.json()) as MediaResp;
        setAttachments((a) => [...a, m.url]);
      }
    } catch {
      Alert.alert('burncpu', t('common.error'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const text = body.trim();
    if ((!text && attachments.length === 0) || busy) return;
    setBusy(true);
    try {
      const finalBody = [text, ...attachments.map((u) => `![](${u})`)].filter(Boolean).join('\n\n');
      const payload: { body: string; visibility: string; reply_to_id?: string } = {
        body: finalBody,
        visibility: 'public',
      };
      if (replyTo) payload.reply_to_id = replyTo;
      const res = await api.post<CreateResponse>('/posts', payload);
      if (res?.quarantined) Alert.alert('burncpu', t('compose.pending'));
      router.back();
    } catch {
      Alert.alert('burncpu', t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const empty = !body.trim() && attachments.length === 0;
  const over = body.length > MAX;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={s.cancel}>{t('common.cancel')}</Text>
        </Pressable>
        {replyTo ? <Text style={s.replyTag}>↳ {t('post.reply')}</Text> : <View />}
        <Pressable style={[s.post, (empty || busy || over) && { opacity: 0.4 }]} onPress={submit} disabled={empty || busy || over}>
          <Text style={s.postText}>{busy ? t('compose.posting') : t('compose.post')}</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
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
        {attachments.length > 0 ? (
          <View style={s.thumbs}>
            {attachments.map((u, i) => (
              <View key={i} style={s.thumbWrap}>
                <Image source={{ uri: mediaUrl(u) }} style={s.thumb} contentFit="cover" />
                <Pressable style={s.thumbX} onPress={() => setAttachments((a) => a.filter((_, j) => j !== i))} hitSlop={6}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable onPress={pick} disabled={uploading} hitSlop={8}>
          <Ionicons name="image-outline" size={24} color={uploading ? colors.fg3 : colors.primary} />
        </Pressable>
        {uploading ? <Text style={s.uploading}>{t('common.loading')}</Text> : <View style={{ flex: 1 }} />}
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    cancel: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 14 },
    replyTag: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
    post: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
    postText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 14 },
    input: { color: c.onSurface, fontSize: 17, lineHeight: 24, padding: 16, fontFamily: fonts.sans, minHeight: 140 },
    thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: c.surfaceHigh },
    thumbX: { position: 'absolute', top: 4, right: 4, backgroundColor: '#000000aa', borderRadius: 10, padding: 2 },
    footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    uploading: { flex: 1, color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
    count: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
  });
