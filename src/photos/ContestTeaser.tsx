/**
 * ContestTeaser — the FotoPivař entry that carries data instead of being a
 * bare link: "8 fotek v kole čeká na tvůj hlas · Končí za 3 dny". It lives in
 * the Parta hero under the RankTeaser, so the biweekly photo round is visible
 * every session — the buried Profile entry point hid the voting loop.
 *
 * Self-contained: fetches the contest snapshot through the client's teaser
 * cache (TTL-bounded, refreshed by any full contest fetch), so refocusing the
 * tab is normally a cache hit. Renders the generic lure first and upgrades in
 * place once data lands — same layout either way, no skeleton, no jump. A
 * fetch failure keeps the lure, which still navigates to the contest screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';

import { CameraIcon, ChevronRightIcon, TrophyIcon } from '@/components/shared/IconGlyph';
import { fetchPhotoContestTeaser, type PhotoContestSnapshot } from '@/data/photoContestClient';
import { cs } from '@/i18n/cs';
import { contestCountdownLabel } from '@/photos/contestCountdown';
import { useContestResultsStore } from '@/stores/contestResultsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export function ContestTeaser() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<PhotoContestSnapshot | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const lastSeenResultsId = useContestResultsStore((s) => s.lastSeenResultsContestId);
  const ingestSnapshot = useContestResultsStore((s) => s.ingestSnapshot);

  useFocusEffect(
    useCallback(() => {
      void fetchPhotoContestTeaser().then((s) => {
        if (!s) return;
        if (mountedRef.current) setSnapshot(s);
        // Also feed the results store, so a podium finisher who only opens
        // Parta still gets the one-time celebration queued.
        void ingestSnapshot(s);
      });
    }, [ingestSnapshot]),
  );

  const contest = snapshot?.contest ?? null;
  const entries = snapshot?.entries ?? [];
  const myEntry = entries.find((e) => e.isMine) ?? null;
  const voted = snapshot?.myVoteEntryId != null;
  const foreignCount = entries.length - (myEntry ? 1 : 0);

  // Fresh, unseen results outrank every running-round state for a few days:
  // opening the contest (or dismissing the celebration) marks them seen.
  const lastResults = snapshot?.lastResults ?? null;
  const resultsUnseen = lastResults != null && lastResults.contest.id !== lastSeenResultsId;
  const myRank = lastResults?.myResult?.rank ?? null;

  let subtitle: string;
  if (resultsUnseen) {
    subtitle =
      myRank != null && myRank <= 3
        ? cs.photoContest.teaserResultsPodiumSubtitle
        : cs.photoContest.teaserResultsSubtitle;
  } else {
    let base: string;
    if (!contest) {
      base = cs.photoContest.teaserFallbackSubtitle;
    } else if (myEntry) {
      base = cs.photoContest.teaserMyEntrySubtitle(cs.photoContest.votesCount(myEntry.votes));
    } else if (voted) {
      base = cs.photoContest.teaserVotedSubtitle;
    } else if (foreignCount > 0) {
      base = cs.photoContest.teaserVoteSubtitle(foreignCount);
    } else {
      base = cs.photoContest.teaserEmptySubtitle;
    }
    const countdown = contest ? contestCountdownLabel(contest.periodEnd) : '';
    subtitle = countdown ? `${base} · ${countdown}` : base;
  }

  const open = useCallback(() => {
    router.push('/photo-contest' as Href);
  }, [router]);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.photoContestLink}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
    >
      <View style={styles.iconWell}>
        {resultsUnseen ? (
          <TrophyIcon size={20} color={Colors.amber} />
        ) : (
          <CameraIcon size={20} color={Colors.amber} />
        )}
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.photoContest.title}
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
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12.5,
    color: Colors.foamMuted,
  },
});
