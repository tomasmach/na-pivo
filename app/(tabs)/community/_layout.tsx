import { Pressable } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { SearchIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';

import { Colors } from '@/theme/colors';

/**
 * Native stack for the Komunita tab — same treatment as Kocoviny.
 *
 * A list screen, so it gets the iOS 26 large title that scrolls away with the
 * content and re-forms small on the bar. The bar is pinned to an opaque stout
 * rather than left on the system material: on this dark screen iOS' own
 * scroll-edge material read as a faint lighter band above the title, and it let
 * the leaderboard ghost through the bar as it scrolled.
 *
 * A folder (not a route group) so the URL stays `/community`.
 */
export default function CommunityLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTintColor: Colors.amber,
        // Opaque on BOTH platforms. Left to itself iOS gives the bar its light
        // scroll-edge material, which on a stout screen read as a faint lighter
        // rounded band above the title — and let scrolled content ghost through
        // the bar. The same pin the diary route already uses (§15.2: the
        // material always has an opaque fallback, and this bar has to hide
        // content, not show it).
        headerStyle: { backgroundColor: Colors.stout },
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: t.tabs.community,
          // Same door as Kocoviny: people are found by searching for them, not
          // by scrolling a leaderboard until a name appears.
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/search' as Href)}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.communitySearchButton}
              hitSlop={10}
            >
              <SearchIcon size={20} color={Colors.amber} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="event/[id]"
        options={{
          headerTransparent: true,
          headerTitle: '',
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: Colors.foam,
          headerBlurEffect: 'none',
          animation: 'ios_from_right',
        }}
      />
      <Stack.Screen
        name="challenge/[id]"
        options={{
          headerTransparent: true,
          headerTitle: '',
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: Colors.foam,
          animation: 'ios_from_right',
        }}
      />
    </Stack>
  );
}
