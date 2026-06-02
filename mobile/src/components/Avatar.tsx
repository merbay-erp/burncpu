import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { mediaUrl } from '@/api';
import { fonts, useTheme } from '@/theme';

export default function Avatar({
  uri,
  name,
  size = 40,
}: {
  uri?: string | null;
  name?: string;
  size?: number;
}) {
  const { colors } = useTheme();
  const url = mediaUrl(uri);
  const radius = size / 2;

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surfaceHigh }}
        contentFit="cover"
        transition={120}
      />
    );
  }

  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: size * 0.42 }}>
        {initial}
      </Text>
    </View>
  );
}
