/**
 * FriendsScreen — the "Parta 3.0" surface (UX spec §2–§5).
 *
 * One living table you watch fill. The section order forks on the graph state,
 * computed once from the dashboard:
 *   - Cold start (0 friends, 0 incoming requests): the consumer sections are
 *     suppressed and the growth block ("SEŽEŇ PARTU") + a "CO TĚ ČEKÁ" teaser
 *     are elevated — the whole screen is the add-your-first-friends hook.
 *   - Active (≥1 friend OR an incoming request): hero → OfflineBanner →
 *     Compose CTA → MyActivityCard → PLÁN NA DNES → TEĎ NA PIVU → ČEKAJÍ NA
 *     TEBE → ŽEBŘÍČEK → KÁMOŠI → CINKLO V PARTĚ → PŘIDAT DO PARTY.
 *   - Offline: hydrate the last dashboard snapshot on mount so an offline cold
 *     start shows the cached graph behind the OfflineBanner instead of a blank
 *     tab; a failed live fetch keeps the last-known dashboard rendered.
 *
 * The screen is a single ScrollView with an amber RefreshControl; every top-level
 * group is wrapped in <Reveal> for a mount-driven staggered entrance, numbered by
 * a per-render counter so absent sections don't leave gaps.
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
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

import {
  DEFAULT_FRIEND_SOCIAL_SETTINGS,
  fetchFriendsDashboard,
  fetchFriendsLive,
  markFriendNotificationsRead,
  respondFriendRequest,
  type FriendNotification,
  type FriendsDashboard,
} from '@/data/friendsClient';
import {
  fetchBeerCheckInFeed,
  type BeerCheckIn,
} from '@/data/beerCheckinsClient';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { BeerTagChips } from '@/components/shared/BeerTagChips';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  BellRingIcon,
  BeerIcon,
  CheckIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FlameIcon,
  SettingsIcon,
  TrophyIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import {
  selectNeedsProfileSetup,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { registerFriendPush, ensureFriendPushRegisteredIfGranted } from '@/notifications/friendPush';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useToastStore } from '@/stores/toastStore';

import { AddFriendTools } from './AddFriendTools';
import CheersPill from './CheersPill';
import CodeSheet from './CodeSheet';
import ComposeSheet from './ComposeSheet';
import FriendActiveCard from './FriendActiveCard';
import { FriendMini, friendDisplayName } from './FriendMini';
import FriendSettingsSheet from './FriendSettingsSheet';
import FriendsSkeleton from './FriendsSkeleton';
import HairlineRow from './HairlineRow';
import { LeaderboardRow } from './LeaderboardRow';
import LiveDot from './LiveDot';
import MyActivityCard from './MyActivityCard';
import OfflineBanner from './OfflineBanner';
import PlanCard from './PlanCard';
import PushOptInStrip from './PushOptInStrip';
import Reveal from './Reveal';
import SectionHeader from './SectionHeader';
import StreakBadge from './StreakBadge';

/** Notification kinds whose feed row opens the actor's friend profile (§F3). */
const PROFILE_FEED_KINDS = new Set(['friend_accepted', 'friend_cheers']);
/** Bounded poll cadence while Parta is focused AND something is live (§D2). */
const LIVE_POLL_MS = 35000;

/** Leaderboard rows shown before the "+N dalších" cut (my row is always pinned). */
const LEADERBOARD_CAP = 8;
const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;
/** Notification kinds that point at an activity worth a one-tap cheer (§C3). */
const REACTABLE_FEED_KINDS = new Set(['friend_at_pub', 'friend_rsvp']);

/** Short cs-CZ "29. 6. 23:45" stamp for the notification feed. */
function timeLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Icon-only tap target shared by the accept / decline / add / remove / ghost
 * actions: ROUND_HIT_SLOP, button role, and the opacity dip on press all live
 * here so the press feedback stays consistent in one place.
 */
function IconButton({
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={ROUND_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, pressed && styles.dim]}
    >
      {children}
    </Pressable>
  );
}

/** Crafted empty strip: icon + one organic line on bare stout, zero amber. */
function EmptyStrip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.emptyStrip}>
      <View
        importantForAccessibility="no"
        accessibilityElementsHidden
        pointerEvents="none"
      >
        {icon}
      </View>
      <Text
        style={styles.emptyStripText}
        numberOfLines={3}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {text}
      </Text>
    </View>
  );
}

/** One line of the cold-start "CO TĚ ČEKÁ" teaser (icon + muted line). */
function TeaserLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.teaserLine}>
      <View importantForAccessibility="no" accessibilityElementsHidden pointerEvents="none">
        {icon}
      </View>
      <Text style={styles.teaserText} maxFontSizeMultiplier={FontScaleCap.body}>
        {text}
      </Text>
    </View>
  );
}

type PartyPulseTone = 'quiet' | 'live' | 'mine';

