import { Text, Linking, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { fonts, useTheme } from '@/theme';

// Lightweight inline renderer for a post body (markdown source). Mirrors what
// the web's body_html does for the common cases: links, @mentions, #hashtags
// and **bold** — all tappable. Heavier markdown (lists, code blocks) renders as
// plain text, which is fine for the timeline.

type Token =
  | { type: 'text' | 'bold' | 'link'; value: string }
  | { type: 'mention' | 'tag'; value: string; key: string };

const RE = /(https?:\/\/[^\s]+)|@([a-zA-Z0-9_]{1,30})|#([a-zA-Z0-9_]{2,32})|\*\*([^*]+)\*\*/g;

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
    if (m[1]) out.push({ type: 'link', value: m[1] });
    else if (m[2]) out.push({ type: 'mention', value: `@${m[2]}`, key: m[2] });
    else if (m[3]) out.push({ type: 'tag', value: `#${m[3]}`, key: m[3].toLowerCase() });
    else if (m[4]) out.push({ type: 'bold', value: m[4] });
    last = RE.lastIndex;
  }
  if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
  return out;
}

export default function RichText({ body, style }: { body: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  const router = useRouter();
  const accent = { color: colors.primary };

  return (
    <Text style={[{ color: colors.onSurface, fontFamily: fonts.sans }, style]}>
      {tokenize(body).map((tk, i) => {
        switch (tk.type) {
          case 'link':
            return (
              <Text key={i} style={[accent, { textDecorationLine: 'underline' }]} onPress={() => Linking.openURL(tk.value).catch(() => {})}>
                {tk.value}
              </Text>
            );
          case 'mention':
            return (
              <Text key={i} style={accent} onPress={() => router.push(`/u/${tk.key}`)}>
                {tk.value}
              </Text>
            );
          case 'tag':
            return (
              <Text key={i} style={accent} onPress={() => router.push(`/tag/${tk.key}`)}>
                {tk.value}
              </Text>
            );
          case 'bold':
            return (
              <Text key={i} style={{ fontFamily: fonts.bold }}>
                {tk.value}
              </Text>
            );
          default:
            return <Text key={i}>{tk.value}</Text>;
        }
      })}
    </Text>
  );
}
