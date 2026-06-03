import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, SectionList, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import { api, API_ORIGIN } from '@/api';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

interface OpenApi {
  paths: Record<string, Record<string, { summary?: string; description?: string }>>;
}
type Endpoint = { method: string; path: string; summary: string };

const METHOD_ORDER = ['get', 'post', 'patch', 'put', 'delete'];
const METHOD_COLOR: Record<string, string> = {
  get: '#3ba55d', post: '#ff8a1a', patch: '#e0a000', put: '#e0a000', delete: '#ff3d2e',
};

export default function Docs() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useLocale();
  const s = styles(colors);

  const [spec, setSpec] = useState<OpenApi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<OpenApi>('/openapi.json')
      .then(setSpec)
      .catch(() => setSpec({ paths: {} }))
      .finally(() => setLoading(false));
  }, []);

  // Group endpoints by the first path segment (e.g. /posts, /dm, /admin).
  const sections = useMemo(() => {
    if (!spec?.paths) return [];
    const groups: Record<string, Endpoint[]> = {};
    for (const [path, methods] of Object.entries(spec.paths)) {
      const seg = path.split('/').filter(Boolean)[0] ?? '/';
      for (const m of METHOD_ORDER) {
        if (methods[m]) (groups[seg] ??= []).push({ method: m, path, summary: methods[m].summary ?? '' });
      }
    }
    return Object.keys(groups)
      .sort()
      .map((title) => ({ title, data: groups[title] }));
  }, [spec]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('docs.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e, i) => `${e.method}${e.path}${i}`}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={s.top}>
              <Text style={s.note}>{t('docs.note')}</Text>
              <Pressable style={s.webBtn} onPress={() => WebBrowser.openBrowserAsync(`${API_ORIGIN}/docs`)}>
                <Ionicons name="open-outline" size={16} color={colors.primary} />
                <Text style={s.webText}>{t('docs.open_web')}</Text>
              </Pressable>
            </View>
          }
          renderSectionHeader={({ section }) => <Text style={s.section}>/{section.title}</Text>}
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={[s.method, { backgroundColor: `${METHOD_COLOR[item.method]}26` }]}>
                <Text style={[s.methodText, { color: METHOD_COLOR[item.method] }]}>{item.method.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.path} selectable>
                  {item.path}
                </Text>
                {item.summary ? <Text style={s.summary}>{item.summary}</Text> : null}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    top: { padding: 16, gap: 12 },
    note: { color: c.onSurfaceVariant, fontSize: 13, lineHeight: 19 },
    webBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 10, paddingVertical: 11 },
    webText: { color: c.primary, fontFamily: fonts.bold, fontSize: 14 },
    section: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8, backgroundColor: c.background },
    row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.outlineVariant, alignItems: 'flex-start' },
    method: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, minWidth: 56, alignItems: 'center' },
    methodText: { fontFamily: fonts.bold, fontSize: 10 },
    path: { color: c.onSurface, fontFamily: fonts.mono, fontSize: 13 },
    summary: { color: c.fg3, fontSize: 12, marginTop: 2 },
  });
