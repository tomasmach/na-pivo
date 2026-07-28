/**
 * BoardSkeleton — the loading state of the global leaderboards.
 *
 * A skeleton is a promise about the layout, so this one draws the shapes that
 * are about to arrive: the rank numeral with its noun, the podium next to it,
 * the two footer facts, and rows that carry a rank, an avatar, a name of
 * uneven length and a score. The old state showed one block in the card and
 * three edge-to-edge slabs in the list, which read as a broken screen rather
 * than a loading one.
 *
 * Motion stays in `SkeletonBlock` (§10): one shared breathe, stopped flat under
 * reduce-motion. Nothing here loops on its own.
 */

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import SkeletonBlock from '@/friends/SkeletonBlock';
import { Colors, withAlpha } from '@/theme/colors';
import { Radius } from '@/theme/layout';

const AVATAR_SIZE = 34;
// Names are not all the same length, and a column of identical bars is the
// tell-tale sign of a fake list. Widths descend with the rank, like the scores.
const NAME_WIDTHS = ['62%', '48%', '70%', '54%', '44%', '60%'] as const;

export const HeroSkeleton = memo(function HeroSkeleton({
  reduceMotion,
}: {
  reduceMotion: boolean;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroRank}>
        <SkeletonBlock
          width={124}
          height={72}
          radius={Radius.medium}
          reduceMotion={reduceMotion}
          tone="raised"
        />
        <SkeletonBlock
          width={68}
          height={12}
          radius={Radius.pill}
          reduceMotion={reduceMotion}
          tone="raised"
        />
      </View>

      {/* The podium's three mats, shortest to tallest, as they will be drawn. */}
      <View style={styles.heroPodium}>
        <SkeletonBlock
          width={26}
          height={30}
          radius={Radius.small}
          reduceMotion={reduceMotion}
          tone="raised"
        />
        <SkeletonBlock
          width={26}
          height={46}
          radius={Radius.small}
          reduceMotion={reduceMotion}
          tone="raised"
        />
        <SkeletonBlock
          width={26}
          height={38}
          radius={Radius.small}
          reduceMotion={reduceMotion}
          tone="raised"
        />
      </View>
    </View>
  );
});

export const HeroFooterSkeleton = memo(function HeroFooterSkeleton({
  reduceMotion,
}: {
  reduceMotion: boolean;
}) {
  return (
    <View style={styles.footer}>
      <SkeletonBlock
        width={104}
        height={14}
        radius={Radius.pill}
        reduceMotion={reduceMotion}
        tone="raised"
      />
      <SkeletonBlock
        width={72}
        height={12}
        radius={Radius.pill}
        reduceMotion={reduceMotion}
        tone="raised"
      />
    </View>
  );
});

export const RowsSkeleton = memo(function RowsSkeleton({
  reduceMotion,
}: {
  reduceMotion: boolean;
}) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {NAME_WIDTHS.map((width, index) => (
        <View key={width + index} style={[styles.row, index > 0 && styles.rowDivider]}>
          <View style={styles.rankCol}>
            <SkeletonBlock
              width={18}
              height={18}
              radius={Radius.small}
              reduceMotion={reduceMotion}
              tone="raised"
            />
          </View>

          <SkeletonBlock
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            radius={Radius.pill}
            reduceMotion={reduceMotion}
            tone="raised"
          />

          <View style={styles.nameCol}>
            <SkeletonBlock
              width={width}
              height={13}
              radius={Radius.pill}
              reduceMotion={reduceMotion}
              tone="raised"
            />
          </View>

          <SkeletonBlock
            width={30}
            height={17}
            radius={Radius.small}
            reduceMotion={reduceMotion}
            tone="raised"
          />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  // Mirrors `heroBody` on the screen: same height, same two columns.
  hero: {
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  heroRank: {
    gap: 10,
  },
  heroPodium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  footer: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Mirrors `GlobalBoardRow`: same height, same gaps, same hairline.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 24,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rankCol: {
    width: 28,
    alignItems: 'center',
  },
  nameCol: {
    flex: 1,
    minWidth: 0,
  },
});
