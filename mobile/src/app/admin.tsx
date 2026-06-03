import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import Sheet from '@/components/Sheet';
import { api, type AdminStats, type AdminReport, type FedInstance, type AdminUserRow } from '@/api';
import { useMe } from '@/auth';
import { fonts, radius, useTheme, type Palette } from '@/theme';
import { relTime, fmtNum } from '@/util';
import { t, useLocale } from '@/i18n';

type Tab = 'stats' | 'reports' | 'federation' | 'users';

const STAT_KEYS: (keyof AdminStats)[] = [
  'total_users', 'dau_24h', 'new_users_24h', 'total_posts',
  'posts_24h', 'reactions_24h', 'dm_messages_24h', 'pending_mod_posts',
  'flagged_sessions', 'errors_24h',
];
const RESOLUTIONS = ['no_action', 'removed', 'suspended', 'other'];

export default function Admin() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useMe();
  useLocale();
  const s = styles(colors);

  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [instances, setInstances] = useState<FedInstance[] | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [host, setHost] = useState('');
  const [resolveId, setResolveId] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (tab === 'stats' && !stats) api.get<AdminStats>('/admin/stats').then(setStats).catch(() => {});
    if (tab === 'reports' && !reports) api.get<AdminReport[]>('/admin/reports?open=1').then(setReports).catch(() => setReports([]));
    if (tab === 'federation' && !instances) api.get<FedInstance[]>('/admin/federation/instances').then(setInstances).catch(() => setInstances([]));
    if (tab === 'users' && !users) api.get<AdminUserRow[]>('/admin/users').then(setUsers).catch(() => setUsers([]));
  }, [tab, me, stats, reports, instances, users]);

  const resolve = async (resolution: string) => {
    const id = resolveId;
    setResolveId(null);
    if (!id) return;
    setReports((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    await api.patch(`/admin/reports/${id}`, { resolution }).catch(() => {});
  };

  const toggleBlock = async (inst: FedInstance) => {
    setInstances((prev) => (prev ? prev.map((x) => (x.host === inst.host ? { ...x, blocked: !x.blocked } : x)) : prev));
    if (inst.blocked) await api.del(`/admin/federation/blocks/${encodeURIComponent(inst.host)}`).catch(() => {});
    else await api.post('/admin/federation/blocks', { host: inst.host }).catch(() => {});
  };

  const blockHost = async () => {
    const h = host.trim().toLowerCase();
    if (!h) return;
    setHost('');
    try {
      await api.post('/admin/federation/blocks', { host: h });
      setInstances((prev) => {
        const exists = prev?.some((x) => x.host === h);
        if (exists) return prev!.map((x) => (x.host === h ? { ...x, blocked: true } : x));
        return [{ host: h, followers: 0, blocked: true, reason: null }, ...(prev ?? [])];
      });
    } catch (e) {
      Alert.alert('burncpu', (e as Error).message || t('common.error'));
    }
  };

  const toggleSuspend = async (u: AdminUserRow) => {
    const next = u.role === 'suspended' ? 'member' : 'suspended';
    setUsers((prev) => (prev ? prev.map((x) => (x.id === u.id ? { ...x, role: next } : x)) : prev));
    await api.patch(`/admin/users/${u.id}`, { role: next }).catch(() => {});
  };

  const TabBtn = ({ k, label }: { k: Tab; label: string }) => (
    <Pressable style={[s.tab, tab === k && s.tabActive]} onPress={() => setTab(k)}>
      <Text style={[s.tabText, tab === k && s.tabTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onBackground} />
        </Pressable>
        <Text style={s.title}>{t('admin.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={s.tabs}>
        <TabBtn k="stats" label={t('admin.stats')} />
        <TabBtn k="reports" label={t('admin.reports')} />
        <TabBtn k="federation" label={t('admin.federation')} />
        <TabBtn k="users" label={t('admin.users')} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
        {/* STATS */}
        {tab === 'stats' ? (
          !stats ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={s.grid}>
              {STAT_KEYS.map((k) => (
                <View key={k} style={s.statCard}>
                  <Text style={s.statValue}>{fmtNum(stats[k])}</Text>
                  <Text style={s.statLabel}>{t(`stat.${k}`)}</Text>
                </View>
              ))}
            </View>
          )
        ) : null}

        {/* REPORTS */}
        {tab === 'reports' ? (
          !reports ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : reports.length === 0 ? (
            <Text style={s.empty}>{t('admin.no_reports')}</Text>
          ) : (
            reports.map((r) => (
              <View key={r.id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>
                    {r.reason} · {r.target_kind}
                  </Text>
                  <Text style={s.rowMeta}>
                    @{r.reporter_username} · {relTime(r.created_at)}
                  </Text>
                  {r.note ? <Text style={s.rowNote} numberOfLines={2}>{r.note}</Text> : null}
                </View>
                <Pressable style={s.resolveBtn} onPress={() => setResolveId(r.id)}>
                  <Text style={s.resolveText}>{t('admin.resolve')}</Text>
                </Pressable>
              </View>
            ))
          )
        ) : null}

        {/* FEDERATION */}
        {tab === 'federation' ? (
          <>
            <View style={s.blockBox}>
              <TextInput
                style={s.input}
                value={host}
                onChangeText={setHost}
                placeholder={t('admin.block_host')}
                placeholderTextColor={colors.fg3}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={blockHost}
              />
              <Pressable style={s.blockBtn} onPress={blockHost}>
                <Ionicons name="ban-outline" size={16} color={colors.onPrimary} />
              </Pressable>
            </View>
            {!instances ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : instances.length === 0 ? (
              <Text style={s.empty}>—</Text>
            ) : (
              instances.map((inst) => (
                <View key={inst.host} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{inst.host}</Text>
                    <Text style={s.rowMeta}>
                      {inst.followers} {t('admin.followers_short')}
                      {inst.reason ? ` · ${inst.reason}` : ''}
                    </Text>
                  </View>
                  <Pressable style={inst.blocked ? s.unblockBtn : s.blockPill} onPress={() => toggleBlock(inst)}>
                    <Text style={inst.blocked ? s.unblockText : s.blockPillText}>
                      {inst.blocked ? t('admin.unblock') : t('admin.block')}
                    </Text>
                  </Pressable>
                </View>
              ))
            )}
          </>
        ) : null}

        {/* USERS */}
        {tab === 'users' ? (
          !users ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            users.map((u) => (
              <View key={u.id} style={s.row}>
                <Pressable style={{ flex: 1 }} onPress={() => router.push(`/u/${u.username}`)}>
                  <Text style={s.rowTitle}>
                    @{u.username}
                    {u.role !== 'member' ? <Text style={{ color: u.role === 'admin' ? colors.primary : colors.error }}> · {u.role}</Text> : null}
                  </Text>
                  <Text style={s.rowMeta}>
                    {u.post_count} {t('profile.posts')} · {u.last_seen_at ? relTime(u.last_seen_at) : '—'}
                  </Text>
                </Pressable>
                {u.role !== 'admin' ? (
                  <Pressable style={u.role === 'suspended' ? s.unblockBtn : s.blockPill} onPress={() => toggleSuspend(u)}>
                    <Text style={u.role === 'suspended' ? s.unblockText : s.blockPillText}>
                      {u.role === 'suspended' ? t('admin.unsuspend') : t('admin.suspend')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )
        ) : null}
      </ScrollView>

      <Sheet
        visible={resolveId !== null}
        onClose={() => setResolveId(null)}
        title={t('admin.resolve')}
        options={RESOLUTIONS.map((r) => ({ label: r, onPress: () => resolve(r) }))}
      />
    </View>
  );
}

const styles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    title: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 18 },
    tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    tab: { flex: 1, paddingVertical: 7, borderRadius: 999, alignItems: 'center', backgroundColor: c.surfaceLow },
    tabActive: { backgroundColor: c.primary },
    tabText: { fontFamily: fonts.semibold, fontSize: 12, color: c.onSurfaceVariant },
    tabTextActive: { color: c.onPrimary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
    statCard: { width: '47%', flexGrow: 1, backgroundColor: c.surfaceHigh, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: 12, padding: 14 },
    statValue: { color: c.onBackground, fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5 },
    statLabel: { color: c.onSurfaceVariant, fontFamily: fonts.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    rowTitle: { color: c.onBackground, fontFamily: fonts.semibold, fontSize: 14 },
    rowMeta: { color: c.fg3, fontFamily: fonts.mono, fontSize: 12, marginTop: 3 },
    rowNote: { color: c.onSurfaceVariant, fontSize: 13, marginTop: 4 },
    resolveBtn: { backgroundColor: c.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    resolveText: { color: c.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    blockBox: { flexDirection: 'row', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: c.outlineVariant },
    input: { flex: 1, backgroundColor: c.background, borderColor: c.outlineVariant, borderWidth: 1, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 10, color: c.onSurface, fontFamily: fonts.mono, fontSize: 14 },
    blockBtn: { width: 44, borderRadius: radius, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    blockPill: { borderColor: c.error, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
    blockPillText: { color: c.error, fontFamily: fonts.semibold, fontSize: 12 },
    unblockBtn: { backgroundColor: c.surfaceLow, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
    unblockText: { color: c.onSurfaceVariant, fontFamily: fonts.semibold, fontSize: 12 },
    empty: { color: c.fg3, textAlign: 'center', marginTop: 30, fontFamily: fonts.mono, fontSize: 13 },
  });
