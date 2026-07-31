import { Stack } from 'expo-router';

import { SearchIcon } from '@/components/shared/IconGlyph';
import { GlassIconButton } from '@/mocks/GlassIconButton';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Kocoviny tab.
 *
 * This one IS a list, so it gets the full iOS 26 treatment: a large title that
 * scrolls away with the content and re-forms small and centred on the blurred
 * bar. Hospody does not, because its content is a sheet over a map and a
 * collapsing title needs a scrolling pane directly beneath it.
 *
 * A folder (not a route group) so the URL stays `/friends` — it is a Live
 * Activity / deep-link target and is named in telemetry and `appReviewPolicy`.
 */
export default function FeedLayout() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: true,
        headerBlurEffect: 'systemChromeMaterialDark',
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: Colors.amber,
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Kocoviny',
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
