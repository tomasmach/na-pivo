import { Platform, Pressable } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { SettingsIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';

/**
 * Native stack for the Profil tab — the same treatment as Kocoviny and
 * Komunita: an iOS 26 large title that scrolls away and re-forms small on the
 * bar. No `headerTransparent` / custom blur; a plain native bar already is
 * glass on 26.
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
        ...(Platform.OS === 'android'
          ? { headerStyle: { backgroundColor: Colors.stout } }
          : null),
        headerTitleStyle: { color: Colors.foam },
        headerLargeTitleStyle: { color: Colors.foam },
        contentStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Profil',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings' as Href)}
              accessibilityRole="button"
              accessibilityLabel="Nastavení"
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
          title: cs.profile.diaryTitle,
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
