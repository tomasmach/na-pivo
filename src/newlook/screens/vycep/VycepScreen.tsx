import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { reportProfileContent } from '@/data/auth';
import { fetchLeaderboard } from '@/data/leaderboardsClient';
import {
  clearNightReaction,
  fetchNightsFeed,
  fetchNightsSummary,
  isRetriableNightError,
  reactToNight,
  unpublishNight,
  type NightsFeedScope,
  type NightsSummaryResult,
  type PublishedNight,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { fetchPhotoContestTeaser } from '@/data/photoContestClient';
import { syncSharingPrefs } from '@/data/sharingPrefsClient';
import { intlLocale, t } from '@/i18n';
import { useToursStore } from '@/stores/toursStore';
import { useVycepStore } from '@/stores/vycepStore';

import { BottomFade, TabHeader, TopFade, useTabBarSpace, useTabHeaderScroll } from '../../components/chrome';
import { BookTab } from '../../duo/BookTab';
import { useDetailPages, useNvRouter } from '../../duo/details';
import { useBook, useIsDuo } from '../../duo/layout';
import { StatusCard } from '../../components/StatusCard';
import { Icon, type IconName } from '../../components/Icon';
import { D, T, Button, Dot, Press, Segmented } from '../../components/ui';
import { NO_VALUE } from '../../format';
import { fadeIn } from '../../motion';
import { C, SCREEN_X, s } from '../../theme';
import { dialog, toast } from '../../ui/store';
import { clockTime, daysUntil, routeLine } from './nightData';
import { useEdgeBleed } from '../../duo/paneContext';

export function RundaButton({ count, given, onPress, disabled }: { count: number; given: boolean; onPress: () => void; disabled?: boolean }) {
  if (disabled) {
    // Your own night collects rounds but cannot take one, so it shows a count instead of a button.
    if (count === 0) return null;
    return (
      <View style={[s.row, { height: 36, gap: 6 }]} accessible accessibilityLabel={t.nv.vycep.round(count)}>
        <Icon name="hand-platter" size={16} color={C.muted} />
        <T s={14} w={600} c={C.text2}>
          {t.nv.vycep.round(count)}
        </T>
      </View>
    );
  }
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityLabel={given ? t.nv.vycep.roundTake : t.nv.vycep.roundGive}
      accessibilityState={{ selected: given }}
      style={[
        s.row,
        {
          alignSelf: 'flex-start',
          height: 36,
          borderRadius: 18,
          paddingHorizontal: 14,
          gap: 6,
          backgroundColor: given ? C.yellowTint : 'transparent',
          borderWidth: 1,
          borderColor: given ? C.yellowLine : C.hairline,
        },
      ]}
    >
      <Icon name="hand-platter" size={16} color={C.yellow} />
      <T s={14} w={600} c={given ? C.yellow : C.white}>
        {count > 0 ? t.nv.vycep.round(count) : t.nv.vycep.roundGive}
      </T>
    </Press>
  );
}

function Shortcut({ icon, title, sub, onPress, selected }: { icon: IconName; title: string; sub: string; onPress: () => void; selected?: boolean }) {
  return (
    <Press
      onPress={onPress}
      accessibilityState={selected ? { selected: true } : undefined}
      // Open beside the feed on the iPhone Duo, like a selected row in a split view.
      style={{ width: 118, padding: 12, gap: 6, borderRadius: 18, backgroundColor: selected ? C.ring : C.card }}
    >
      <Icon name={icon} size={16} color={C.yellow} />
      <View style={{ gap: 2 }}>
        <T s={14} w={700}>
          {title}
        </T>
        <T s={12} c={C.muted} numberOfLines={1}>
          {sub || ' '}
        </T>
      </View>
    </Press>
  );
}

function authorHandle(night: PublishedNight): string {
  return night.author.nickname ? `@${night.author.nickname}` : night.author.displayName || t.nv.vycep.authorFallback;
}

function postWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const day = (x: Date) => x.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (day(d) === day(now)) return t.nv.vycep.postToday(clockTime(iso));
  if (day(d) === day(yesterday)) return t.nv.vycep.postYesterday(clockTime(iso));
  return d.toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric' });
}

const Post = memo(function Post({ night, showScope, onRemoved }: { night: PublishedNight; showScope: boolean; onRemoved: (id: string) => void }) {
  const [given, setGiven] = useState(night.myRound);
  const [count, setCount] = useState(night.rounds);
  const busy = useRef(false);
  const handle = authorHandle(night);

  const toggleRound = () => {
    if (busy.current || night.isMine) return;
    busy.current = true;
    const turningOn = !given;
    trackUiInteraction('night_react', turningOn ? 'toggle_on' : 'toggle_off');
    setGiven(turningOn);
    setCount((c) => Math.max(0, c + (turningOn ? 1 : -1)));
    void (turningOn ? reactToNight(night.id) : clearNightReaction(night.id)).then((res) => {
      busy.current = false;
      trackUiInteraction('night_react', res.ok || isRetriableNightError(res) ? 'success' : 'failure');
      if (res.ok) {
        setCount(res.rounds);
        setGiven(res.myRound);
        return;
      }
      if (isRetriableNightError(res)) {
        void enqueueNightOp(turningOn ? { op: 'round', nightId: night.id } : { op: 'round-clear', nightId: night.id });
        toast({ kind: 'offline', title: t.nv.vycep.roundQueued, icon: 'hand-platter' });
        return;
      }
      setGiven(!turningOn);
      setCount((c) => Math.max(0, c + (turningOn ? -1 : 1)));
      toast({ kind: 'error', title: t.nv.vycep.roundError, icon: 'hand-platter' });
    });
  };

  const report = () =>
    dialog({
      title: t.nv.vycep.reportTitle,
      body: t.nv.vycep.reportBody(handle),
      actions: [
        { label: t.nv.vycep.back },
        {
          label: t.nv.vycep.report,
          kind: 'danger',
          onPress: () =>
            void reportProfileContent({ targetAccountId: night.author.id, reason: 'spam', nightId: night.id }).then((res) =>
              res.ok
                ? toast({ kind: 'saved', title: t.nv.vycep.reported, sub: t.nv.vycep.reportedSub, icon: 'flag' })
                : toast({ kind: 'error', title: t.nv.vycep.reportError, icon: 'flag' }),
            ),
        },
      ],
    });

  const unpublish = () =>
    dialog({
      title: t.nv.vycep.unpublishTitle,
      body: t.nv.vycep.unpublishBody,
      actions: [
        { label: t.nv.vycep.back },
        {
          label: t.nv.vycep.unpublishConfirm,
          kind: 'danger',
          onPress: () => {
            const clientId = night.clientId;
            if (!clientId) return;
            trackUiInteraction('night_unpublish', 'submit');
            void unpublishNight(clientId).then((res) => {
              trackUiInteraction('night_unpublish', res.ok || isRetriableNightError(res) ? 'success' : 'failure');
              if (!res.ok && !isRetriableNightError(res)) {
                toast({ kind: 'error', title: t.nv.vycep.unpublishError, icon: 'megaphone' });
                return;
              }
              if (!res.ok) void enqueueNightOp({ op: 'unpublish', clientId });
              useVycepStore.getState().markUnpublished(clientId);
              toast({ kind: 'info', title: t.nv.vycep.unpublished, icon: 'megaphone' });
              onRemoved(night.id);
            });
          },
        },
      ],
    });

  const scopeLabel = night.visibility === 'public' ? t.nv.vycep.postScopeWorld : t.nv.vycep.postScopeParta;
  const meta = [night.city, postWhen(night.createdAt), showScope ? scopeLabel : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.control, overflow: 'hidden' }, s.center]}>
          {night.author.avatarUrl ? (
            <Image source={{ uri: night.author.avatarUrl }} style={{ width: 36, height: 36 }} />
          ) : (
            <T s={14} w={800} c={C.yellow}>
              {handle.replace('@', '').charAt(0).toUpperCase()}
            </T>
          )}
        </View>
        <View style={[s.fill, { gap: 1 }]}>
          <T s={16} w={700} numberOfLines={1}>
            {handle}
          </T>
          <T s={12} c={C.muted} numberOfLines={1}>
            {meta}
          </T>
        </View>
        <Press
          accessibilityRole="button"
          accessibilityLabel={night.isMine ? t.nv.vycep.unpublish : t.nv.vycep.report}
          onPress={night.isMine ? unpublish : report}
          style={[{ width: 44, height: 44, marginVertical: -4, marginRight: -12 }, s.center]}
        >
          <Icon name={night.isMine ? 'eye-off' : 'flag'} size={16} color={C.muted} />
        </Press>
      </View>
      {night.heroPhotoUrl ? <Image source={{ uri: night.heroPhotoUrl }} style={{ width: '100%', height: 170, borderRadius: 16 }} resizeMode="cover" /> : null}
      <View style={{ gap: 4 }}>
        <D s={40} lh={1}>
          {t.nv.vycep.postBeers(night.beerCount)}
        </D>
        <T s={14} w={500} c={C.text2}>
          {routeLine(night.pubNames, night.durationMinutes)}
        </T>
      </View>
      <RundaButton count={count} given={given} disabled={night.isMine} onPress={toggleRound} />
    </View>
  );
});

