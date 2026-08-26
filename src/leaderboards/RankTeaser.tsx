/**
 * RankTeaser — the countrywide-leaderboards entry that carries data instead of
 * being a bare link: "Tenhle týden jsi 47. pivař v zemi". It lives in the
 * Parta hero, above the fold, so the Monday-reset weekly race is visible every
 * session — that reset is the retention loop the buried entry points hid.
 *
 * Self-contained: fetches the weekly beers board itself (the leaderboards
 * client caches per category×period, so refocusing the tab is normally a cache
 * hit). Renders the generic lure first and upgrades in place once data lands —
 * same layout either way, so there's no skeleton and no jump. A fetch failure
 * simply keeps the lure, which still navigates to the boards screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

import { ChevronRightIcon, EyeOffIcon, TrophyIcon } from '@/components/shared/IconGlyph';
import { fetchLeaderboard, type Leaderboard } from '@/data/leaderboardsClient';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** The chase target: the visible cut the subtitle races the user toward. */
const TOP_CUT = 10;

export function RankTeaser() {
  const router = useRouter();
  const [board, setBoard] = useState<Leaderboard | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchLeaderboard('beers', 'week').then((b) => {
        if (mountedRef.current && b) setBoard(b);
      });
    }, []),
  );

  const me = board?.me ?? null;
  const rank = me?.rank ?? null;
  const ghost = me != null && !me.eligible && rank != null;

  let subtitle: string;
  if (rank == null) {
    subtitle = t.leaderboards.teaserFallbackSubtitle;
  } else if (ghost) {
    subtitle = t.leaderboards.teaserGhostSubtitle;
  } else if (rank <= TOP_CUT) {
    subtitle = t.leaderboards.teaserTopSubtitle;
  } else {
    const cutEntry = board?.entries[TOP_CUT - 1];
    const gap = cutEntry && me ? cutEntry.score - me.score + 1 : 0;
    subtitle = gap > 0 ? t.leaderboards.teaserChase(gap) : t.leaderboards.teaserResetNote;
  }

  const open = useCallback(() => {
    router.push({ pathname: '/leaderboards', params: { source: 'parta' } } as Href);
  }, [router]);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={t.a11y.leaderboardsOpen}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
    >
      <View style={styles.iconWell}>
        {ghost ? (
          <EyeOffIcon size={20} color={Colors.amber} />
        ) : (
          <TrophyIcon size={20} color={Colors.amber} />
        )}
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {rank == null ? (
            t.leaderboards.teaserFallbackTitle
          ) : (
            <>
              {t.leaderboards.teaserTitleBefore}
              <Text style={styles.titleRank}>{t.leaderboards.teaserTitleRank(rank)}</Text>
              {t.leaderboards.teaserTitleAfter}
            </>
          )}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {subtitle}
        </Text>
      </View>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.55),
    backgroundColor: withAlpha(Colors.stout2, 0.88),
  },
  pressed: {
    opacity: 0.7,
  },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
  },
  titleRank: {
    color: Colors.amber,
  },
  subtitle: {
    marginTop: 1,
    fontWeight: '500',
    fontSize: 12.5,
    color: Colors.foamMuted,
  },
});
