import {
  Stack,
  useGlobalSearchParams,
  useRouter,
  usePathname,
  type Href,
} from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fontAssets } from '@/theme/fonts';
import { Colors } from '@/theme/colors';
import { t } from '@/i18n';
import { flushPubReportQueue } from '@/data/pubReportQueue';
import { flushPubNameCorrectionsQueue } from '@/data/pubNameCorrectionsQueue';
import { flushFeedbackQueue } from '@/data/feedbackQueue';
import { flushAccountPreferencesQueue } from '@/data/accountPreferencesQueue';
import { flushCommunityQueue } from '@/data/communityQueue';
import {
  flushAddedPubsQueue,
  restoreQueuedAddedPubs,
  syncOwnAddedPubs,
} from '@/data/addedPubsQueue';
import { flushDrinksQueue } from '@/data/drinksQueue';
import { flushDeleteDrinksQueue } from '@/data/deleteDrinksQueue';
import { flushUpdateDrinksQueue } from '@/data/updateDrinksQueue';
import { installPubRatingsSync, restorePubRatings } from '@/data/pubRatingsSync';
import { installPubAmenitiesSync, restorePubAmenities } from '@/data/pubAmenitiesSync';
import { installPrivatePubDataRestores } from '@/data/privatePubDataRestore';
import { flushVisitsQueue } from '@/data/visitsQueue';
import { flushFriendsQueue } from '@/data/friendsQueue';
import { fetchFriendsLive } from '@/data/friendsClient';
import {
  peekPendingInviteCode,
  stashPendingInviteCode,
} from '@/data/friendInviteLink';
import { flushBeerCheckinsQueue } from '@/data/beerCheckinsQueue';
import { flushNightsQueue } from '@/data/nightsQueue';
import { flushPartyGameStartsQueue } from '@/data/partyGameStartsQueue';
import { flushPartyEveningActionsQueue } from '@/data/partyEveningActionsQueue';
import { flushPartyGamesQueue } from '@/data/partyGamesQueue';
import { flushBeerPhotosQueue } from '@/data/beerPhotosQueue';
import { PrivateAccountMutationFrozenError } from '@/data/privateAccountBoundary';
import { seedDrinksFromHistory } from '@/data/drinksHistorySync';
import { seedVisitsFromHistory } from '@/data/visitsSync';
import {
  installClientTelemetry,
  setTelemetrySession,
  trackClientEvent,
} from '@/data/telemetryClient';
import {
  productScreenFromPathname,
  trackScreenViewed,
  type ProductScreenName,
} from '@/data/productTelemetry';
import { flushWalkingDistance } from '@/data/walkingTelemetry';
import { getCachedAuthenticationState } from '@/data/account';
import {
  getProcessInitialNotificationNavigationTicket,
  getProcessInviteNavigationCoordinator,
} from '@/data/inviteNavigation';
import {
  shouldShowOnboardingForPath,
  isStartupFlushOwnedByAccountInitialization,
  runAfterAccountInitialization,
} from '@/data/startupRouting';
import { useAccountStore, selectIsSignedIn } from '@/stores/accountStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { usePubStore } from '@/stores/pubStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useTallyStore } from '@/stores/tallyStore';
import { hasLiveFriendSignal, usePartaSignalStore } from '@/stores/partaSignalStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import {
  cancelPendingPartyRecapNavigation,
  completePendingPartyRecapNavigation,
} from '@/party/partyRouting';
import { ensureFriendPushRegisteredIfGranted } from '@/notifications/friendPush';
import { refreshCurrencyFromLastKnownLocation } from '@/location/locationCurrency';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { ContestResultsModal } from '@/photos/ContestResultsModal';
import { PubReminderOnboardingModal } from '@/components/shared/PubReminderOnboardingModal';
import { NicknameNudgeModal } from '@/components/shared/NicknameNudgeModal';
import { PubReminderEnableFailureModal } from '@/components/shared/PubReminderEnableFailureModal';
import { AppDialogHost } from '@/components/shared/AppDialog';
import { UgcConsentGate } from '@/account/UgcConsentGate';
import { AppReviewPromptGate } from '@/reviews/AppReviewPromptGate';
import { Toast } from '@/components/shared/Toast';
import {
  cancelPendingPubReminder,
  consumeInitialPubReminderTap,
  initializePubReminderNotifications,
  refreshPubReminderGeofences,
  subscribeFriendPushReceived,
  subscribePubReminderTap,
  type FriendTapPayload,
} from '@/notifications/pubReminderNotifications';
import { friendPushDestination } from '@/notifications/friendPushDestination';
import {
  consumeInitialBeerCountReminderTap,
  initializeBeerCountReminderNotifications,
  subscribeBeerCountReminderTap,
} from '@/notifications/beerCountReminder';
import {
  initializeLiveBeerActivity,
  reconcileLiveBeerActivityAndAutoArchive,
} from '@/liveActivity/liveBeerActivity';
import { installBackendLocaleHeader } from '@/data/localeHeader';

