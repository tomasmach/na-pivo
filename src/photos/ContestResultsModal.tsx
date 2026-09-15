/**
 * ContestResultsModal — the one-time FotoPivař podium celebration.
 *
 * Pops once per closed round for the top 3 (queued by contestResultsStore):
 * my winning photo, a trophy medallion breaking its bottom edge, rank title,
 * and the reward receipt (votes / XP / wins) that used to be paid silently.
 *
 * Also acts as the launch gate for results: after the what's-new check
 * settles (so the two popups never stack), it pulls the cached contest
 * snapshot and lets the store decide whether anything is pending. Offline or
 * failed fetches queue nothing — the store retries on the next successful
 * fetch from any surface.
 */

import React, { useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';

import { BeerBubbles } from '@/components/celebration/BeerBubbles';
import { SoftGlow } from '@/components/celebration/SoftGlow';
import { GlowButton } from '@/components/shared/GlowButton';
import { TrophyIcon } from '@/components/shared/IconGlyph';
import { fetchPhotoContestTeaser } from '@/data/photoContestClient';
import { cs } from '@/i18n/cs';
import { useContestResultsStore } from '@/stores/contestResultsStore';
import { useLaunchModalMutex } from '@/stores/launchModalMutex';
import { useReleaseStore } from '@/stores/releaseStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow, softDrop } from '@/theme/shadows';
import { fireSuccessHaptic } from '@/utils/haptics';

const MEDALLION = 64;
const CARD_MAX_WIDTH = 420;

function rankCopy(rank: number): { title: string; body: string } {
  if (rank === 1) return { title: cs.photoContest.resultsTitleFirst, body: cs.photoContest.resultsBodyFirst };
  if (rank === 2) return { title: cs.photoContest.resultsTitleSecond, body: cs.photoContest.resultsBodySecond };
  return { title: cs.photoContest.resultsTitleThird, body: cs.photoContest.resultsBodyThird };
}

export function ContestResultsModal() {
  const pending = useContestResultsStore((s) => s.pendingResult);
  const ingestSnapshot = useContestResultsStore((s) => s.ingestSnapshot);
  const dismissResult = useContestResultsStore((s) => s.dismissResult);
  const releaseSettled = useReleaseStore((s) => s.checkSettled);
  const releaseNote = useReleaseStore((s) => s.pendingNote);
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  // Launch gate: one cached snapshot fetch once the what's-new popup is out
  // of the way. Any surface's later fetch also feeds the store, so a failure
  // here is not a missed celebration, just a delayed one.
  const gateOpen = releaseSettled && releaseNote === null;
  useEffect(() => {
    if (!gateOpen) return;
    let cancelled = false;
    void fetchPhotoContestTeaser().then((snapshot) => {
      if (!cancelled && snapshot) void ingestSnapshot(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [gateOpen, ingestSnapshot]);

  // Launch-modal mutex: only one launch popup may present at a time (two
  // sibling RN Modals wedge iOS). Claim while we want to show; a lost race
  // resolves itself when the holder releases and `holder` flips back to null.
  const holder = useLaunchModalMutex((s) => s.holder);
  const wantVisible = gateOpen && pending !== null;
  useEffect(() => {
    const mutex = useLaunchModalMutex.getState();
    if (wantVisible) mutex.claim('contest-results');
    else mutex.release('contest-results');
  }, [wantVisible, holder]);
  useEffect(() => () => useLaunchModalMutex.getState().release('contest-results'), []);
  const visible = wantVisible && holder === 'contest-results';

  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = withDelay(
        80,
        withSpring(1, { damping: 14, stiffness: 140, mass: 0.9 }),
      );
      fireSuccessHaptic();
    } else {
      progress.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) });
    }
  }, [visible, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.92 + progress.value * 0.08 },
      { translateY: (1 - progress.value) * 20 },
    ],
  }));

  if (!pending) return null;

  const { title, body } = rankCopy(pending.rank);
  const stats: { value: string; label: string }[] = [
    { value: String(pending.votes), label: cs.photoContest.resultsStatVotes },
  ];
  if (pending.xpAwarded > 0) {
    stats.push({ value: `+${pending.xpAwarded}`, label: cs.photoContest.resultsStatXp });
  }
  if (pending.rank === 1 && pending.winsCount > 0) {
    stats.push({ value: String(pending.winsCount), label: cs.photoContest.resultsStatWins });
  }

  const openContest = () => {
    dismissResult();
    router.push('/photo-contest' as Href);
  };

  const cardWidth = Math.min(screenWidth - Spacing.lg * 2, CARD_MAX_WIDTH);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissResult}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, softDrop(), amberGlow(26), cardAnim, { width: cardWidth }]}>
          {pending.imageUrl ? (
            <Image
              source={{ uri: pending.imageUrl }}
              style={styles.photo}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : null}

          {/* Trophy medallion breaking the photo's bottom edge. */}
          <View style={[styles.medallionRow, !pending.imageUrl && styles.medallionRowNoPhoto]}>
            <View style={styles.medallionGlow} pointerEvents="none">
              <SoftGlow size={MEDALLION * 2.4} color={Colors.amber} opacity={0.4} />
            </View>
            <View style={styles.medallion}>
              <TrophyIcon size={30} color={Colors.amberLight} />
            </View>
          </View>

          <View style={styles.content}>
            <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.photoContest.resultsEyebrow}
            </Text>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {title}
            </Text>
            <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
              {body}
            </Text>

            <View style={styles.statsRow}>
              {stats.map((stat, i) => (
                <React.Fragment key={stat.label}>
                  {i > 0 ? <View style={styles.statDivider} /> : null}
                  <View style={styles.stat}>
                    <Text style={styles.statValue} allowFontScaling={false}>
                      {stat.value}
                    </Text>
                    <Text style={styles.statLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                      {stat.label}
                    </Text>
                  </View>
                </React.Fragment>
              ))}
            </View>

            <GlowButton label={cs.photoContest.resultsCta} onPress={openContest} glow="soft" height={54} />
            <Pressable
              onPress={dismissResult}
              accessibilityRole="button"
              style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
            >
              <Text style={styles.closeText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.photoContest.resultsClose}
              </Text>
            </Pressable>
          </View>

          {/* Rising bubbles over the whole card; the component collapses to
              static under reduce-motion on its own. */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <BeerBubbles width={cardWidth} height={420} bubbleCount={10} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.85),
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.45),
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: 170,
    backgroundColor: Colors.stout3,
  },
  medallionRow: {
    alignItems: 'center',
    marginTop: -MEDALLION / 2,
    height: MEDALLION,
  },
  medallionRowNoPhoto: {
    marginTop: Spacing.xl,
  },
  medallionGlow: {
    position: 'absolute',
    top: MEDALLION / 2 - MEDALLION * 1.2,
  },
  medallion: {
    width: MEDALLION,
    height: MEDALLION,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.55),
    backgroundColor: Colors.stout,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    alignItems: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.amber,
  },
  title: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 33,
    color: Colors.foam,
    textAlign: 'center',
  },
  body: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  stat: {
    alignItems: 'center',
    minWidth: 64,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.border, 0.9),
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 28,
    fontVariant: ['tabular-nums'],
    color: Colors.amberLight,
  },
  statLabel: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  closeButton: {
    alignSelf: 'center',
    marginTop: Spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  closePressed: {
    opacity: 0.7,
  },
  closeText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
});
