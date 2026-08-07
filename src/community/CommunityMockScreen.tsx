import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useRouter, type Href } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChallengeGlyphIcon } from '@/community/ChallengeGlyphIcon';
import { EventCover } from '@/community/EventCover';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import type { Challenge } from '@/data/challengesClient';
import { fetchChallenges } from '@/data/challengesClient';
import {
  fetchCommunityEvents,
  type CommunityEvent,
} from '@/data/communityEventsClient';
import {
  fetchLeaderboard,
  type BoardEntry,
  type Leaderboard,
  type LeaderboardCategory,
  type LeaderboardPeriod,
} from '@/data/leaderboardsClient';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { MenuChip } from '@/mocks/MenuChip';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { useAccountStore } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const SECTIONS = ['Žebříčky', 'Výzvy', 'Akce'] as const;
const METRICS = ['Piva', 'Hospody', 'Mapér XP'] as const;
const PERIODS = ['Týden', 'Letos', 'Celkem'] as const;

type Metric = (typeof METRICS)[number];
type Period = (typeof PERIODS)[number];

const CATEGORY: Record<Metric, LeaderboardCategory> = {
  Piva: 'beers',
  Hospody: 'pubs',
  'Mapér XP': 'mapper',
};
const WINDOW: Record<Period, LeaderboardPeriod> = {
  Týden: 'week',
  Letos: 'year',
  Celkem: 'all',
};
const UNITS: Record<Metric, string> = { Piva: 'piv', Hospody: 'hospod', 'Mapér XP': 'XP' };

