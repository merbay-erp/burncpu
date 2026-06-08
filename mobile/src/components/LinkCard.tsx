import { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { fetchLinkPreview, mediaUrl, type LinkPreview } from '@/api';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { hostOf } from '@/util';

// Dedupe across cards in the session — same URL fetched once (server caches too).
const cache = new Map<string, Promise<LinkPreview | null>>();
function load(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetchLinkPreview(url)
      .then((r) => r.preview)
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

// Rich Open Graph "unfurl" card. Renders nothing until a preview resolves and
// nothing at all if the link has no usable metadata. Mirrors the web LinkCard.
export default function LinkCard({
  url,
  onResolved,
}: {
  url: string;
  onResolved?: (hasPreview: boolean) => void;
}) {
  const { colors } = useTheme();
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const s = styles(colors);

  useEffect(() => {
    let alive = true;
    load(url).then((p) => {
      if (!alive) return;
      setPreview(p);
      onResolved?.(p != null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!preview) return null;

  return (
    <Pressable
      style={s.card}
      onPress={() => Linking.openURL(preview.url).catch(() => {})}
    >
      {preview.image ? (
        <Image source={{ uri: mediaUrl(preview.image) }} style={s.image} contentFit="cover" transition={150} />
      ) : null}
      <View style={s.body}>
        <Text style={s.domain} numberOfLines={1}>
          {preview.site_name || hostOf(preview.url)}
        </Text>
        {preview.title ? (
          <Text style={s.title} numberOfLines={2}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text style={s.desc} numberOfLines={2}>
            {preview.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    card: {
      marginTop: 10,
      borderRadius: radius,
      borderWidth: 1,
      borderColor: c.outlineVariant,
      backgroundColor: c.surfaceLow,
      overflow: 'hidden',
    },
    image: { width: '100%', aspectRatio: 1.91, backgroundColor: c.surfaceHigh },
    body: { padding: 12 },
    domain: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.4 },
    title: { color: c.onSurface, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginTop: 4 },
    desc: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 18, marginTop: 4 },
  });
