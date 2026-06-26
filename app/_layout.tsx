import { Stack, useRouter, usePathname, type Href } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';

import { fontAssets } from '@/theme/fonts';
import { Colors } from '@/theme/colors';
import { flushPubReportQueue } from '@/data/pubReportQueue';
import { flushFeedbackQueue } from '@/data/feedbackQueue';
import { flushCommunityQueue } from '@/data/communityQueue';
import { flushAddedPubsQueue } from '@/data/addedPubsQueue';
import { flushDrinksQueue } from '@/data/drinksQueue';
import { flushDeleteDrinksQueue } from '@/data/deleteDrinksQueue';
import { flushUpdateDrinksQueue } from '@/data/updateDrinksQueue';
import { installPubRatingsSync, restorePubRatings } from '@/data/pubRatingsSync';
import { flushPubRatingsQueue } from '@/data/pubRatingsQueue';
import { installPubAmenitiesSync, restorePubAmenities } from '@/data/pubAmenitiesSync';
import { flushPubAmenitiesQueue } from '@/data/pubAmenitiesQueue';
import { flushVisitsQueue } from '@/data/visitsQueue';
import { seedVisitsFromHistory } from '@/data/visitsSync';
import {
  installClientTelemetry,
  setTelemetrySession,
  trackClientEvent,
} from '@/data/telemetryClient';
import { flushWalkingDistance } from '@/data/walkingTelemetry';
import { useAccountStore, selectNeedsProfileSetup } from '@/stores/accountStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useTallyStore } from '@/stores/tallyStore';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { PubReminderOnboardingModal } from '@/components/shared/PubReminderOnboardingModal';
import { Toast } from '@/components/shared/Toast';
import {
  consumeInitialPubReminderTap,
  initializePubReminderNotifications,
  refreshPubReminderGeofences,
  subscribePubReminderTap,
} from '@/notifications/pubReminderNotifications';

/**
 * Onboarding gate: once auth resolves (`status==='ready'`) and a signed-in
 * account has no nickname yet, push the user into the setup wizard. Runs after
 * initAccount/auth settles so it catches email/Google/Apple sign-ups AND
 * returning users upgrading from an older build. Re-entrancy is naturally
 * guarded — `selectNeedsProfileSetup` flips to false the moment a nickname is
 * set — and we never redirect while already on the setup route.
 */
function ProfileGate() {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAccountStore((s) => s.status);
  const needsSetup = useAccountStore(selectNeedsProfileSetup);

  useEffect(() => {
    if (status === 'ready' && needsSetup && pathname !== '/profile/setup') {
      router.replace('/profile/setup' as Href);
    }
  }, [status, needsSetup, pathname, router]);

  return null;
}

SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore — splash may already be hidden
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const router = useRouter();

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    installClientTelemetry();
    void initializePubReminderNotifications();
  }, []);

  useEffect(() => {
    // Tapping a "nejsi v hospodě?" reminder jumps straight to the beer counter.
    // Handle both a running app (listener) and a cold start from the tap.
    const navigateToCounter = () => router.push('/beer' as Href);
    if (fontsLoaded || fontError) {
      void consumeInitialPubReminderTap(navigateToCounter);
    }
    const subscription = subscribePubReminderTap(navigateToCounter);
    return () => subscription.remove();
  }, [fontsLoaded, fontError, router]);

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
        void trackClientEvent({ event: 'app_open', severity: 'info' });
      });
  }, []);

  useEffect(() => {
    // Fire-and-forget: after an app update, surface the "what's new" popup. Waits
    // for persisted state internally and never throws — a miss just retries next
    // launch.
    void useReleaseStore.getState().checkForUpdate();
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
    void flushFeedbackQueue();
    void flushCommunityQueue();
    void flushAddedPubsQueue();
    void flushDrinksQueue();
    void flushDeleteDrinksQueue();
    void flushUpdateDrinksQueue();
    // Personal ratings: pull + merge the server set (LWW), pushing local-newer
    // ratings, then flush. Visits: one-time seed of existing history, then flush.
    void restorePubRatings();
    void flushPubRatingsQueue();
    // Amenity votes: same pull + merge + push + flush as ratings (spec §4.7).
    void restorePubAmenities();
    void flushPubAmenitiesQueue();
    void seedVisitsFromHistory();
    void flushVisitsQueue();
    // Close an evening left idle past the timeout while the app was away, so the
    // counter reopens clean (the evening stays resumable for the same day/pub).
    useTallyStore.getState().maybeAutoArchive();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void trackClientEvent({ event: 'app_foreground', severity: 'info' });
        useTallyStore.getState().maybeAutoArchive();
        void flushPubReportQueue();
        void flushFeedbackQueue();
        void flushCommunityQueue();
        void flushAddedPubsQueue();
        void flushDrinksQueue();
        void flushDeleteDrinksQueue();
        void flushUpdateDrinksQueue();
        void restorePubRatings();
        void flushPubRatingsQueue();
        void restorePubAmenities();
        void flushPubAmenitiesQueue();
        void flushVisitsQueue();
        // Re-seed pub geofences for wherever the user is now (no-op when the
        // feature is off; cheap unless they moved a few km since last fetch).
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
            name="profile/setup"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              // The nickname step is the hard gate — it must not be swipe-dismissable.
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
        </Stack>
        <ProfileGate />
        <WhatsNewModal />
        <PubReminderOnboardingModal />
        <Toast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
