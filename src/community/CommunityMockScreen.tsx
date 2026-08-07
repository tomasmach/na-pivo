import * as Location from 'expo-location';
import { useRouter, type Href } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChallengeGlyphIcon } from '@/community/ChallengeGlyphIcon';
import {
  EventCover,
  eventDateLabel,
  eventPlaceLabel,
  eventTimeLabel,
} from '@/community/EventCover';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import {
  fetchChallenges,
  type Challenge,
} from '@/data/challengesClient';
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
import { checkLocationPermission } from '@/compass/permissions';
import { MenuChip } from '@/mocks/MenuChip';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';

const SECTIONS = ['Žebříčky', 'Výzvy', 'Akce'] as const;
const METRICS = ['Piva', 'Hospody', 'Mapér XP'] as const;
const PERIODS = ['Týden', 'Letos', 'Celkem'] as const;

const CATEGORY_BY_LABEL: Record<(typeof METRICS)[number], LeaderboardCategory> = {
  Piva: 'beers',
  Hospody: 'pubs',
  'Mapér XP': 'mapper',
};
const PERIOD_BY_LABEL: Record<(typeof PERIODS)[number], LeaderboardPeriod> = {
  Týden: 'week',
  Letos: 'year',
  Celkem: 'all',
};

function profileName(entry: BoardEntry): string {
  if (entry.isMe) return '@ty';
  if (entry.account.nickname) return `@${entry.account.nickname}`;
  return entry.account.displayName || 'Pivař';
}

function unitFor(category: LeaderboardCategory, score: number): string {
  if (category === 'mapper') return 'XP';
  if (category === 'pubs') {
    if (score === 1) return 'hospoda';
    if (score >= 2 && score <= 4) return 'hospody';
    return 'hospod';
  }
  if (score === 1) return 'pivo';
  if (score >= 2 && score <= 4) return 'piva';
  return 'piv';
}

function challengeSummary(challenge: Challenge): string {
  const end = new Date(challenge.windowEnd);
  const deadline = Number.isFinite(end.getTime())
    ? `Do ${end.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' })}`
    : 'Aktivní výzva';
  return `${deadline} · ${challenge.current} z ${challenge.target}`;
}

function dedupeEvents(...groups: CommunityEvent[][]): CommunityEvent[] {
  const seen = new Set<string>();
  return groups.flat().filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function Podium({ rows, category }: { rows: BoardEntry[]; category: LeaderboardCategory }) {
  const order = [rows[1], rows[0], rows[2]];
  const heights = [64, 84, 56];
  return (
    <View style={styles.podium}>
      {order.map((row, index) =>
        row ? (
          <View key={row.account.id} style={styles.podiumCol}>
            <Avatar
              size={index === 1 ? 62 : 46}
              uri={row.account.avatarUrl}
              nickname={row.account.nickname}
              displayName={row.account.displayName}
              border={index === 1 ? 'amber' : 'quiet'}
            />
            <Text
              style={[styles.podiumHandle, index === 1 && styles.podiumHandleFirst]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {profileName(row)}
            </Text>
            <Text style={styles.podiumScore} allowFontScaling={false}>
              {row.score}
              <Text style={styles.podiumUnit}> {unitFor(category, row.score)}</Text>
            </Text>
            <View
              style={[
                styles.podiumBlock,
                { height: heights[index] },
                index === 1 && styles.podiumBlockFirst,
              ]}
            >
              <Text style={styles.podiumRank} allowFontScaling={false}>
                {row.rank}
              </Text>
            </View>
          </View>
        ) : (
          <View key={`empty-${index}`} style={styles.podiumCol} />
        ),
      )}
    </View>
  );
}

function LeaderboardSkeleton({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <View style={styles.skeletonGroup}>
      <View style={styles.skeletonPodium}>
        {[46, 62, 46].map((size, index) => (
          <View key={size + index} style={styles.skeletonPodiumCol}>
            <SkeletonBlock width={size} height={size} radius={size / 2} reduceMotion={reduceMotion} />
            <SkeletonBlock width="70%" height={13} reduceMotion={reduceMotion} />
            <SkeletonBlock width="50%" height={20} reduceMotion={reduceMotion} />
          </View>
        ))}
      </View>
      {[0, 1, 2, 3, 4].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={34} height={34} radius={17} reduceMotion={reduceMotion} />
          <SkeletonBlock width="52%" height={15} reduceMotion={reduceMotion} />
          <View style={styles.grow} />
          <SkeletonBlock width={42} height={18} reduceMotion={reduceMotion} />
        </View>
      ))}
    </View>
  );
}

