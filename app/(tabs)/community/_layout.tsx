import { Platform, Pressable } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { SearchIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';

import { Colors } from '@/theme/colors';

/**
 * Native stack for the Komunita tab — same treatment as Kocoviny.
 *
 * A list screen, so it gets the iOS 26 large title that scrolls away with the
 * content and re-forms small on the bar. iOS 26 hides large titles behind an
 * explicit opaque navigation-bar background, so the screen supplies stout.
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
        headerStyle: { backgroundColor: Platform.OS === 'ios' ? 'transparent' : Colors.stout },
        headerTransparent: Platform.OS === 'ios',
        headerBlurEffect: 'none',
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
          headerLargeTitle: false,
          headerStyle: { backgroundColor: 'transparent' },
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
          headerLargeTitle: false,
          headerStyle: { backgroundColor: 'transparent' },
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
