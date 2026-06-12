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
import { useAccountStore } from '@/stores/accountStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { WhatsNewModal } from '@/components/shared/WhatsNewModal';

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
    // Fire-and-forget: ensure an anonymous device account exists. Non-blocking —
    // failure leaves the app fully functional and retries on the next launch.
    void useAccountStore.getState().initAccount();
  }, []);

  useEffect(() => {
    // Fire-and-forget: after an app update, surface the "what's new" popup. Waits
    // for persisted state internally and never throws — a miss just retries next
    // launch.
    void useReleaseStore.getState().checkForUpdate();
  }, []);

  useEffect(() => {
    // Fire-and-forget: re-send pub reports and feedback whose first delivery
    // failed. Runs on launch and whenever the app returns to the foreground;
    // never throws.
    void flushPubReportQueue();
    void flushFeedbackQueue();
    void flushCommunityQueue();
    void flushDrinksQueue();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void flushPubReportQueue();
        void flushFeedbackQueue();
        void flushCommunityQueue();
        void flushDrinksQueue();
      }
    });
    return () => subscription.remove();
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
        </Stack>
        <WhatsNewModal />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
