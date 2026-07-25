/**
 * "Parta" in the Tácek composition.
 *
 * The social graph, offline snapshot, queues, focus refresh, push hand-off and
 * bounded live poll are the same as before. This file only changes where their
 * existing surfaces live:
 *
 *   1. a quiet party chip and the single overflow door,
 *   2. one table card and one chronological stream,
 *   3. one fixed nudge slot,
 *   4. one amber action (plus the quiet add-friend twin for an existing party).
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
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import { BeerTagChips } from '@/components/shared/BeerTagChips';
import {
  BellRingIcon,
  BeerIcon,
  CameraIcon,
  CheckIcon,
  EllipsisIcon,
  HouseIcon,
  QrCodeIcon,
  SettingsIcon,
  TrophyIcon,
  Undo2Icon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { CounterCta, CounterSecondary } from '@/counter/CounterCta';
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
  respondToActivity,
  type FriendNotification,
  type FriendProfile,
  type FriendPubActivity,
  type FriendsDashboard,
  type Friendship,
} from '@/data/friendsClient';
import {
  enqueueFriendOp,
  isRetriableFriendError,
} from '@/data/friendsQueue';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import {
  fetchLeaderboard,
  type Leaderboard,
} from '@/data/leaderboardsClient';
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
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { formatPrice } from '@/utils/currency';
import {
  ensureFriendPushRegisteredIfGranted,
  registerFriendPush,
} from '@/notifications/friendPush';

import { AddFriendTools } from './AddFriendTools';
import CheersPill from './CheersPill';
import CodeSheet from './CodeSheet';
import ComposeSheet from './ComposeSheet';
import FriendActiveCard from './FriendActiveCard';
import { FriendListRow } from './FriendListRow';
import { FriendMini, friendDisplayName } from './FriendMini';
import FriendSettingsSheet from './FriendSettingsSheet';
import { GoingRoster } from './GoingRoster';
import HairlineRow from './HairlineRow';
import MyActivityCard from './MyActivityCard';
import { PartyCard } from './PartyCard';
import PlanCard from './PlanCard';
import { useFriendSafety } from './friendSafety';

const LIVE_POLL_MS = 35000;
const SHEET_DISMISS_MS = 260;
const ROUND_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;
const PROFILE_FEED_KINDS = new Set(['friend_accepted', 'friend_cheers']);
const REACTABLE_FEED_KINDS = new Set(['friend_at_pub', 'friend_rsvp']);

interface BeerFeedItem {
  key: string;
  checkIns: BeerCheckIn[];
}

type StreamItem =
  | { key: string; kind: 'plan'; at: number; activity: FriendPubActivity; mine: boolean }
  | { key: string; kind: 'live'; at: number; activity: FriendPubActivity }
  | { key: string; kind: 'beer'; at: number; item: BeerFeedItem }
  | { key: string; kind: 'notification'; at: number; notification: FriendNotification }
  | { key: string; kind: 'request'; at: number; request: Friendship }
  | {
      key: string;
      kind: 'friend';
      at: number;
      friend: FriendProfile;
      stats: FriendsDashboard['friendStats'][string];
    };

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeLabel(iso: string): string {
  const parsed = timestamp(iso);
  if (parsed === 0) return '';
  return new Date(parsed).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function planTimeLabel(iso: string): string {
  const parsed = timestamp(iso);
  if (parsed === 0) return '';
  return new Date(parsed).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupBeerFeed(checkIns: BeerCheckIn[]): BeerFeedItem[] {
  const groups = new Map<string, BeerCheckIn[]>();
  const order: string[] = [];
  for (const checkIn of checkIns) {
    const key = checkIn.visitClientId
      ? `visit:${checkIn.account.id}:${checkIn.visitClientId}`
      : `checkin:${checkIn.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)?.push(checkIn);
  }
  return order.map((key) => ({ key, checkIns: groups.get(key) ?? [] }));
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
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
  const hasIdentity = nickname != null;

  const friendPushEnabled = useSettingsStore((state) => state.friendPushEnabled);
  const friendPushPrompted = useSettingsStore((state) => state.friendPushPrompted);
  const setFriendPushPrompted = useSettingsStore((state) => state.setFriendPushPrompted);
  const priceCurrency = useSettingsStore((state) => state.priceCurrency);

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
  const quickRsvpRef = useRef(false);
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

      const beerFeedPromise = fetchBeerCheckInFeed(controller.signal);
      const next = await fetchFriendsDashboard(controller.signal);
      if (!mountedRef.current) return;

      if (generation === loadGenRef.current) {
        if (next) {
          const override = settingsOverrideRef.current;
          setDashboard(override ? { ...next, settings: override } : next);
          setLoadError(false);

          const willMarkRead =
            next.notifications.length > 0 && (mode === 'initial' || mode === 'refresh');
          if (willMarkRead) {
            void markFriendNotificationsRead(next.notifications.map((item) => item.id));
          }
          usePartaSignalStore.getState().setSignal({
            pendingRequests: next.incomingRequests.length,
            unread: willMarkRead ? 0 : next.unreadCount,
            liveNow: next.activeFriends.length > 0 || next.myActiveActivity != null,
          });
        } else {
          setLoadError(true);
        }
      }

      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
      if (!next) return;

      const nextBeerFeed = await beerFeedPromise;
      if (!mountedRef.current || generation !== loadGenRef.current || !nextBeerFeed) return;
      setBeerFeed(nextBeerFeed);
    },
    [],
  );

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
          }
        : current,
    );
    setLoadError(false);
    usePartaSignalStore.getState().setSignal({
      pendingRequests: slice.incomingCount,
      unread: slice.unreadCount,
      liveNow: slice.activeFriends.length > 0 || slice.myActiveActivity != null,
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

  const liveOrPlanned =
    dashboard != null &&
    (dashboard.activeFriends.length > 0 ||
      dashboard.myActiveActivity != null ||
      dashboard.myPlan != null ||
      dashboard.plans.length > 0);

  useEffect(() => {
    if (!focused || !liveOrPlanned) return;
    const timer = setInterval(() => void pollLive(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [focused, liveOrPlanned, pollLive]);

  const openFriendProfile = useCallback(
    (accountId: string) => {
      if (accountId) router.push(`/parta/${accountId}` as Href);
    },
    [router],
  );
  const openFriendSafety = useFriendSafety(reload);

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
      if (respondingRequestActions[id]) return;
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

  const respondGoing = useCallback(
    (activity: FriendPubActivity) => {
      if (quickRsvpRef.current) return;
      quickRsvpRef.current = true;
      void respondToActivity(activity.id, 'going').then((result) => {
        quickRsvpRef.current = false;
        if (result.ok) {
          reload();
          return;
        }
        if (isRetriableFriendError(result)) {
          void enqueueFriendOp({ op: 'rsvp', activityId: activity.id, response: 'going' });
          showToast(cs.friends.rsvpQueued);
          reload();
          return;
        }
        showToast(cs.friends.rsvpError);
      });
    },
    [reload, showToast],
  );

  const handleEndBroadcast = useCallback(() => {
    const activity = dashboard?.myActiveActivity;
    if (!activity || endingBroadcastRef.current) return;
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
  }, [dashboard?.myActiveActivity, reload, showToast]);

  const handleEnablePush = useCallback(() => {
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
      {
        key: 'party',
        label: cs.friends.moreWholeParty,
        icon: UsersIcon,
        onPress: () =>
          runAfterMoreClose(() => router.push('/profile/parta' as Href)),
      },
      {
        key: 'leaderboards',
        label: cs.friends.moreLeaderboards,
        icon: TrophyIcon,
        onPress: () =>
          runAfterMoreClose(() =>
            router.push({ pathname: '/leaderboards', params: { source: 'parta' } } as Href),
          ),
      },
      {
        key: 'photo-contest',
        label: cs.friends.morePhotoContest,
        icon: CameraIcon,
        onPress: () =>
          runAfterMoreClose(() => router.push('/photo-contest' as Href)),
      },
      {
        key: 'vycep',
        label: cs.friends.moreVycep,
        icon: BeerIcon,
        onPress: () => runAfterMoreClose(() => router.push('/vycep' as Href)),
      },
      {
        key: 'party-evening',
        label: cs.friends.morePartyEvening,
        icon: UsersIcon,
        onPress: () => runAfterMoreClose(() => router.push('/party' as Href)),
      },
      {
        key: 'home-party',
        label: cs.friends.moreHomeParty,
        icon: HouseIcon,
        onPress: () =>
          runAfterMoreClose(() => router.push('/community-events' as Href)),
      },
    ],
    [router, runAfterMoreClose],
  );

  const d = dashboard;
  const friendCount = d?.friends.length ?? 0;
  const beerFeedItems = useMemo(() => groupBeerFeed(beerFeed), [beerFeed]);

  const streamItems = useMemo<StreamItem[]>(() => {
    if (!d) return [];
    const items: StreamItem[] = [];

    if (d.myPlan) {
      items.push({
        key: `plan:mine:${d.myPlan.id}`,
        kind: 'plan',
        at: timestamp(d.myPlan.scheduledFor ?? d.myPlan.createdAt),
        activity: d.myPlan,
        mine: true,
      });
    }
    for (const plan of d.plans) {
      items.push({
        key: `plan:${plan.id}`,
        kind: 'plan',
        at: timestamp(plan.scheduledFor ?? plan.createdAt),
        activity: plan,
        mine: false,
      });
    }
    for (const activity of d.activeFriends) {
      items.push({
        key: `live:${activity.id}`,
        kind: 'live',
        at: timestamp(activity.updatedAt || activity.startedAt),
        activity,
      });
    }
    for (const item of beerFeedItems.slice(0, 6)) {
      const first = item.checkIns[0];
      if (!first) continue;
      items.push({
        key: `beer:${item.key}`,
        kind: 'beer',
        at: timestamp(first.checkedInAt),
        item,
      });
    }
    for (const notification of d.notifications.slice(0, 6)) {
      items.push({
        key: `notification:${notification.id}`,
        kind: 'notification',
        at: timestamp(notification.createdAt),
        notification,
      });
    }
    for (const request of d.incomingRequests) {
      items.push({
        key: `request:${request.id}`,
        kind: 'request',
        at: timestamp(request.requestedAt),
        request,
      });
    }
    for (const friend of d.friends) {
      const stats = d.friendStats[friend.id];
      if (!stats?.lastSharedAt) continue;
      items.push({
        key: `friend:${friend.id}`,
        kind: 'friend',
        at: timestamp(stats.lastSharedAt),
        friend,
        stats,
      });
    }

    return items.sort((a, b) => b.at - a.at);
  }, [beerFeedItems, d]);
  const firstLiveStreamKey = streamItems.find((item) => item.kind === 'live')?.key;
  const firstRequestStreamKey = streamItems.find((item) => item.kind === 'request')?.key;

  const partyNumbers = useMemo(() => {
    const goingIds = new Set<string>();
    if (d) {
      for (const activity of d.activeFriends) {
        if (activity.account.id) goingIds.add(activity.account.id);
      }
      for (const plan of d.plans) {
        if (plan.account.id) goingIds.add(plan.account.id);
      }
      const activities = [
        ...d.activeFriends,
        ...d.plans,
        ...(d.myActiveActivity ? [d.myActiveActivity] : []),
        ...(d.myPlan ? [d.myPlan] : []),
      ];
      for (const activity of activities) {
        for (const profile of activity.responses.goingProfiles) {
          if (profile.id) goingIds.add(profile.id);
        }
      }
    }
    const mine = d?.myActiveActivity != null;
    const going = goingIds.size + (mine ? 1 : 0);
    const maybe = d
      ? [
          ...d.activeFriends,
          ...d.plans,
          ...(d.myActiveActivity ? [d.myActiveActivity] : []),
          ...(d.myPlan ? [d.myPlan] : []),
        ].reduce((sum, activity) => sum + activity.responses.maybe, 0)
      : 0;
    return { count: going, going, maybe, mine };
  }, [d]);

  const freshestLive = useMemo(() => {
    if (!d || d.activeFriends.length === 0) return null;
    return [...d.activeFriends].sort(
      (a, b) => timestamp(b.updatedAt || b.startedAt) - timestamp(a.updatedAt || a.startedAt),
    )[0];
  }, [d]);

  const freshestPlan = useMemo(() => {
    if (!d) return null;
    const plans = [...(d.myPlan ? [d.myPlan] : []), ...d.plans];
    if (plans.length === 0) return null;
    return plans.sort(
      (a, b) =>
        timestamp(b.scheduledFor ?? b.createdAt) -
        timestamp(a.scheduledFor ?? a.createdAt),
    )[0];
  }, [d]);

  const headline = useMemo(() => {
    if (freshestLive) {
      return cs.friends.nudgeLive(
        friendDisplayName(freshestLive.account),
        freshestLive.name,
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
  }, [d?.myActiveActivity, freshestLive, freshestPlan]);

  const rankLine = useMemo(() => {
    if (d?.settings.ghostMode) return cs.friends.hiddenRank;
    const rank = weeklyBoard?.me.rank;
    if (rank == null) return null;
    return `${cs.leaderboards.teaserTitleBefore}${cs.leaderboards.teaserTitleRank(rank)}${cs.leaderboards.teaserTitleAfter}`;
  }, [d?.settings.ghostMode, weeklyBoard?.me.rank]);

  const unansweredLive = useMemo(
    () => d?.activeFriends.find((activity) => activity.myResponse == null) ?? null,
    [d?.activeFriends],
  );

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
    if (unansweredLive) {
      return {
        kind: 'rapid',
        text: cs.friends.nudgeLive(
          friendDisplayName(unansweredLive.account),
          unansweredLive.name,
        ),
        confirmLabel: cs.friends.nudgeLiveJoin,
        onConfirm: () => respondGoing(unansweredLive),
      };
    }
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
    if (streakAtRisk) {
      return {
        kind: 'dopito',
        label: cs.friends.nudgeStreakRisk,
        onPress: () => setComposeVisible(true),
      };
    }
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
    respondGoing,
    router,
    streakAtRisk,
    unansweredLive,
  ]);

  const cta = useMemo(() => {
    if (!isSignedIn) {
      return {
        label: cs.friends.ctaSignIn,
        subLabel: null as string | null,
        onPress: () => router.push('/auth' as Href),
      };
    }
    if (nickname == null) {
      return {
        label: cs.friends.ctaNickname,
        subLabel: null as string | null,
        onPress: () => router.push('/profile/edit' as Href),
      };
    }
    if (friendCount === 0) {
      return {
        label: cs.friends.ctaAddFriend,
        subLabel: cs.friends.ctaAddFriendSub,
        onPress: () => setAddFriendVisible(true),
      };
    }
    if (d?.myActiveActivity) {
      return {
        label: cs.friends.ctaWhoIsComing,
        subLabel: null as string | null,
        onPress: () => setRosterVisible(true),
      };
    }
    if ((d?.activeFriends.length ?? 0) > 0) {
      return {
        label: cs.friends.ctaPingToo,
        subLabel: null as string | null,
        onPress: () => setComposeVisible(true),
      };
    }
    return {
      label: cs.friends.ctaPing,
      subLabel: cs.friends.ctaPingSub,
      onPress: () => setComposeVisible(true),
    };
  }, [d?.activeFriends.length, d?.myActiveActivity, friendCount, isSignedIn, nickname, router]);

  const onRequestsLayout = useCallback((event: LayoutChangeEvent) => {
    requestsYRef.current = event.nativeEvent.layout.y;
  }, []);
  const onActiveLayout = useCallback((event: LayoutChangeEvent) => {
    activeYRef.current = event.nativeEvent.layout.y;
  }, []);

  const renderNotificationRow = useCallback(
    (notification: FriendNotification) => {
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
          first
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
    },
    [handleFeedPress, reload],
  );

  const renderBeerFeedRow = useCallback(
    (item: BeerFeedItem) => {
      const checkIn = item.checkIns[0];
      if (!checkIn) return null;
      const when = timeLabel(checkIn.checkedInAt);
      const ownerName = friendDisplayName(checkIn.account);
      const totalQuantity = item.checkIns.reduce(
        (sum, row) => sum + Math.max(1, Math.floor(row.quantity || 1)),
        0,
      );
      const totalPrice = item.checkIns.reduce(
        (sum, row) =>
          sum +
          (row.priceCzk != null
            ? row.priceCzk * Math.max(1, Math.floor(row.quantity || 1))
            : 0),
        0,
      );
      const hasAnyPrice = item.checkIns.some((row) => row.priceCzk != null);
      const beerNames = item.checkIns
        .map((row) => {
          const quantity = Math.max(1, Math.floor(row.quantity || 1));
          return quantity > 1 ? `${quantity}× ${row.beerName}` : row.beerName;
        })
        .join(', ');
      const amount = [
        totalQuantity > 1 ? `${totalQuantity}×` : '',
        hasAnyPrice ? formatPrice(totalPrice, priceCurrency) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const meta = [
        amount,
        item.checkIns.length === 1 && checkIn.rating != null
          ? `${checkIn.rating.toFixed(1)} / 5`
          : '',
        checkIn.pubName,
        when,
      ]
        .filter(Boolean)
        .join(' · ');

      return (
        <HairlineRow
          first
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
              <Text
                style={styles.feedTitle}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {item.checkIns.length > 1
                  ? `${ownerName} zapsal ${totalQuantity} piv`
                  : `${ownerName} pije ${checkIn.beerName}`}
              </Text>
              {item.checkIns.length > 1 ? (
                <Text
                  style={styles.feedBody}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {beerNames}
                </Text>
              ) : null}
              {meta ? (
                <Text
                  style={styles.feedBody}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {meta}
                </Text>
              ) : null}
              {checkIn.note ? (
                <Text
                  style={styles.feedNote}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {checkIn.note}
                </Text>
              ) : null}
              {item.checkIns.length === 1 && checkIn.tags.length > 0 ? (
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
    },
    [priceCurrency, reload, router],
  );

  const renderRequestRow = useCallback(
    (request: Friendship) => (
      <HairlineRow first>
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

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
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
          onPress={() => setMoreVisible(true)}
          style={({ pressed }) => [styles.moreButton, pressed && styles.dim]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.partaMore}
        >
          <EllipsisIcon size={20} color={Colors.mutedText} />
        </Pressable>
      </View>

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
        <View style={streamItems.length === 0 ? styles.cardGrow : undefined}>
          <PartyCard
            count={partyNumbers.count}
            countLabel={
              partyNumbers.count > 0
                ? cs.friends.tableCaption
                : cs.friends.tableCaptionQuiet
            }
            headline={headline}
            factStrong={
              (d?.streak.currentWeeks ?? 0) > 0
                ? cs.friends.streakWeeks(d?.streak.currentWeeks ?? 0)
                : cs.friends.noStreak
            }
            factMuted={rankLine}
            linkLabel={
              partyNumbers.count > 0 || partyNumbers.maybe > 0
                ? cs.friends.tableLink
                : null
            }
            going={partyNumbers.going}
            maybe={partyNumbers.maybe}
            mine={partyNumbers.mine}
            onPress={
              partyNumbers.count > 0 || partyNumbers.maybe > 0
                ? () => setRosterVisible(true)
                : null
            }
            accessibilityLabel={cs.a11y.partaCard(String(partyNumbers.count), headline)}
          />
        </View>

        <Text style={styles.streamHeader} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.friends.streamHeader}
        </Text>

        <PartaPhotoStrip refreshKey={photoFeedKey} style={styles.photoStreamItem} />

        {streamItems.length > 0 ? (
          <View style={styles.stream}>
            {streamItems.map((item) => {
              if (item.kind === 'plan') {
                return (
                  <PlanCard
                    key={item.key}
                    activity={item.activity}
                    mine={item.mine}
                    onResponded={reload}
                    onCanceled={reload}
                  />
                );
              }
              if (item.kind === 'live') {
                return (
                  <View
                    key={item.key}
                    onLayout={item.key === firstLiveStreamKey ? onActiveLayout : undefined}
                  >
                    <FriendActiveCard
                      activity={item.activity}
                      onResponded={reload}
                      stale={loadError}
                    />
                  </View>
                );
              }
              if (item.kind === 'beer') {
                return (
                  <View key={item.key} style={styles.streamRowCard}>
                    {renderBeerFeedRow(item.item)}
                  </View>
                );
              }
              if (item.kind === 'notification') {
                return (
                  <View key={item.key} style={styles.streamRowCard}>
                    {renderNotificationRow(item.notification)}
                  </View>
                );
              }
              if (item.kind === 'request') {
                return (
                  <View
                    key={item.key}
                    style={styles.streamRowCard}
                    onLayout={item.key === firstRequestStreamKey ? onRequestsLayout : undefined}
                  >
                    {renderRequestRow(item.request)}
                  </View>
                );
              }
              return (
                <View key={item.key} style={styles.streamRowCard}>
                  <FriendListRow
                    friend={item.friend}
                    stats={item.stats}
                    first
                    onOpenProfile={openFriendProfile}
                    onLongPress={openFriendSafety}
                  />
                </View>
              );
            })}
          </View>
        ) : loading && !d ? null : (
          <Text style={styles.streamEmpty} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.streamEmpty}
          </Text>
        )}
      </ScrollView>

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={cta.label}
        subLabel={cta.subLabel}
        onPress={cta.onPress}
        accessibilityLabel={cta.label}
      />

      {friendCount > 0 ? (
        <CounterSecondary
          label={cs.friends.secondaryAddFriend}
          onPress={() => setAddFriendVisible(true)}
        />
      ) : null}

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
  header: {
    minHeight: 44,
    marginBottom: 8,
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
    fontFamily: Fonts.display.extrabold,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  cardGrow: {
    flex: 1,
  },
  streamHeader: {
    marginTop: 24,
    marginBottom: 8,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  stream: {
    gap: 12,
  },
  streamEmpty: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  photoStreamItem: {
    marginBottom: 12,
  },
  streamRowCard: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 16,
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
  feedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  feedIconDisk: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
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
    includeFontPadding: false,
  },
  feedTime: {
    flexShrink: 0,
    fontFamily: Fonts.ui.medium,
    color: Colors.mutedText,
    fontSize: 11,
    includeFontPadding: false,
  },
  feedBody: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    color: Colors.foamMuted,
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
  },
  feedNote: {
    marginTop: 4,
    fontFamily: Fonts.ui.medium,
    color: Colors.foam,
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
  },
  feedTags: {
    marginTop: 8,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  sheetCardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  sheetCard: {
    flex: 1,
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
    fontFamily: Fonts.display.extrabold,
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
    flex: 1,
    marginTop: Spacing.sm,
  },
  sheetListContent: {
    gap: 12,
    paddingBottom: Spacing.sm,
  },
  sheetEmpty: {
    paddingVertical: 24,
    fontFamily: Fonts.ui.medium,
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
});