function PartyPulsePanel({
  tone,
  label,
  title,
  body,
  friendCount,
  streakLabel,
  onCompose,
}: {
  tone: PartyPulseTone;
  label: string;
  title: string;
  body: string;
  friendCount: number;
  streakLabel: string;
  onCompose?: () => void;
}) {
  const isLive = tone === 'live';
  const isMine = tone === 'mine';
  const canCompose = onCompose != null;

  return (
    <View
      style={[
        styles.pulseCard,
        isLive && styles.pulseCardLive,
        isMine && styles.pulseCardMine,
      ]}
    >
      <View
        style={[
          styles.pulseRail,
          (isLive || isMine) && styles.pulseRailHot,
        ]}
        pointerEvents="none"
      />
      <View style={styles.pulseTopRow}>
        <View
          style={[
            styles.pulseIconDisk,
            (isLive || isMine) && styles.pulseIconDiskHot,
          ]}
          importantForAccessibility="no"
          accessibilityElementsHidden
          pointerEvents="none"
        >
          {isLive || isMine ? (
            <BeerIcon size={20} color={Colors.stout} />
          ) : (
            <BellRingIcon size={20} color={Colors.amberLight} />
          )}
        </View>
        <Text
          style={[
            styles.pulseLabel,
            (isLive || isMine) && styles.pulseLabelHot,
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {label}
        </Text>
        {isLive || isMine ? <LiveDot size={7} /> : null}
        <View
          style={styles.pulseSignal}
          importantForAccessibility="no"
          accessibilityElementsHidden
          pointerEvents="none"
        >
          <View
            style={[
              styles.pulseSignalBar,
              (isLive || isMine) && styles.pulseSignalBarHot,
            ]}
          />
          <View
            style={[
              styles.pulseSignalBar,
              styles.pulseSignalBarMid,
              (isLive || isMine) && styles.pulseSignalBarHot,
            ]}
          />
          <View
            style={[
              styles.pulseSignalBar,
              styles.pulseSignalBarTall,
              (isLive || isMine) && styles.pulseSignalBarHot,
            ]}
          />
        </View>
      </View>

      <Text
        style={styles.pulseTitle}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {title}
      </Text>
      <Text
        style={styles.pulseBody}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {body}
      </Text>

      <View style={styles.pulseFooter}>
        <View style={styles.pulseMetrics}>
          <View style={styles.pulseMetric}>
            <UsersIcon size={14} color={Colors.mutedText} />
            <Text style={styles.pulseMetricText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.pulseFriendCount(friendCount)}
            </Text>
          </View>
          <View style={styles.pulseMetric}>
            <FlameIcon
              size={14}
              color={streakLabel === cs.friends.streakEmpty ? Colors.mutedText : Colors.amber}
            />
            <Text style={styles.pulseMetricText} maxFontSizeMultiplier={FontScaleCap.body}>
              {streakLabel}
            </Text>
          </View>
        </View>

        {canCompose ? (
          <View style={styles.pulseCta}>
            <GlowButton
              label={isLive ? cs.friends.pulseJoinCta : cs.friends.composeOpen}
              onPress={onCompose}
              variant={isLive ? 'secondary' : 'primary'}
              glow={isLive ? 'none' : 'soft'}
              height={52}
              icon={<BellRingIcon size={18} color={isLive ? Colors.amber : Colors.stout} />}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SectionPanel({
  children,
  hot = false,
}: {
  children: ReactNode;
  hot?: boolean;
}) {
  return <View style={[styles.sectionPanel, hot && styles.sectionPanelHot]}>{children}</View>;
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);

  const [dashboard, setDashboard] = useState<FriendsDashboard | null>(null);
  const [beerFeed, setBeerFeed] = useState<BeerCheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Distinct from `dashboard`: a failed fetch must never read as "no friends".
  const [loadError, setLoadError] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);
  const [composeVisible, setComposeVisible] = useState(false);
  const [showAllBoard, setShowAllBoard] = useState(false);
  // Push opt-in strip: a system-denied enable collapses it to the settings hint.
  const [pushDenied, setPushDenied] = useState(false);
  // Focus gate for the bounded live poll (Parta is a persistent tab).
  const [focused, setFocused] = useState(false);

  // Identity: the growth block needs a nickname before a QR/code makes sense.
  const nickname = useAccountStore(selectNickname);
  const needsProfileSetup = useAccountStore(selectNeedsProfileSetup);
  const hasIdentity = nickname != null;

  const friendPushEnabled = useSettingsStore((s) => s.friendPushEnabled);
  const friendPushPrompted = useSettingsStore((s) => s.friendPushPrompted);
  const setFriendPushPrompted = useSettingsStore((s) => s.setFriendPushPrompted);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const settingsOverrideRef = useRef<FriendsDashboard['settings'] | null>(null);
  // Race guard: an out-of-order reload must never clobber a fresher one. Each
  // load bumps the generation and aborts the previous in-flight fetch (§D2).
  const loadGenRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  // Scroll-to-target plumbing for push-tap / feed-row routing (§F3).
  const scrollRef = useRef<ScrollView>(null);
  const requestsYRef = useRef(0);
  const activeYRef = useRef(0);
  const scrollToOffset = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      const gen = ++loadGenRef.current;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      if (mode === 'refresh') setRefreshing(true);
      const next = await fetchFriendsDashboard(controller.signal);
      const nextBeerFeed = next ? await fetchBeerCheckInFeed(controller.signal) : null;
      if (!mountedRef.current) return;
      // A newer load superseded this one → skip the (now stale) dashboard/badge
      // writes, but ALWAYS clear the spinner/skeleton this load owns below —
      // otherwise a superseded pull-to-refresh or initial load spins forever.
      if (gen === loadGenRef.current) {
        if (next) {
          const override = settingsOverrideRef.current;
          setDashboard(override ? { ...next, settings: override } : next);
          if (nextBeerFeed) setBeerFeed(nextBeerFeed);
          setLoadError(false);
          const willMarkRead =
            next.notifications.length > 0 && (mode === 'initial' || mode === 'refresh');
          if (willMarkRead) {
            void markFriendNotificationsRead(next.notifications.map((n) => n.id));
          }
          // Feed the ambient tab badge from the freshest server truth. Marking read
          // now means the unread dot clears in lockstep (no badge desync/blink).
          usePartaSignalStore.getState().setSignal({
            pendingRequests: next.incomingRequests.length,
            unread: willMarkRead ? 0 : next.unreadCount,
            liveNow: next.activeFriends.length > 0 || next.myActiveActivity != null,
          });
        } else {
          // Keep the last-known dashboard rendered; only flip the error flag.
          setLoadError(true);
        }
      }
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    },
    [],
  );

  // Cheap live poll (§D2): the bounded interval hits GET /v1/friends/live — just
  // the live/plan surfaces + badge counts — instead of the heavy full dashboard
  // (365-day shared-stats scan + leaderboard). Merges the light slice onto the
  // current dashboard WITHOUT clobbering the heavy sections (friends, leaderboard,
  // streak, requests, feed); the full dashboard still loads on focus/refresh/
  // mutations. Shares the load generation + abort so newest-wins ordering holds.
  const pollLive = useCallback(async () => {
    const gen = ++loadGenRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const slice = await fetchFriendsLive(controller.signal);
    if (!mountedRef.current || gen !== loadGenRef.current) return;
    if (!slice) {
      setLoadError(true);
      return;
    }
    setDashboard((prev) =>
      prev
        ? {
            ...prev,
            activeFriends: slice.activeFriends,
            myActiveActivity: slice.myActiveActivity,
            plans: slice.plans,
            myPlan: slice.myPlan,
          }
        : prev,
    );
    setLoadError(false);
    usePartaSignalStore.getState().setSignal({
      pendingRequests: slice.incomingCount,
      unread: slice.unreadCount,
      liveNow: slice.activeFriends.length > 0 || slice.myActiveActivity != null,
    });
  }, []);

  // Hydrate the persisted snapshot before the network resolves so an offline
  // cold start shows the cached graph (behind the OfflineBanner) instead of a
  // blank tab (§2C / §H2). The network result replaces it.
  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snap) => {
      if (!alive || !snap) return;
      setDashboard((prev) => prev ?? snap.dashboard);
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

  /** Stable "reload the dashboard" used by every mutating child. */
  const reload = useCallback(() => {
    void load();
  }, [load]);

  // On focus: silently refresh so a push that landed while away is reflected, and
  // opportunistically light up push for existing grantees. A push tap / claim set
  // a pending-refresh flag — consume it to force a full refresh and scroll to the
  // named row (§D2/§F3). Also drives the focus gate for the bounded poll.
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

  // Foreground: silently refresh whenever the app returns to the foreground (a
  // stale tab left open across a night out).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load('silent');
    });
    return () => sub.remove();
  }, [load]);

  // Bounded poll: only while Parta is focused AND something is actually live/
  // planned (cost per AGENTS.md — it stops the moment nothing is happening). The
  // effect re-arms on each dashboard change, so a poll's own result resets the
  // timer rather than stacking intervals.
  const liveOrPlanned =
    dashboard != null &&
    (dashboard.activeFriends.length > 0 ||
      dashboard.myActiveActivity != null ||
      dashboard.myPlan != null ||
      dashboard.plans.length > 0);
  useEffect(() => {
    if (!focused || !liveOrPlanned) return;
    const id = setInterval(() => void pollLive(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [focused, liveOrPlanned, pollLive]);

  // — Profile navigation (§F) —
  const openFriendProfile = useCallback(
    (accountId: string) => {
      if (accountId) router.push(`/parta/${accountId}` as Href);
    },
    [router],
  );

  // — Push opt-in strip (§E2) —
  const handleEnablePush = useCallback(() => {
    void registerFriendPush().then((result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        showToast(cs.friends.pushEnabledToast, {
          icon: <BellRingIcon size={20} color={Colors.amber} />,
        });
      } else if (result.reason === 'denied') {
        setPushDenied(true);
      }
    });
  }, [showToast]);
  const dismissPush = useCallback(() => setFriendPushPrompted(true), [setFriendPushPrompted]);
  const openPushSettings = useCallback(() => void Linking.openSettings(), []);

  // Feed-row routing by kind (§F3): a request scrolls to ČEKAJÍ, a live/rsvp row
  // scrolls to TEĎ NA PIVU, an accepted/cheers row opens the actor's profile.
  const handleFeedPress = useCallback(
    (notification: FriendNotification) => {
      if (notification.kind === 'friend_request') {
        scrollToOffset(requestsYRef.current);
      } else if (
        notification.kind === 'friend_at_pub' ||
        notification.kind === 'friend_rsvp'
      ) {
        scrollToOffset(activeYRef.current);
      } else if (PROFILE_FEED_KINDS.has(notification.kind) && notification.actor?.id) {
        openFriendProfile(notification.actor.id);
      }
    },
    [openFriendProfile, scrollToOffset],
  );

  const respond = useCallback(
    async (id: string, action: 'accept' | 'decline') => {
      const result = await respondFriendRequest(id, action);
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
    [load, showToast],
  );

  const handleSettingsSaved = useCallback((next: FriendsDashboard['settings']) => {
    settingsOverrideRef.current = next;
    setDashboard((prev) => (prev ? { ...prev, settings: next } : prev));
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsVisible(false);
    void load();
  }, [load]);

  // Dynamic hero sub-line (compact hero folds live proof + streak urgency).
  const heroSub = useMemo<{ text: string; color: string }>(() => {
    if (!dashboard) return { text: '', color: Colors.mutedText };
    const myGoing = dashboard.myActiveActivity
      ? dashboard.myActiveActivity.responses.going
      : 0;
    const friendsLive = dashboard.activeFriends.length;
    const iAmLive = dashboard.myActiveActivity != null;

    if (iAmLive && myGoing > 0) {
      return { text: cs.friends.heroLiveMine(myGoing), color: Colors.foam };
    }
    if (iAmLive) {
      // I already broadcast tonight — "someone must cink first" would lie.
      return { text: cs.friends.heroLiveSolo, color: Colors.foam };
    }
    if (
      dashboard.streak.currentWeeks > 0 &&
      !dashboard.streak.thisWeekLit &&
      friendsLive === 0 &&
      !iAmLive
    ) {
      return { text: cs.friends.heroStreakRisk, color: Colors.amberLight };
    }
    if (friendsLive >= 1) {
      return friendsLive === 1
        ? {
            text: cs.friends.heroFriendLive(friendDisplayName(dashboard.activeFriends[0].account)),
            color: Colors.foamMuted,
          }
        : { text: cs.friends.heroManyLive(friendsLive), color: Colors.foamMuted };
    }
    return { text: cs.friends.heroQuiet, color: Colors.mutedText };
  }, [dashboard]);

  const liveNow =
    dashboard != null &&
    (dashboard.activeFriends.length > 0 || dashboard.myActiveActivity != null);

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <FriendsSkeleton />
      </View>
    );
  }

  const d = dashboard;
  const friendsLive = d ? d.activeFriends.length : 0;
  // The live section earns its caption only when it has live friend cards. Quiet
  // and mine-only states are carried by the hero pulse instead of another block.
  const showActiveSection = !!d && friendsLive > 0;
  // Cold start: no friends AND no incoming requests (a null dashboard — offline
  // first run with no snapshot — also reads as cold start).
  const isColdStart = !d || (d.friends.length === 0 && d.incomingRequests.length === 0);
  const hasPlans = !!(d && (d.myPlan || d.plans.length > 0));
  const pulseTone: PartyPulseTone | null =
    !d || isColdStart
      ? null
      : d.myActiveActivity
        ? 'mine'
        : friendsLive > 0
          ? 'live'
          : 'quiet';
  const pulseLabel =
    pulseTone === 'mine'
      ? cs.friends.pulseMineLabel
      : pulseTone === 'live'
        ? cs.friends.pulseLiveLabel
        : cs.friends.pulseQuietLabel;
  const pulseTitle = pulseTone === 'quiet' ? cs.friends.pulseQuietTitle : heroSub.text;
  const pulseBody =
    pulseTone === 'mine'
      ? cs.friends.pulseMineBody
      : pulseTone === 'live'
        ? cs.friends.pulseLiveBody
        : cs.friends.pulseQuietBody;
  const pulseStreakLabel = d
    ? d.streak.currentWeeks > 0
      ? cs.friends.streakWeeks(d.streak.currentWeeks)
      : cs.friends.streakEmpty
    : '';

  // Leaderboard slicing: top rows + a tappable "+N dalších" expand, but ALWAYS
  // pin my row while collapsed (expanding shows everyone, me included).
  const leaderboard = d?.leaderboard ?? [];
  const maxVisits = leaderboard.reduce((m, e) => Math.max(m, e.visits30d), 0);
  const visibleBoard = leaderboard.slice(0, LEADERBOARD_CAP);
  const hiddenCount = leaderboard.length - visibleBoard.length;
  const boardToShow = showAllBoard ? leaderboard : visibleBoard;
  const myIndex = leaderboard.findIndex((e) => e.isMe);
  const myPinned = !showAllBoard && hiddenCount > 0 && myIndex >= LEADERBOARD_CAP;

  // Push opt-in strip (§E2): only once there is something to notify about, and
  // never after the user enabled or dismissed it (a system-denial collapses it
  // to the settings one-liner).
  const pushAudience = !!d && (d.friends.length > 0 || d.incomingRequests.length > 0);
  const showPushStrip =
    !friendPushEnabled && (pushDenied || (!friendPushPrompted && pushAudience));

  const revealCounter = { next: 0 };
  const nextReveal = () => revealCounter.next++;

  const onRequestsLayout = (e: LayoutChangeEvent) => {
    requestsYRef.current = e.nativeEvent.layout.y;
  };
  const onActiveLayout = (e: LayoutChangeEvent) => {
    activeYRef.current = e.nativeEvent.layout.y;
  };

  const renderFeedRow = (notification: FriendNotification, first: boolean) => {
    const when = timeLabel(notification.createdAt);
    const canReact =
      !!notification.activityId && REACTABLE_FEED_KINDS.has(notification.kind);
    const canRoute =
      notification.kind === 'friend_request' ||
      notification.kind === 'friend_at_pub' ||
      notification.kind === 'friend_rsvp' ||
      (PROFILE_FEED_KINDS.has(notification.kind) && !!notification.actor?.id);
    return (
      <HairlineRow
        key={notification.id}
        first={first}
        onPress={canRoute ? () => handleFeedPress(notification) : undefined}
      >
        <View style={styles.feedRow}>
          <View
            style={[
              styles.feedIconDisk,
              !notification.readAt && styles.feedIconDiskUnread,
            ]}
            importantForAccessibility="no"
            accessibilityElementsHidden
            pointerEvents="none"
          >
            <BellRingIcon
              size={16}
              color={notification.readAt ? Colors.mutedText : Colors.amber}
            />
          </View>
          <View style={styles.feedText}>
            <View style={styles.feedTitleRow}>
              <Text
                style={styles.feedTitle}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {notification.title}
              </Text>
              {when ? (
                <Text style={styles.feedTime} numberOfLines={1} allowFontScaling={false}>
                  {when}
                </Text>
              ) : null}
            </View>
            <Text
              style={styles.feedBody}
              numberOfLines={2}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {notification.body}
            </Text>
          </View>
          {canReact ? (
            <CheersPill
              activityId={notification.activityId as string}
              count={0}
              mine={false}
              compact
              ownerName={friendDisplayName(notification.actor)}
              onChanged={reload}
            />
          ) : null}
        </View>
      </HairlineRow>
    );
  };

  const renderBeerFeedRow = (checkIn: BeerCheckIn, first: boolean) => {
    const when = timeLabel(checkIn.checkedInAt);
    const ownerName = friendDisplayName(checkIn.account);
    const meta = [
      checkIn.rating != null ? `${checkIn.rating.toFixed(1)} / 5` : '',
      checkIn.pubName,
      when,
    ].filter(Boolean).join(' · ');
    return (
      <HairlineRow
        key={checkIn.id}
        first={first}
        onPress={() =>
          router.push({
            pathname: '/beer-detail',
            params: { beer: checkIn.beerName, brewery: checkIn.breweryName },
          } as Href)
        }
      >
        <View style={styles.feedRow}>
          <View style={styles.feedIconDisk}>
            <BeerIcon size={16} color={Colors.amber} />
          </View>
          <View style={styles.feedText}>
            <View style={styles.feedTitleRow}>
              <Text style={styles.feedTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {ownerName} pije {checkIn.beerName}
              </Text>
            </View>
            {meta ? (
              <Text style={styles.feedBody} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {meta}
              </Text>
            ) : null}
            {checkIn.note ? (
              <Text style={styles.feedNote} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                {checkIn.note}
              </Text>
            ) : null}
            {checkIn.tags.length > 0 ? (
              <View style={styles.feedTags}>
                <BeerTagChips tags={checkIn.tags} />
              </View>
            ) : null}
          </View>
          <CheersPill
            activityId={checkIn.id}
            target="beerCheckIn"
            count={checkIn.reactions.cheers}
            mine={checkIn.myReaction === 'cheers'}
            compact
            ownerName={ownerName}
            onChanged={reload}
          />
        </View>
      </HairlineRow>
    );
  };

  return (
    <View style={styles.root}>
      {/* Android is edge-to-edge, so `adjustResize` no longer pushes content
          above the keyboard — pad it here (iOS pads via keyboard insets). */}
      <KeyboardAvoidingView style={styles.root} behavior="padding" enabled={Platform.OS === 'android'}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom + 18, 32) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={Colors.amber}
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* §2 — Hero */}
        <Reveal index={nextReveal()}>
          <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
            <View style={styles.heroRow1}>
              <View style={styles.heroTitleWrap}>
                <Text
                  style={styles.heroTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {cs.friends.title}
                </Text>
                {liveNow ? (
                  // Lift the dot to the title's cap-height optical center — the
                  // 34px line box carries descender space, so a box-centered dot
                  // reads as a stray full stop.
                  <View style={styles.liveDotNudge}>
                    <LiveDot size={9} />
                  </View>
                ) : null}
              </View>

              <View style={styles.heroRight}>
                {d && !isColdStart ? <StreakBadge streak={d.streak} /> : null}
                {d?.settings.ghostMode ? (
                  // Pure status chip, not a control: the gear is the single entry
                  // to settings, so ghost mode reads as a labelled state here
                  // (icon alone was mistaken for a second, redundant button).
                  <View
                    style={styles.ghostChip}
                    accessibilityRole="text"
                    accessibilityLabel={cs.friends.ghostActive}
                  >
                    <EyeOffIcon size={15} color={Colors.amberLight} />
                    <Text style={styles.ghostChipLabel} allowFontScaling={false}>
                      {cs.friends.ghostChip}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => setSettingsVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel={cs.friends.settingsOpen}
                  style={({ pressed }) => [styles.gear, pressed && styles.dim]}
                >
                  <SettingsIcon size={22} color={Colors.mutedText} />
                </Pressable>
              </View>
            </View>

            {isColdStart ? (
              <>
                <Text
                  style={styles.heroColdTitle}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {cs.friends.heroTitle}
                </Text>
                <Text
                  style={styles.heroColdBody}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.friends.heroBody}
                </Text>
                {loadError && !d ? (
                  <Text style={styles.firstRunOffline} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.firstRunOffline}
                  </Text>
                ) : null}
              </>
            ) : d && pulseTone ? (
              <PartyPulsePanel
                tone={pulseTone}
                label={pulseLabel}
                title={pulseTitle}
                body={pulseBody}
                friendCount={d.friends.length}
                streakLabel={pulseStreakLabel}
                onCompose={!d.myActiveActivity ? () => setComposeVisible(true) : undefined}
              />
            ) : null}

            {isColdStart ? <View style={styles.heroRule} /> : null}
          </View>
        </Reveal>

        {/* §11 — OfflineBanner (data stays below; snapshot-aware copy) */}
        {loadError && !(isColdStart && !d) ? (
          <Reveal index={nextReveal()}>
            <View style={styles.section}>
              <OfflineBanner onRetry={() => void load('refresh')} />
            </View>
          </Reveal>
        ) : null}

        {isColdStart ? (
          <>
            {/* §3 — SEŽEŇ PARTU: the cold-start growth hook (add stays inline
                here so a 0-friend user at the table isn't kicked to another screen) */}
            <Reveal index={nextReveal()}>
              <View style={styles.section}>
                <SectionPanel>
                  <SectionHeader label={cs.friends.growthHeader} />
                  <AddFriendTools
                    hasIdentity={hasIdentity}
                    needsProfileSetup={needsProfileSetup}
                    onOpenCode={() => setCodeVisible(true)}
                    onChanged={reload}
                    showSearch
                  />
                </SectionPanel>
              </View>
            </Reveal>

            {/* §J — CO TĚ ČEKÁ: a calm 3-line preview of the loop */}
            <Reveal index={nextReveal()}>
              <View style={styles.section}>
                <SectionPanel>
                  <SectionHeader label={cs.friends.whatIsPartaHeader} />
                  <View style={styles.teaser}>
                    <TeaserLine
                      icon={<BellRingIcon size={18} color={Colors.mutedText} />}
                      text={cs.friends.whatIsParta1}
                    />
                    <TeaserLine
                      icon={<UsersIcon size={18} color={Colors.mutedText} />}
                      text={cs.friends.whatIsParta2}
                    />
                    <TeaserLine
                      icon={<FlameIcon size={18} color={Colors.mutedText} />}
                      text={cs.friends.whatIsParta3}
                    />
                  </View>
                </SectionPanel>
              </View>
            </Reveal>
          </>
        ) : (
          <>
            {/* §E — Push opt-in strip (warm, high, dismissable) */}
            {showPushStrip ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <PushOptInStrip
                    mode={pushDenied ? 'denied' : 'prompt'}
                    onEnable={handleEnablePush}
                    onDismiss={dismissPush}
                    onOpenSettings={openPushSettings}
                  />
                </View>
              </Reveal>
            ) : null}

            {/* §3 — MyActivityCard: my own live broadcast, the one card with a glow */}
            {d?.myActiveActivity ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <MyActivityCard activity={d.myActiveActivity} onEnded={reload} stale={loadError} />
                </View>
              </Reveal>
            ) : null}

            {/* §B3 — PLÁN NA DNES: today's upcoming plans (mine first) */}
            {hasPlans && d ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <SectionHeader label={cs.friends.plansHeader} />
                  <View style={styles.stack}>
                    {d.myPlan ? (
                      <PlanCard
                        key={d.myPlan.id}
                        activity={d.myPlan}
                        mine
                        onResponded={reload}
                        onCanceled={reload}
                      />
                    ) : null}
                    {d.plans.map((plan) => (
                      <PlanCard
                        key={plan.id}
                        activity={plan}
                        mine={false}
                        onResponded={reload}
                        onCanceled={reload}
                      />
                    ))}
                  </View>
                </View>
              </Reveal>
            ) : null}

            {/* §4 — TEĎ NA PIVU: the decision surface (friends' live cards). */}
            {showActiveSection && d ? (
              <Reveal index={nextReveal()} onLayout={onActiveLayout}>
                <View style={styles.section}>
                  <SectionHeader
                    label={cs.friends.activeHeader}
                    live
                    stale={loadError}
                  />
                  {loadError && friendsLive > 0 ? (
                    <Text style={styles.staleNote} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.friends.staleNote}
                    </Text>
                  ) : null}
                  <View style={styles.stack}>
                    {d.activeFriends.map((activity) => (
                      <FriendActiveCard
                        key={activity.id}
                        activity={activity}
                        onResponded={reload}
                        stale={loadError}
                      />
                    ))}
                  </View>
                </View>
              </Reveal>
            ) : null}

            {/* §5 — ČEKAJÍ NA TEBE: incoming requests */}
            {d && d.incomingRequests.length > 0 ? (
              <Reveal index={nextReveal()} onLayout={onRequestsLayout}>
                <View style={styles.section}>
                  <SectionPanel hot>
                    <SectionHeader label={cs.friends.requestsHeader} />
                    <View>
                      {d.incomingRequests.map((request, i) => (
                        <HairlineRow key={request.id} first={i === 0}>
                          <View style={styles.requestRow}>
                            <FriendMini profile={request.requester} />
                            <View style={styles.requestActions}>
                              <IconButton
                                onPress={() => void respond(request.id, 'decline')}
                                accessibilityLabel={cs.friends.decline}
                                style={styles.declineBtn}
                              >
                                <XIcon size={18} color={Colors.foam} />
                              </IconButton>
                              <IconButton
                                onPress={() => void respond(request.id, 'accept')}
                                accessibilityLabel={cs.friends.accept}
                                style={styles.acceptBtn}
                              >
                                <CheckIcon size={18} color={Colors.stout} />
                              </IconButton>
                            </View>
                          </View>
                        </HairlineRow>
                      ))}
                    </View>
                  </SectionPanel>
                </View>
              </Reveal>
            ) : null}

            {/* §8 — ŽEBŘÍČEK PARTY */}
            {d ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <SectionPanel>
                    <SectionHeader label={cs.friends.leaderboardHeader} />
                    {leaderboard.length <= 1 ? (
                      <EmptyStrip
                        icon={<TrophyIcon size={28} color={Colors.mutedText} />}
                        text={cs.friends.leaderboardEmpty}
                      />
                    ) : (
                      <View style={styles.panelList}>
                        {boardToShow.map((entry, i) => (
                          <LeaderboardRow
                            key={entry.account.id || `rank-${i}`}
                            entry={entry}
                            rank={i + 1}
                            maxVisits={maxVisits}
                            onPress={
                              entry.isMe || !entry.account.id
                                ? undefined
                                : () => openFriendProfile(entry.account.id)
                            }
                          />
                        ))}
                        {!showAllBoard && hiddenCount > 0 ? (
                          <Pressable
                            onPress={() => setShowAllBoard(true)}
                            accessibilityRole="button"
                            accessibilityLabel={cs.friends.leaderboardMore(hiddenCount)}
                            style={({ pressed }) => [styles.moreRow, pressed && styles.dim]}
                          >
                            <Text style={styles.moreLine} maxFontSizeMultiplier={FontScaleCap.body}>
                              {cs.friends.leaderboardMore(hiddenCount)}
                            </Text>
                          </Pressable>
                        ) : null}
                        {myPinned && myIndex >= 0 ? (
                          <>
                            <Text
                              style={styles.dividerDots}
                              allowFontScaling={false}
                              accessibilityElementsHidden
                              importantForAccessibility="no"
                            >
                              …
                            </Text>
                            <LeaderboardRow
                              key="me-pinned"
                              entry={leaderboard[myIndex]}
                              rank={myIndex + 1}
                              maxVisits={maxVisits}
                            />
                          </>
                        ) : null}
                      </View>
                    )}

                    {/* Cross-link: from the party race to the countrywide one. */}
                    <Pressable
                      onPress={() => router.push('/leaderboards' as Href)}
                      accessibilityRole="button"
                      accessibilityLabel={cs.a11y.leaderboardsOpen}
                      style={({ pressed }) => [styles.globalBoardsLink, pressed && styles.dim]}
                    >
                      <TrophyIcon size={16} color={Colors.amber} />
                      <Text
                        style={styles.globalBoardsLinkText}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {cs.leaderboards.entryFriends}
                      </Text>
                      <ChevronRightIcon size={16} color={Colors.mutedText} />
                    </Pressable>
                  </SectionPanel>
                </View>
              </Reveal>
            ) : null}

            {d && beerFeed.length > 0 ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <SectionPanel>
                    <SectionHeader label={cs.beerCheckins.feedHeader} />
                    <View>
                      {beerFeed.slice(0, 6).map((checkIn, i) => renderBeerFeedRow(checkIn, i === 0))}
                    </View>
                  </SectionPanel>
                </View>
              </Reveal>
            ) : null}

            {/* §9 — CINKLO V PARTĚ: ambient notification feed + one-tap reactions */}
            {d && d.notifications.length > 0 ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <SectionPanel>
                    <SectionHeader label={cs.friends.feedHeader} />
                    <View>
                      {d.notifications
                        .slice(0, 6)
                        .map((notification, i) => renderFeedRow(notification, i === 0))}
                    </View>
                  </SectionPanel>
                </View>
              </Reveal>
            ) : null}

            {/* Footer cross-link into Správa party — the full friends list, add
                tools and outgoing invites now live there. Navigation, not an
                action (amber icon, foam text, chevron), so no GlowButton. */}
            {d ? (
              <Reveal index={nextReveal()}>
                <View style={styles.section}>
                  <Pressable
                    onPress={() => router.push('/profile/parta' as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={cs.friends.manageLink}
                    style={({ pressed }) => [styles.manageLink, pressed && styles.dim]}
                  >
                    <View
                      style={styles.manageIconDisk}
                      importantForAccessibility="no"
                      accessibilityElementsHidden
                      pointerEvents="none"
                    >
                      <UsersIcon size={18} color={Colors.amber} />
                    </View>
                    <Text style={styles.manageLinkText} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.friends.manageLink}
                    </Text>
                    <ChevronRightIcon size={16} color={Colors.mutedText} />
                  </Pressable>
                </View>
              </Reveal>
            ) : null}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <FriendSettingsSheet
        visible={settingsVisible}
        onClose={closeSettings}
        settings={d?.settings ?? DEFAULT_FRIEND_SOCIAL_SETTINGS}
        onSaved={handleSettingsSaved}
      />

      {codeVisible ? <CodeSheet onClose={() => setCodeVisible(false)} /> : null}
      {composeVisible ? (
        <ComposeSheet
          friends={dashboard?.friends ?? []}
          onSubmitted={reload}
          onClose={() => setComposeVisible(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },

  // — Hero —
  hero: {
    paddingBottom: Spacing.md,
  },
  heroRow1: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  heroTitleWrap: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heroTitle: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: Colors.foam,
  },
  heroRight: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  gear: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    // Collapse the invisible hit-area padding (44 box − 22 glyph = 11/side) so
    // the glyph keeps an optical gap to the ghost chip and sits flush with the
    // content's right edge.
    marginLeft: -11,
    marginRight: -11,
  },
  // Matches the StreakBadge amber chip so the header reads as one row.
  ghostChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderColor: withAlpha(Colors.amber, 0.32),
  },
  ghostChipLabel: {
    fontFamily: Fonts.display.semibold,
    fontSize: 13,
    color: Colors.amberLight,
  },
  liveDotNudge: {
    transform: [{ translateY: -5 }],
  },
  heroColdTitle: {
    marginTop: Spacing.md,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    lineHeight: 27,
    color: Colors.foam,
  },
  heroColdBody: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
  },
  pulseCard: {
    position: 'relative',
    overflow: 'hidden',
    marginTop: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.72),
    backgroundColor: Colors.stout2,
    ...softDrop(),
  },
  pulseCardLive: {
    borderColor: withAlpha(Colors.amber, 0.38),
    backgroundColor: Colors.stout3,
  },
  pulseCardMine: {
    borderColor: withAlpha(Colors.amber, 0.5),
  },
  pulseRail: {
    position: 'absolute',
    top: Spacing.lg,
    bottom: Spacing.lg,
    left: 0,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: withAlpha(Colors.amber, 0.28),
  },
  pulseRailHot: {
    backgroundColor: Colors.amber,
  },
  pulseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pulseIconDisk: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.25),
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  pulseIconDiskHot: {
    borderColor: withAlpha(Colors.amber, 0.8),
    backgroundColor: Colors.amber,
  },
  pulseLabel: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  pulseLabelHot: {
    color: Colors.amberLight,
  },
  pulseSignal: {
    marginLeft: 'auto',
    height: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  pulseSignalBar: {
    width: 3,
    height: 7,
    borderRadius: 2,
    backgroundColor: withAlpha(Colors.mutedText, 0.38),
  },
  pulseSignalBarMid: {
    height: 11,
  },
  pulseSignalBarTall: {
    height: 15,
  },
  pulseSignalBarHot: {
    backgroundColor: withAlpha(Colors.amber, 0.86),
  },
  pulseTitle: {
    marginTop: Spacing.md,
    fontFamily: Fonts.display.extrabold,
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: -0.3,
    color: Colors.foam,
  },
  pulseBody: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  pulseFooter: {
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  pulseMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  pulseMetric: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.small,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    backgroundColor: withAlpha(Colors.foam, 0.045),
  },
  pulseMetricText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.foamMuted,
  },
  pulseCta: {
    alignSelf: 'stretch',
  },
  firstRunOffline: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  heroRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.border, 0.6),
    marginTop: Spacing.md,
    marginHorizontal: -Spacing.lg,
  },

  // — Section rhythm —
  section: {
    marginTop: Spacing.xl,
  },
  sectionPanel: {
    padding: Spacing.lg,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.55),
    backgroundColor: withAlpha(Colors.stout2, 0.88),
    ...softDrop(),
  },
  sectionPanelHot: {
    borderColor: withAlpha(Colors.amber, 0.32),
    backgroundColor: withAlpha(Colors.stout3, 0.9),
  },
  panelList: {
    marginHorizontal: -10,
  },
  stack: {
    gap: Spacing.sm,
  },
  dim: {
    opacity: 0.6,
  },
  // — Footer cross-link into Správa party —
  manageLink: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.55),
    backgroundColor: withAlpha(Colors.stout2, 0.76),
  },
  manageLinkText: {
    flex: 1,
    fontFamily: Fonts.display.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  manageIconDisk: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },

  // — CO TĚ ČEKÁ teaser —
  teaser: {
    gap: Spacing.md,
  },
  teaserLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  teaserText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
  },

  // — Requests —
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
    borderRadius: HitArea.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  declineBtn: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: HitArea.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },

  // — Empty strips —
  emptyStrip: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  emptyStripText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // — Leaderboard —
  moreRow: {
    minHeight: HitArea.min,
    justifyContent: 'center',
  },
  moreLine: {
    marginTop: Spacing.sm,
    paddingHorizontal: 10,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  globalBoardsLink: {
    marginTop: Spacing.sm,
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 10,
  },
  globalBoardsLinkText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foam,
  },
  staleNote: {
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontStyle: 'italic',
    fontSize: 12,
    color: Colors.mutedText,
  },
  dividerDots: {
    marginTop: Spacing.xs,
    textAlign: 'center',
    fontFamily: Fonts.display.semibold,
    fontSize: 16,
    color: Colors.mutedText,
  },

  // — Notification feed —
  feedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  feedIconDisk: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    backgroundColor: withAlpha(Colors.foam, 0.045),
  },
  feedIconDiskUnread: {
    borderColor: withAlpha(Colors.amber, 0.3),
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  feedText: {
    flex: 1,
    minWidth: 0,
  },
  feedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  feedTitle: {
    flex: 1,
    fontFamily: Fonts.ui.bold,
    color: Colors.foam,
    fontSize: 14,
  },
  feedTime: {
    flexShrink: 0,
    fontFamily: Fonts.ui.medium,
    color: Colors.mutedText,
    fontSize: 11,
  },
  feedBody: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  feedNote: {
    marginTop: 4,
    fontFamily: Fonts.ui.medium,
    color: Colors.foam,
    fontSize: 13,
    lineHeight: 18,
  },
  feedTags: {
    marginTop: 6,
  },
});
