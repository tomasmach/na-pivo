import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { leaveRoute } from '@/navigation/leaveRoute';
import { PhotoDiarySection } from '@/photos/PhotoDiarySection';
import { Colors } from '@/theme/colors';
import { Radius, Spacing } from '@/theme/layout';

export default function ProfilePhotosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => leaveRoute(router)}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.backButton}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <PhotoDiarySection />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  header: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
});
