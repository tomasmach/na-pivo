import { Stack } from 'expo-router';

import { SearchIcon } from '@/components/shared/IconGlyph';
import { GlassIconButton } from '@/mocks/GlassIconButton';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Hospody tab (§17).
 *
 * The header belongs to the platform: a translucent blurred bar with the title
 * inline. The large title is OFF here — a collapsing title needs a scrolling
 * content pane directly beneath it, and this screen's content is a sheet
 * floating over a map. It comes back on any screen that is a list again.
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
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: false,
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
          // No map button. The map IS the screen behind the sheet — you get to
          // it by pulling the sheet down, which is one road instead of two
          // (§0.3). A header icon that reveals what is already underneath is
          // chrome describing the layout back to you.
          headerRight: () => (
            <GlassIconButton accessibilityLabel="Hledat">
              <SearchIcon size={18} color={Colors.foam} />
            </GlassIconButton>
          ),
        }}
      />
    </Stack>
  );
}
