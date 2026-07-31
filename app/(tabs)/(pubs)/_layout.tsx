import { View } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { MapIcon, SearchIcon } from '@/components/shared/IconGlyph';
import { GlassIconButton } from '@/mocks/GlassIconButton';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Hospody tab (§17).
 *
 * The large title, its collapse into a centred title on a blurred bar and the
 * icon morphing are iOS 26 behaviours. Hand-rolling them from a scroll offset
 * gets the geometry roughly right and the feel wrong, so the header belongs to
 * the platform: `headerLargeTitle` + a translucent blur.
 *
 * Search is a trailing glass BUTTON, not `headerSearchBarOptions`. On iOS 26
 * that option renders a full-width field pinned to the BOTTOM of the screen —
 * a different control for a different job, and not what a list with a large
 * title wants sitting next to its title.
 *
 * A route GROUP — `(pubs)` — rather than a folder, so the URL stays `/` and
 * every existing `router.replace('/(tabs)')` keeps landing where it did.
 */
export default function PubsLayout() {
  const router = useRouter();

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
        headerLargeTitleShadowVisible: false,
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Hospody',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <GlassIconButton
                accessibilityLabel="Mapa"
                onPress={() => router.push('/pubs-map' as Href)}
              >
                <MapIcon size={18} color={Colors.foam} />
              </GlassIconButton>
              <GlassIconButton accessibilityLabel="Hledat">
                <SearchIcon size={18} color={Colors.foam} />
              </GlassIconButton>
            </View>
          ),
        }}
      />
    </Stack>
  );
}
