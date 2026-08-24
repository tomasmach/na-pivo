import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { LockKeyholeIcon } from '@/components/shared/IconGlyph';
import { BADGE_CATALOG } from '@/profile/badgeCatalog';
import type { AccountAchievements, AccountMapper } from '@/data/auth';
import { cs } from '@/i18n/cs';

function resolvedAchievements(
  mapper: AccountMapper | undefined,
  achievements: AccountAchievements,
): AccountAchievements {
  return {
    ...achievements,
    firstMap: achievements.firstMap || (mapper?.firstMapperCount ?? 0) >= 1,
    explorer: achievements.explorer || (mapper?.distinctMappedPubs ?? 0) >= 10,
    cartographer: achievements.cartographer || (mapper?.distinctMappedPubs ?? 0) >= 25,
    completionist: achievements.completionist || (mapper?.completedPubsCount ?? 0) >= 1,
    factMachine: achievements.factMachine || (mapper?.amenityVotesCount ?? 0) >= 100,
  };
}

export function AchievementGrid({
  mapper,
  achievements,
  limit,
}: {
  mapper: AccountMapper | undefined;
  achievements: AccountAchievements;
  /** Show only the first N badges — the profile teaser behind "Zobrazit vše".
   *  Unset renders the whole cabinet (the /profile/badges screen). */
  limit?: number;
}) {
  const effective = useMemo(() => resolvedAchievements(mapper, achievements), [mapper, achievements]);
  const rows = useMemo(() => {
    const catalog = limit === undefined ? BADGE_CATALOG : BADGE_CATALOG.slice(0, limit);
    const result: (typeof BADGE_CATALOG)[number][][] = [];
    for (let i = 0; i < catalog.length; i += 3) result.push(catalog.slice(i, i + 3));
    return result;
  }, [limit]);

  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row[0].key} style={styles.row}>
          {row.map(({ key, title, hint, Icon }) => {
            const unlocked = effective[key];
            return (
              <View
                key={key}
                style={styles.badge}
                accessible
                accessibilityRole="image"
                accessibilityLabel={unlocked ? cs.a11y.badgeUnlocked(title) : cs.a11y.badgeLocked(title, hint)}
              >
                <View style={[styles.medallion, unlocked ? styles.medallionOn : styles.medallionOff]}>
                  {unlocked ? <Icon size={20} color={Colors.amber} /> : <LockKeyholeIcon size={20} color={Colors.mutedText} />}
                </View>
                <Text style={[styles.title, !unlocked && styles.titleLocked]} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                  {title}
                </Text>
                <Text style={styles.hint} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                  {hint}
                </Text>
              </View>
            );
          })}
          {row.length < 3 ? Array.from({ length: 3 - row.length }).map((_, i) => <View key={i} style={styles.spacer} />) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.sm + 2 },
  row: { flexDirection: 'row', gap: Spacing.sm + 2 },
  spacer: { flex: 1 },
  badge: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.stout2, borderRadius: Radius.card, borderWidth: 1, borderColor: Colors.border, paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm },
  medallion: { width: 52, height: 52, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  medallionOn: { backgroundColor: withAlpha(Colors.amber, 0.18), borderWidth: 1, borderColor: withAlpha(Colors.amber, 0.5) },
  medallionOff: { backgroundColor: Colors.stout3, borderWidth: 1, borderColor: Colors.border },
  title: { fontWeight: '700', fontSize: 13, color: Colors.foam, textAlign: 'center' },
  titleLocked: { color: Colors.mutedText },
  hint: { fontWeight: '400', fontSize: 11, lineHeight: 15, color: Colors.mutedText, textAlign: 'center' },
});
