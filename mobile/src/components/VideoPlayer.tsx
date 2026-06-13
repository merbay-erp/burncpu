import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';

import { radius, useTheme, type Palette } from '@/theme';

// Inline video for posts + DMs. Two modes:
//   • Feed (autoplay-on-view): pass `playing` — the player mounts and plays
//     MUTED only while the post is on-screen (the home screen drives `playing`
//     from FlatList viewability), pausing as it scrolls away. Native controls let
//     the viewer unmute / scrub.
//   • DM (lazy tap-to-play): omit `playing` — a lightweight poster + play badge,
//     and the player (with sound) only mounts on tap. No autoplay, no data burn.
export default function VideoPlayer({
  uri,
  poster,
  marginTop = 8,
  playing,
}: {
  uri: string;
  poster?: string | null;
  marginTop?: number;
  playing?: boolean;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  const [tapped, setTapped] = useState(false);
  const autoMode = playing !== undefined;

  if (autoMode || tapped) {
    return (
      <Player
        uri={uri}
        marginTop={marginTop}
        playing={autoMode ? !!playing : true}
        unmuted={tapped}
      />
    );
  }

  return (
    <Pressable
      style={[s.poster, { marginTop }]}
      onPress={() => setTapped(true)}
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

function Player({
  uri,
  marginTop,
  playing,
  unmuted,
}: {
  uri: string;
  marginTop: number;
  playing: boolean;
  unmuted: boolean;
}) {
  const { colors } = useTheme();
  const s = styles(colors);
  const [aspect, setAspect] = useState(16 / 10);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = !unmuted;
    if (playing) p.play();
  });

  // React to scroll (playing) + a manual unmute tap.
  useEffect(() => {
    player.muted = !unmuted;
    if (playing) player.play();
    else player.pause();
  }, [player, playing, unmuted]);

  // Adopt the clip's real aspect ratio once the track loads — otherwise a
  // portrait clip gets letterboxed into a fixed 16:10 landscape box and looks
  // tiny. Clamp so an extreme clip can't make the card absurdly tall/wide.
  useEffect(() => {
    const apply = (size?: { width: number; height: number } | null) => {
      if (size && size.width > 0 && size.height > 0) {
        setAspect(Math.min(Math.max(size.width / size.height, 0.5), 1.91));
      }
    };
    apply(player.videoTrack?.size);
    const sub = player.addListener('videoTrackChange', ({ videoTrack }) => apply(videoTrack?.size));
    return () => sub.remove();
  }, [player]);

  return (
    <VideoView
      style={[s.video, { marginTop, aspectRatio: aspect }]}
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
      borderRadius: radius,
      backgroundColor: '#000',
      overflow: 'hidden',
    },
  });
