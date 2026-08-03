import { Stack } from 'expo-router';

import { Colors } from '@/theme/colors';

/**
 * Native stack for the Kocoviny tab.
 *
 * The home screen has NO bar. Its title is the app's own logo, and a logo is
 * content — it belongs at the top of the feed, scrolling away with it, not
 * welded to a 52pt band that follows you down the list. The pushed screens
 * below still get the platform's own bar, because a pushed screen needs a back
 * control and that control is the system's job.
 *
 * A folder (not a route group) so the URL stays `/friends` — it is a deep-link
 * target and is named in telemetry and `appReviewPolicy`.
 */
export default function FeedLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        // Tint colours the BUTTONS; the title is foam. Letting the tint carry
        // both made the large title amber, which reads as a link.
        headerTintColor: Colors.amber,
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Na pivo',
          // No bar at all on the home screen. The logo is content, not chrome:
          // it sits at the top of the feed and scrolls away with it, the way
          // the large title used to. A pinned wordmark is a band that eats
          // 52pt of a phone forever to say something you already know.
          headerShown: false,
        }}
      />
      {/* Declared INSIDE the tab's stack, so the push happens under the tab
          bar and the bar stays put. In the root stack it covered the tabs. */}
      <Stack.Screen
        name="party-recap"
        options={{
          headerTransparent: true,
          headerTitle: '',
          // Without this the back control is labelled with the parent route —
          // "(tabs)" — which is a router internal, not a place.
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: Colors.foam,
          animation: 'ios_from_right',
        }}
      />
    </Stack>
  );
}

