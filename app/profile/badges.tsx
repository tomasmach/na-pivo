import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { EMPTY_ACHIEVEMENTS } from '@/data/auth';
import { useAccountStore } from '@/stores/accountStore';
import { cs } from '@/i18n/cs';

export default function BadgesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAccountStore((s) => s.profile);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel={cs.a11y.backButton}>
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{cs.profile.achievementsHeader}</Text>
          <Text style={styles.title}>{cs.profile.badgeCollectionTitle}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{cs.profile.badgeCollectionIntro}</Text>
        <AchievementGrid mapper={profile?.mapper} achievements={profile?.achievements ?? EMPTY_ACHIEVEMENTS} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  back: { width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: Colors.stout2, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  headerText: { gap: 2 },
  eyebrow: { fontFamily: Fonts.ui.bold, fontSize: 10, letterSpacing: 1.3, color: Colors.amber },
  title: { fontFamily: Fonts.display.extrabold, fontSize: 24, color: Colors.foam },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  intro: { fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 20, color: Colors.foamMuted, maxWidth: 310 },
});
