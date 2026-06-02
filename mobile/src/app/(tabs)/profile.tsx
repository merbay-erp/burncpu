import { View } from 'react-native';
import ProfileView from '@/components/ProfileView';
import LoginGate from '@/components/LoginGate';
import { useMe } from '@/auth';
import { useTheme } from '@/theme';

export default function ProfileTab() {
  const { colors } = useTheme();
  const me = useMe();
  if (!me) return <LoginGate />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ProfileView username={me.username} />
    </View>
  );
}
