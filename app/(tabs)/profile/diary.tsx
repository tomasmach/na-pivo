import { useState } from 'react';
import { Pressable } from 'react-native';
import { Stack } from 'expo-router';

import { MenuIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import DiaryScreen from '@/diary/DiaryScreen';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';

/** Private/local history lives in Profil; Party keeps the centre tab. */
export default function ProfileDiaryRoute() {
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <>
      {/* Title, tint and the dark bar itself belong to the stack (`_layout`);
          this route only hangs its own action on the trailing slot. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => setStatsOpen(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.diaryStats}
            >
              <MenuIcon size={20} color={Colors.amber} />
            </Pressable>
          ),
        }}
      />
      <DiaryScreen
        embedded
        bottomInset={TAB_CHROME}
        statsOpen={statsOpen}
        onStatsClose={() => setStatsOpen(false)}
      />
    </>
  );
}
