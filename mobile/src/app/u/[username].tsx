import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import ProfileView from '@/components/ProfileView';
import { useTheme } from '@/theme';

export default function UserProfile() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ProfileView username={username} />
      <Pressable
        style={[styles.back, { top: insets.top + 8, backgroundColor: `${colors.background}cc` }]}
        onPress={() => router.back()}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={24} color={colors.onBackground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 10, borderRadius: 999, padding: 4 },
});
