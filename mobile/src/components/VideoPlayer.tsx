import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';

import { radius, useTheme, type Palette } from '@/theme';

// Inline video for posts + DMs. Lazy by design: a feed can hold many clips, so
// we render a lightweight poster with a play affordance and only mount the
// actual player (and start the network fetch) once the user taps — no dozens of
// simultaneous video surfaces, no autoplay burning mobile data. The backend
// range-serves the file, so seeking streams rather than downloading the whole.

export default function VideoPlayer({
  uri,
  poster,
  marginTop = 8,
}: {
  uri: string;
  poster?: string | null;
  marginTop?: number;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  const [active, setActive] = useState(false);

  if (active) return <Player uri={uri} marginTop={marginTop} />;

  return (
    <Pressable
      style={[s.poster, { marginTop }]}
      onPress={() => setActive(true)}
      accessibilityRole="button"
      accessibilityLabel="Videoyu oynat"
    >
      {poster ? <Image source={{ uri: poster }} style={s.posterImg} contentFit="cover" /> : null}
      <View style={s.playBadge}>
        <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
      </View>
    </Pressable>
  );
}

function Player({ uri, marginTop }: { uri: string; marginTop: number }) {
  const { colors } = useTheme();
  const s = styles(colors);
  // Hook runs only once this subcomponent mounts (i.e. after the tap).
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <VideoView
      style={[s.video, { marginTop }]}
      player={player}
      nativeControls
      contentFit="contain"
    />
  );
}

const styles = (_c: Palette) =>
  StyleSheet.create({
    poster: {
      width: '100%',
      aspectRatio: 16 / 10,
      borderRadius: radius,
      backgroundColor: '#000',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    posterImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    playBadge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.85)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    video: {
      width: '100%',
      aspectRatio: 16 / 10,
      borderRadius: radius,
      backgroundColor: '#000',
      overflow: 'hidden',
    },
  });
