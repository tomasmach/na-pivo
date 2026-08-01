/**
 * GoingRoster — the social-proof hero moment of the Parta loop (spec §6).
 *
 * An overlapped Avatar "coin-stack" of everyone who tapped *Jdu*, plus a loud
 * amber count numeral. The stack is going-only: the proof is who is actually
 * coming, so *maybe* / *dneska ne* never enter the coin stack — they trail as a
 * small muted secondary line.
 *
 * Two sizes via the `size` prop: `standard` (32px coins) for FriendActiveCard,
 * `large` (40px coins) for the hotter MyActivityCard.
 *
 * Each coin is wrapped in a surface-colored pill so adjacent overlaps read as
 * separated, punched-out coins. The wrapper background is a *prop* (`surfaceColor`)
 * because the same roster sits on different grounds (stout vs stout2 vs the
 * amber-tinted me-row) and the rings must match whatever it rests on. Coins are
 * zIndex-descending left→right, so the leftmost — a fresh joiner — sits on top.
 *
 * Motion (all reduce-motion gated, §9): a genuinely new coin pops scale 0.5→1
 * (pop spring), keyed by profile id and memoized so existing coins never
 * re-animate on a pull-to-refresh; the count numeral pulses 1→1.15→1 only when
 * the going count actually increments. Under reduce-motion every coin simply
 * appears at its final scale and the numeral never pulses.
 *
 * Empty (`goingCount === 0`): no stack — a single dashed ghost ring plus an
 * organic line ("Zatím nikdo nekývl." on a friend's card, "Čekáš na první
 * kývnutí." on my own).
 */

