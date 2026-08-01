import { Pressable } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { SearchIcon } from '@/components/shared/IconGlyph';

import { Colors } from '@/theme/colors';

/**
 * Native stack for the Komunita tab — same treatment as Kocoviny.
 *
 * A list screen, so it gets the iOS 26 large title that scrolls away with the
 * content and re-forms small on the bar. No `headerTransparent` / custom blur:
 * a plain native bar already IS glass on 26, and claiming to supply the
 * material and then supplying a flat colour is what made the earlier bars read
 * as hand-drawn bands.
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
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Komunita',
          // Same door as Kocoviny: people are found by searching for them, not
          // by scrolling a leaderboard until a name appears.
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/search' as Href)}
              accessibilityRole="button"
              accessibilityLabel="Hledat"
              hitSlop={10}
            >
              <SearchIcon size={20} color={Colors.amber} />
            </Pressable>
          ),
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
