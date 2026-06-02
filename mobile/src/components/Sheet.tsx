import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { t } from '@/i18n';

export interface SheetOption {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  danger?: boolean;
  onPress: () => void;
}

export default function Sheet({
  visible,
  onClose,
  options,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  options: SheetOption[];
  title?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = styles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 8 }]} onPress={() => {}}>
          <View style={s.grabber} />
          {title ? <Text style={s.title}>{title}</Text> : null}
          {options.map((o, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceLow }]}
              onPress={() => {
                onClose();
                o.onPress();
              }}
            >
              {o.emoji ? (
                <Text style={{ fontSize: 20, width: 24, textAlign: 'center' }}>{o.emoji}</Text>
              ) : o.icon ? (
                <Ionicons name={o.icon} size={20} color={o.danger ? colors.error : colors.onBackground} style={{ width: 24 }} />
              ) : null}
              <Text style={[s.label, o.danger && { color: colors.error }]}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[s.row, s.cancel]} onPress={onClose}>
            <Text style={s.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, paddingHorizontal: 8 },
    grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: c.outlineVariant, marginBottom: 8 },
    title: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12, textAlign: 'center', paddingVertical: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 14, borderRadius: radius },
    label: { color: c.onBackground, fontSize: 16, fontFamily: fonts.medium },
    cancel: { justifyContent: 'center', marginTop: 4 },
    cancelText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 15 },
  });
