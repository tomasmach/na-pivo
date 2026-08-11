/**
 * "Parta" in the Tácek composition.
 *
 * The social graph, offline snapshot, queues, focus refresh, push hand-off and
 * bounded live poll are the same as before. What changed is the order of the
 * screen, and it changed because of one piece of testing feedback: you could
 * not see that anybody was in a pub until they said so out loud.
 *
 * So the screen now reads top to bottom as the questions people actually ask:
 *
 *   1. **Kdo kde sedí** — everyone currently in a pub, derived from the visits
 *      the counter already syncs. A "cinknutí" is no longer how you find out
 *      somebody is out; it is how they ask you to come. Those rows keep the
 *      loud card with the RSVP, the rest are quiet one-liners.
 *   2. **Čerstvě cvaknuto** — tonight's photos, unchanged.
 *   3. **Co se pilo** — one chronological row per evening, automatic. Ratings
 *      are folded into the evening they belong to rather than running as a
 *      second, parallel feed. (Not called "Výčep": that name belongs to the
 *      screen behind the rail door, where a night is hung up on purpose.)
 *   4. **Co spolu podniknout** — the two other evening formats, at the tail.
 *
 * Two things left the surface entirely. The friend list is no longer
 * interleaved with the feed — it was the single most confusing thing on the
 * screen — and lives behind "…" → Celá parta. The notification log left the app
 * altogether: every kind it held was either a row this screen already shows
 * (request, presence, RSVP, plan) or a push that had already done its job in
 * the moment it mattered. All that survives of it is the tab dot, which a push
 * lights and opening this screen clears.
 *
 * Nothing is permanently pinned to the bottom. This is a feed: chrome that
 * stays put is chrome the stream pays for on every screenful.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import { DoorRail, type DoorRailTile } from '@/components/shared/DoorRail';
import {
  CheckIcon,
  MenuIcon,
  HandPlatterIcon,
  ImagesIcon,
  QrCodeIcon,
  SettingsIcon,
  TrophyIcon,
  Undo2Icon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { ScrollFade } from '@/components/shared/ScrollFade';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import {
  fetchBeerCheckInFeed,
  type BeerCheckIn,
} from '@/data/beerCheckinsClient';
import {
  DEFAULT_FRIEND_SOCIAL_SETTINGS,
  endFriendPubActivity,
  fetchFriendsDashboard,
  fetchFriendsLive,
  markFriendNotificationsRead,
  respondFriendRequest,
  type FriendPubActivity,
  type FriendsDashboard,
  type Friendship,
} from '@/data/friendsClient';
import {
  enqueueFriendOp,
  isRetriableFriendError,
} from '@/data/friendsQueue';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { trackUiInteraction } from '@/data/uxTelemetry';
import {
  fetchLeaderboard,
  type Leaderboard,
} from '@/data/leaderboardsClient';
import { fetchPartaFeed, type PartaFeedSitting } from '@/data/partaFeedClient';
import {
  fetchPhotoContestTeaser,
  type PhotoContestSnapshot,
} from '@/data/photoContestClient';
import { cs } from '@/i18n/cs';
import { PartaPhotoStrip } from '@/photos/PartaPhotoStrip';
import {
  selectIsSignedIn,
  selectNeedsNickname,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { useContestResultsStore } from '@/stores/contestResultsStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import {
  ensureFriendPushRegisteredIfGranted,
  registerFriendPush,
} from '@/notifications/friendPush';

import { AddFriendTools } from './AddFriendTools';
import CodeSheet from './CodeSheet';
import ComposeSheet from './ComposeSheet';
import FriendActiveCard from './FriendActiveCard';
import { FriendMini, friendDisplayName } from './FriendMini';
import FriendSettingsSheet from './FriendSettingsSheet';
import { GoingRoster } from './GoingRoster';
import HairlineRow from './HairlineRow';
import MyActivityCard from './MyActivityCard';
import { PartaPlans } from './PartaPlans';
import { PartyCard } from './PartyCard';
import PlanCard from './PlanCard';
import { PresenceList } from './PresenceList';
import { SittingRow } from './SittingRow';
import { deriveSharedTable } from './sharedTable';
import { mergeCheckInsIntoFeed, type MergedSitting } from './partaFeedMerge';
import { useFriendSafety } from './friendSafety';

const LIVE_POLL_MS = 35000;
const SHEET_DISMISS_MS = 260;
const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;
/** How many evenings the screen holds before "Načíst starší" earns its place. */
const FEED_PAGE = 20;

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function planTimeLabel(iso: string): string {
  const parsed = timestamp(iso);
  if (parsed === 0) return '';
  return new Date(parsed).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function IconButton({
  onPress,
  accessibilityLabel,
  style,
  children,
  disabled = false,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={ROUND_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, (pressed || disabled) && styles.dim]}
    >
      {children}
    </Pressable>
  );
}

