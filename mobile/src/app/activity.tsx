import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';

import { api, type Activity, type ActivityDay } from '@/api';
import { useMe } from '@/auth';
import { fonts, useTheme, type Palette } from '@/theme';
import { t, useLocale } from '@/i18n';

type Win = '7d' | '30d' | '90d';
type Metric = keyof Pick<ActivityDay, 'posts' | 'reactions_received' | 'replies_received' | 'followers_gained'>;

const CARDS: { key: Metric; label: string }[] = [
  { key: 'posts', label: 'activity.posts' },
  { key: 'reactions_received', label: 'activity.reactions' },
  { key: 'replies_received', label: 'activity.replies' },
  { key: 'followers_gained', label: 'activity.followers' },
];

export default function ActivityScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [win, setWin] = useState<Win>('30d');
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    api
      .get<Activity>(`/users/me/activity?window=${win}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [me, win]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('activity.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={s.windows}>
        {(['7d', '30d', '90d'] as Win[]).map((w) => (
          <Pressable key={w} style={[s.win, win === w && s.winActive]} onPress={() => setWin(w)}>
            <Text style={[s.winText, win === w && s.winTextActive]}>{t(`win.${w}`)}</Text>
          </Pressable>
        ))}
      </View>

      {loading || !data ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 12 }}>
          {CARDS.map((card) => (
            <StatCard
              key={card.key}
              label={t(card.label)}
              total={data.totals[card.key]}
              series={data.daily.map((d) => d[card.key])}
              c={colors}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// Hermes-safe thousands separator (Turkish uses '.') — avoids relying on Intl.
function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function StatCard({ label, total, series, c }: { label: string; total: number; series: number[]; c: Palette }) {
  const s = styles(c);
  return (
    <View style={s.card}>
      <View style={{ flex: 1 }}>
        <Text style={s.cardValue}>{fmt(total)}</Text>
        <Text style={s.cardLabel}>{label}</Text>
      </View>
      <Sparkline values={series} color={c.primary} width={130} height={42} />
    </View>
  );
}

function Sparkline({ values, color, width, height }: { values: number[]; color: string; width: number; height: number }) {
  const points = useMemo(() => {
    if (values.length < 2) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const stepX = width / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * stepX;
        const y = height - 3 - ((v - min) / span) * (height - 6);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values, width, height]);

  if (!points) return <View style={{ width, height }} />;
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    windows: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    win: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', backgroundColor: c.surfaceLow },
    winActive: { backgroundColor: c.primary },
    winText: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurfaceVariant },
    winTextActive: { color: c.onPrimary },
    card: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceHigh, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 14, padding: 16 },
    cardValue: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 28, letterSpacing: -0.5 },
    cardLabel: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  });
