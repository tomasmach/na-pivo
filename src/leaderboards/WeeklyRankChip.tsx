/**
 * WeeklyRankChip — the counter's quiet tie-in to the weekly race: a small pill
 * under the session hero ("47. v zemi tenhle týden") that opens the boards,
 * plus the post-log moment — when a just-counted beer moves the projected rank
 * up past someone visible, a one-off toast celebrates the jump.
 *
 * Stays mounted regardless of the session count (it renders null instead of
 * unmounting) so the toast bookkeeping survives an undo back to zero. Rank
 * shown is projected locally via optimisticRankAfter over the cached board —
 * beers logged this minute aren't in the server score yet.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { fetchLeaderboard, type Leaderboard } from '@/data/leaderboardsClient';
import { optimisticRankAfter } from '@/leaderboards/rankMath';
import { t } from '@/i18n';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export function WeeklyRankChip({ sessionBeerCount }: { sessionBeerCount: number }) {
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  // The cached board plus the session count at the moment it arrived — beers
  // counted after that baseline are the ones the server score can't know yet.
  const [snapshot, setSnapshot] = useState<{ board: Leaderboard; baseline: number } | null>(null);

  // Latest session count, readable from the one-shot fetch callback.
  const countRef = useRef(sessionBeerCount);
  useEffect(() => {
    countRef.current = sessionBeerCount;
  }, [sessionBeerCount]);
  // Best rank already celebrated (or the server rank at fetch) — a toast fires
  // only on an improvement past it, so undo/re-count can never repeat one.
  const celebratedRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLeaderboard('beers', 'week').then((b) => {
      if (cancelled || !b) return;
      celebratedRef.current = b.me.rank;
      setSnapshot({ board: b, baseline: countRef.current });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const extra = snapshot ? sessionBeerCount - snapshot.baseline : 0;
  const projectedRank = snapshot ? optimisticRankAfter(snapshot.board, extra) : null;

  useEffect(() => {
    if (!snapshot || extra <= 0 || projectedRank == null) return;
    const prev = celebratedRef.current;
    if (prev == null || projectedRank < prev) {
      celebratedRef.current = projectedRank;
      showToast(t.leaderboards.rankUpToast(projectedRank), {
        icon: <TrophyIcon size={20} color={Colors.amber} />,
      });
    }
  }, [snapshot, extra, projectedRank, showToast]);

  // Surfaces only once this session has a beer — the empty counter keeps its
  // clean "everything starts with one tap" hero.
  if (sessionBeerCount <= 0 || projectedRank == null) return null;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/leaderboards', params: { source: 'counter' } } as Href)}
      accessibilityRole="button"
      accessibilityLabel={t.a11y.leaderboardsOpen}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <TrophyIcon size={14} color={Colors.amber} />
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        <Text style={styles.rank}>{`${projectedRank}.`}</Text>
        {t.leaderboards.chipLabelSuffix}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: Spacing.sm,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.7),
    backgroundColor: withAlpha(Colors.stout2, 0.9),
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.foamMuted,
  },
  rank: {
    color: Colors.amber,
    fontWeight: '700',
  },
});
