import { Stack } from 'expo-router';
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
import { flushDrinksQueue } from '@/data/drinksQueue';
import { flushDeleteDrinksQueue } from '@/data/deleteDrinksQueue';
import { installPubRatingsSync, restorePubRatings } from '@/data/pubRatingsSync';
import { flushPubRatingsQueue } from '@/data/pubRatingsQueue';
import { flushVisitsQueue } from '@/data/visitsQueue';
import { seedVisitsFromHistory } from '@/data/visitsSync';
import {
  installClientTelemetry,
  setTelemetrySession,
  trackClientEvent,
} from '@/data/telemetryClient';
import { flushWalkingDistance } from '@/data/walkingTelemetry';
import { useAccountStore } from '@/stores/accountStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';
import { Toast } from '@/components/shared/Toast';

SplashScreen.preventAutoHideAsync().catch(() => {
  // ignore — splash may already be hidden
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    installClientTelemetry();
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
    // Fire-and-forget: re-send pub reports and feedback whose first delivery
    // failed. Runs on launch and whenever the app returns to the foreground;
    // never throws.
    void flushPubReportQueue();
    void flushFeedbackQueue();
    void flushCommunityQueue();
    void flushDrinksQueue();
    void flushDeleteDrinksQueue();
    // Personal ratings: pull + merge the server set (LWW), pushing local-newer
    // ratings, then flush. Visits: one-time seed of existing history, then flush.
    void restorePubRatings();
    void flushPubRatingsQueue();
    void seedVisitsFromHistory();
    void flushVisitsQueue();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void trackClientEvent({ event: 'app_foreground', severity: 'info' });
        void flushPubReportQueue();
        void flushFeedbackQueue();
        void flushCommunityQueue();
        void flushDrinksQueue();
        void flushDeleteDrinksQueue();
        void restorePubRatings();
        void flushPubRatingsQueue();
        void flushVisitsQueue();
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
            name="evening"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
        </Stack>
        <WhatsNewModal />
        <Toast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