// Every backend request carries Accept-Language from the first render on.
installBackendLocaleHeader();

/**
 * One-time gate: when the onboarding store resolves 'show' (fresh install or
 * signed-out existing install, never completed), replace the stack root with
 * the welcome pager. Stays out of the way of a Parta invite deep link — the
 * invite screen wins, and the decision stays 'show' so the gate fires once the
 * invite closes.
 */
function OnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const decision = useOnboardingStore((s) => s.decision);

  useEffect(() => {
    if (
      decision === 'show' &&
      shouldShowOnboardingForPath(pathname)
    ) {
      router.replace('/onboarding' as Href);
    }
  }, [decision, pathname, router]);

  return null;
}

/**
 * Tracks coarse screen usage after account hydration. Dynamic route parameters
 * never leave the device; productTelemetry collapses them to fixed names first.
 */
function ProductTelemetryTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const previousPathnameRef = useRef<string | null>(null);
  const previousScreenRef = useRef<ProductScreenName | undefined>(undefined);

  useEffect(() => {
    if (!enabled || previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;

    const screen = productScreenFromPathname(pathname);
    if (!screen) return;
    trackScreenViewed(screen, previousScreenRef.current);
    previousScreenRef.current = screen;
  }, [enabled, pathname]);

  return null;
}

/**
 * Seed the Parta tab badge once on launch with a single cheap live fetch, so
 * pending requests / live friends surface before the user first opens Parta (§D1).
 * Only for signed-in accounts (anonymous devices have no social graph); silent on
 * failure. No polling — the bounded poll stays inside FriendsScreen.
 */
function seedPartaBadge(): void {
  if (!selectIsSignedIn(useAccountStore.getState())) return;
  void fetchFriendsLive().then((slice) => {
    if (!slice) return;
    usePartaSignalStore.getState().setSignal({
      pendingRequests: slice.incomingCount,
      unread: slice.unreadCount,
      liveNow: hasLiveFriendSignal(slice),
    });
  });
}

function ignoreExpectedPrivateAccountFreeze(error: unknown): void {
  if (!(error instanceof PrivateAccountMutationFrozenError)) throw error;
}

function restoreAndFlushAddedPubsQueue(): void {
  void restoreQueuedAddedPubs()
    .then((restoredCount) => {
      if (restoredCount > 0) {
        usePubStore.getState().bumpCatalogRevision();
      }
      return flushAddedPubsQueue()
        .then(() => syncOwnAddedPubs())
        .then(() => restoredCount);
    })
    .then((restoredCount) => {
      if (restoredCount > 0) {
        usePubStore.getState().bumpCatalogRevision();
      }
    })
    .catch(ignoreExpectedPrivateAccountFreeze);
}

SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore — splash may already be hidden
});

// Kick the first-run decision off at module scope, BEFORE any component
// mounts: launch effects write persisted stores within the first frames
// (tally auto-archive, currency restore, queue flushes), and decide()'s
// existing-install key sniff must enqueue its AsyncStorage reads ahead of
// those writes or a fresh install gets misread as an upgrade.
const onboardingDecisionPromise = useOnboardingStore
  .getState()
  .decide(getCachedAuthenticationState);

