/**
 * Odznaky — the whole collection. Up top the three closest levels worth
 * chasing, then the medals by theme. Tapping any of them opens its detail,
 * which BadgeHost draws.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Band, PAGE_PAD, RoundButton, SectionTitle } from '@/components/shared/FlatPage';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { BadgeCell, BadgeGoalRow, BadgeGrid } from '@/profile/BadgeRows';
import { BADGE_GROUPS, nearestGoals, type BadgeKey } from '@/profile/badgeModel';
import { LOCKED_BADGES, useAccountBadges } from '@/profile/useAccountBadges';
import { useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const NONE: readonly BadgeKey[] = [];

export function BadgesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accountId = useAccountStore((s) => s.profile?.id ?? null);
  const states = useAccountBadges() ?? LOCKED_BADGES;
  const unopened = useBadgeStore((s) => (s.accountId === accountId ? s.unopened : NONE));
  const open = useBadgeStore((s) => s.open);
  const goals = useMemo(() => nearestGoals(states), [states]);
  const earned = states.filter((state) => state.tier > 0).length;
  const now = new Date();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <RoundButton onPress={() => router.back()} label={t.a11y.backButton}>
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </RoundButton>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.badges.title}
        </Text>
        <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.badges.collectionCount(earned, states.length)}
        </Text>

        {goals.length > 0 ? (
          <>
            <SectionTitle title={t.badges.next} />
            {goals.map((state, index) => (
              <BadgeGoalRow key={state.key} state={state} first={index === 0} onPress={() => open(state.key)} />
            ))}
            <Band />
          </>
        ) : null}

        {BADGE_GROUPS.map((group) => (
          <View key={group}>
            <SectionTitle title={t.badges.groups[group]} />
            <BadgeGrid>
              {states
                .filter((state) => state.group === group)
                .map((state) => (
                  <BadgeCell
                    key={state.key}
                    state={state}
                    now={now}
                    dot={unopened.includes(state.key)}
                    onPress={() => open(state.key)}
                  />
                ))}
            </BadgeGrid>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  content: {
    paddingHorizontal: PAGE_PAD,
  },
  title: {
    marginTop: Spacing.md,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.foam,
  },
  caption: {
    marginTop: 2,
    fontSize: 15,
    color: Colors.mutedText,
  },
});
