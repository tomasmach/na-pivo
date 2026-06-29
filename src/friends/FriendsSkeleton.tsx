/**
 * FriendsSkeleton — the layout-mirroring loading state for FriendsScreen (spec §11).
 *
 * Never a bare spinner: this ghosts the real screen's silhouette so the content
 * lands in place rather than jumping. Top → bottom it mirrors:
 *   1. compact hero bar — a wide title block + a ghost streak chip,
 *   2. one big loop-card skeleton (Radius.cardLarge) carrying a ghost header row,
 *      a title line, a ghost RSVP pill (height 50) and a 3-coin roster stack,
 *   3. three short hairline rows (the leaderboard / friends list silhouette).
 *
 * Every shimmer is a SkeletonBlock leaf, so the reduce-motion behaviour (loop
 * fully STOPS, rests static) lives in one place. The whole tree is decorative and
 * hidden from the accessibility tree.
 */

import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

import SkeletonBlock from './SkeletonBlock';

const HAIRLINE_ROW_COUNT = 3;
const ROSTER_COIN_COUNT = 3;
const ROSTER_COIN_SIZE = 36;
const ROSTER_OVERLAP = -14;

function FriendsSkeletonComponent() {
  const reduceMotion = useReduceMotion();

  return (
    <View
      style={styles.root}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 1. Compact hero bar — title block + ghost streak chip */}
      <View style={styles.hero}>
        <SkeletonBlock
          width={132}
          height={26}
          radius={Radius.small}
          reduceMotion={reduceMotion}
        />
        <SkeletonBlock
          width={64}
          height={32}
          radius={Radius.pill}
          reduceMotion={reduceMotion}
        />
      </View>

      {/* 2. One big loop-card skeleton (the live loop) */}
      <View style={styles.loopCard}>
        {/* header: ghost avatar + name line */}
        <View style={styles.cardHeader}>
          <SkeletonBlock
            width={ROSTER_COIN_SIZE}
            height={ROSTER_COIN_SIZE}
            radius={Radius.pill}
            reduceMotion={reduceMotion}
          />
          <View style={styles.cardHeaderLines}>
            <SkeletonBlock
              width={124}
              height={14}
              radius={Radius.small}
              reduceMotion={reduceMotion}
            />
            <SkeletonBlock
              width={72}
              height={10}
              radius={Radius.small}
              reduceMotion={reduceMotion}
            />
          </View>
        </View>

        {/* pub title line */}
        <SkeletonBlock
          width="62%"
          height={20}
          radius={Radius.small}
          reduceMotion={reduceMotion}
        />

        {/* ghost RSVP pill (height 50) */}
        <SkeletonBlock
          width="100%"
          height={50}
          radius={Radius.pill}
          reduceMotion={reduceMotion}
        />

        {/* 3 ghost avatar coins, overlapped like the going-roster stack */}
        <View style={styles.rosterRow}>
          {Array.from({ length: ROSTER_COIN_COUNT }).map((_, index) => (
            <View
              key={index}
              style={[styles.coin, index > 0 && styles.coinOverlap]}
            >
              <SkeletonBlock
                width={ROSTER_COIN_SIZE}
                height={ROSTER_COIN_SIZE}
                radius={Radius.pill}
                reduceMotion={reduceMotion}
              />
            </View>
          ))}
        </View>
      </View>

      {/* 3. Three short hairline rows (leaderboard / friends silhouette) */}
      <View style={styles.hairlineGroup}>
        {Array.from({ length: HAIRLINE_ROW_COUNT }).map((_, index) => (
          <View key={index} style={styles.hairlineRow}>
            <SkeletonBlock
              width={34}
              height={34}
              radius={Radius.pill}
              reduceMotion={reduceMotion}
            />
            <View style={styles.hairlineLines}>
              <SkeletonBlock
                width="52%"
                height={14}
                radius={Radius.small}
                reduceMotion={reduceMotion}
              />
              <SkeletonBlock
                width="30%"
                height={10}
                radius={Radius.small}
                reduceMotion={reduceMotion}
              />
            </View>
            <SkeletonBlock
              width={40}
              height={18}
              radius={Radius.small}
              reduceMotion={reduceMotion}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  hero: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loopCard: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    padding: Spacing.lg,
    gap: Spacing.md,
    ...softDrop(),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardHeaderLines: {
    gap: Spacing.xs,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coin: {
    backgroundColor: Colors.stout2,
    padding: 2,
    borderRadius: Radius.pill,
  },
  coinOverlap: {
    marginLeft: ROSTER_OVERLAP,
  },
  hairlineGroup: {
    marginTop: Spacing.xl,
  },
  hairlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  hairlineLines: {
    flex: 1,
    gap: Spacing.xs,
  },
});

export default memo(FriendsSkeletonComponent);
