import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Avatar from './Avatar';
import Post from './Post';
import { api, type Profile, type PostView, type Timeline } from '@/api';
import { useMe, logout } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function ProfileView({ username }: { username: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<PostView[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);

  const self = me?.username === username;

  const load = useCallback(async () => {
    try {
      const [p, t2] = await Promise.all([
        api.get<Profile>(`/users/${username}`),
        api.get<Timeline | PostView[]>(`/users/${username}/posts`),
      ]);
      setProfile(p);
      setFollowing(p.is_following);
      setPosts(Array.isArray(t2) ? t2 : t2.posts);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async () => {
    if (!me) return router.push('/login');
    const next = !following;
    setFollowing(next);
    try {
      if (next) await api.post(`/users/${username}/follow`);
      else await api.del(`/users/${username}/follow`);
    } catch {
      setFollowing(!next);
    }
  };

  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: insets.top + 60 }} />;
  if (!profile)
    return (
      <View style={[s.center, { paddingTop: insets.top + 60 }]}>
        <Text style={s.muted}>—</Text>
      </View>
    );

  const header = (
    <View style={[s.head, { paddingTop: insets.top + 14 }]}>
      <View style={s.headTop}>
        <Avatar uri={profile.avatar_url} name={profile.display_name} size={72} />
        {self ? (
          <Pressable style={s.outlineBtn} onPress={logout}>
            <Text style={s.outlineBtnText}>{t('nav.logout')}</Text>
          </Pressable>
        ) : (
          <Pressable style={following ? s.outlineBtn : s.solidBtn} onPress={toggleFollow}>
            <Text style={following ? s.outlineBtnText : s.solidBtnText}>
              {following ? t('profile.following') : t('profile.follow')}
            </Text>
          </Pressable>
        )}
      </View>
      <Text style={s.name}>{profile.display_name}</Text>
      <Text style={s.handle}>@{profile.username}</Text>
      {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
      <View style={s.counts}>
        <Text style={s.count}>
          <Text style={s.countNum}>{profile.counts.posts}</Text> {t('profile.posts')}
        </Text>
        <Text style={s.count}>
          <Text style={s.countNum}>{profile.counts.followers}</Text> {t('profile.followers')}
        </Text>
        <Text style={s.count}>
          <Text style={s.countNum}>{profile.counts.following}</Text> {t('profile.followingc')}
        </Text>
      </View>
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={posts}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => <Post post={item} />}
    />
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center' },
    muted: { color: c.fg3, fontFamily: fonts.mono },
    head: { paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    headTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    name: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 20, marginTop: 12 },
    handle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 13, marginTop: 2 },
    bio: { color: c.onSurface, fontSize: 14, lineHeight: 20, marginTop: 10 },
    counts: { flexDirection: 'row', gap: 18, marginTop: 14 },
    count: { color: c.onSurfaceVariant, fontSize: 13 },
    countNum: { color: c.onBackground, fontFamily: fonts.bold },
    solidBtn: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 9 },
    solidBtnText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 13 },
    outlineBtn: { borderColor: c.outline, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
    outlineBtnText: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 13 },
  });
