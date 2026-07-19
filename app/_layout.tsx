import { Stack, useRouter, usePathname, type Href } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AppState, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';

import { fontAssets } from '@/theme/fonts';
import { Colors } from '@/theme/colors';
import { flushPubReportQueue } from '@/data/pubReportQueue';
import { flushPubNameCorrectionsQueue } from '@/data/pubNameCorrectionsQueue';
import { flushFeedbackQueue } from '@/data/feedbackQueue';
import { flushCommunityQueue } from '@/data/communityQueue';
import { flushAddedPubsQueue, restoreQueuedAddedPubs } from '@/data/addedPubsQueue';
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
import { flushBeerPhotosQueue } from '@/data/beerPhotosQueue';
import { seedVisitsFromHistory } from '@/data/visitsSync';
import {
  installClientTelemetry,
  setTelemetrySession,
  trackClientEvent,
} from '@/data/telemetryClient';
import { flushWalkingDistance } from '@/data/walkingTelemetry';
import { getCachedAuthenticationState } from '@/data/account';
import { useAccountStore, selectIsSignedIn } from '@/stores/accountStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { usePubStore } from '@/stores/pubStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useTallyStore } from '@/stores/tallyStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { ensureFriendPushRegisteredIfGranted } from '@/notifications/friendPush';
import { refreshCurrencyFromLastKnownLocation } from '@/location/locationCurrency';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { ContestResultsModal } from '@/photos/ContestResultsModal';
import { PubReminderOnboardingModal } from '@/components/shared/PubReminderOnboardingModal';
import { NicknameNudgeModal } from '@/components/shared/NicknameNudgeModal';
import { PubReminderEnableFailureModal } from '@/components/shared/PubReminderEnableFailureModal';
import { AppDialogHost } from '@/components/shared/AppDialog';
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
      return flushAddedPubsQueue().then(() => restoredCount);
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

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const router = useRouter();
  // Hold the splash until the first-run decision resolves too, so a fresh
  // install fades straight into the onboarding instead of flashing the compass.
  const onboardingDecided = useOnboardingStore((s) => s.decision !== 'pending');

  useEffect(() => {
    if ((fontsLoaded || fontError) && onboardingDecided) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, onboardingDecided]);

  useEffect(() => {
    installClientTelemetry();
    void initializePubReminderNotifications();
    void initializeBeerCountReminderNotifications();
    void refreshCurrencyFromLastKnownLocation();
  }, []);

  useEffect(() => {
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
  }, [fontsLoaded, fontError, router]);

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
    let hadActiveCounterSession = (useTallyStore.getState().current?.drinks.length ?? 0) > 0;
    if (hadActiveCounterSession) void cancelPendingPubReminder();

    return useTallyStore.subscribe((state) => {
      const hasActiveCounterSession = (state.current?.drinks.length ?? 0) > 0;
      if (hasActiveCounterSession && !hadActiveCounterSession) {
        void cancelPendingPubReminder();
      }
      hadActiveCounterSession = hasActiveCounterSession;
    });
  }, []);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    // Fire-and-forget: ensure an anonymous device account exists. Non-blocking.
    // Once the attempt settles, telemetry can include the bearer auth header so
    // usage counters attach to the anonymous account when possible.
    void useAccountStore
      .getState()
      .initAccount()
      .finally(() => {
        const session = useAccountStore.getState().session;
        setTelemetrySession(session);
        // Account hydration may restore the legacy CZK/EUR preference after the
        // launch-time location check, so let the cached country win once more.
        void refreshCurrencyFromLastKnownLocation();
        void trackClientEvent({ event: 'app_open', severity: 'info' });
        // A Parta invite deep link tapped before the account existed was stashed;
        // now that an account is ready, claim it (fires a Parta refresh on success).
        void consumeAndClaimPendingInviteCode();
        // Light up the Parta tab badge without waiting for the first Parta visit.
        seedPartaBadge();
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
    // Install the personal-rating push subscriber once for the process lifetime:
    // it diffs every store change into a queued upsert/delete. Kept separate from
    // the flush effect so it is set up exactly once.
    const unsubscribeRatings = installPubRatingsSync();
    return unsubscribeRatings;
  }, []);

  useEffect(() => {
    // Install the "Zmapuj hospodu" amenity-vote push subscriber once for the
    // process lifetime, mirroring the ratings subscriber: it diffs every store
    // change into a queued per-amenity upsert/delete tombstone.
    const unsubscribeAmenities = installPubAmenitiesSync();
    return unsubscribeAmenities;
  }, []);

  useEffect(() => {
    // Fire-and-forget: re-send pub reports and feedback whose first delivery
    // failed. Runs on launch and whenever the app returns to the foreground;
    // never throws.
    void flushPubReportQueue();
    void flushPubNameCorrectionsQueue();
    void flushFeedbackQueue();
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
    void ensureFriendPushRegisteredIfGranted();
    // Close an evening left idle past the timeout while the app was away, so the
    // counter reopens clean (the evening stays resumable for the same day/pub).
    useTallyStore.getState().maybeAutoArchive();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // A protected iOS Keychain can be temporarily unavailable to a locked
        // background launch. Retry account hydration once the user foregrounds
        // the app instead of leaving that transient miss looking like logout.
        if (!useAccountStore.getState().session) {
          void useAccountStore.getState().initAccount();
        }
        void trackClientEvent({ event: 'app_foreground', severity: 'info' });
        useTallyStore.getState().maybeAutoArchive();
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
    return () => {
      flushWalkingDistance();
      subscription.remove();
    };
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

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
        <Toast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
