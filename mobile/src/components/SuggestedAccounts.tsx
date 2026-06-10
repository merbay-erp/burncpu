import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import Avatar from './Avatar';
import { api } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t } from '@/i18n';

interface Suggested {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number;
}

// "Who to follow" for the mobile empty feed. A new account follows no one, so
// the personal feed is blank — this turns that into one-tap follows of the
// server-ranked accounts worth following first. Renders nothing when there are
// no suggestions, so the empty feed just shows its text as before.
export default function SuggestedAccounts({ limit = 6 }: { limit?: number }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const router = useRouter();
  const [users, setUsers] = useState<Suggested[]>([]);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    api
      .get<Suggested[]>(`/users/suggestions?limit=${limit}`)
      .then((r) => {
        if (alive) setUsers(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [limit]);

  const follow = useCallback(async (u: Suggested) => {
    setFollowed((m) => ({ ...m, [u.username]: true }));
    try {
      await api.post(`/users/${u.username}/follow`);
    } catch {
      setFollowed((m) => ({ ...m, [u.username]: false }));
    }
  }, []);

  if (users.length === 0) return null;

  return (
    <View style={s.card}>
      <Text style={s.title}>{t('suggest.title')}</Text>
      <Text style={s.subtitle}>{t('suggest.subtitle')}</Text>
      {users.map((u) => {
        const done = !!followed[u.username];
        return (
          <View key={u.id} style={s.row}>
            <Pressable style={s.who} onPress={() => router.push(`/u/${u.username}`)}>
              <Avatar uri={u.avatar_url} name={u.display_name || u.username} size={40} />
              <View style={s.names}>
                <Text style={s.name} numberOfLines={1}>
                  {u.display_name || u.username}
                </Text>
                <Text style={s.handle} numberOfLines={1}>
                  @{u.username}
                </Text>
              </View>
            </Pressable>
            <Pressable
              disabled={done}
              onPress={() => follow(u)}
              style={[s.btn, done ? s.btnDone : s.btnFollow]}
            >
              <Text style={done ? s.btnDoneText : s.btnFollowText}>
                {done ? t('suggest.following') : t('suggest.follow')}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 14,
      marginTop: 28,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.outlineVariant,
      backgroundColor: c.surfaceLow,
    },
    title: { fontFamily: fonts.bold, fontSize: 15, color: c.onSurface },
    subtitle: { fontFamily: fonts.sans, fontSize: 13, color: c.onSurfaceVariant, marginTop: 2, marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    who: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
    names: { flex: 1, minWidth: 0 },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: c.onSurface },
    handle: { fontFamily: fonts.mono, fontSize: 12, color: c.onSurfaceVariant },
    btn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
    btnFollow: { backgroundColor: c.primary },
    btnFollowText: { fontFamily: fonts.bold, fontSize: 13, color: c.onPrimary },
    btnDone: { borderWidth: 1, borderColor: c.outlineVariant },
    btnDoneText: { fontFamily: fonts.bold, fontSize: 13, color: c.onSurfaceVariant },
  });
