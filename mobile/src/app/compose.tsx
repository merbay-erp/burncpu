import { useEffect, useState } from 'react';
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

import Avatar from '@/components/Avatar';
import { api, mediaUrl, uploadMedia, lookupUsers, type Author, type CreateResponse, type PostView } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

const MAX = 5000;

export default function Compose() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { replyTo, editId } = useLocalSearchParams<{ replyTo?: string; editId?: string }>();
  useLocale();
  const s = styles(colors);

  const [body, setBody] = useState('');
  const [cw, setCw] = useState('');
  const [showCw, setShowCw] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // @-mention typeahead
  const [sel, setSel] = useState(0);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [sugs, setSugs] = useState<Author[]>([]);

  useEffect(() => {
    if (editId) api.get<PostView>(`/posts/${editId}`).then((p) => setBody(p.body)).catch(() => {});
  }, [editId]);

  // derive the @token under the cursor
  useEffect(() => {
    const m = body.slice(0, sel).match(/@(\w{1,30})$/);
    setMentionQ(m ? m[1] : null);
  }, [body, sel]);

  // debounced lookup
  useEffect(() => {
    if (!mentionQ) {
      setSugs([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      lookupUsers(mentionQ)
        .then((r) => live && setSugs(r))
        .catch(() => live && setSugs([]));
    }, 180);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [mentionQ]);

  const insertMention = (username: string) => {
    const upto = body.slice(0, sel).replace(/@(\w{1,30})$/, `@${username} `);
    const next = upto + body.slice(sel);
    setBody(next);
    setSugs([]);
    setMentionQ(null);
  };

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9 });
    if (res.canceled || !res.assets?.length) return;
    setUploading(true);
    try {
      for (const asset of res.assets) {
        const isVideo = asset.type === 'video';
        // Match the backend caps (12 MB image / 64 MB video) before uploading.
        const limit = (isVideo ? 64 : 12) * 1024 * 1024;
        if (asset.fileSize && asset.fileSize > limit) {
          Alert.alert('burncpu', `Dosya çok büyük — en fazla ${isVideo ? 64 : 12} MB`);
          continue;
        }
        if (isVideo && asset.duration && asset.duration > 120_000) {
          Alert.alert('burncpu', 'Video çok uzun — en fazla 2 dakika');
          continue;
        }
        const name = asset.fileName ?? (isVideo ? 'video.mp4' : 'image.jpg');
        const mime = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
        const m = await uploadMedia(asset.uri, name, mime);
        setAttachments((a) => [...a, m.url]);
      }
    } catch (e) {
      Alert.alert('burncpu', `${t('common.error')}\n${(e as Error)?.message ?? ''}`.trim());
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
      if (editId) {
        await api.patch(`/posts/${editId}`, { body: finalBody });
      } else {
        const payload: { body: string; visibility: string; reply_to_id?: string; content_warning?: string } = {
          body: finalBody,
          visibility: 'public',
        };
        if (replyTo) payload.reply_to_id = replyTo;
        if (showCw && cw.trim()) payload.content_warning = cw.trim();
        const res = await api.post<CreateResponse>('/posts', payload);
        if (res?.quarantined) Alert.alert('burncpu', t('compose.pending'));
      }
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
        {editId ? (
          <Text style={s.replyTag}>{t('post.edit')}</Text>
        ) : replyTo ? (
          <Text style={s.replyTag}>↳ {t('post.reply')}</Text>
        ) : (
          <View />
        )}
        <Pressable style={[s.post, (empty || busy || over) && { opacity: 0.4 }]} onPress={submit} disabled={empty || busy || over}>
          <Text style={s.postText}>{busy ? t('compose.posting') : editId ? t('post.save_edit') : t('compose.post')}</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {showCw ? (
          <View style={s.cwBar}>
            <Ionicons name="warning-outline" size={16} color={colors.primary} />
            <TextInput
              style={s.cwInput}
              placeholder={t('compose.cw_ph')}
              placeholderTextColor={colors.fg3}
              value={cw}
              onChangeText={setCw}
            />
            <Pressable onPress={() => { setShowCw(false); setCw(''); }} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.fg3} />
            </Pressable>
          </View>
        ) : null}
        <TextInput
          style={s.input}
          placeholder={t('compose.placeholder')}
          placeholderTextColor={colors.fg3}
          multiline
          autoFocus
          value={body}
          onChangeText={setBody}
          onSelectionChange={(e) => setSel(e.nativeEvent.selection.start)}
          textAlignVertical="top"
        />
        {attachments.length > 0 ? (
          <View style={s.thumbs}>
            {attachments.map((u, i) => (
              <View key={i} style={s.thumbWrap}>
                {/\.(mp4|webm|mov)(\?|#|$)/i.test(u) ? (
                  <View style={[s.thumb, { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="videocam" size={22} color="#fff" />
                  </View>
                ) : (
                  <Image source={{ uri: mediaUrl(u) }} style={s.thumb} contentFit="cover" />
                )}
                <Pressable style={s.thumbX} onPress={() => setAttachments((a) => a.filter((_, j) => j !== i))} hitSlop={6}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* mention suggestions */}
      {sugs.length > 0 ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={s.sugBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
          {sugs.map((u) => (
            <Pressable key={u.id} style={s.sug} onPress={() => insertMention(u.username)}>
              <Avatar uri={u.avatar_url} name={u.username} size={22} />
              <Text style={s.sugName}>@{u.username}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={[s.footer, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable onPress={pick} disabled={uploading} hitSlop={8}>
          <Ionicons name="image-outline" size={24} color={uploading ? colors.fg3 : colors.primary} />
        </Pressable>
        {!editId ? (
          <Pressable onPress={() => setShowCw((v) => !v)} hitSlop={8}>
            <Ionicons name="warning-outline" size={23} color={showCw ? colors.primary : colors.onSurfaceVariant} />
          </Pressable>
        ) : null}
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
    cwBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.outlineVariant, backgroundColor: `${c.primary}0f` },
    cwInput: { flex: 1, color: c.onSurface, fontFamily: fonts.sans, fontSize: 14 },
    input: { color: c.onSurface, fontSize: 17, lineHeight: 24, padding: 16, fontFamily: fonts.sans, minHeight: 140 },
    thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: c.surfaceHigh },
    thumbX: { position: 'absolute', top: 4, right: 4, backgroundColor: '#000000aa', borderRadius: 10, padding: 2 },
    sugBar: { maxHeight: 48, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    sug: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.surfaceLow, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginVertical: 7 },
    sugName: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 13 },
    footer: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.outlineVariant },
    uploading: { flex: 1, color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12 },
    count: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12 },
  });
