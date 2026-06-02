import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import Avatar from '@/components/Avatar';
import { api, API_ORIGIN, mediaUrl, type Profile } from '@/api';
import { getMe, setMe, useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function ProfileEdit() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    api.get<Profile>(`/users/${me.username}`).then((p) => {
      setDisplayName(p.display_name);
      setBio(p.bio ?? '');
      setAvatarUrl(p.avatar_url);
    }).catch(() => {});
  }, [me]);

  const pickAvatar = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    try {
      const fd = new FormData();
      fd.append('file', { uri: asset.uri, name: asset.fileName ?? 'avatar.jpg', type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob);
      const r = await fetch(`${API_ORIGIN}/api/v1/media`, { method: 'POST', body: fd, credentials: 'include' });
      if (!r.ok) throw new Error();
      const m = (await r.json()) as { url: string };
      setAvatarUrl(m.url);
    } catch {
      Alert.alert('burncpu', t('common.error'));
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.patch<Profile>('/users/me', {
        display_name: displayName.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl,
      });
      const cur = getMe();
      if (cur) await setMe({ ...cur, display_name: updated.display_name, avatar_url: updated.avatar_url });
      router.back();
    } catch {
      Alert.alert('burncpu', t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={s.cancel}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={s.title}>{t('profile.edit')}</Text>
        <Pressable style={[s.save, busy && { opacity: 0.4 }]} onPress={save} disabled={busy}>
          <Text style={s.saveText}>{t('profile.save')}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Pressable style={s.avatarWrap} onPress={pickAvatar}>
          {avatarUrl ? (
            <Image source={{ uri: mediaUrl(avatarUrl) }} style={s.avatar} contentFit="cover" />
          ) : (
            <Avatar name={displayName} size={84} />
          )}
          <View style={s.avatarBadge}>
            <Ionicons name="camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressable>

        <View>
          <Text style={s.label}>{t('profile.display_name')}</Text>
          <TextInput style={s.input} value={displayName} onChangeText={setDisplayName} placeholderTextColor={colors.fg3} />
        </View>
        <View>
          <Text style={s.label}>{t('profile.bio')}</Text>
          <TextInput
            style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
            value={bio}
            onChangeText={setBio}
            multiline
            placeholderTextColor={colors.fg3}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    cancel: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 14 },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 16 },
    save: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
    saveText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 13 },
    avatarWrap: { alignSelf: 'center', position: 'relative' },
    avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: c.surfaceHigh },
    avatarBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: c.primary, borderRadius: 14, padding: 6, borderWidth: 2, borderColor: c.background },
    label: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
    input: { backgroundColor: c.surfaceLow, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 11, color: c.onSurface, fontSize: 15 },
  });
