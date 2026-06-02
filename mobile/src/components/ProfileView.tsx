import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import Avatar from './Avatar';
import Post from './Post';
import Sheet from './Sheet';
import { api, type Profile, type PostView, type Timeline } from '@/api';
import { useMe } from '@/auth';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);

  const self = me?.username === username;

  const load = useCallback(async () => {
    try {
      const [p, t2] = await Promise.all([
        api.get<Profile>(`/users/${username}`),
        api.get<Timeline | PostView[]>(`/users/${username}/posts`),
      ]);
      setProfile(p);
      setFollowing(p.is_following);
      setBlocked(p.is_blocked_by_viewer);
      setMuted(p.is_muted_by_viewer);
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

  const toggleBlock = async () => {
    const next = !blocked;
    setBlocked(next);
    if (next) setFollowing(false);
    try {
      if (next) await api.post(`/users/${username}/block`);
      else await api.del(`/users/${username}/block`);
    } catch {
      setBlocked(!next);
    }
  };

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    try {
      if (next) await api.post(`/users/${username}/mute`);
      else await api.del(`/users/${username}/mute`);
    } catch {
      setMuted(!next);
    }
  };

  const reportUser = async () => {
    if (!profile) return;
    try {
      await api.post('/reports', { target_kind: 'user', target_id: profile.id, reason: 'inappropriate' });
      Alert.alert('burncpu', t('post.reported'));
    } catch {
      /* ignore */
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
          <Pressable style={s.gearBtn} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={16} color={colors.onBackground} />
            <Text style={s.outlineBtnText}>{t('nav.settings')}</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable style={s.menuBtn} onPress={() => setMenuOpen(true)} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.onBackground} />
            </Pressable>
            <Pressable style={following ? s.outlineBtn : s.solidBtn} onPress={toggleFollow}>
              <Text style={following ? s.outlineBtnText : s.solidBtnText}>
                {blocked ? t('profile.blocked') : following ? t('profile.following') : t('profile.follow')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      <Text style={s.name}>{profile.display_name}</Text>
      <Text style={s.handle}>@{profile.username}</Text>
      {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}
      <View style={s.counts}>
        <Text style={s.count}>
          <Text style={s.countNum}>{profile.counts.posts}</Text> {t('profile.posts')}
        </Text>
        <Pressable onPress={() => router.push(`/follows/${username}?type=followers`)}>
          <Text style={s.count}>
            <Text style={s.countNum}>{profile.counts.followers}</Text> {t('profile.followers')}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/follows/${username}?type=following`)}>
          <Text style={s.count}>
            <Text style={s.countNum}>{profile.counts.following}</Text> {t('profile.followingc')}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        style={{ backgroundColor: colors.background }}
        data={posts}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <Post post={item} />}
      />
      <Sheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={`@${username}`}
        options={[
          { label: muted ? t('profile.unmute') : t('profile.mute'), icon: muted ? 'volume-high-outline' : 'volume-mute-outline', onPress: toggleMute },
          { label: blocked ? t('profile.unblock') : t('profile.block'), icon: 'ban-outline', danger: true, onPress: toggleBlock },
          { label: t('post.report'), icon: 'flag-outline', onPress: reportUser },
        ]}
      />
    </>
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
    gearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: c.outline, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
    menuBtn: { borderColor: c.outline, borderWidth: 1, borderRadius: 999, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    outlineBtnText: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 13 },
  });
