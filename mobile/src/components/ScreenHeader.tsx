import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, useTheme, type Palette } from '@/theme';

export default function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = styles(colors);
  return (
    <View style={[s.header, { paddingTop: insets.top + 8 }]}>
      <Text style={s.title}>{title}</Text>
      <View>{right}</View>
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.outlineVariant,
      backgroundColor: c.background,
    },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
  });
