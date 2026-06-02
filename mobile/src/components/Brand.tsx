import { Text, View, type TextStyle } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import Logo from './Logo';
import { fonts, useTheme } from '@/theme';

// The burncpu wordmark: flame logo + "burn" in a vertical fire gradient
// (amber → orange → red, like the web `.burn-text`) + "cpu" in the fg colour.
export default function Brand({ size = 22, logo = true }: { size?: number; logo?: boolean }) {
  const { colors } = useTheme();
  const txt: TextStyle = {
    fontFamily: fonts.bold,
    fontSize: size,
    letterSpacing: -0.5,
    lineHeight: size * 1.18,
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.34 }}>
      {logo ? <Logo size={size * 1.15} /> : null}
      <View style={{ flexDirection: 'row' }}>
        <MaskedView maskElement={<Text style={txt}>burn</Text>}>
          <LinearGradient
            colors={['#ffce4a', '#ff7a1a', '#ff2d1a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          >
            <Text style={[txt, { opacity: 0 }]}>burn</Text>
          </LinearGradient>
        </MaskedView>
        <Text style={[txt, { color: colors.onBackground }]}>cpu</Text>
      </View>
    </View>
  );
}