function ChallengesSkeleton({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <View style={styles.skeletonGroup}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonChallenge}>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width={38} height={38} radius={19} reduceMotion={reduceMotion} />
            <SkeletonBlock width="62%" height={17} reduceMotion={reduceMotion} />
          </View>
          <SkeletonBlock width="100%" height={7} radius={4} reduceMotion={reduceMotion} />
        </View>
      ))}
    </View>
  );
}

function EventsSkeleton({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <View style={styles.skeletonGroup}>
      {[0, 1].map((index) => (
        <View key={index} style={styles.skeletonEvent}>
          <SkeletonBlock width={112} height={112} radius={0} reduceMotion={reduceMotion} tone="raised" />
          <View style={styles.skeletonEventCopy}>
            <SkeletonBlock width="80%" height={18} reduceMotion={reduceMotion} tone="raised" />
            <SkeletonBlock width="60%" height={13} reduceMotion={reduceMotion} tone="raised" />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function CommunityMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Žebříčky');
  const [metric, setMetric] = useState<(typeof METRICS)[number]>('Piva');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Týden');
  const [boardResult, setBoardResult] = useState<{
    key: string;
    board: Leaderboard | null;
  } | null>(null);
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [events, setEvents] = useState<CommunityEvent[] | null>(null);
  const [eventsHaveLocation, setEventsHaveLocation] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const category = CATEGORY_BY_LABEL[metric];
  const effectivePeriodLabel = category === 'mapper' ? 'Celkem' : period;
  const queryPeriod = PERIOD_BY_LABEL[effectivePeriodLabel];
  const boardKey = `${category}:${queryPeriod}`;
  const boardLoading = boardResult?.key !== boardKey;
  const board = boardLoading ? null : boardResult.board;

  useEffect(() => {
    const abort = new AbortController();
    void fetchLeaderboard(category, queryPeriod, { signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      setBoardResult({ key: boardKey, board: result });
    });
    return () => abort.abort();
  }, [boardKey, category, queryPeriod]);

  useEffect(() => {
    const abort = new AbortController();
    void fetchChallenges({ signal: abort.signal }).then((result) => {
      if (!abort.signal.aborted) setChallenges(result);
    });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      const listed = await fetchCommunityEvents(undefined, abort.signal);
      if (abort.signal.aborted) return;
      const mine = listed.ok ? dedupeEvents(listed.dashboard.hosted, listed.dashboard.joined) : [];
      if (!listed.ok) setEventsError(listed.detail);
      const permission = await checkLocationPermission();
      if (abort.signal.aborted) return;
      if (permission !== 'granted') {
        setEvents(mine);
        return;
      }
      try {
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (abort.signal.aborted) return;
        const discovered = await fetchCommunityEvents(
          { lat: fix.coords.latitude, lng: fix.coords.longitude },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (discovered.ok) {
          setEventsHaveLocation(true);
          setEvents(dedupeEvents(discovered.dashboard.nearby, mine));
          setEventsError(null);
        } else {
          setEvents(mine);
          setEventsError(discovered.detail);
        }
      } catch {
        setEvents(mine);
      }
    })();
    return () => abort.abort();
  }, []);

  const leaderboardRows = board?.entries ?? [];
  const rest = leaderboardRows.slice(3);
  const periodOptions = useMemo(
    () => (category === 'mapper' ? (['Celkem'] as const) : PERIODS),
    [category],
  );

  const eventsEmpty = eventsError
    ? eventsError
    : eventsHaveLocation
      ? 'V okolí se teď nic nechystá. Až se něco šustne, objeví se to tady.'
      : 'Bez povolené polohy okolí neproklepneme. Tvoje akce se tu ukážou i tak.';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <UnderlineTabs options={SECTIONS} value={section} onChange={setSection} inset={MockLayout.screenPad} />

      {section === 'Žebříčky' ? (
        <>
          <View style={styles.chips}>
            <MenuChip
              value={metric}
              options={METRICS}
              title="Podle čeho"
              onChange={(value) => setMetric(value as (typeof METRICS)[number])}
            />
            <MenuChip
              value={effectivePeriodLabel}
              options={periodOptions}
              title="Za jaké období"
              onChange={(value) => setPeriod(value as (typeof PERIODS)[number])}
            />
          </View>
          {boardLoading ? (
            <LeaderboardSkeleton reduceMotion={reduceMotion} />
          ) : leaderboardRows.length ? (
            <>
              <Podium rows={leaderboardRows} category={category} />
              {rest.map((row) => (
                <View key={row.account.id} style={[styles.row, row.isMe && styles.rowMe]}>
                  <Avatar
                    size={34}
                    uri={row.account.avatarUrl}
                    nickname={row.account.nickname}
                    displayName={row.account.displayName}
                    border="quiet"
                  />
                  <View style={styles.body}>
                    <Text
                      style={[styles.handle, row.isMe && styles.handleMe]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {profileName(row)}
                    </Text>
                    <Text style={styles.rank} allowFontScaling={false}>
                      {row.rank}. místo
                    </Text>
                  </View>
                  <Text style={styles.score} allowFontScaling={false}>
                    {row.score}
                    <Text style={styles.scoreUnit}> {unitFor(category, row.score)}</Text>
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.empty}>V tomhle žebříčku zatím nikdo nesedí.</Text>
          )}
        </>
      ) : null}

      {section === 'Výzvy' ? (
        challenges === null ? (
          <ChallengesSkeleton reduceMotion={reduceMotion} />
        ) : challenges.length ? (
          challenges.map((challenge, index) => (
            <Pressable
              key={challenge.id}
              onPress={() => router.push(`/community/challenge/${challenge.id}` as Href)}
              style={({ pressed }) => [
                styles.challenge,
                index === 0 && styles.challengeFirst,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={challenge.title}
            >
              <View style={styles.challengeHead}>
                <View style={styles.medallion}>
                  <ChallengeGlyphIcon glyph={challenge.glyph} size={17} color={Colors.amber} />
                </View>
                <View style={styles.grow}>
                  <Text style={styles.handle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                    {challenge.title}
                  </Text>
                  <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                    {challengeSummary(challenge)}
                  </Text>
                </View>
                <ChevronRightIcon size={18} color={Colors.mutedText} />
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${challenge.ratio * 100}%`, backgroundColor: Colors.amber },
                  ]}
                />
              </View>
            </Pressable>
          ))
        ) : (
          <Text style={styles.empty}>Výčepní výzvy teď odpočívají. Mrkni sem zase později.</Text>
        )
      ) : null}

      {section === 'Akce' ? (
        events === null ? (
          <EventsSkeleton reduceMotion={reduceMotion} />
        ) : events.length ? (
          events.map((event) => (
            <Pressable
              key={event.id}
              onPress={() => router.push(`/community/event/${event.id}` as Href)}
              style={({ pressed }) => [styles.event, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${event.title}, ${eventDateLabel(event)} ${eventTimeLabel(event)}, ${eventPlaceLabel(event)}`}
            >
              <EventCover event={event} height={112} />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {event.title}
                </Text>
                <Text style={styles.eventMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {eventDateLabel(event)} {eventTimeLabel(event)} · {eventPlaceLabel(event)}
                </Text>
              </View>
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            </Pressable>
          ))
        ) : (
          <Text style={styles.empty}>{eventsEmpty}</Text>
        )
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  pressed: { opacity: 0.65 },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    marginTop: MockLayout.sectionGap,
    marginBottom: Spacing.md,
  },
  podiumCol: { flex: 1, alignItems: 'center', gap: 3 },
  podiumHandle: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  podiumHandleFirst: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  podiumScore: { fontSize: 20, fontWeight: '800', color: Colors.foam, fontVariant: ['tabular-nums'] },
  podiumBlock: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    paddingTop: 6,
    marginTop: 4,
  },
  podiumBlockFirst: { backgroundColor: withAlpha(Colors.amber, 0.34) },
  podiumUnit: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  podiumRank: { fontSize: 15, fontWeight: '800', color: Colors.amber },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowMe: { borderTopColor: withAlpha(Colors.amber, 0.3) },
  rank: { fontSize: 13, fontWeight: '600', color: Colors.mutedText, marginTop: 2, fontVariant: ['tabular-nums'] },
  body: { flex: 1, gap: 5 },
  handle: { ...MockType.bodySemibold, color: Colors.foam },
  handleMe: { color: Colors.amber },
  score: { fontSize: 16, fontWeight: '700', color: Colors.foam, fontVariant: ['tabular-nums'] },
  scoreUnit: { fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  challenge: {
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  challengeFirst: { borderTopWidth: 0, marginTop: Spacing.sm },
  challengeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  medallion: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  sub: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  track: { height: 7, borderRadius: 4, backgroundColor: withAlpha(Colors.foam, 0.07), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  event: {
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
    overflow: 'hidden',
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingRight: Spacing.md,
  },
  eventBody: { flex: 1, gap: 3, paddingVertical: Spacing.md },
  eventTitle: { ...MockType.bodySemibold, fontSize: 17, color: Colors.foam },
  eventMeta: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  empty: { fontSize: 15, lineHeight: 22, color: Colors.mutedText, marginTop: MockLayout.sectionGap },
  skeletonGroup: { gap: Spacing.md, marginTop: Spacing.sm },
  skeletonPodium: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginTop: Spacing.lg },
  skeletonPodiumCol: { flex: 1, alignItems: 'center', gap: Spacing.sm },
  skeletonRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  skeletonChallenge: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  skeletonEvent: { height: 112, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.stout2, borderRadius: MockLayout.cardRadius, overflow: 'hidden' },
  skeletonEventCopy: { flex: 1, gap: Spacing.sm },
});