function SheetScaffold({
  visible,
  title,
  onClose,
  children,
  keyboardAware = false,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  keyboardAware?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const content = keyboardAware ? (
    <KeyboardAwareScrollView
      style={styles.sheetList}
      contentContainerStyle={styles.sheetListContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </KeyboardAwareScrollView>
  ) : (
    <ScrollView
      style={styles.sheetList}
      contentContainerStyle={styles.sheetListContent}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.sheetCardWrap, { marginBottom: -insets.bottom }]}>
          <Pressable
            style={[styles.sheetCard, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={() => undefined}
          >
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {title}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.sheetClose, pressed && styles.dim]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>
            {content}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AddFriendSheet({
  visible,
  hasIdentity,
  needsNickname,
  onOpenCode,
  onChanged,
  onClose,
}: {
  visible: boolean;
  hasIdentity: boolean;
  needsNickname: boolean;
  onOpenCode: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  return (
    <SheetScaffold
      visible={visible}
      title={cs.friends.growthHeader}
      onClose={onClose}
      keyboardAware
    >
      <AddFriendTools
        hasIdentity={hasIdentity}
        needsNickname={needsNickname}
        onOpenCode={onOpenCode}
        onChanged={onChanged}
        showSearch
      />
    </SheetScaffold>
  );
}

function RosterBlock({ activity, mine }: { activity: FriendPubActivity; mine: boolean }) {
  const ownerIncluded = mine ? 0 : 1;
  const profiles = mine
    ? activity.responses.goingProfiles
    : [activity.account, ...activity.responses.goingProfiles.filter((p) => p.id !== activity.account.id)];

  return (
    <View style={styles.rosterBlock}>
      <Text style={styles.rosterPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
        {activity.name}
      </Text>
      <GoingRoster
        profiles={profiles}
        goingCount={activity.responses.going + ownerIncluded}
        maybeCount={activity.responses.maybe}
        cantCount={activity.responses.cant}
        size="standard"
        surfaceColor={Colors.stout2}
        iAmGoing={mine || activity.myResponse === 'going'}
        isMyCard={mine}
      />
    </View>
  );
}

function RosterSheet({
  visible,
  dashboard,
  stale,
  onReload,
  onClose,
}: {
  visible: boolean;
  dashboard: FriendsDashboard | null;
  stale: boolean;
  onReload: () => void;
  onClose: () => void;
}) {
  const activities = dashboard
    ? [
        ...(dashboard.myPlan ? [{ activity: dashboard.myPlan, mine: true }] : []),
        ...dashboard.activeFriends.map((activity) => ({ activity, mine: false })),
        ...dashboard.plans.map((activity) => ({ activity, mine: false })),
      ]
    : [];

  return (
    <SheetScaffold visible={visible} title={cs.friends.ctaWhoIsComing} onClose={onClose}>
      {dashboard?.myActiveActivity ? (
        <MyActivityCard
          activity={dashboard.myActiveActivity}
          stale={stale}
          onEnded={() => {
            onReload();
            onClose();
          }}
        />
      ) : null}
      {activities.map(({ activity, mine }) => (
        <RosterBlock key={`${mine ? 'mine' : 'friend'}:${activity.id}`} activity={activity} mine={mine} />
      ))}
      {!dashboard?.myActiveActivity && activities.length === 0 ? (
        <Text style={styles.sheetEmpty} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.friends.rosterEmpty}
        </Text>
      ) : null}
    </SheetScaffold>
  );
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((state) => state.show);

  const [dashboard, setDashboard] = useState<FriendsDashboard | null>(null);
  const [beerFeed, setBeerFeed] = useState<BeerCheckIn[]>([]);
  const [sittings, setSittings] = useState<PartaFeedSitting[]>([]);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Opened straight from Nastavení: the privacy switches live here, but nobody
  // looks for "kdo mě vidí" on the Parta screen. `?settings=1` is the door.
  const settingsParam = useLocalSearchParams<{ settings?: string }>().settings;
  const [settingsVisible, setSettingsVisible] = useState(settingsParam === '1');
  const [codeVisible, setCodeVisible] = useState(false);
  const [composeVisible, setComposeVisible] = useState(false);
  const [addFriendVisible, setAddFriendVisible] = useState(false);
  const [rosterVisible, setRosterVisible] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [photoFeedKey, setPhotoFeedKey] = useState(0);
  const [weeklyBoard, setWeeklyBoard] = useState<Leaderboard | null>(null);
  const [contestSnapshot, setContestSnapshot] = useState<PhotoContestSnapshot | null>(null);
  const [respondingRequestActions, setRespondingRequestActions] = useState<
    Record<string, 'accept' | 'decline'>
  >({});

  const nickname = useAccountStore(selectNickname);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const myAccountId = useAccountStore((state) => state.session?.accountId ?? null);
  const hasIdentity = nickname != null;

  const friendPushEnabled = useSettingsStore((state) => state.friendPushEnabled);
  const friendPushPrompted = useSettingsStore((state) => state.friendPushPrompted);
  const setFriendPushPrompted = useSettingsStore((state) => state.setFriendPushPrompted);

  const lastSeenResultsId = useContestResultsStore(
    (state) => state.lastSeenResultsContestId,
  );
  const ingestContestSnapshot = useContestResultsStore((state) => state.ingestSnapshot);
  const markContestResultsSeen = useContestResultsStore((state) => state.markResultsSeen);

  const mountedRef = useRef(true);
  const loadGenRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const settingsOverrideRef = useRef<FriendsDashboard['settings'] | null>(null);
  const sheetActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const requestsYRef = useRef(0);
  const activeYRef = useRef(0);
  const endingBroadcastRef = useRef(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
      loadAbortRef.current?.abort();
      if (sheetActionTimerRef.current) clearTimeout(sheetActionTimerRef.current);
    },
    [],
  );

  const scrollToOffset = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      const generation = ++loadGenRef.current;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;

      if (mode === 'refresh') setRefreshing(true);
      setPhotoFeedKey((key) => key + 1);

      // Rejections must not skip the spinner teardown. A pull-to-refresh whose
      // fetch is aborted by the next poll (or that simply throws) used to leave
      // `refreshing` true forever, and the wheel sat wedged above the card until
      // the screen was remounted. Hence try/finally, and caught side feeds:
      // their promises are created here but awaited after two early returns.
      const beerFeedPromise = fetchBeerCheckInFeed(controller.signal).catch(() => null);
      const sittingsPromise = fetchPartaFeed({
        limit: FEED_PAGE,
        signal: controller.signal,
      }).catch(() => null);
      try {
        const next = await fetchFriendsDashboard(controller.signal);
        if (!mountedRef.current) return;

        if (generation === loadGenRef.current) {
          if (next) {
            const override = settingsOverrideRef.current;
            setDashboard(override ? { ...next, settings: override } : next);
            setLoadError(false);

            // The notification log has no screen of its own any more — every
            // kind it carries is either a row above (request, presence, RSVP,
            // plan) or a push you already got. What is left of it is the tab
            // dot: a push lights it, opening Parta clears it, because by then
            // you have seen the thing itself.
            const willMarkRead =
              next.notifications.length > 0 && (mode === 'initial' || mode === 'refresh');
            if (willMarkRead) {
              void markFriendNotificationsRead(next.notifications.map((item) => item.id));
            }
            usePartaSignalStore.getState().setSignal({
              pendingRequests: next.incomingRequests.length,
              unread: willMarkRead ? 0 : next.unreadCount,
              liveNow:
                next.presence.length > 0 ||
                next.activeFriends.length > 0 ||
                next.myActiveActivity != null,
            });
          } else {
            setLoadError(true);
          }
        }

        if (!next) return;

        const [nextBeerFeed, nextSittings] = await Promise.all([
          beerFeedPromise,
          sittingsPromise,
        ]);
        if (!mountedRef.current || generation !== loadGenRef.current) return;
        if (nextBeerFeed) setBeerFeed(nextBeerFeed);
        if (nextSittings) {
          setSittings(nextSittings.sittings);
          setFeedCursor(nextSittings.nextCursor);
        }
      } catch {
        // An aborted load is the newer one doing its job, not an outage.
        if (!controller.signal.aborted && generation === loadGenRef.current) {
          setLoadError(true);
        }
      } finally {
        if (mode === 'initial') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
    },
    [],
  );

  const loadMoreSittings = useCallback(() => {
    if (!feedCursor || feedLoadingMore) return;
    trackUiInteraction('friends_load_more', 'load_more');
    setFeedLoadingMore(true);
    void fetchPartaFeed({ cursor: feedCursor, limit: FEED_PAGE }).then((page) => {
      if (!mountedRef.current) return;
      // Release the latch even on failure, or one bad page wedges pagination
      // for the lifetime of the screen.
      setFeedLoadingMore(false);
      if (!page) return;
      setSittings((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.sittings.filter((item) => !seen.has(item.id))];
      });
      setFeedCursor(page.nextCursor);
    });
  }, [feedCursor, feedLoadingMore]);

  const pollLive = useCallback(async () => {
    const generation = ++loadGenRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const slice = await fetchFriendsLive(controller.signal);
    if (!mountedRef.current || generation !== loadGenRef.current) return;
    if (!slice) {
      setLoadError(true);
      return;
    }
    setDashboard((current) =>
      current
        ? {
            ...current,
            activeFriends: slice.activeFriends,
            myActiveActivity: slice.myActiveActivity,
            plans: slice.plans,
            myPlan: slice.myPlan,
            presence: slice.presence,
            myPresence: slice.myPresence,
          }
        : current,
    );
    setLoadError(false);
    usePartaSignalStore.getState().setSignal({
      pendingRequests: slice.incomingCount,
      unread: slice.unreadCount,
      liveNow:
        slice.presence.length > 0 ||
        slice.activeFriends.length > 0 ||
        slice.myActiveActivity != null,
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snapshot) => {
      if (!alive || !snapshot) return;
      setDashboard((current) => current ?? snapshot.dashboard);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load('initial'), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const target = usePartaSignalStore.getState().consumeRefresh();
      void load(target ? 'refresh' : 'silent').then(() => {
        if (!target || !mountedRef.current) return;
        if (target.friendshipId) scrollToOffset(requestsYRef.current);
        else if (target.activityId) scrollToOffset(activeYRef.current);
      });
      void ensureFriendPushRegisteredIfGranted();
      return () => setFocused(false);
    }, [load, scrollToOffset]),
  );

  useFocusEffect(
    useCallback(() => {
      void fetchLeaderboard('beers', 'week').then((board) => {
        if (mountedRef.current && board) setWeeklyBoard(board);
      });
      void fetchPhotoContestTeaser().then((snapshot) => {
        if (!snapshot) return;
        if (mountedRef.current) setContestSnapshot(snapshot);
        void ingestContestSnapshot(snapshot);
      });
    }, [ingestContestSnapshot]),
  );

  useEffect(() => {
    if (!focused) return;
    return usePartaSignalStore.subscribe((state, previous) => {
      if (!state.pendingRefresh || previous.pendingRefresh) return;
      const target = state.consumeRefresh();
      void load('silent').then(() => {
        if (!target || !mountedRef.current) return;
        if (target.friendshipId) scrollToOffset(requestsYRef.current);
        else if (target.activityId) scrollToOffset(activeYRef.current);
      });
    });
  }, [focused, load, scrollToOffset]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load('silent');
    });
    return () => subscription.remove();
  }, [load]);

  const d = dashboard;

  const liveOrPlanned =
    d != null &&
    (d.presence.length > 0 ||
      d.activeFriends.length > 0 ||
      d.myActiveActivity != null ||
      d.myPresence != null ||
      d.myPlan != null ||
      d.plans.length > 0);

  useEffect(() => {
    if (!focused || !liveOrPlanned) return;
    const timer = setInterval(() => void pollLive(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [focused, liveOrPlanned, pollLive]);

  const openFriendProfile = useCallback(
    (accountId: string) => {
      if (accountId) {
        trackUiInteraction('friends_profile_open');
        router.push(`/parta/${accountId}` as Href);
      }
    },
    [router],
  );
  const openFriendSafety = useFriendSafety(reload);
  const handleSittingLongPress = useCallback(
    (sitting: PartaFeedSitting) => openFriendSafety(sitting.account),
    [openFriendSafety],
  );

  const respond = useCallback(
    async (id: string, action: 'accept' | 'decline') => {
      if (respondingRequestActions[id]) return;
      trackUiInteraction(
        action === 'accept' ? 'friends_request_accept' : 'friends_request_decline',
        action,
      );
      setRespondingRequestActions((current) => ({ ...current, [id]: action }));
      const result = await respondFriendRequest(id, action);
      if (!mountedRef.current) return;
      setRespondingRequestActions((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (result.ok) {
        showToast(
          action === 'accept' ? cs.friends.requestAccepted : cs.friends.requestDeclined,
          {
            icon:
              action === 'accept' ? (
                <CheckIcon size={20} color={Colors.amber} />
              ) : (
                <XIcon size={20} color={Colors.amber} />
              ),
          },
        );
        await load();
      } else {
        showToast(result.detail, { icon: <XIcon size={20} color={Colors.amber} /> });
      }
    },
    [load, respondingRequestActions, showToast],
  );

  const handleEndBroadcast = useCallback(() => {
    const activity = d?.myActiveActivity;
    if (!activity || endingBroadcastRef.current) return;
    trackUiInteraction('friends_end_broadcast');
    showAppDialog({
      title: cs.friends.endActivityConfirmTitle,
      message: cs.friends.endActivityConfirmBody,
      buttons: [
        { text: cs.common.cancel, style: 'cancel' },
        {
          text: cs.friends.endActivityConfirmConfirm,
          style: 'destructive',
          onPress: () => {
            endingBroadcastRef.current = true;
            void endFriendPubActivity(activity.id).then((result) => {
              endingBroadcastRef.current = false;
              if (result.ok) {
                showToast(cs.friends.endedToast, {
                  icon: <Undo2Icon size={20} color={Colors.amber} />,
                });
                reload();
                return;
              }
              if (isRetriableFriendError(result)) {
                void enqueueFriendOp({
                  op: 'end',
                  clientId: activity.id,
                  activityId: activity.id,
                });
                showToast(cs.friends.endQueued, {
                  icon: <Undo2Icon size={20} color={Colors.amber} />,
                });
                reload();
                return;
              }
              showToast(result.detail);
            });
          },
        },
      ],
    });
  }, [d?.myActiveActivity, reload, showToast]);

  const handleEnablePush = useCallback(() => {
    trackUiInteraction('friends_push_enable');
    void registerFriendPush().then((result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        showToast(cs.friends.pushEnabledToast);
      }
    });
  }, [showToast]);

  const dismissPush = useCallback(
    () => setFriendPushPrompted(true),
    [setFriendPushPrompted],
  );

  const handleSettingsSaved = useCallback((next: FriendsDashboard['settings']) => {
    settingsOverrideRef.current = next;
    setDashboard((current) => (current ? { ...current, settings: next } : current));
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsVisible(false);
    void load();
  }, [load]);

  const runAfterMoreClose = useCallback((action: () => void) => {
    setMoreVisible(false);
    if (sheetActionTimerRef.current) clearTimeout(sheetActionTimerRef.current);
    sheetActionTimerRef.current = setTimeout(() => {
      sheetActionTimerRef.current = null;
      action();
    }, SHEET_DISMISS_MS);
  }, []);

  const openCodeFromAdd = useCallback(() => {
    setAddFriendVisible(false);
    if (sheetActionTimerRef.current) clearTimeout(sheetActionTimerRef.current);
    sheetActionTimerRef.current = setTimeout(() => {
      sheetActionTimerRef.current = null;
      setCodeVisible(true);
    }, SHEET_DISMISS_MS);
  }, []);

  const moreRows = useMemo<MoreRow[]>(
    () => [
      {
        key: 'add-friend',
        label: cs.friends.secondaryAddFriend,
        icon: UserPlusIcon,
        onPress: () => runAfterMoreClose(() => setAddFriendVisible(true)),
      },
      {
        key: 'party',
        label: cs.friends.moreWholeParty,
        icon: UsersIcon,
        onPress: () =>
          runAfterMoreClose(() => {
            trackUiInteraction('friends_manage_open');
            router.push('/profile/parta' as Href);
          }),
      },
      {
        key: 'settings',
        label: cs.friends.moreSettings,
        icon: SettingsIcon,
        onPress: () => runAfterMoreClose(() => setSettingsVisible(true)),
      },
      {
        key: 'code',
        label: cs.friends.moreMyCode,
        icon: QrCodeIcon,
        onPress: () => runAfterMoreClose(() => setCodeVisible(true)),
      },
    ],
    [router, runAfterMoreClose],
  );

  // Žebříčky, FotoPivař and Výčep are three whole features that used to be
  // invisible behind the "…" glyph. They belong on the card, in the same rail
  // idiom the counter uses (DESIGN.md §5.5).
  const railTiles = useMemo<DoorRailTile[]>(
    () => [
      {
        key: 'vycep',
        label: cs.friends.railVycep,
        a11yLabel: cs.a11y.vycepLink,
        Icon: HandPlatterIcon,
        onPress: () => {
          trackUiInteraction('friends_taproom_open');
          router.push('/vycep' as Href);
        },
      },
      {
        key: 'leaderboards',
        label: cs.friends.railLeaderboards,
        a11yLabel: cs.a11y.leaderboardsLink,
        Icon: TrophyIcon,
        onPress: () => {
          trackUiInteraction('friends_leaderboards_open');
          router.push({ pathname: '/leaderboards', params: { source: 'parta' } } as Href);
        },
      },
      {
        key: 'photo-contest',
        label: cs.friends.railPhotoContest,
        a11yLabel: cs.a11y.photoContestLink,
        Icon: ImagesIcon,
        onPress: () => {
          trackUiInteraction('friends_photo_contest_open');
          router.push('/photo-contest' as Href);
        },
      },
    ],
    [router],
  );

  const friendCount = d?.friends.length ?? 0;

  /** Accounts whose sitting is already told loudly by a broadcast card. */
  const broadcastAccountIds = useMemo(
    () => new Set((d?.activeFriends ?? []).map((activity) => activity.account.id)),
    [d?.activeFriends],
  );

  /** The quiet half: sitting somewhere, never asked anyone to join. */
  const quietPresence = useMemo(
    () => (d?.presence ?? []).filter((row) => !broadcastAccountIds.has(row.account.id)),
    [broadcastAccountIds, d?.presence],
  );

  /** Show my own row only when the loud MyActivityCard is not already up. */
  const myQuietPresence = d?.myActiveActivity ? null : (d?.myPresence ?? null);

  const sittingCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of d?.presence ?? []) ids.add(row.account.id);
    for (const activity of d?.activeFriends ?? []) ids.add(activity.account.id);
    const mine = d?.myPresence != null || d?.myActiveActivity != null;
    return ids.size + (mine ? 1 : 0);
  }, [d?.activeFriends, d?.myActiveActivity, d?.myPresence, d?.presence]);

  const maybeCount = useMemo(
    () =>
      d
        ? [
            ...d.activeFriends,
            ...d.plans,
            ...(d.myActiveActivity ? [d.myActiveActivity] : []),
            ...(d.myPlan ? [d.myPlan] : []),
          ].reduce((sum, activity) => sum + activity.responses.maybe, 0)
        : 0,
    [d],
  );

  /** The Výčep: sittings with whatever anyone wrote about them, newest first. */
  const feed = useMemo<MergedSitting[]>(
    () => mergeCheckInsIntoFeed(sittings, beerFeed, myAccountId),
    [beerFeed, myAccountId, sittings],
  );

  const plans = useMemo(
    () =>
      d
        ? [
            ...(d.myPlan ? [{ activity: d.myPlan, mine: true }] : []),
            ...d.plans.map((activity) => ({ activity, mine: false })),
          ].sort(
            (a, b) =>
              timestamp(a.activity.scheduledFor ?? a.activity.createdAt) -
              timestamp(b.activity.scheduledFor ?? b.activity.createdAt),
          )
        : [],
    [d],
  );

  const freshestSitting = useMemo(() => {
    const rows = [...(d?.presence ?? [])];
    if (rows.length === 0) return null;
    return rows.sort((a, b) => timestamp(b.lastSeenAt) - timestamp(a.lastSeenAt))[0];
  }, [d?.presence]);

  const freshestPlan = useMemo(() => {
    if (!d) return null;
    const rows = [...(d.myPlan ? [d.myPlan] : []), ...d.plans];
    if (rows.length === 0) return null;
    return rows.sort(
      (a, b) =>
        timestamp(b.scheduledFor ?? b.createdAt) -
        timestamp(a.scheduledFor ?? a.createdAt),
    )[0];
  }, [d]);

  /**
   * The evening that used to need a code: me and whoever from the party is in
   * the same pub right now, worked out from the presence rows the counter
   * already produces. Built from the full `presence` list, not the quiet half —
   * a friend who also broadcast is still sitting at my table.
   */
  const sharedTable = useMemo(
    () => deriveSharedTable(d?.myPresence ?? null, d?.presence ?? []),
    [d?.myPresence, d?.presence],
  );

  const headline = useMemo(() => {
    // Sitting together outranks whoever is freshest: the party's own table is
    // the more interesting fact than a friend three districts away.
    if (sharedTable) {
      return cs.friends.headlineTogether(
        friendDisplayName(sharedTable.friends[0].account),
        sharedTable.friends.length - 1,
      );
    }
    if (freshestSitting) {
      return cs.friends.headlineSitting(
        friendDisplayName(freshestSitting.account),
        sittingCount - 1,
      );
    }
    if (freshestPlan) {
      const time = planTimeLabel(freshestPlan.scheduledFor ?? freshestPlan.startedAt);
      return time
        ? `${cs.friends.planAt(time)} · ${freshestPlan.name}`
        : freshestPlan.name;
    }
    if (d?.myActiveActivity) return cs.friends.pulseMineBody;
    return cs.friends.emptyActive;
  }, [d?.myActiveActivity, freshestPlan, freshestSitting, sharedTable, sittingCount]);

  const rankLine = useMemo(() => {
    if (d?.settings.ghostMode) return cs.friends.hiddenRank;
    const rank = weeklyBoard?.me.rank;
    if (rank == null) return null;
    return `${cs.leaderboards.teaserTitleBefore}${cs.leaderboards.teaserTitleRank(rank)}${cs.leaderboards.teaserTitleAfter}`;
  }, [d?.settings.ghostMode, weeklyBoard?.me.rank]);

  const lastResults = contestSnapshot?.lastResults ?? null;
  const contestResultsUnseen =
    lastResults != null && lastResults.contest.id !== lastSeenResultsId;
  const pushAudience = friendCount > 0 || (d?.incomingRequests.length ?? 0) > 0;
  const streakAtRisk =
    (d?.streak.currentWeeks ?? 0) > 0 && d?.streak.thisWeekLit === false;

  const nudge = useMemo<Nudge | null>(() => {
    const request = d?.incomingRequests[0];
    if (request) {
      return {
        kind: 'rapid',
        text: cs.friends.nudgeRequest(friendDisplayName(request.requester)),
        confirmLabel: cs.friends.nudgeRequestAccept,
        onConfirm: () => void respond(request.id, 'accept'),
      };
    }
    if (loadError) {
      return {
        kind: 'counted',
        text: cs.friends.nudgeOffline,
        undoLabel: cs.friends.nudgeOfflineRetry,
        onUndo: () => void load('refresh'),
      };
    }
    // No nudge for an unanswered live table any more. It used to be the only
    // way to see one, so it earned its 52pt; now "Kdo kde sedí" sits directly
    // under the card with that friend's own card in it, RSVP included. The
    // strip was printing the same sentence a thumb-width below the card that
    // already said it — and printing it truncated, because a "Jdu" pill and a
    // pub name do not fit on one row (§0.3, one path to one thing).
    if (d?.myActiveActivity) {
      return {
        kind: 'counted',
        text: cs.friends.nudgeBroadcasting,
        undoLabel: cs.friends.nudgeBroadcastEnd,
        onUndo: handleEndBroadcast,
      };
    }
    if (!friendPushEnabled && !friendPushPrompted && pushAudience) {
      return {
        kind: 'checkin',
        text: cs.friends.nudgePush,
        ctaLabel: cs.friends.nudgePushEnable,
        onPress: handleEnablePush,
        onDismiss: dismissPush,
      };
    }
    if (contestResultsUnseen && lastResults) {
      return {
        kind: 'checkin',
        text: cs.friends.nudgeContest,
        ctaLabel: cs.friends.nudgeContestOpen,
        onPress: () => router.push('/photo-contest' as Href),
        onDismiss: () => markContestResultsSeen(lastResults.contest.id),
      };
    }
    // A streak at risk is deliberately NOT a nudge: its only action is the
    // footer's own button, so a chip above it was a second button that said the
    // same thing and stole 64pt from the stream. It lives in the card's footer
    // fact instead, next to the streak it is about.
    return null;
  }, [
    contestResultsUnseen,
    d?.incomingRequests,
    d?.myActiveActivity,
    dismissPush,
    friendPushEnabled,
    friendPushPrompted,
    handleEnablePush,
    handleEndBroadcast,
    lastResults,
    load,
    loadError,
    markContestResultsSeen,
    pushAudience,
    respond,
    router,
  ]);

  const cta = useMemo(() => {
    if (!isSignedIn) {
      return {
        label: cs.friends.ctaSignIn,
        onPress: () => router.push('/auth' as Href),
      };
    }
    if (nickname == null) {
      return {
        label: cs.friends.ctaNickname,
        onPress: () => router.push('/profile/edit' as Href),
      };
    }
    if (friendCount === 0) {
      return {
        label: cs.friends.ctaAddFriend,
        onPress: () => setAddFriendVisible(true),
      };
    }
    if (d?.myActiveActivity) {
      return {
        label: cs.friends.ctaWhoIsComing,
        onPress: () => setRosterVisible(true),
      };
    }
    if ((d?.activeFriends.length ?? 0) > 0) {
      return {
        label: cs.friends.ctaPingToo,
        onPress: () => setComposeVisible(true),
      };
    }
    return {
      label: cs.friends.ctaPing,
      onPress: () => setComposeVisible(true),
    };
  }, [d?.activeFriends.length, d?.myActiveActivity, friendCount, isSignedIn, nickname, router]);

  const onRequestsLayout = useCallback((event: LayoutChangeEvent) => {
    requestsYRef.current = event.nativeEvent.layout.y;
  }, []);
  const onActiveLayout = useCallback((event: LayoutChangeEvent) => {
    activeYRef.current = event.nativeEvent.layout.y;
  }, []);

  const renderRequestRow = useCallback(
    (request: Friendship, first: boolean) => (
      <HairlineRow key={request.id} first={first}>
        <View style={styles.requestRow}>
          <FriendMini profile={request.requester} />
          <View style={styles.requestActions}>
            <IconButton
              onPress={() => void respond(request.id, 'decline')}
              disabled={respondingRequestActions[request.id] != null}
              accessibilityLabel={cs.friends.decline}
              style={styles.declineBtn}
            >
              {respondingRequestActions[request.id] === 'decline' ? (
                <ActivityIndicator color={Colors.foam} size="small" />
              ) : (
                <XIcon size={18} color={Colors.foam} />
              )}
            </IconButton>
            <IconButton
              onPress={() => void respond(request.id, 'accept')}
              disabled={respondingRequestActions[request.id] != null}
              accessibilityLabel={cs.friends.accept}
              style={styles.acceptBtn}
            >
              {respondingRequestActions[request.id] === 'accept' ? (
                <ActivityIndicator color={Colors.stout} size="small" />
              ) : (
                <CheckIcon size={18} color={Colors.stout} />
              )}
            </IconButton>
          </View>
        </View>
      </HairlineRow>
    ),
    [respond, respondingRequestActions],
  );

  // The screen's chrome, but it lives in the card's top padding rather than in
  // a band of its own above it — see PartyCard's `topRow`.
  const chromeRow = (
    <View style={styles.chromeRow}>
      {friendCount > 0 ? (
        <Pressable
          onPress={() => router.push('/profile/parta' as Href)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.partaChip(cs.friends.pulseFriendCount(friendCount))}
          style={({ pressed }) => [styles.partyChip, pressed && styles.dim]}
        >
          <UsersIcon size={16} color={Colors.amber} />
          <Text
            style={styles.partyChipLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {cs.friends.pulseFriendCount(friendCount)}
          </Text>
        </Pressable>
      ) : (
        <View
          style={styles.partyChip}
          accessibilityRole="text"
          accessibilityLabel={cs.friends.soloChip}
        >
          <UsersIcon size={16} color={Colors.amber} />
          <Text
            style={styles.partyChipLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {cs.friends.soloChip}
          </Text>
        </View>
      )}
      <View style={styles.headerSpacer} />
      <Pressable
        onPress={() => {
          trackUiInteraction('friends_more_open');
          setMoreVisible(true);
        }}
        style={({ pressed }) => [styles.moreButton, pressed && styles.dim]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.partaMore}
      >
        <MenuIcon size={20} color={Colors.mutedText} />
      </Pressable>
    </View>
  );

  const hasSitting =
    d != null &&
    (d.activeFriends.length > 0 || quietPresence.length > 0 || myQuietPresence != null);
  const requests = d?.incomingRequests ?? [];

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          // The tab bar under this screen already pads for the home indicator,
          // so `insets.bottom` here would be that gap charged twice — 26pt of
          // stout between the pill and the bar. Just the block gap.
          paddingBottom: Spacing.sm,
        },
      ]}
    >
      {/* The stream and the fade that ends it share one box, so the fade is
          never an out-of-bounds child (Android clips those). */}
      <View style={styles.body}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={Colors.amber}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={feed.length === 0 && !hasSitting ? styles.cardGrow : undefined}>
            <PartyCard
              count={sittingCount}
              countLabel={
                sittingCount > 0
                  ? cs.friends.tableCaptionSitting
                  : cs.friends.tableCaptionQuiet
              }
              headline={headline}
              factStrong={
                (d?.streak.currentWeeks ?? 0) > 0
                  ? cs.friends.streakWeeks(d?.streak.currentWeeks ?? 0)
                  : cs.friends.noStreak
              }
              // The risk outranks the rank: it expires this week, the rank does not.
              factMuted={streakAtRisk ? cs.friends.streakRiskFact : rankLine}
              // The door is the screen's action, not a second way into the
              // roster — the card itself already opens that when anyone is
              // sitting, and the numeral plus the table say how many.
              linkLabel={cta.label}
              onLinkPress={cta.onPress}
              // The drawing carries the same fact as the numeral above it:
              // seats taken are people actually sitting, not RSVPs on a plan.
              going={sittingCount}
              maybe={maybeCount}
              mine={d?.myPresence != null || d?.myActiveActivity != null}
              onPress={
                sittingCount > 0 || maybeCount > 0 ? () => setRosterVisible(true) : null
              }
              accessibilityLabel={cs.a11y.partaCard(String(sittingCount), headline)}
              rail={<DoorRail tiles={railTiles} />}
              topRow={chromeRow}
            />
          </View>

          {/* 1. Kdo kde sedí — the block the whole rebuild is about. */}
          <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.presenceHeader}
          </Text>

          {hasSitting ? (
            // The layout anchor sits on the block, not on a card inside it: a
            // push hand-off scrolls to an offset measured against the scroll
            // view, and only a direct child of the content view has one.
            <View style={styles.block} onLayout={onActiveLayout}>
              {/* Broadcast first: those rows are an invitation, not just a fact. */}
              {(d?.activeFriends ?? []).map((activity) => (
                <FriendActiveCard
                  key={`live:${activity.id}`}
                  activity={activity}
                  onResponded={reload}
                  stale={loadError}
                />
              ))}
              <PresenceList
                presence={quietPresence}
                myPresence={myQuietPresence}
                stale={loadError}
                sharedCacheKey={sharedTable?.cacheKey ?? null}
                onOpenProfile={openFriendProfile}
                onChanged={reload}
              />
            </View>
          ) : loading && !d ? null : (
            <Text style={styles.blockEmpty} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.presenceEmpty}
            </Text>
          )}

          {requests.length > 0 ? (
            <View style={[styles.card, styles.spaced]} onLayout={onRequestsLayout}>
              {requests.map((request, index) => renderRequestRow(request, index === 0))}
            </View>
          ) : null}

          {plans.length > 0 ? (
            <View style={[styles.block, styles.spaced]}>
              {plans.map(({ activity, mine }) => (
                <PlanCard
                  key={`plan:${mine ? 'mine' : 'friend'}:${activity.id}`}
                  activity={activity}
                  mine={mine}
                  onResponded={reload}
                  onCanceled={reload}
                />
              ))}
            </View>
          ) : null}

          {/* 2. Čerstvě cvaknuto — between the people and what they drank. */}
          <PartaPhotoStrip refreshKey={photoFeedKey} style={styles.photoStreamItem} />

          {/* 3. Co se pilo — automatic, chronological, one row per evening. */}
          <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.sittingsHeader}
          </Text>

          {feed.length > 0 ? (
            <>
              <View style={styles.card}>
                {feed.map((row, index) => (
                  <SittingRow
                    key={row.sitting.id}
                    sitting={row.sitting}
                    checkIns={row.checkIns}
                    first={index === 0}
                    onLongPress={handleSittingLongPress}
                    onChanged={reload}
                  />
                ))}
              </View>
              {feedCursor ? (
                <Pressable
                  onPress={loadMoreSittings}
                  disabled={feedLoadingMore}
                  accessibilityRole="button"
                  accessibilityLabel={cs.friends.sittingsMore}
                  style={({ pressed }) => [
                    styles.moreFeedButton,
                    (pressed || feedLoadingMore) && styles.dim,
                  ]}
                >
                  <Text
                    style={styles.moreFeedLabel}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {feedLoadingMore ? cs.friends.sittingsLoading : cs.friends.sittingsMore}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : loading && !d ? null : (
            <Text style={styles.blockEmpty} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.sittingsEmpty}
            </Text>
          )}

          {/* 4. Co spolu podniknout. */}
          <PartaPlans />
        </ScrollView>
        <ScrollFade height={16} />
      </View>

      {/* Nothing is pinned here but the nudge, and the nudge collapses when
          there is none — which is most of the time. Parta is a feed: a button
          parked above the tab bar is lit the whole time the user is only
          reading, and every screen it stays on is a screen it shortens. The one
          action lives in the card's footer door instead (see PartyCard), and
          "Přidat kámoše" lives behind the "…" door.

          What is left here is only what the card's door cannot do: accept a
          request, retry offline, join a live table, opt into push. If a nudge's
          action IS the card's door, it does not belong in this slot. */}
      <NudgeSlot nudge={nudge} collapseWhenEmpty />

      <MoreSheet
        visible={moreVisible}
        title={cs.friends.moreTitle}
        rows={moreRows}
        onClose={() => setMoreVisible(false)}
      />

      <FriendSettingsSheet
        visible={settingsVisible}
        onClose={closeSettings}
        settings={d?.settings ?? DEFAULT_FRIEND_SOCIAL_SETTINGS}
        onSaved={handleSettingsSaved}
      />

      {codeVisible ? <CodeSheet onClose={() => setCodeVisible(false)} /> : null}

      {composeVisible ? (
        <ComposeSheet
          friends={d?.friends ?? []}
          onSubmitted={reload}
          onClose={() => setComposeVisible(false)}
        />
      ) : null}

      <AddFriendSheet
        visible={addFriendVisible}
        hasIdentity={hasIdentity}
        needsNickname={needsNickname}
        onOpenCode={openCodeFromAdd}
        onChanged={reload}
        onClose={() => setAddFriendVisible(false)}
      />

      <RosterSheet
        visible={rosterVisible}
        dashboard={d}
        stale={loadError}
        onReload={reload}
        onClose={() => setRosterVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  chromeRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  partyChip: {
    minHeight: HitArea.min,
    maxWidth: '80%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partyChipLabel: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  headerSpacer: {
    flex: 1,
    minWidth: Spacing.sm,
  },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    opacity: 0.6,
  },
  body: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    // Room for the last row to clear the fade instead of ending under it.
    paddingBottom: Spacing.lg,
  },
  cardGrow: {
    flex: 1,
  },
  // One quiet label per section — a name for the group, never a headline
  // competing with the card above it.
  sectionHeader: {
    marginTop: 24,
    marginBottom: 8,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  block: {
    gap: 12,
  },
  /** Same 12 as the gap inside a block — one rhythm down the whole stream. */
  spaced: {
    marginTop: 12,
  },
  blockEmpty: {
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 20,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  photoStreamItem: {
    marginTop: 24,
  },
  card: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 16,
  },
  moreFeedButton: {
    marginTop: 12,
    minHeight: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.18),
  },
  moreFeedLabel: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  requestActions: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  acceptBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  declineBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  sheetCardWrap: {
    width: '100%',
    // Let the card measure its content until this cap. A percentage minHeight
    // combined with flex: 1 leaves the list unbounded and Yoga clips it.
    maxHeight: '92%',
  },
  sheetCard: {
    flexShrink: 1,
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  sheetGrabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sheetTitle: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  sheetClose: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetList: {
    // Shrink only after the card reaches its cap, then scroll inside it.
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  sheetListContent: {
    gap: 12,
    paddingBottom: Spacing.sm,
  },
  sheetEmpty: {
    paddingVertical: 24,
    fontWeight: '500',
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  rosterBlock: {
    gap: 12,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rosterPub: {
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
});
