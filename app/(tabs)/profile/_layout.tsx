import { Platform, Pressable } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { SettingsIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Profil tab — the same treatment as Komunita: an iOS 26
 * large title that scrolls away and re-forms small on the bar. The screen
 * supplies stout because iOS 26 hides large titles behind opaque bar colors.
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
        headerStyle: { backgroundColor: Platform.OS === 'ios' ? 'transparent' : Colors.stout },
        headerBlurEffect: 'none',
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: t.tabs.profile,
          headerTransparent: Platform.OS === 'ios',
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
