import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import {
  ChevronLeftIcon,
  CompassIcon,
  MapPinnedIcon,
  SproutIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { AchievementGrid } from '@/profile/AchievementGrid';
import { EMPTY_ACHIEVEMENTS, type AccountMapper } from '@/data/auth';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import { cs } from '@/i18n/cs';

function MapperStat({
  icon,
  value,
  caption,
}: {
  icon: React.ReactNode;
  value: string;
  caption: string;
}) {
  return (
    <View style={styles.mapperStat}>
      <View style={styles.mapperIcon}>{icon}</View>
      <Text
        style={styles.mapperValue}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.display}
      >
        {value}
      </Text>
      <Text
        style={styles.mapperCaption}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {caption}
      </Text>
    </View>
  );
}

function MapperSection({
  mapper,
  signedIn,
}: {
  mapper: AccountMapper | undefined;
  signedIn: boolean;
}) {
  return (
    <View style={styles.mapperSection}>
      <Text style={styles.sectionHeader} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.mapPub.mapperHeader}
      </Text>
      {mapper ? (
        <>
          <View style={styles.mapperGrid}>
            <MapperStat
              icon={<MapPinnedIcon size={18} color={Colors.amber} />}
              value={String(mapper.distinctMappedPubs)}
              caption={cs.mapPub.mapperStatMappedPubs}
            />
            <MapperStat
              icon={<CompassIcon size={18} color={Colors.amber} />}
              value={String(mapper.amenityVotesCount)}
              caption={cs.mapPub.mapperStatAnswers}
            />
            <MapperStat
              icon={<SproutIcon size={18} color={Colors.amber} />}
              value={String(mapper.firstMapperCount)}
              caption={cs.mapPub.mapperStatFirstMaps}
            />
            <MapperStat
              icon={<StarIcon size={18} color={Colors.amber} />}
              value={String(mapper.completedPubsCount)}
              caption={cs.mapPub.mapperStatCompleted}
            />
          </View>
          {!signedIn ? (
            <Text style={styles.mapperHint} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.mapPub.mapperSignedOut}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={styles.mapperEmpty}>
          <View style={styles.mapperEmptyIcon}>
            <SproutIcon size={22} color={Colors.amber} />
          </View>
          <Text style={styles.mapperEmptyText} maxFontSizeMultiplier={FontScaleCap.body}>
            {signedIn ? cs.mapPub.mapperEmpty : cs.mapPub.mapperSignedOut}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function BadgesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAccountStore((s) => s.profile);
  const signedIn = useAccountStore(selectIsSignedIn);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.profile.achievementsHeader}
          </Text>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.profile.badgeCollectionTitle}
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <MapperSection mapper={profile?.mapper} signedIn={signedIn} />
        <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.profile.badgeCollectionIntro}
        </Text>
        <AchievementGrid
          mapper={profile?.mapper}
          achievements={profile?.achievements ?? EMPTY_ACHIEVEMENTS}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
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
  headerText: { gap: 2 },
  eyebrow: { fontFamily: Fonts.ui.bold, fontSize: 10, letterSpacing: 1.3, color: Colors.amber },
  title: { fontFamily: Fonts.display.extrabold, fontSize: 24, color: Colors.foam },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  mapperSection: { gap: Spacing.sm },
  sectionHeader: {
    marginLeft: 4,
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  mapperGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm + 2,
  },
  mapperStat: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 6,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapperIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  mapperValue: {
    marginTop: 6,
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  mapperCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1,
    color: Colors.mutedText,
  },
  mapperHint: {
    marginLeft: 4,
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.mutedText,
  },
  mapperEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapperEmptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  mapperEmptyText: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  intro: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    maxWidth: 310,
  },
});
