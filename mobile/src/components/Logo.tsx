import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// burncpu brand mark — a clean flame (amber → orange → red), ported 1:1 from
// the web Logo SVG, with the web's `logo-flame` flicker (scale + rotate loop).
export default function Logo({ size = 24, animate = true }: { size?: number; animate?: boolean }) {
  const scale = useSharedValue(1);
  const rot = useSharedValue(0);

  useEffect(() => {
    if (!animate) return;
    const e = Easing.inOut(Easing.quad);
    scale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 520, easing: e }),
        withTiming(0.98, { duration: 520, easing: e }),
        withTiming(1.03, { duration: 520, easing: e }),
        withTiming(1, { duration: 1040, easing: e }),
      ),
      -1,
      false,
    );
    rot.value = withRepeat(
      withSequence(
        withTiming(-2, { duration: 520, easing: e }),
        withTiming(2, { duration: 520, easing: e }),
        withTiming(-1, { duration: 520, easing: e }),
        withTiming(0, { duration: 1040, easing: e }),
      ),
      -1,
      false,
    );
  }, [animate, scale, rot]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rot.value}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="bcflame" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#ff3d2e" />
            <Stop offset="0.5" stopColor="#ff8a1a" />
            <Stop offset="1" stopColor="#ffd24a" />
          </LinearGradient>
        </Defs>
        <Path
          fill="url(#bcflame)"
          d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        />
      </Svg>
    </Animated.View>
  );
}
