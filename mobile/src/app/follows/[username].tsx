import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import Avatar from '@/components/Avatar';
import { api, type Author } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

export default function Follows() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { username, type } = useLocalSearchParams<{ username: string; type?: string }>();
  useLocale();
  const s = styles(colors);

  const kind = type === 'following' ? 'following' : 'followers';
  const [users, setUsers] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Author[]>(`/users/${username}/${kind}`)
      .then(setUsers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username, kind]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{kind === 'following' ? t('follows.following') : t('follows.followers')}</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          ListEmptyComponent={<Text style={s.empty}>—</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/u/${item.username}`)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceLow }]}
            >
              <Avatar uri={item.avatar_url} name={item.display_name} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>
                  {item.display_name}
                </Text>
                <Text style={s.handle} numberOfLines={1}>
                  @{item.username}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    name: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 14 },
    handle: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12, marginTop: 2 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 40, fontFamily: fonts.mono, fontSize: 13 },
  });
