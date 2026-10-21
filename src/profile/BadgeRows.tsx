import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { BadgeMedal, goalLook, medalLook } from '@/profile/BadgeMedal';
import type { BadgeState } from '@/profile/badgeModel';
import { badgeA11y, badgeName, cellStatus, stillLine } from '@/profile/badgeText';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export function ProgressBar({ share, thick = false }: { share: number; thick?: boolean }) {
  const percent = Math.max(2, Math.min(100, share * 100));
  return (
    <View style={[styles.track, thick && styles.trackThick]}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}

/** One next level to chase: the medal it will be, how far it is, and the bar. */
export function BadgeGoalRow({
  state,
  first,
  prefixed = false,
  onPress,
}: {
  state: BadgeState;
  first: boolean;
  /** "Na řadě: Poutník III" on the profile, where no section says it already. */
  prefixed?: boolean;
  onPress: () => void;
}) {
  const next = state.next ?? 0;
  const name = badgeName(state, state.tier + 1);
  const title = prefixed ? t.badges.nextRow(name) : name;
  const still = stillLine(state);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.goal, !first && styles.divided, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[title, still, t.badges.earnedOf(state.value, next)].filter(Boolean).join(', ')}
    >
      <BadgeMedal badge={state.key} look={goalLook(state)} size={48} />
      <View style={styles.goalText}>
        <Text style={styles.goalTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {title}
        </Text>
        {still ? (
          <Text style={styles.goalSub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {still}
          </Text>
        ) : null}
        <View style={styles.goalBar}>
          <ProgressBar share={next ? state.value / next : 0} />
        </View>
      </View>
      <Text style={styles.goalCount} maxFontSizeMultiplier={FontScaleCap.body}>
        {`${state.value}/${next}`}
      </Text>
    </Pressable>
  );
}

/** A medal in the collection grid: name with level and one number under it. */
export function BadgeCell({
  state,
  now,
  dot = false,
  status,
  onPress,
}: {
  state: BadgeState;
  now: Date;
  dot?: boolean;
  /** Replaces the usual status, e.g. the level a friend reached. */
  status?: string;
  onPress?: () => void;
}) {
  const earned = state.tier > 0;
  const body = (
    <>
      <BadgeMedal badge={state.key} look={medalLook(state)} size={64} dot={dot} />
      <Text
        style={[styles.cellName, !earned && styles.cellNameLocked]}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.display}
      >
        {badgeName(state)}
      </Text>
      <Text style={styles.cellStatus} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {status ?? cellStatus(state, now)}
      </Text>
    </>
  );
  const label = status ? `${badgeName(state)}, ${status}` : badgeA11y(state, now, dot);
  if (!onPress) {
    return (
      <View style={styles.cell} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </Pressable>
  );
}

export function BadgeGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: withAlpha(Colors.foam, 0.08),
    overflow: 'hidden',
  },
  trackThick: {
    height: 6,
    borderRadius: 3,
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  pressed: {
    opacity: 0.65,
  },
  goal: {
    minHeight: 72,
    paddingVertical: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  goalText: {
    flex: 1,
    minWidth: 0,
  },
  goalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foam,
  },
  goalSub: {
    marginTop: 2,
    fontSize: 14,
    color: Colors.mutedText,
  },
  goalBar: {
    marginTop: Spacing.sm,
  },
  goalCount: {
    minWidth: 48,
    textAlign: 'right',
    fontSize: 15,
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  grid: {
    marginTop: Spacing.xs,
    marginHorizontal: -6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.md,
  },
  cell: {
    width: '25%',
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  cellName: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: Colors.foam,
    textAlign: 'center',
  },
  cellNameLocked: {
    color: Colors.foamMuted,
  },
  cellStatus: {
    marginTop: 2,
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
