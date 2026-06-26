import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { fetchBeerTrailSnapshot, type BeerTrailTeaser } from '@/beerTrail/beerTrailClient';
import { isPlusSubscription } from '@/beerTrail/beerTrailModel';
import { CrownIcon, MapPinnedIcon, ClipboardListIcon, ChevronRightIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useAccountStore } from '@/stores/accountStore';

interface Props {
  fallbackTeaser: BeerTrailTeaser;
}

function teaserLine(teaser: BeerTrailTeaser): string {
  if (teaser.distinctPubs <= 0 && teaser.totalBeers <= 0) return cs.beerTrail.teaserEmpty;
  if (teaser.citiesCount > 0) {
    return cs.beerTrail.teaserWithCities(teaser.distinctPubs, teaser.citiesCount);
  }
  return cs.beerTrail.teaserWithoutCities(teaser.distinctPubs);
}

export function BeerTrailTeaserCard({ fallbackTeaser }: Props) {
  const router = useRouter();
  const subscription = useAccountStore((s) => s.profile?.subscription);
  const profileIsPlus = isPlusSubscription(subscription);
  const [remoteTeaser, setRemoteTeaser] = useState<BeerTrailTeaser | null>(null);
  const [remoteIsPlus, setRemoteIsPlus] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBeerTrailSnapshot({ signal: controller.signal }).then((snapshot) => {
      if (!snapshot) return;
      setRemoteTeaser(snapshot.teaser);
      setRemoteIsPlus(snapshot.entitlement.isPlus);
    });
    return () => controller.abort();
  }, []);

  const teaser = remoteTeaser ?? fallbackTeaser;
  const isPlus = remoteIsPlus ?? profileIsPlus;
  const headline = useMemo(() => teaserLine(teaser), [teaser]);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.iconWell}>
          <CrownIcon size={20} color={Colors.amber} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
            {isPlus ? cs.beerTrail.plusEyebrow : cs.beerTrail.freeEyebrow}
          </Text>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {isPlus ? cs.beerTrail.plusTitle : cs.beerTrail.freeTitle}
          </Text>
        </View>
      </View>

      <Text style={styles.headline} maxFontSizeMultiplier={FontScaleCap.heading}>
        {headline}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {isPlus ? cs.beerTrail.plusBody : cs.beerTrail.freeBody}
      </Text>

      {isPlus ? (
        <View style={styles.actions}>
          <TrailAction
            icon={<MapPinnedIcon size={18} color={Colors.stout} />}
            label={cs.beerTrail.openMap}
            onPress={() => router.push('/beer-trail' as Href)}
            primary
          />
          <TrailAction
            icon={<ClipboardListIcon size={18} color={Colors.amber} />}
            label={cs.beerTrail.openReport}
            onPress={() => router.push('/beer-trail-report' as Href)}
          />
        </View>
      ) : (
        <Pressable
          onPress={() => router.push('/beer-trail-plus' as Href)}
          style={({ pressed }) => [styles.unlockButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.beerTrailUnlock}
        >
          <Text style={styles.unlockText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.beerTrail.unlock}
          </Text>
          <ChevronRightIcon size={18} color={Colors.stout} />
        </Pressable>
      )}
    </View>
  );
}

function TrailAction({
  icon,
  label,
  onPress,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary ? styles.actionPrimary : styles.actionSecondary,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
    >
      {icon}
      <Text
        style={[styles.actionText, primary ? styles.actionTextPrimary : styles.actionTextSecondary]}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.stout3,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    padding: 18,
    gap: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.38),
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: Colors.amber,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.foam,
  },
  headline: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 29,
    color: Colors.foam,
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  unlockButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  unlockText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.stout,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  actionPrimary: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  actionSecondary: {
    backgroundColor: withAlpha(Colors.amber, 0.08),
    borderColor: withAlpha(Colors.amber, 0.35),
  },
  actionText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
  },
  actionTextPrimary: {
    color: Colors.stout,
  },
  actionTextSecondary: {
    color: Colors.amber,
  },
  pressed: {
    opacity: 0.72,
  },
});
