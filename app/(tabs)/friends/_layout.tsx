import { Pressable } from 'react-native';
import { Stack } from 'expo-router';

import { SearchIcon } from '@/components/shared/IconGlyph';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Kocoviny tab.
 *
 * This one IS a list, so it gets the full iOS 26 treatment: a large title that
 * scrolls away with the content and re-forms small and centred on the bar, with
 * the trailing action floating on the system's own glass capsule.
 *
 * Deliberately NOT `headerTransparent` + `headerBlurEffect`. Setting those tells
 * the platform "I will supply the material" — and then supplying a flat colour
 * is why the bar read as a hand-drawn band rather than an iOS 26 one. A plain
 * native bar already IS glass on 26; it mostly needs to be left alone. Spendee's
 * `MoreStackNavigator` does exactly this: large title, no shadow, fonts
 * overridden, and transparency reserved for pushed small-title screens.
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
        headerTintColor: Colors.amber,
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Kocoviny',
          // No custom glass wrapper here: on iOS 26 the system already floats
          // bar buttons on their own capsule. Adding ours would be two glass
          // layers, one of them a fake.
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Hledat" hitSlop={10}>
              <SearchIcon size={20} color={Colors.amber} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
