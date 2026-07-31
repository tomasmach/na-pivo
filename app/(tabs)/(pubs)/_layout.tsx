import { Stack } from 'expo-router';

import { Colors } from '@/theme/colors';

/**
 * Native stack for the Hospody tab (§17).
 *
 * The large title, its collapse into a centred title on a blurred bar, the
 * icon morphing and the search field that hides under the title are all iOS 26
 * behaviours. Hand-rolling them from a scroll offset gets the geometry roughly
 * right and the feel wrong, so this hands the header to the platform instead:
 * `headerLargeTitle` + `headerSearchBarOptions` + a translucent blur.
 *
 * A route GROUP — `(pubs)` — rather than a folder, so the URL stays `/` and
 * every existing `router.replace('/(tabs)')` keeps landing where it did.
 */
export default function PubsLayout() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: true,
        headerBlurEffect: 'systemChromeMaterialDark',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: Colors.amber,
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        headerLargeStyle: { backgroundColor: Colors.stout },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Hospody',
          // The native search field: it lives under the large title, rides up
          // with it and hides on scroll. iOS 26 draws it on the glass bar.
          headerSearchBarOptions: {
            placeholder: 'Hledej hospodu nebo pivo',
            hideWhenScrolling: true,
            textColor: Colors.foam,
            hintTextColor: Colors.mutedText,
            tintColor: Colors.amber,
          },
        }}
      />
    </Stack>
  );
}