function eventWhen(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function challengeDeadline(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long' }).format(parsed);
}

function Podium({ rows, unit }: { rows: BoardEntry[]; unit: string }) {
  const order = [rows[1], rows[0], rows[2]].filter((row): row is BoardEntry => Boolean(row));
  const heights = [64, 84, 56];
  return (
    <View style={styles.podium}>
      {order.map((row, index) => {
        const handle = row.account.nickname ? `@${row.account.nickname}` : row.account.displayName;
        return (
          <View key={row.account.id} style={styles.podiumCol}>
            <Avatar
              uri={row.account.avatarUrl}
              nickname={row.account.nickname}
              displayName={row.account.displayName}
              size={index === 1 ? 62 : 46}
              border={index === 1 ? 'amber' : 'quiet'}
            />
            <Text
              style={[styles.podiumHandle, index === 1 && styles.podiumHandleFirst]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {handle}
            </Text>
            <Text style={styles.podiumScore} allowFontScaling={false}>
              {row.score}<Text style={styles.podiumUnit}> {unit}</Text>
            </Text>
            <View style={[styles.podiumBlock, { height: heights[index] }, index === 1 && styles.podiumBlockFirst]}>
              <Text style={styles.podiumRank} allowFontScaling={false}>{row.rank}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function LoadingRows() {
  const reduceMotion = useReducedMotion();
  return (
    <View style={styles.loading} accessibilityLabel="Načítám komunitu">
      <SkeletonBlock width="100%" height={92} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={58} reduceMotion={reduceMotion} />
      <SkeletonBlock width="100%" height={58} reduceMotion={reduceMotion} />
    </View>
  );
}

async function coarseLocation(): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return undefined;
    const fix =
      (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000, requiredAccuracy: 1000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return {
      // Roughly one kilometre. Discovery does not need a table's precise pin.
      lat: Number(fix.coords.latitude.toFixed(2)),
      lng: Number(fix.coords.longitude.toFixed(2)),
    };
  } catch {
    return undefined;
  }
}

function CommunityMockScreenContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useAccountStore((state) => state.profile);
  const [section, setSection] = React.useState<(typeof SECTIONS)[number]>('Žebříčky');
  const [metric, setMetric] = React.useState<Metric>('Piva');
  const [period, setPeriod] = React.useState<Period>('Týden');
  const [board, setBoard] = React.useState<Leaderboard | null>(null);
  const [boardLoading, setBoardLoading] = React.useState(true);
  const [boardFailed, setBoardFailed] = React.useState(false);
  const [challenges, setChallenges] = React.useState<Challenge[] | null>(null);
  const [challengesLoading, setChallengesLoading] = React.useState(true);
  const [challengesFailed, setChallengesFailed] = React.useState(false);
  const [events, setEvents] = React.useState<CommunityEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = React.useState(true);
  const [eventsFailed, setEventsFailed] = React.useState(false);
  const [eventsAuthRequired, setEventsAuthRequired] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  // Mapér XP is an exact lifetime counter. Its durable ledgers do not preserve
  // every historical bonus amount by timestamp, so pretending that Týden and
  // Letos are different boards would be worse than an honest fixed window.
  const effectivePeriod: Period = metric === 'Mapér XP' ? 'Celkem' : period;

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const kickoff = setTimeout(() => {
      setBoardLoading(true);
      setBoardFailed(false);
      void fetchLeaderboard(CATEGORY[metric], WINDOW[effectivePeriod], {
        signal: controller.signal,
        force: revision > 0,
      }).then((result) => {
        if (!active) return;
        setBoard(result);
        setBoardFailed(result === null);
        setBoardLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(kickoff);
      controller.abort();
    };
  }, [effectivePeriod, metric, revision]);

  React.useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const kickoff = setTimeout(() => {
      setChallengesLoading(true);
      setChallengesFailed(false);
      setEventsLoading(true);
      setEventsFailed(false);
      setEventsAuthRequired(false);
      void Promise.all([
        fetchChallenges({ signal: controller.signal, force: revision > 0 }),
        coarseLocation().then((location) => fetchCommunityEvents(location, controller.signal)),
      ]).then(([challengeRows, eventResult]) => {
        if (!active) return;
        setChallenges(challengeRows ?? []);
        setChallengesFailed(challengeRows === null);
        setChallengesLoading(false);
        if (eventResult.ok) {
          const unique = new Map<string, CommunityEvent>();
          for (const event of [
            ...eventResult.dashboard.nearby,
            ...eventResult.dashboard.hosted,
            ...eventResult.dashboard.joined,
          ]) unique.set(event.id, event);
          setEvents([...unique.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
        } else {
          setEvents([]);
        }
        setEventsAuthRequired(!eventResult.ok && eventResult.code === 'auth');
        setEventsFailed(!eventResult.ok && eventResult.code !== 'auth');
        setEventsLoading(false);
        setRefreshing(false);
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(kickoff);
      controller.abort();
    };
  }, [revision]);

  const boardRows = React.useMemo(() => {
    if (!board) return [];
    const rows = [...board.entries];
    if (!board.me.listed && board.me.rank !== null && profile?.id) {
      rows.push({
        rank: board.me.rank,
        score: board.me.score,
        isMe: true,
        isFriend: false,
        account: {
          id: profile.id,
          nickname: profile.nickname,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
      });
    }
    return rows.sort((left, right) => left.rank - right.rank);
  }, [board, profile]);
  const rest = boardRows.slice(3);

  const refresh = () => {
    setRefreshing(true);
    setRevision((value) => value + 1);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
    >
      <UnderlineTabs options={SECTIONS} value={section} onChange={setSection} inset={MockLayout.screenPad} />

      {section === 'Žebříčky' ? (
        <>
          <View style={styles.chips}>
            <MenuChip value={metric} options={METRICS} title="Podle čeho" onChange={(value) => setMetric(value as Metric)} />
            <MenuChip
              value={effectivePeriod}
              options={metric === 'Mapér XP' ? ['Celkem'] : PERIODS}
              title="Za jaké období"
              onChange={(value) => setPeriod(value as Period)}
            />
          </View>
          {boardLoading ? <LoadingRows /> : boardFailed ? (
            <Text style={styles.empty}>Žebříček se teď nedotáhl. Potáhni dolů a zkus to znovu.</Text>
          ) : boardRows.length ? (
            <>
              <Podium rows={boardRows.slice(0, 3)} unit={UNITS[metric]} />
              {rest.map((row) => {
                const handle = row.account.nickname ? `@${row.account.nickname}` : row.account.displayName;
                return (
                  <View key={row.account.id} style={[styles.row, row.isMe && styles.rowMe]}>
                    <Avatar uri={row.account.avatarUrl} nickname={row.account.nickname} displayName={row.account.displayName} size={34} border="quiet" />
                    <View style={styles.body}>
                      <Text style={[styles.handle, row.isMe && styles.handleMe]} numberOfLines={1}>{handle}</Text>
                      <Text style={styles.rank} allowFontScaling={false}>{row.rank}. místo</Text>
                    </View>
                    <Text style={styles.score} allowFontScaling={false}>{row.score}<Text style={styles.scoreUnit}> {UNITS[metric]}</Text></Text>
                  </View>
                );
              })}
            </>
          ) : (
            <Text style={styles.empty}>V tomhle žebříčku zatím nikdo není.</Text>
          )}
        </>
      ) : null}

      {section === 'Výzvy' ? (
        challengesLoading ? <LoadingRows /> : challengesFailed ? (
          <Text style={styles.empty}>Výzvy se teď nedotáhly. Potáhni dolů a zkus to znovu.</Text>
        ) : challenges?.length ? challenges.map((challenge, index) => (
          <Pressable
            key={challenge.id}
            onPress={() => router.push(`/community/challenge/${challenge.id}` as Href)}
            style={({ pressed }) => [styles.challenge, index === 0 && styles.challengeFirst, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={challenge.title}
          >
            <View style={styles.challengeHead}>
              <View style={styles.medallion}><ChallengeGlyphIcon glyph={challenge.glyph} size={17} color={Colors.amber} /></View>
              <View style={styles.grow}>
                <Text style={styles.handle} numberOfLines={1}>{challenge.title}</Text>
                <Text style={styles.sub}>Do {challengeDeadline(challenge.deadline)} · {challenge.done} z {challenge.goal}</Text>
              </View>
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${challenge.progress * 100}%` }]} /></View>
          </Pressable>
        )) : <Text style={styles.empty}>Teď neběží žádná výzva.</Text>
      ) : null}

      {section === 'Akce' ? (
        eventsLoading ? <LoadingRows /> : <>
          {eventsAuthRequired ? null : eventsFailed ? (
            <Text style={styles.empty}>Akce se teď nedotáhly. Potáhni dolů a zkus to znovu.</Text>
          ) : (events ?? []).map((event) => (
            <Pressable
              key={event.id}
              onPress={() => router.push(`/community/event/${event.id}` as Href)}
              style={({ pressed }) => [styles.event, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={event.title}
            >
              <EventCover event={event} height={112} />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.eventMeta} numberOfLines={2}>{eventWhen(event.startsAt)} · {event.areaLabel || event.city}</Text>
              </View>
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            </Pressable>
          ))}
          {!eventsAuthRequired && !eventsFailed && (events?.length ?? 0) === 0 ? <Text style={styles.empty}>V okolí teď žádná akce není.</Text> : null}
          <Pressable
            style={({ pressed }) => [styles.create, pressed && styles.pressed]}
            onPress={() => router.push((eventsAuthRequired ? '/auth' : '/community-events') as Href)}
            accessibilityRole="button"
            accessibilityLabel={eventsAuthRequired ? 'Přihlásit se pro akce' : 'Moje akce a nové setkání'}
          >
            <Text style={styles.createText}>{eventsAuthRequired ? 'Přihlásit se pro akce' : 'Moje akce a nové setkání'}</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

/**
 * Community state contains personalized ranks, challenge progress and joined
 * events. Tabs remain mounted across login/logout, so remount this local state
 * at the account boundary before any replacement-account request can settle.
 * The key remains unchanged for same-account offline refreshes.
 */
export default function CommunityMockScreen() {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  return <CommunityMockScreenContent key={accountId ?? 'account-pending'} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  pressed: { opacity: 0.65 },
  loading: { gap: Spacing.sm, marginTop: Spacing.lg },
  empty: { fontSize: 15, fontWeight: '500', color: Colors.mutedText, textAlign: 'center', marginTop: MockLayout.sectionGap },
  chips: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginTop: MockLayout.sectionGap, marginBottom: Spacing.md },
  podiumCol: { flex: 1, alignItems: 'center', gap: 3 },
  podiumHandle: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  podiumHandleFirst: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  podiumScore: { fontSize: 20, fontWeight: '800', color: Colors.foam, fontVariant: ['tabular-nums'] },
  podiumUnit: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  podiumBlock: { alignSelf: 'stretch', borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: withAlpha(Colors.amber, 0.16), alignItems: 'center', paddingTop: 6, marginTop: 4 },
  podiumBlockFirst: { backgroundColor: withAlpha(Colors.amber, 0.34) },
  podiumRank: { fontSize: 15, fontWeight: '800', color: Colors.amber },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm + 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  rowMe: { borderTopColor: withAlpha(Colors.amber, 0.3) },
  body: { flex: 1, gap: 3 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  handleMe: { color: Colors.amber },
  rank: { fontSize: 13, fontWeight: '600', color: Colors.mutedText, fontVariant: ['tabular-nums'] },
  score: { fontSize: 16, fontWeight: '700', color: Colors.foam, fontVariant: ['tabular-nums'] },
  scoreUnit: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  medallion: { width: 38, height: 38, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(Colors.amber, 0.12) },
  grow: { flex: 1 },
  challenge: { gap: Spacing.sm, paddingVertical: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  challengeFirst: { borderTopWidth: 0, marginTop: Spacing.sm },
  challengeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  sub: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  track: { height: 7, borderRadius: 4, backgroundColor: withAlpha(Colors.foam, 0.07), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: Colors.amber },
  event: { borderRadius: MockLayout.cardRadius, backgroundColor: Colors.stout2, overflow: 'hidden', marginTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingRight: Spacing.md },
  eventBody: { flex: 1, gap: 3, paddingVertical: Spacing.md },
  eventTitle: { ...MockType.bodySemibold, fontSize: 17, color: Colors.foam },
  eventMeta: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  create: { minHeight: 48, borderRadius: Radius.pill, backgroundColor: Colors.stout3, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, paddingHorizontal: Spacing.lg },
  createText: { fontSize: 14, fontWeight: '700', color: Colors.foam },
});
