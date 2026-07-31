import { Stack } from 'expo-router';

import { Colors } from '@/theme/colors';

/**
 * Stack for the Hospody tab (§17).
 *
 * No header on the list screen. A bar carrying the title "Hospody" repeats what
 * the tab already says, and its search button duplicated the search field that
 * lives inside the sheet — two doors to one thing (§0.3). The map is the screen
 * and the sheet is its chrome; there is nothing left for a nav bar to do.
 *
 * Pushed screens under this stack keep the blurred bar: those you came to from
 * somewhere, so they need a way back.
 *
 * A route GROUP — `(pubs)` — rather than a folder, so the URL stays `/` and
 * every existing `router.replace('/(tabs)')` keeps landing where it did.
 */
export default function PubsLayout() {
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerBlurEffect: 'systemChromeMaterialDark',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: Colors.amber,
        headerTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* Declared INSIDE the tab's stack, so the push happens under the tab
          bar and the bar stays put. In the root stack it covered the tabs. */}
      <Stack.Screen
        name="pub/[id]"
        options={{
          headerTransparent: true,
          headerTitle: '',
          // Without this the back control is labelled with the parent route —
          // "(tabs)" — which is a router internal, not a place.
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: Colors.foam,
          // No bar at all — just the floating back disc over the map. The
          // inherited blur painted a grey band across the top of a photo and a
          // map that are meant to run under the status bar.
          headerBlurEffect: 'none',
          animation: 'ios_from_right',
        }}
      />
    </Stack>
  );
}