import React, { memo, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { useReduceMotion } from '@/utils/useReduceMotion';
import type { FriendProfile } from '@/data/friendsClient';

const PULSE_PEAK = 1.15;

type RosterSize = 'standard' | 'large';

interface SizeConfig {
  /** Avatar diameter in points. */
  avatar: number;
  /** Negative left margin pulling each coin onto the previous one. */
  overlap: number;
  /** Max avatars rendered before collapsing the remainder into a +N coin. */
  maxVisible: number;
  /** Count numeral font size. */
  numeral: number;
  /** Going-word font size beside the numeral. */
  word: number;
}

const SIZE_CONFIG: Record<RosterSize, SizeConfig> = {
  standard: { avatar: 32, overlap: -10, maxVisible: 4, numeral: 16, word: 13 },
  large: { avatar: 40, overlap: -14, maxVisible: 5, numeral: 22, word: 14 },
};

interface GoingRosterProps {
  /** GOING responders' profiles (server already caps the list). */
  profiles: FriendProfile[];
  /** Authoritative total of *Jdu* responses (may exceed `profiles.length`). */
  goingCount: number;
  /** Total *Možná* responses — never enters the stack. */
  maybeCount: number;
  /** Total *Dneska ne* responses — never enters the stack. */
  cantCount: number;
  /** `standard` = 32px coins (friend card), `large` = 40px coins (my card). */
  size: RosterSize;
  /** Background of the card this roster sits on, used to punch out coin rings. */
  surfaceColor: string;
  /** Whether I am among the going — appends a quiet "+ ty" to the count word. */
  iAmGoing: boolean;
  /** Tunes the empty-state copy: my own card waits, a friend's card is unanswered. */
  isMyCard?: boolean;
}

/** Builds the surface-colored coin wrapper style (punch-out ring + overlap + stacking). */
function coinWrapperStyle(
  surfaceColor: string,
  marginLeft: number,
  zIndex: number,
): ViewStyle {
  return {
    backgroundColor: surfaceColor,
    padding: 2,
    borderRadius: Radius.pill,
    marginLeft,
    zIndex,
  };
}

interface RosterCoinProps {
  profile: FriendProfile;
  avatarSize: number;
  /** -overlap for every coin past the first, 0 for the leftmost. */
  marginLeft: number;
  surfaceColor: string;
  zIndex: number;
}

/**
 * A single Avatar coin. Renders flat — no scale-in/float; a joiner simply appears
 * in the stack. Keyed by profile id + memoized upstream so existing coins are
 * never remounted when the roster array identity changes on refresh.
 */
const RosterCoin = memo(function RosterCoin({
  profile,
  avatarSize,
  marginLeft,
  surfaceColor,
  zIndex,
}: RosterCoinProps) {
  return (
    <View style={coinWrapperStyle(surfaceColor, marginLeft, zIndex)}>
      <Avatar
        uri={profile.avatarUrl}
        nickname={profile.nickname}
        displayName={profile.displayName}
        size={avatarSize}
      />
    </View>
  );
});

interface PlusDiskProps {
  count: number;
  avatarSize: number;
  marginLeft: number;
  surfaceColor: string;
  zIndex: number;
}

/** Trailing "+N" coin shown when the going count exceeds the visible avatars. */
const PlusDisk = memo(function PlusDisk({
  count,
  avatarSize,
  marginLeft,
  surfaceColor,
  zIndex,
}: PlusDiskProps) {
  return (
    <View style={coinWrapperStyle(surfaceColor, marginLeft, zIndex)}>
      <View
        style={[
          styles.plusInner,
          { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
        ]}
      >
        <Text
          style={styles.plusText}
          allowFontScaling={false}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {`+${count}`}
        </Text>
      </View>
    </View>
  );
});

function GoingRosterBase({
  profiles,
  goingCount,
  maybeCount,
  cantCount,
  size,
  surfaceColor,
  iAmGoing,
  isMyCard = false,
}: GoingRosterProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const config = SIZE_CONFIG[size];

  // Avatars actually drawn; the overflow collapses into the +N coin.
  const visibleProfiles = useMemo(
    () => profiles.slice(0, config.maxVisible),
    [profiles, config.maxVisible],
  );
  const overflow = Math.max(0, goingCount - config.maxVisible);
  const maybeCantLine = cs.friends.maybeCantLine(maybeCount, cantCount);

  // Loud count numeral pulses once on each increment (never on a refresh that
  // leaves the count unchanged).
  const countScale = useSharedValue(1);
  const prevCount = useRef(goingCount);
  useEffect(() => {
    if (goingCount > prevCount.current && !reduceMotion) {
      countScale.value = withSequence(
        withTiming(PULSE_PEAK, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }),
      );
    }
    prevCount.current = goingCount;
  }, [goingCount, reduceMotion, countScale]);
  useEffect(() => () => cancelAnimation(countScale), [countScale]);

  const numeralAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: countScale.value }],
  }));

  const goingWord = `${cs.friends.goingLabel(goingCount)}${iAmGoing ? ' + ty' : ''}`;

  // Whole roster reads as one accessible node so a screen reader gets the
  // summary instead of an unlabelled pile of avatar images.
  const a11yLabel = useMemo(() => {
    if (goingCount === 0) {
      return isMyCard ? cs.friends.nobodyYet : cs.friends.rosterEmpty;
    }
    const head = `${goingCount} ${goingWord}`;
    return maybeCantLine ? `${head}, ${maybeCantLine}` : head;
  }, [goingCount, isMyCard, goingWord, maybeCantLine]);

  return (
    <View accessible accessibilityLabel={a11yLabel}>
      {goingCount === 0 ? (
        <View style={styles.row}>
          <View
            style={[
              styles.ghostRing,
              {
                width: config.avatar,
                height: config.avatar,
                borderRadius: config.avatar / 2,
              },
            ]}
          />
          <Text
            style={styles.emptyLine}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {isMyCard ? cs.friends.nobodyYet : cs.friends.rosterEmpty}
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.stack}>
            {visibleProfiles.map((profile, index) => (
              <RosterCoin
                key={profile.id}
                profile={profile}
                avatarSize={config.avatar}
                marginLeft={index === 0 ? 0 : config.overlap}
                surfaceColor={surfaceColor}
                zIndex={visibleProfiles.length - index}
              />
            ))}
            {overflow > 0 ? (
              <PlusDisk
                count={overflow}
                avatarSize={config.avatar}
                marginLeft={config.overlap}
                surfaceColor={surfaceColor}
                zIndex={0}
              />
            ) : null}
          </View>

          <View style={styles.countLabel}>
            <Animated.Text
              style={[styles.countNumeral, { fontSize: config.numeral }, numeralAnimStyle]}
              allowFontScaling={false}
              maxFontSizeMultiplier={FontScaleCap.display}
            >
              {goingCount}
            </Animated.Text>
            <Text
              style={[styles.countWord, { fontSize: config.word }]}
              maxFontSizeMultiplier={FontScaleCap.body}
              numberOfLines={1}
            >
              {goingWord}
            </Text>
          </View>
        </View>
      )}

      {maybeCantLine ? (
        <Text
          style={styles.secondaryLine}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {maybeCantLine}
        </Text>
      ) : null}
    </View>
  );
}

export const GoingRoster = memo(GoingRosterBase);

export default GoingRoster;

// --- styles ---------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  plusInner: {
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: {
    fontWeight: '700',
    fontSize: 13,
    color: Colors.amber,
    includeFontPadding: false,
  },
  countLabel: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  countNumeral: {
    fontWeight: '800',
    color: Colors.amber,
    includeFontPadding: false,
  },
  countWord: {
    fontWeight: '500',
    color: Colors.foamMuted,
    flexShrink: 1,
  },
  secondaryLine: {
    marginTop: Spacing.xs,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
  },
  ghostRing: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: withAlpha(Colors.mutedText, 0.5),
  },
  emptyLine: {
    flexShrink: 1,
    fontWeight: '500',
    fontStyle: 'italic',
    fontSize: 13,
    color: Colors.mutedText,
  },
});