function StartupBoundaryRecovery({
  loading,
  onRetry,
}: {
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <GestureHandlerRootView style={styles.startupRecoveryRoot}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.startupRecoveryContent}>
          <Text style={styles.startupRecoveryTitle}>{t.startup.lockedTitle}</Text>
          <Text style={styles.startupRecoveryBody}>{t.startup.lockedBody}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onRetry}
            style={({ pressed }) => [
              styles.startupRecoveryButton,
              pressed && !loading && styles.startupRecoveryButtonPressed,
            ]}
          >
            {loading ? (
              <ActivityIndicator color={Colors.stout} />
            ) : (
              <Text style={styles.startupRecoveryButtonText}>{t.startup.lockedRetry}</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{
    code?: string | string[];
    joinCode?: string | string[];
    invite?: string | string[];
  }>();
  const routeInviteCode = pathname === '/parta/pozvanka'
    ? (Array.isArray(routeParams.code) ? routeParams.code[0] : routeParams.code)?.trim() || null
    : null;
  const partyInviteRequest = Boolean(
    pathname === '/party-live' && routeParams.joinCode && routeParams.invite,
  );
  const pathnameRef = useRef(pathname);
  // Arbitrates a canonical explicit route against a persisted-code restore.
  // Expo Router has already navigated by the time this coordinator sees it;
  // this owner only decides whether startup may restore another code.
  const inviteNavigationRef = useRef(getProcessInviteNavigationCoordinator());
  const initialNotificationNavigationTicketRef = useRef(
    getProcessInitialNotificationNavigationTicket(),
  );
  const inviteRouteWasVisibleRef = useRef(false);
  // Startup effects must run once, so late navigation reads the router via ref.
  const routerRef = useRef(router);
  const [telemetryReady, setTelemetryReady] = useState(false);
  const startupBoundaryReady = useAccountStore((state) => state.startupBoundaryReady);
  const accountStatus = useAccountStore((state) => state.status);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const previousAccountIdRef = useRef(accountId);
  const [startupRecoveryRetrying, setStartupRecoveryRetrying] = useState(false);
  const showStartupRecovery =
    !startupBoundaryReady && (accountStatus === 'error' || startupRecoveryRetrying);
  const startupRetryAttemptRef = useRef(0);
  const retryStartupBoundary = useCallback(() => {
    if (useAccountStore.getState().status === 'loading') return;
    setStartupRecoveryRetrying(true);
    void useAccountStore.getState().initAccount().finally(() => {
      setStartupRecoveryRetrying(false);
    });
  }, []);

  useEffect(() => {
    if (startupBoundaryReady) {
      startupRetryAttemptRef.current = 0;
    }
  }, [startupBoundaryReady]);

  useEffect(() => {
    if (!showStartupRecovery || startupBoundaryReady || accountStatus === 'loading') return;
    const delayMs = Math.min(1_000 * (2 ** startupRetryAttemptRef.current), 15_000);
    startupRetryAttemptRef.current += 1;
    const timer = setTimeout(retryStartupBoundary, delayMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retryStartupBoundary();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [accountStatus, retryStartupBoundary, showStartupRecovery, startupBoundaryReady]);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  // Expo Router is the sole URL consumer. The canonical route only records
  // ownership and stashes the code for account hydration; it never performs a
  // second push/replace behind the router's navigation.
  useEffect(() => {
    if (routeInviteCode) {
      inviteRouteWasVisibleRef.current = true;
      cancelPendingPartyRecapNavigation();
      inviteNavigationRef.current.handleExplicitInviteCode(routeInviteCode);
      void stashPendingInviteCode(routeInviteCode);
      return;
    }
    if (partyInviteRequest) {
      inviteRouteWasVisibleRef.current = true;
      cancelPendingPartyRecapNavigation();
      // Native intent records this before routing; recording the canonical
      // route too also covers direct/router and future push entry points.
      inviteNavigationRef.current.handleExplicitEntry('party:canonical-route');
      return;
    }
    // A native intent may be recorded before Expo commits its canonical route.
    // Do not release that process owner from an intermediate startup pathname;
    // release only after a confirmed invite route was actually visible.
    if (!inviteRouteWasVisibleRef.current) return;
    inviteRouteWasVisibleRef.current = false;
    inviteNavigationRef.current.leaveConfirmation();
  }, [partyInviteRequest, routeInviteCode]);
  useEffect(() => {
    completePendingPartyRecapNavigation(router, pathname);
  }, [pathname, router]);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  useEffect(() => {
    if (previousAccountIdRef.current !== accountId) {
      cancelPendingPartyRecapNavigation();
      previousAccountIdRef.current = accountId;
    }
  }, [accountId]);
  // Hold the splash until the first-run decision resolves too, so a fresh
  // install fades straight into the onboarding instead of flashing the compass.
  const onboardingDecision = useOnboardingStore((s) => s.decision);
  const onboardingDecided = onboardingDecision !== 'pending';

  useEffect(() => {
    if (
      (fontsLoaded || fontError) &&
      onboardingDecided &&
      (startupBoundaryReady || showStartupRecovery)
    ) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, onboardingDecided, showStartupRecovery, startupBoundaryReady]);

  useEffect(() => {
    installClientTelemetry();
    void refreshCurrencyFromLastKnownLocation();
  }, []);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    void initializePubReminderNotifications();
    void initializeBeerCountReminderNotifications();
  }, [startupBoundaryReady]);

  useEffect(() => installPrivatePubDataRestores(), []);

  const commitCounterNavigation = useCallback(() => {
    cancelPendingPartyRecapNavigation();
    routerRef.current.push('/beer' as Href);
  }, []);

  const claimInitialNotificationNavigation = useCallback((intentKey: string) =>
    inviteNavigationRef.current.reserveExplicitEntry(
      initialNotificationNavigationTicketRef.current,
      intentKey,
    ), []);

  const prepareWarmNotificationNavigation = useCallback((intentKey: string) =>
    inviteNavigationRef.current.prepareExplicitEntry(intentKey), []);

  const commitFriendsNavigation = useCallback((payload: FriendTapPayload) => {
    cancelPendingPartyRecapNavigation();
    usePartaSignalStore.getState().requestRefresh(payload);
    routerRef.current.push(friendPushDestination(payload) as Href);
  }, []);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    // Tapping a "nejsi v hospodě?" reminder jumps straight to the beer counter.
    // Handle both a running app (listener) and a cold start from the tap.
    if (fontsLoaded || fontError) {
      void consumeInitialBeerCountReminderTap(
        commitCounterNavigation,
        (notificationId) => claimInitialNotificationNavigation(
          `notification:${notificationId}`,
        ),
      );
    }
    const pubSubscription = subscribePubReminderTap(
      commitCounterNavigation,
      commitFriendsNavigation,
      {
        claimPubReminder: (notificationId) => prepareWarmNotificationNavigation(
          `notification:${notificationId ?? `counter-${Date.now()}`}`,
        ),
        claimFriend: (payload) => prepareWarmNotificationNavigation(
          `notification:${payload.notificationId ?? `friend-${Date.now()}`}`,
        ),
      },
    );
    const beerCountSubscription = subscribeBeerCountReminderTap(
      commitCounterNavigation,
      (notificationId) => prepareWarmNotificationNavigation(
        `notification:${notificationId}`,
      ),
    );
    return () => {
      pubSubscription.remove();
      beerCountSubscription.remove();
    };
  }, [
    claimInitialNotificationNavigation,
    commitCounterNavigation,
    commitFriendsNavigation,
    fontError,
    fontsLoaded,
    prepareWarmNotificationNavigation,
    startupBoundaryReady,
  ]);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    let hadActiveCounterSession = (useTallyStore.getState().current?.drinks.length ?? 0) > 0;
    if (hadActiveCounterSession) void cancelPendingPubReminder();

    return useTallyStore.subscribe((state) => {
      const hasActiveCounterSession = (state.current?.drinks.length ?? 0) > 0;
      if (hasActiveCounterSession && !hadActiveCounterSession) {
        void cancelPendingPubReminder();
      }
      hadActiveCounterSession = hasActiveCounterSession;
    });
  }, [startupBoundaryReady]);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    // A friend push received while the app is foregrounded (on any tab) nudges the
    // Parta badge, so it reacts without waiting for a background→foreground cycle
    // or a Parta focus (§D1). Request/accept pushes also reload an already-visible
    // Parta screen; the next dashboard/live fetch reconciles the counts.
    const subscription = subscribeFriendPushReceived((kind) => {
      const signal = usePartaSignalStore.getState();
      signal.bumpFromPush(kind);
      if (kind === 'friend_request' || kind === 'friend_accepted') {
        signal.requestRefresh();
      }
    });
    return () => subscription.remove();
  }, [startupBoundaryReady]);

  useEffect(() => {
    // Fire-and-forget: ensure an anonymous device account exists. Non-blocking.
    // Once the attempt settles, telemetry can include the bearer auth header so
    // usage counters attach to the anonymous account when possible.
    const accountInitialization = useAccountStore.getState().initAccount();
    void runAfterAccountInitialization(accountInitialization, async () => {
      if (!useAccountStore.getState().startupBoundaryReady) return;
      // Resolve the cold notification before considering a persisted friend
      // invite. Its process-level owner is recorded synchronously before the
      // push route, so an older stashed confirmation can never cover it.
      await consumeInitialPubReminderTap(
        commitCounterNavigation,
        commitFriendsNavigation,
        {
          claimPubReminder: (notificationId) => claimInitialNotificationNavigation(
            `notification:${notificationId ?? `counter-${Date.now()}`}`,
          ),
          claimFriend: (payload) => claimInitialNotificationNavigation(
            `notification:${payload.notificationId ?? `friend-${Date.now()}`}`,
          ),
        },
      );
      // Restore owner-scoped Party identity only after crash-lost account
      // deletion has been resolved and the safe session is published.
      await usePartyEveningStore.getState().restore();
      const session = useAccountStore.getState().session;
      setTelemetrySession(session);
      setTelemetryReady(true);
      // Account hydration may restore the legacy CZK/EUR preference after the
      // launch-time location check, so let the cached country win once more.
      void refreshCurrencyFromLastKnownLocation();
      void trackClientEvent({ event: 'app_open', severity: 'info' });
      // A code stashed before the account existed waits for explicit consent:
      // restore its confirmation screen instead of claiming behind the user's
      // back. The restore ticket is claimed before the peek resolves so any
      // explicit deep link landing meanwhile wins the race; the coordinator
      // also prevents double navigation against the canonical route owner.
      const restoreTicket = inviteNavigationRef.current.beginRestoreLookup();
      void peekPendingInviteCode().then((pendingCode) => {
        const decision = inviteNavigationRef.current.resolveRestoreLookup(
          restoreTicket,
          pendingCode,
        );
        if (decision.action !== 'none' && decision.code) {
          routerRef.current.push(`/parta/pozvanka?code=${encodeURIComponent(decision.code)}` as Href);
        }
      });
      // Light up the Parta tab badge without waiting for the first Parta visit.
      seedPartaBadge();
      // Existing installs may hold local diary drinks from before /v1/drinks
      // sync existed. Seed only after account initialization has settled so
      // the private history cannot race a session rotation.
      void seedDrinksFromHistory();
      // Refresh first hydrates the tiny account-scoped table identity, then
      // asks the server. Do that before reconciling a lock-screen +1 so a cold
      // offline launch cannot silently turn a table beer into a private one.
      await flushPartyEveningActionsQueue();
      void flushNightsQueue();
      void flushPartyGamesQueue();
      void flushPartyGameStartsQueue();
      await usePartyEveningStore.getState().refresh();
      await initializeLiveBeerActivity();
    });
  }, [
    claimInitialNotificationNavigation,
    commitCounterNavigation,
    commitFriendsNavigation,
  ]);

  useEffect(() => {
    // First-run decision (kicked off at module scope) MUST resolve before the
    // release check: on a fresh install checkForUpdate() writes the
    // `na-pivo-release` baseline, one of the keys decide() reads to tell a
    // fresh install from an upgrade. Then, fire-and-forget: after an app
    // update, surface the "what's new" popup. Waits for persisted state
    // internally and never throws — a miss just retries next launch.
    void onboardingDecisionPromise.finally(() => {
      void useReleaseStore.getState().checkForUpdate();
    });
  }, []);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    // Install the personal-rating push subscriber once for the process lifetime:
    // it diffs every store change into a queued upsert/delete. Kept separate from
    // the flush effect so it is set up exactly once.
    const unsubscribeRatings = installPubRatingsSync();
    return unsubscribeRatings;
  }, [startupBoundaryReady]);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    // Install the "Zmapuj hospodu" amenity-vote push subscriber once for the
    // process lifetime, mirroring the ratings subscriber: it diffs every store
    // change into a queued per-amenity upsert/delete tombstone.
    const unsubscribeAmenities = installPubAmenitiesSync();
    return unsubscribeAmenities;
  }, [startupBoundaryReady]);

  useEffect(() => {
    if (!startupBoundaryReady) return;
    // Fire-and-forget: re-send pub reports and feedback whose first delivery
    // failed. Runs on launch and whenever the app returns to the foreground;
    // never throws.
    void flushPubReportQueue();
    void flushPubNameCorrectionsQueue();
    void flushFeedbackQueue();
    void flushAccountPreferencesQueue();
    void flushCommunityQueue();
    restoreAndFlushAddedPubsQueue();
    if (!isStartupFlushOwnedByAccountInitialization('drinks')) void flushDrinksQueue();
    void flushDeleteDrinksQueue();
    void flushUpdateDrinksQueue();
    // Personal ratings and amenity votes have an account-aware launch/thaw
    // coordinator above. Visits still seed once here, then flush.
    void seedVisitsFromHistory();
    if (!isStartupFlushOwnedByAccountInitialization('visits')) void flushVisitsQueue();
    // Parta: retry queued RSVP/cinknutí/reactions, and light up push for
    // existing notification-permission grantees without a prompt (Parta 3.0).
    void flushFriendsQueue();
    void flushBeerCheckinsQueue();
    void flushBeerPhotosQueue();
    // Výčep: retry queued night publishes/unpublishes and round reactions.
    if (!isStartupFlushOwnedByAccountInitialization('nights')) void flushNightsQueue();
    if (!isStartupFlushOwnedByAccountInitialization('party-games')) void flushPartyGamesQueue();
    if (!isStartupFlushOwnedByAccountInitialization('party-game-starts')) {
      void flushPartyGameStartsQueue();
    }
    void ensureFriendPushRegisteredIfGranted();
    // Live Activity initialization and every foreground/focus sweep reconcile
    // lock-screen additions before applying the tally's idle cutoff.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Rehydrate credentials that were temporarily unavailable, then validate
        // a signed-in session. Only a real 401 opens the recovery screen; an
        // offline/server failure keeps the previous state intact.
        void useAccountStore.getState().resumeSession().then(async (result) => {
          if (result === 'invalid') {
            if (!pathnameRef.current.startsWith('/auth')) router.push('/auth' as Href);
            return;
          }
          void flushAccountPreferencesQueue();
          // Retry a deferred history seed only after resume has settled.
          void seedDrinksFromHistory();
          // A table may have been joined, left, or ended on another device.
          // Refresh it before consuming any native counter actions.
          await flushPartyEveningActionsQueue();
          void flushNightsQueue();
          void flushPartyGamesQueue();
          void flushPartyGameStartsQueue();
          await usePartyEveningStore.getState().refresh();
          await reconcileLiveBeerActivityAndAutoArchive();
        });
        void trackClientEvent({ event: 'app_foreground', severity: 'info' });
        void flushPubReportQueue();
        void flushPubNameCorrectionsQueue();
        void flushFeedbackQueue();
        void flushCommunityQueue();
        restoreAndFlushAddedPubsQueue();
        void flushDrinksQueue();
        void flushDeleteDrinksQueue();
        void flushUpdateDrinksQueue();
        void restorePubRatings().catch(ignoreExpectedPrivateAccountFreeze);
        void restorePubAmenities().catch(ignoreExpectedPrivateAccountFreeze);
        void flushVisitsQueue();
        void flushFriendsQueue();
        void flushBeerCheckinsQueue();
        void flushBeerPhotosQueue();
        // Nights + party-games queues are flushed in the resumeSession chain
        // above, after the evening-actions queue — the ordering that launch
        // uses. Flushing them here too ran every one of them twice per
        // foreground.
        void useAccountStore.getState().refreshDiarySnapshot();
        // Re-seed pub geofences for wherever the user is now (no-op when the
        // feature is off; cheap unless they moved a few km since last fetch).
        if ((useTallyStore.getState().current?.drinks.length ?? 0) > 0) {
          void cancelPendingPubReminder();
        }
        void refreshPubReminderGeofences();
      } else {
        flushWalkingDistance();
      }
    });
    // Pulling down Android's notification drawer does not change AppState; it
    // emits blur/focus instead. Reconcile the native action as soon as the user
    // returns so its counter and selected beer cannot drift from the diary.
    const focusSubscription =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            void flushPartyEveningActionsQueue()
              .then(() => usePartyEveningStore.getState().refresh())
              .then(() => reconcileLiveBeerActivityAndAutoArchive());
          })
        : null;
    return () => {
      flushWalkingDistance();
      subscription.remove();
      focusSubscription?.remove();
    };
  }, [router, startupBoundaryReady]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  if (showStartupRecovery && !startupBoundaryReady) {
    return (
      <StartupBoundaryRecovery
        loading={accountStatus === 'loading' || startupRecoveryRetrying}
        onRetry={retryStartupBoundary}
      />
    );
  }

  if (!startupBoundaryReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.stout }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.stout },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          {/* Starting a night slides UP and the chevron sends it back DOWN —
              the Strava "Record" idiom. It is a modal rather than a tab page
              precisely so the dismissal is the same gesture reversed, instead
              of a hard jump to another tab. */}
          <Stack.Screen
            name="party-live"
            options={{
              // A modal presentation cannot reliably push the game and finish
              // cards above itself on iOS. Keep the same vertical motion while
              // using a regular stack card, so every action remains reachable.
              presentation: 'card',
              animation: 'slide_from_bottom',
            }}
          />
          {/* Search is a MODE, not a page: it takes the whole screen, keeps its
              own Zrušit, and slides up so dismissing it is the reverse gesture.
              Under the tab bar it would have been a fourth thing competing with
              the tabs for the same job. */}
          <Stack.Screen
            name="search"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          {/* A game is passed around the table, so it takes the whole screen —
              a tab bar under a phone in someone else's hand is a mis-tap. It
              pushes from the right because you came from the hub and go back to
              it, unlike the night itself which slides up out of nowhere. */}
          {/* Choosing where the night is happening. It is the Hospody screen —
              the map, the filters, the detail with "Vybrat tuhle hospodu" — but
              presented OVER the running night rather than by jumping to another
              tab. Leaving the hub to answer a question about the hub made the
              evening feel like something you had walked away from. */}
          <Stack.Screen
            name="pick-pub"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          {/* Somebody else's profile. Pushed from the right, not raised as a
              modal: you got here by tapping a face in a feed or a thread and you
              are coming straight back to it. */}
          <Stack.Screen name="user" options={{ animation: 'ios_from_right' }} />
          <Stack.Screen name="night/[id]" options={{ animation: 'ios_from_right' }} />
          <Stack.Screen
            name="party-game"
            options={{ presentation: 'card', animation: 'ios_from_right' }}
          />
          {/* Saving the night: pushed over the hub so backing out returns you to
              an evening that is still running. Only "Zveřejnit" ends it. */}
          <Stack.Screen
            name="party-finish"
            options={{
              presentation: 'card',
              animation: 'ios_from_right',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="onboarding"
            options={{
              presentation: 'fullScreenModal',
              animation: 'fade',
              // One-way door: finish or skip, never swipe away.
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="settings"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="home-point"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_right',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="celebration"
            options={{
              presentation: 'fullScreenModal',
              animation: 'fade',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="about"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="privacy"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="report"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="contribute"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="add-pub"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="suggest-pub-event"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="evening"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="beer-detail"
            options={{
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="vycep"
            options={{
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="auth/index"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="auth/reset"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="auth/verify"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="account"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="profile/privacy"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="profile/edit"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="profile/parta"
            options={{
              // A back-navigable "place" (party management), pushed like a detail
              // screen with the native right-edge back-swipe.
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="profile/badges"
            options={{
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="profile/photos"
            options={{
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="leaderboards"
            options={{
              // Global leaderboards — a back-navigable "place" like /profile/parta.
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="parta/pozvanka"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="parta/[id]"
            options={{
              // A back-navigable "place" (friend profile), pushed like a detail
              // screen with the native right-edge back-swipe.
              animation: 'slide_from_right',
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="photo/[key]"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="photo-contest"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
        </Stack>
        <OnboardingGate />
        <WhatsNewModal />
        <ContestResultsModal />
        <PubReminderOnboardingModal />
        <NicknameNudgeModal />
        <PubReminderEnableFailureModal />
        <UgcConsentGate />
        <AppDialogHost />
        <AppReviewPromptGate />
        <ProductTelemetryTracker
          enabled={
            telemetryReady &&
            onboardingDecided &&
            !(onboardingDecision === 'show' && pathname !== '/onboarding')
          }
        />
        <Toast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  startupRecoveryRoot: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  startupRecoveryContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  startupRecoveryTitle: {
    color: Colors.foam,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  startupRecoveryBody: {
    color: Colors.foamMuted,
    fontSize: 16,
    lineHeight: 23,
  },
  startupRecoveryButton: {
    minHeight: 52,
    marginTop: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  startupRecoveryButtonPressed: {
    opacity: 0.82,
  },
  startupRecoveryButtonText: {
    color: Colors.stout,
    fontSize: 17,
    fontWeight: '800',
  },
});
