/**
 * DESIGN MOCK — Feed home, Strava's activity feed shape.
 *
 * One card per NIGHT, never per beer. The card is readable without opening it:
 * who, where, and the three numbers. That is the whole Strava trick — the feed
 * is not a list of links to activities, it IS the activities.
 *
 * Card order, top to bottom:
 *   author + when          who is talking, and how fresh it is
 *   title                  the night, named
 *   pub chain              the route, in amber, like a Strava map
 *   three numbers          piva / čas / hospody, hairline-separated
 *   people                 overlapping initials, the table
 *   cheers · comments      the social floor
 *
 * A live night gets a pill instead of a timestamp and skips the numbers that
 * are not final yet.
 *
 * System font throughout (see PartyRecapScreen's header for why).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, type Href } from "expo-router";

import { MessageSquareIcon, SearchIcon } from "@/components/shared/IconGlyph";
import { GlassIconButton } from "@/components/shared/GlassIconButton";
import { CheersButton } from "@/feed/CheersButton";
import { cs } from "@/i18n/cs";
import type { FeedEntry } from "@/feed/mockFeed";
import { PartyHighlight } from "@/feed/PartyHighlight";
import { buildRoast } from "@/feed/roast";
import {
  mergeFeedNights,
  pendingPublishToFeedEntry,
  publishedNightToFeedEntry,
  type FeedNightEntry,
} from "@/feed/feedModel";
import {
  clearNightReaction,
  fetchNightsFeed,
  isRetriableNightError,
  reactToNight,
  subscribeNightsFeedChanges,
  type NightsFeedScope,
  type PublishedNight,
} from "@/data/nightsClient";
import {
  enqueueNightOp,
  getPendingNightPublishes,
  subscribeNightsQueue,
} from "@/data/nightsQueue";
import SegmentedControl from "@/friends/SegmentedControl";
import SkeletonBlock from "@/friends/SkeletonBlock";
import { useNowTick } from "@/friends/useNowTick";
import { StatGrid } from "@/mocks/StatGrid";
import { MockColors, MockLayout, MockType } from "@/mocks/mockTheme";
import { useAccountStore } from "@/stores/accountStore";
import { useToastStore } from "@/stores/toastStore";
import { TAB_CHROME } from '@/components/shared/TabBar';
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { HitArea, Radius, Spacing } from "@/theme/layout";
import { useReduceMotion } from "@/utils/useReduceMotion";

const SCOPES: readonly [NightsFeedScope, NightsFeedScope] = ['friends', 'global'];
type FeedCardEntry = FeedEntry | FeedNightEntry;

function isNightEntry(entry: FeedCardEntry): entry is FeedNightEntry {
  return 'source' in entry && entry.source === 'night';
}

/** "Honza, Petr a ty" — the table, named the way you would say it out loud. */
function namesLine(people: { name: string }[]): string {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} a ${names[names.length - 1]}`;
}

/** A face when there is one, the initial when there is not. The ring is the
 *  card ground, so overlapping faces punch out of each other cleanly.
 *
 *  Exported because the recap's byline IS this byline — the detail is the post
 *  opened, so a second implementation there could only ever drift from it. */
export function Face({
  name,
  tint,
  avatar,
  size = 28,
}: {
  name: string;
  tint: string;
  avatar?: string;
  size?: number;
}) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

  const shape = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (avatar && failedAvatar !== avatar) {
    return (
      <Image
        source={{ uri: avatar }}
        style={[styles.avatar, shape]}
        onError={() => setFailedAvatar(avatar)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={[styles.avatar, shape, { backgroundColor: tint, borderColor: MockColors.surface }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {name.replace('@', '').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export function FeedCard({
  entry,
  first = false,
}: {
  entry: FeedCardEntry;
  /** The band separates posts FROM EACH OTHER. Above the first one there is no
   *  previous post to separate it from, only the title — so it reads as a rule
   *  under the header instead of a gap, which is a different thing. */
  first?: boolean;
}) {
  const router = useRouter();
  const real = isNightEntry(entry);

  // Derived, not written: every roast is a true observation about THIS night,
  // and the rules stay silent when there is nothing fair to say (see roast.ts).
  const roast = real
    ? null
    : buildRoast({
        beers: entry.beers,
        duration: entry.durationMinutes,
        pubs: entry.stops.length,
        people: entry.people.length,
        photos: entry.photos,
        games: entry.games,
        gamesWon: entry.gamesWon,
        usualPerHour: entry.usualPerHour,
        visitsToSamePub: entry.visitsToSamePub,
      });

  const people = real
    ? [
        {
          name: entry.author.nickname ? `@${entry.author.nickname}` : entry.author.displayName,
          tint: Colors.amber,
          avatar: entry.author.avatarUrl ?? undefined,
        },
      ]
    : entry.people;
  const title = real ? entry.title : roast?.line ?? entry.title;
  const description = real
    ? [
        entry.city || null,
        cs.vycep.storySecondaryLine(
          entry.wineCount,
          entry.shotCount,
          entry.softDrinkCount,
        ) || null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : roast?.basis ?? entry.note ?? '';
  const beerCount = real ? entry.beerCount : entry.beers;
  const duration = entry.duration;
  const pubCount = real ? entry.pubNames.length : entry.stops.length;
  const durationLabel = real ? 'Večer' : entry.live ? 'Běží' : 'Večer';

  const content = (
    <>
      <Pressable
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        onPress={() => {
          const handle = real
            ? entry.author.nickname ?? ''
            : entry.people[0]?.name.replace('@', '') ?? '';
          if (handle) router.push(`/user?handle=${encodeURIComponent(handle)}` as Href);
        }}
        disabled={real && !entry.author.nickname}
        accessibilityRole="button"
        accessibilityLabel={`Profil: ${namesLine(people)}`}
      >
        <View style={styles.headAvatars}>
          {people.slice(0, 4).map((person, index) => (
            <View key={`${person.name}-${index}`} style={index === 0 ? undefined : styles.peopleOverlap}>
              <Face
                name={person.name}
                tint={person.tint}
                avatar={person.avatar}
                size={30}
              />
            </View>
          ))}
        </View>
        <View style={styles.grow}>
          <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {namesLine(people)}
          </Text>
          <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
            {real && entry.pending ? 'Čeká na signál' : entry.when}
          </Text>
        </View>
      </Pressable>

      <Text style={styles.title} numberOfLines={3} maxFontSizeMultiplier={FontScaleCap.heading}>
        {title}
      </Text>
      {description ? (
        <Text style={styles.description} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {description}
        </Text>
      ) : null}
      <View style={styles.statsRow}>
        <StatGrid
          columns={3}
          stats={[
            { label: "Piva", value: String(beerCount) },
            { label: durationLabel, value: duration },
            { label: "Hospody", value: String(pubCount) },
          ]}
        />
      </View>
    </>
  );

  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      {real ? (
        <View>{content}</View>
      ) : (
        <Pressable
          style={({ pressed }) => [pressed && styles.cardPressed]}
          onPress={() => router.push("/friends/party-recap" as Href)}
          accessibilityRole="button"
          accessibilityLabel={`${entry.title}, detail večera`}
        >
          {content}
        </Pressable>
      )}

      {real ? (
        entry.pubNames.length > 0 ? (
          <Text style={styles.realRoute} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
            {entry.pubNames.join('  →  ')}
          </Text>
        ) : null
      ) : (
        <View style={styles.hero}>
          <PartyHighlight entry={entry} />
        </View>
      )}

      {real ? (
        !entry.isMine && !entry.pending ? <FeedReaction entry={entry} /> : null
      ) : (
        <View style={styles.cardFoot}>
          <CheersButton
            count={entry.cheers}
            cheered={Boolean(entry.cheered)}
            label={cs.friends.cheersCount(entry.cheers)}
          />
          <Pressable
            style={({ pressed }) => [styles.footAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Komentáře"
          >
            <MessageSquareIcon size={19} color={Colors.foam} />
            <Text style={styles.footText} allowFontScaling={false}>{entry.comments}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function FeedReaction({ entry }: { entry: FeedNightEntry }) {
  const showToast = useToastStore((state) => state.show);
  const [active, setActive] = useState(entry.myRound);
  const [count, setCount] = useState(entry.rounds);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(() => {
    if (busy) return;
    const next = !active;
    const previousCount = count;
    setActive(next);
    setCount((value) => Math.max(0, value + (next ? 1 : -1)));
    setBusy(true);
    const request = next ? reactToNight(entry.id) : clearNightReaction(entry.id);
    void request.then((result) => {
      setBusy(false);
      if (result.ok) {
        setActive(result.myRound);
        setCount(result.rounds);
        return;
      }
      if (isRetriableNightError(result)) {
        void enqueueNightOp(next ? { op: 'round', nightId: entry.id } : { op: 'round-clear', nightId: entry.id });
        showToast(cs.vycep.roundQueuedToast);
        return;
      }
      setActive(!next);
      setCount(previousCount);
      showToast(cs.vycep.roundErrorToast);
    });
  }, [active, busy, count, entry.id, showToast]);

  return (
    <View style={styles.cardFoot}>
      <CheersButton
        count={count}
        cheered={active}
        onPress={toggle}
        label={cs.friends.cheersCount(count)}
      />
    </View>
  );
}

function FeedSkeleton() {
  const reduceMotion = useReduceMotion();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.card, index === 0 && styles.cardFirst]}>
          <View style={styles.skeletonHead}>
            <SkeletonBlock width={30} height={30} radius={15} reduceMotion={reduceMotion} />
            <View style={styles.skeletonText}>
              <SkeletonBlock width="42%" height={14} reduceMotion={reduceMotion} />
              <SkeletonBlock width="24%" height={10} reduceMotion={reduceMotion} />
            </View>
          </View>
          <SkeletonBlock width="72%" height={22} reduceMotion={reduceMotion} />
          <View style={styles.skeletonStats}>
            {[0, 1, 2].map((stat) => (
              <SkeletonBlock key={stat} width="29%" height={48} reduceMotion={reduceMotion} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function LoadingMoreSkeleton() {
  const reduceMotion = useReduceMotion();
  return (
    <View style={styles.loadingMore} accessibilityElementsHidden importantForAccessibility="no">
      <SkeletonBlock width="100%" height={72} reduceMotion={reduceMotion} />
    </View>
  );
}

export default function FeedMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useNowTick();
  const profile = useAccountStore((state) => state.profile);
  const [scopeIndex, setScopeIndex] = useState<0 | 1>(0);
  const scope = SCOPES[scopeIndex];
  const [nights, setNights] = useState<PublishedNight[] | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof getPendingNightPublishes>>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSeq = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadPending = useCallback(() => {
    void getPendingNightPublishes().then((items) => {
      if (mountedRef.current) setPending(items);
    });
  }, []);

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    void fetchNightsFeed(scope).then((result) => {
      if (!mountedRef.current) return;
      setRefreshing(false);
      if (seq !== requestSeq.current) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setNights(result.nights);
      setCursor(result.nextCursor);
    });
  }, [scope]);

  useFocusEffect(
    useCallback(() => {
      loadPending();
      load();
    }, [load, loadPending]),
  );

  useEffect(() => subscribeNightsFeedChanges(load), [load]);
  useEffect(() => subscribeNightsQueue(loadPending), [loadPending]);

  const [previousScope, setPreviousScope] = useState(scope);
  if (scope !== previousScope) {
    setPreviousScope(scope);
    setNights(null);
    setCursor(null);
    setFailed(false);
  }

  const refresh = useCallback(() => {
    setRefreshing(true);
    loadPending();
    load();
  }, [load, loadPending]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore || refreshing || nights === null) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    void fetchNightsFeed(scope, cursor).then((result) => {
      if (!mountedRef.current) return;
      setLoadingMore(false);
      if (seq !== requestSeq.current || !result.ok) return;
      setNights((current) => {
        const seen = new Set((current ?? []).map((night) => night.id));
        return [...(current ?? []), ...result.nights.filter((night) => !seen.has(night.id))];
      });
      setCursor(result.nextCursor);
    });
  }, [cursor, loadingMore, nights, refreshing, scope]);

  const entries = useMemo(() => {
    const published = (nights ?? []).map((night) => publishedNightToFeedEntry(night, now));
    const queued = pending
      .filter((payload) => scope === 'friends' || payload.visibility === 'public')
      .map((payload) => pendingPublishToFeedEntry(payload, profile, now));
    return mergeFeedNights(queued, published);
  }, [nights, now, pending, profile, scope]);

  const header = (
    <>
      <View style={[styles.brandRow, { paddingTop: insets.top + Spacing.sm }]}>
        <Image source={require("../../assets/images/icon.png")} style={styles.mark} />
        <Text style={styles.wordmark} allowFontScaling={false}>Na pivo</Text>
      </View>
      <View style={styles.scope}>
        <SegmentedControl
          options={[cs.vycep.scopeParta, cs.vycep.scopeWorld]}
          value={scopeIndex}
          onChange={setScopeIndex}
          accessibilityLabel="Které kocoviny chceš vidět"
        />
      </View>
    </>
  );

  const empty = nights === null && !failed ? (
    <FeedSkeleton />
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
        {failed ? 'Kocoviny se teď nenačetly' : scope === 'friends' ? 'U party je zatím ticho' : 'Svět zatím dospává'}
      </Text>
      <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
        {failed
          ? 'Zatáhni dolů a zkus to znovu.'
          : scope === 'friends'
            ? 'Až někdo vyvěsí večer, objeví se tady. Klidně začni ty.'
            : 'Nikdo tu teď nemá vyvěšený večer. To se po pivu stává.'}
      </Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.screen}
        data={entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item, index }) => <FeedCard entry={item} first={index === 0} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={loadingMore ? <LoadingMoreSkeleton /> : null}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
      />

      <View style={[styles.searchFloat, { top: insets.top + Spacing.sm }]}>
        <GlassIconButton size={40} accessibilityLabel="Hledat" onPress={() => router.push("/search" as Href)}>
          <SearchIcon size={19} color={Colors.amber} />
        </GlassIconButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { flexGrow: 1, paddingHorizontal: MockLayout.screenPad },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: Spacing.md,
  },
  searchFloat: { position: "absolute", right: MockLayout.screenPad, zIndex: 2 },
  mark: { width: 28, height: 28, borderRadius: 7 },
  // Baloo, the one place a display face belongs: a wordmark is a picture of the
  // name, not text. Everything else on the screen is the system font (§3).
  wordmark: { fontFamily: Fonts.numeral, fontSize: 19, color: Colors.foam },
  scope: { paddingBottom: Spacing.sm },
  grow: { flex: 1 },
  pressed: { opacity: 0.6 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  screenTitle: { ...MockType.titleXL, color: Colors.foam },
  searchButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: "center",
    justifyContent: "center",
  },

  // — Nudge —
  // Not a card. Only posts get a surface; the nudge is a line of copy and a
  // button, and wrapping it panelled the first thing you see on the screen.
  nudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  nudgeTitle: { fontWeight: "700", fontSize: 15, color: Colors.foam },
  nudgeBody: {
    fontWeight: "400",
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  nudgeCta: {
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  nudgeCtaText: { fontWeight: "700", fontSize: 13, color: Colors.stout },

  // — Card —
  // No panel. A post wrapped in a card gives away the screen's width to a
  // border on both sides, and the feed is the one place that wants every pixel
  // for the content. Posts sit on the ground, separated by a hairline.
  // Posts are separated by a dark BAND, not a hairline. Strava does the same
  // and it is why its feed reads as a stack of separate things — a 1px line
  // between two panels of the same colour just makes one long panel with a
  // scratch in it. The band is darker than the ground, so it reads as the gap
  // between cards rather than a border on them.
  card: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderTopWidth: 10,
    borderTopColor: '#0F0A05',
    marginHorizontal: -Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  // No band above the first post — but it still needs air, or the byline sits
  // on the large title's baseline and reads as its subtitle.
  cardFirst: { borderTopWidth: 0, paddingTop: Spacing.xl },
  cardPressed: { opacity: 0.92 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  headAvatars: { flexDirection: "row", alignItems: "center" },

  // — Hero —
  hero: { marginTop: Spacing.md, marginHorizontal: -Spacing.md },
  realRoute: {
    marginTop: Spacing.md,
    fontSize: 14,
    fontWeight: '600',
    color: withAlpha(Colors.amber, 0.9),
  },
  photoStrip: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    top: 12,
    flexDirection: "row",
    gap: 6,
  },
  photo: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  photoMore: { backgroundColor: MockColors.surfaceHigh },
  photoMoreText: { fontSize: 12, fontWeight: "700", color: Colors.foam },
  author: { fontWeight: "700", fontSize: 15, color: Colors.foam },
  when: {
    fontWeight: "400",
    fontSize: 12,
    color: Colors.mutedText,
    marginTop: 1,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  liveText: {
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.amber,
  },

  description: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedText,
    lineHeight: 19,
    marginTop: 4,
  },
  title: {
    fontWeight: "800",
    fontSize: 21,
    color: Colors.foam,
    marginTop: Spacing.md,
    letterSpacing: -0.3,
  },
  route: {
    fontWeight: "500",
    fontSize: 13,
    color: withAlpha(Colors.amber, 0.85),
    marginTop: 3,
  },

  // — Numbers —
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  stat: { flex: 1 },
  statValue: {
    fontWeight: "800",
    fontSize: 22,
    color: Colors.foam,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontWeight: "500",
    fontSize: 11,
    color: Colors.mutedText,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: withAlpha(Colors.foam, 0.12),
    marginHorizontal: Spacing.sm,
  },

  // — People —
  peopleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.md,
  },
  peopleOverlap: { marginLeft: -9 },
  // A 2pt ring in the card colour punches each face out of the one behind it.
  avatar: { alignItems: "center", justifyContent: "center", borderWidth: 2 },
  avatarText: { fontWeight: "700", color: Colors.stout },
  peopleLabel: {
    flex: 1,
    fontWeight: "400",
    fontSize: 12,
    color: Colors.mutedText,
    marginLeft: Spacing.sm,
  },

  // — Floor —
  cardFoot: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  footAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
  },
  // The floor carries the card's only two actions, so it reads at full
  // strength — muted grey made them look like metadata you cannot press.
  footText: { fontWeight: "600", fontSize: 15, color: Colors.foam },
  footTextOn: { color: Colors.amber },

  skeletonHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  skeletonText: { flex: 1, gap: Spacing.xs },
  skeletonStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.lg },
  loadingMore: { paddingVertical: Spacing.md },
  empty: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: { fontSize: 21, fontWeight: '800', color: Colors.foam, textAlign: 'center' },
  emptyBody: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  mockNote: {
    fontWeight: "400",
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: "center",
    marginTop: Spacing.md,
  },
});