/** A post without a photo, drawn as empty boxes of the same sizes. */
function GhostPost() {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12, opacity: 0.6 }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.control }} />
        <View style={{ width: 120, height: 14, borderRadius: 7, backgroundColor: C.control }} />
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ width: 110, height: 40, borderRadius: 10, backgroundColor: C.control }} />
        <View style={{ width: 180, height: 19, borderRadius: 8, backgroundColor: C.control }} />
      </View>
      <View style={{ width: 96, height: 36, borderRadius: 18, backgroundColor: C.control }} />
    </View>
  );
}

const NO_NIGHTS: PublishedNight[] = [];
const nightKey = (night: PublishedNight) => night.id;
/** Posts on the first screen fade in like the rest of the tab; later pages just appear. */
const FADED_POSTS = 4;

type FeedState = { scope: NightsFeedScope; nights: PublishedNight[] | null; cursor: string | null; failed: boolean };

function useFeed(scope: NightsFeedScope) {
  const [state, setState] = useState<FeedState>({ scope, nights: null, cursor: null, failed: false });
  const seq = useRef(0);
  const loadingMore = useRef(false);
  // A scope switch shows the skeleton until that scope's first page lands.
  const view: FeedState = state.scope === scope ? state : { scope, nights: null, cursor: null, failed: false };

  const load = useCallback(() => {
    const mine = ++seq.current;
    void fetchNightsFeed(scope).then((res) => {
      if (mine !== seq.current) return;
      setState((prev) =>
        res.ok
          ? { scope, nights: res.nights, cursor: res.nextCursor, failed: false }
          : { ...(prev.scope === scope ? prev : { scope, nights: null, cursor: null }), failed: true },
      );
    });
  }, [scope]);

  useEffect(load, [load]);

  const loadMore = useCallback(() => {
    if (!view.cursor || loadingMore.current) return;
    const mine = seq.current;
    loadingMore.current = true;
    void fetchNightsFeed(scope, view.cursor).then((res) => {
      loadingMore.current = false;
      if (mine !== seq.current || !res.ok) return;
      setState((prev) => {
        if (prev.scope !== scope) return prev;
        const seen = new Set((prev.nights ?? []).map((n) => n.id));
        return { ...prev, nights: [...(prev.nights ?? []), ...res.nights.filter((n) => !seen.has(n.id))], cursor: res.nextCursor };
      });
    });
  }, [scope, view.cursor]);

  const remove = useCallback((id: string) => setState((prev) => ({ ...prev, nights: prev.nights?.filter((n) => n.id !== id) ?? null })), []);

  return { ...view, load, loadMore, remove };
}

