import { Pressable } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { SettingsIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Profil tab — the same treatment as Komunita: an iOS 26
 * large title that scrolls away and re-forms small on the bar, pinned to an
 * opaque stout. Left on the system material the segmented control ghosted
 * through the bar as it scrolled under it.
 *
 * Settings live behind the trailing gear rather than as a row in the content
 * (§0.4, and the 3.0 nav decision that settings belong to Profil).
 *
 * A folder (not a route group) so the URL stays `/profile` — it is named in
 * telemetry, `appReviewPolicy` and several `router.navigate` calls.
 */
export default function ProfileLayout() {
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
          title: t.tabs.profile,
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings' as Href)}
              accessibilityRole="button"
              accessibilityLabel={t.settings.title}
              hitSlop={10}
            >
              <SettingsIcon size={20} color={Colors.amber} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="diary"
        options={{
          title: t.profile.diaryTitle,
          headerLargeTitle: false,
          // A pushed small-title bar otherwise picks iOS' light scroll-edge
          // material even though the whole diary is stout. Pin this route to
          // the dark product surface so the foam title keeps its contrast.
          headerStyle: { backgroundColor: Colors.stout },
          headerTintColor: Colors.foam,
          headerTitleStyle: { color: Colors.foam },
        }}
      />
    </Stack>
  );
}
