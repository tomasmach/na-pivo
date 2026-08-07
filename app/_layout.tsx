import { Stack, useRouter, usePathname, type Href } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  AppState,
  Linking,
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
import { flushVisitsQueue } from '@/data/visitsQueue';
import { flushFriendsQueue } from '@/data/friendsQueue';
import { fetchFriendsLive } from '@/data/friendsClient';
import {
  consumeAndClaimPendingInviteCode,
  parseInviteCodeFromUrl,
  stashPendingInviteCode,
} from '@/data/friendInviteLink';
import { flushBeerCheckinsQueue } from '@/data/beerCheckinsQueue';
import { flushNightsQueue } from '@/data/nightsQueue';
import { flushPartyGameStartsQueue } from '@/data/partyGameStartsQueue';
import { flushPartyEveningActionsQueue } from '@/data/partyEveningActionsQueue';
import { flushPartyGamesQueue } from '@/data/partyGamesQueue';
import { flushBeerPhotosQueue } from '@/data/beerPhotosQueue';
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
import { useAccountStore, selectIsSignedIn } from '@/stores/accountStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { usePubStore } from '@/stores/pubStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useTallyStore } from '@/stores/tallyStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { ensureFriendPushRegisteredIfGranted } from '@/notifications/friendPush';
import { refreshCurrencyFromLastKnownLocation } from '@/location/locationCurrency';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { ContestResultsModal } from '@/photos/ContestResultsModal';
import { PubReminderOnboardingModal } from '@/components/shared/PubReminderOnboardingModal';
import { NicknameNudgeModal } from '@/components/shared/NicknameNudgeModal';
import { PubReminderEnableFailureModal } from '@/components/shared/PubReminderEnableFailureModal';
import { AppDialogHost } from '@/components/shared/AppDialog';
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
import {
  consumeInitialBeerCountReminderTap,
  initializeBeerCountReminderNotifications,
  subscribeBeerCountReminderTap,
} from '@/notifications/beerCountReminder';
import {
  initializeLiveBeerActivity,
  reconcileLiveBeerActivityAndAutoArchive,
} from '@/liveActivity/liveBeerActivity';

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
      pathname !== '/onboarding' &&
      !pathname.startsWith('/parta/pozvanka')
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
      liveNow: slice.activeFriends.length > 0 || slice.myActiveActivity != null,
    });
  });
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
    });
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
          <Text style={styles.startupRecoveryTitle}>Telefon teď nepustil účet</Text>
          <Text style={styles.startupRecoveryBody}>
            Odemkni ho a zkus bezpečné načtení znovu. Tvoje data zatím necháváme zavřená.
          </Text>
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
              <Text style={styles.startupRecoveryButtonText}>Zkusit znovu</Text>
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
  const pathnameRef = useRef(pathname);
  const [telemetryReady, setTelemetryReady] = useState(false);
  const startupBoundaryReady = useAccountStore((state) => state.startupBoundaryReady);
  const accountStatus = useAccountStore((state) => state.status);
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

  useEffect(() => {
    if (!startupBoundaryReady) return;
    // Tapping a "nejsi v hospodě?" reminder jumps straight to the beer counter.
    // Handle both a running app (listener) and a cold start from the tap.
    const navigateToCounter = () => router.push('/beer' as Href);
    // A friend push tap forces a Parta refresh (and scroll to its payload row).
    const navigateToFriends = (payload?: FriendTapPayload) => {
      usePartaSignalStore.getState().requestRefresh(payload ?? undefined);
      router.push('/friends' as Href);
    };
    if (fontsLoaded || fontError) {
      void consumeInitialPubReminderTap(navigateToCounter, navigateToFriends);
      void consumeInitialBeerCountReminderTap(navigateToCounter);
    }
    const pubSubscription = subscribePubReminderTap(navigateToCounter, navigateToFriends);
    const beerCountSubscription = subscribeBeerCountReminderTap(navigateToCounter);
    return () => {
      pubSubscription.remove();
      beerCountSubscription.remove();
    };
  }, [fontsLoaded, fontError, router, startupBoundaryReady]);

  useEffect(() => {
    const handleInviteUrl = (url: string | null) => {
      const code = parseInviteCodeFromUrl(url);
      if (!code) return;
      void stashPendingInviteCode(code);
      router.push({ pathname: '/parta/pozvanka', params: { code } } as Href);
    };

    Linking.getInitialURL()
      .then(handleInviteUrl)
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => handleInviteUrl(url));
    return () => subscription.remove();
  }, [router]);

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
    void accountInitialization
      .finally(async () => {
        if (!useAccountStore.getState().startupBoundaryReady) return;
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
        // A Parta invite deep link tapped before the account existed was stashed;
        // now that an account is ready, claim it (fires a Parta refresh on success).
        void consumeAndClaimPendingInviteCode();
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
  }, []);

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
    void flushDrinksQueue();
    void flushDeleteDrinksQueue();
    void flushUpdateDrinksQueue();
    // Personal ratings: pull + merge the server set (LWW), pushing local-newer
    // ratings, then flush. Visits: one-time seed of existing history, then flush.
    void restorePubRatings();
    // Amenity votes: same pull + merge + push + flush as ratings (spec §4.7).
    void restorePubAmenities();
    void seedVisitsFromHistory();
    void flushVisitsQueue();
    // Parta: retry queued RSVP/cinknutí/reactions, and light up push for
    // existing notification-permission grantees without a prompt (Parta 3.0).
    void flushFriendsQueue();
    void flushBeerCheckinsQueue();
    void flushBeerPhotosQueue();
    // Výčep: retry queued night publishes/unpublishes and round reactions.
    void flushNightsQueue();
    void flushPartyGamesQueue();
    void flushPartyGameStartsQueue();
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
        void restorePubRatings();
        void restorePubAmenities();
        void flushVisitsQueue();
        void flushFriendsQueue();
        void flushBeerCheckinsQueue();
        void flushBeerPhotosQueue();
        void flushNightsQueue();
        void flushPartyGamesQueue();
        void flushPartyGameStartsQueue();
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
              presentation: 'fullScreenModal',
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
            options={{ presentation: 'fullScreenModal', animation: 'ios_from_right' }}
          />
          {/* Saving the night: pushed over the hub so backing out returns you to
              an evening that is still running. Only "Zveřejnit" ends it. */}
          <Stack.Screen
            name="party-finish"
            options={{ presentation: 'fullScreenModal', animation: 'ios_from_right' }}
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