function useSummary(scope: NightsFeedScope) {
  const [summary, setSummary] = useState<Partial<Record<NightsFeedScope, NightsSummaryResult>>>({});
  useEffect(() => {
    let live = true;
    void fetchNightsSummary(scope).then((res) => {
      if (live) setSummary((prev) => ({ ...prev, [scope]: res }));
    });
    return () => {
      live = false;
    };
  }, [scope]);
  const res = summary[scope];
  return res?.ok ? res : null;
}

function useShortcutData(enabled: boolean) {
  const [contestDays, setContestDays] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null | undefined>(undefined);
  const plan = useToursStore((st) => st.plans[0] ?? null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetchPhotoContestTeaser().then((snap) => {
      if (live && snap?.contest) setContestDays(daysUntil(snap.contest.periodEnd));
    });
    void fetchLeaderboard('beers', 'week').then((board) => {
      if (live && board) setRank(board.me.rank);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return { contestDays, rank, plan };
}

type Scope = 'svet' | 'parta';

export function VycepScreen() {
  const [scope, setScope] = useState<Scope>('svet');
  const { book } = useBook();
  const duo = useIsDuo();
  // The open Duo shows the world and the crew side by side, so neither half has the switch.
  if (book) return <BookTab tab="vycep" left={<Feed scope="svet" />} right={<Feed scope="parta" />} />;
  // Folded the crew half waits hidden, so unfolding finds it where it was.
  return <BookTab tab="vycep" left={<Feed scope={scope} onScope={setScope} />} right={duo ? <Feed scope="parta" /> : undefined} />;
}

/** One feed. With `onScope` it switches between the world and the crew; without, it is a half of the open Duo. */
function Feed({ scope, onScope }: { scope: Scope; onScope?: (scope: Scope) => void }) {
  const router = useNvRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const crewHalf = !onScope && scope === 'parta';
  const openRoute = useDetailPages('vycep').at(-1)?.route;
  const bleed = useEdgeBleed(SCREEN_X);
  const feedScope: NightsFeedScope = scope === 'svet' ? 'global' : 'friends';
  const autopublish = useVycepStore((st) => st.nightAutopublish);
  const feed = useFeed(feedScope);
  const summary = useSummary(feedScope);
  const { contestDays, rank, plan } = useShortcutData(!crewHalf);
  const onScroll = useTabHeaderScroll(crewHalf ? 'vycep-parta' : 'vycep');

  useEffect(() => {
    void syncSharingPrefs();
  }, []);

  const publish = () => router.push(autopublish === null ? '/nv/prvni-vyveseni' : '/nv/vyvesit');

  const leader = summary?.leader ? (summary.leader.isMe ? t.nv.vycep.summaryYou : summary.leader.name) : NO_VALUE;
  const stats: [string, string][] = [
    [summary ? String(summary.nights) : NO_VALUE, t.nv.vycep.summaryNights(summary?.nights ?? 0)],
    [summary ? String(summary.beers) : NO_VALUE, t.nv.vycep.summaryBeers(summary?.beers ?? 0)],
    [leader, t.nv.vycep.summaryLeads],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Animated.FlatList
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={feed.nights ?? NO_NIGHTS}
        keyExtractor={nightKey}
        renderItem={({ item, index }) => {
          // Everything in the world tab is public, so only your own night repeats who can see it.
          const post = <Post night={item} showScope={scope === 'parta' || item.isMine} onRemoved={feed.remove} />;
          return index < FADED_POSTS ? <Animated.View entering={fadeIn}>{post}</Animated.View> : post;
        }}
        onEndReached={feed.loadMore}
        onEndReachedThreshold={1.5}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 16, paddingBottom: tabSpace + 30 }}
        ListHeaderComponentStyle={{ gap: 16 }}
        ListHeaderComponent={
          <>
            {crewHalf ? (
              // Named by the switch label it replaces on a phone.
              <TabHeader tab="vycep-parta" title={t.nv.vycep.scopeParta} />
            ) : (
              <TabHeader tab="vycep" title={t.nv.vycep.title}>
                <Button label={t.nv.vycep.publishCta} icon="plus" height={44} style={{ paddingHorizontal: 18 }} onPress={publish} />
              </TabHeader>
            )}
            {onScope ? (
              <Segmented
                height={38}
                options={[
                  { key: 'svet', label: t.nv.vycep.scopeWorld },
                  { key: 'parta', label: t.nv.vycep.scopeParta },
                ]}
                value={scope}
                onChange={onScope}
              />
            ) : null}
            <View style={{ padding: 16, gap: 12, borderRadius: 24, backgroundColor: C.yellowWash, borderWidth: 1, borderColor: C.yellowEdge }}>
              <View style={[s.row, { gap: 8 }]}>
                <Dot />
                <T s={14} w={700} c={C.yellow}>
                  {scope === 'svet' ? t.nv.vycep.summaryWorld : t.nv.vycep.summaryParta}
                </T>
              </View>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                {stats.map(([v, l], i) => (
                  <View key={i} style={{ gap: 2, alignItems: i === 2 ? 'flex-end' : 'flex-start', flex: i === 0 ? 1.4 : 1 }}>
                    <D s={28} lh={1} numberOfLines={1}>
                      {v}
                    </D>
                    <T s={12} c={C.muted}>
                      {l}
                    </T>
                  </View>
                ))}
              </View>
            </View>
            {crewHalf ? null : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bleed.style} contentContainerStyle={[bleed.contentStyle, { gap: 8 }]}>
                <Shortcut
                  icon="camera"
                  title={t.nv.vycep.shortcutContest}
                  sub={contestDays === null ? '' : contestDays > 0 ? t.nv.vycep.shortcutContestLeft(contestDays) : t.nv.vycep.shortcutContestToday}
                  onPress={() => router.push('/nv/fotopivar')}
                  selected={openRoute === 'fotopivar'}
                />
                <Shortcut
                  icon="route"
                  title={t.nv.vycep.shortcutTour}
                  sub={plan ? t.nv.vycep.shortcutTourSub(plan.stops.length) : t.nv.vycep.shortcutTourEmpty}
                  onPress={() => router.push('/nv/tour')}
                  selected={openRoute === 'tour'}
                />
                <Shortcut
                  icon="trophy"
                  title={t.nv.vycep.shortcutBoards}
                  sub={rank === undefined ? '' : rank ? t.nv.vycep.shortcutBoardsRank(rank) : t.nv.vycep.shortcutBoardsNone}
                  onPress={() => router.push('/nv/zebricky')}
                  selected={openRoute === 'zebricky'}
                />
              </ScrollView>
            )}
            {feed.nights === null && !feed.failed ? (
              <>
                <GhostPost />
                <GhostPost />
                <GhostPost />
              </>
            ) : feed.failed && !feed.nights?.length ? (
              <StatusCard text={t.nv.vycep.loadError} action={t.nv.vycep.retry} onAction={feed.load} />
            ) : feed.nights?.length === 0 ? (
              <StatusCard
                text={scope === 'svet' ? t.nv.vycep.emptyWorld : t.nv.vycep.emptyParta}
                action={t.nv.vycep.publishCta}
                actionIcon="plus"
                onAction={publish}
              />
            ) : null}
          </>
        }
      />
      <TopFade />
      <BottomFade height={tabSpace + 40} tabBar />
    </View>
  );
}
