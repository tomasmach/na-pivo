/**
 * StreakBadge — the hero chip that makes the party streak visible (Parta 2.0 §7).
 *
 * Three states gate BOTH color and motion so a dead streak never fake-glows:
 *   - lit            (currentWeeks > 0 && thisWeekLit): amber shell, amber flame,
 *                    perpetual breathe (scale 1↔1.08 + opacity 1↔0.85).
 *   - standing-unlit (currentWeeks > 0 && !thisWeekLit): same shell, dim amber
 *                    flame, STATIC — it's calling for action, the urgency lives in
 *                    the hero sub-line, not here.
 *   - dead           (currentWeeks === 0): muted shell, zero amber, "Bez série".
 *
 * Increment reward: on mount (or live bump) when currentWeeks exceeds the persisted
 * `lastSeenPartyStreak`, fire a one-shot numeral pop + a short BeerBubbles burst +
 * success haptic (gated), then persist the new value so it fires exactly once.
 *
 * Reduce-motion: flame fully static (motion STOPS, not slows), no burst, no
 * celebration haptic — the number just updates.
 *
 * Wrapped in a 44pt Pressable (hitSlop) so the chip has a tappable reason to exist
 * (no nav target): tap → a detail toast about the current streak state.
 */

import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BeerBubbles } from '@/components/celebration/BeerBubbles';
import { FlameIcon } from '@/components/shared/IconGlyph';
import type { FriendStreak } from '@/data/friendsClient';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { fireSuccessHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

const BREATHE_MS = 1200;
const BURST_MS = 1200;
/** Tappable target padding: chip is 32 tall, hitSlop lifts it to 44pt. */
const HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;

interface StreakBadgeProps {
  streak: FriendStreak;
}

function StreakBadgeImpl({ streak }: StreakBadgeProps) {
  const { currentWeeks, thisWeekLit } = streak;
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  const isDead = currentWeeks <= 0;
  const isLit = currentWeeks > 0 && thisWeekLit;

  // 0 = rest (scale 1, opacity 1), 1 = peak (scale 1.08, opacity 0.85).
  const breathe = useSharedValue(0);
  const popScale = useSharedValue(1);

  const [chipSize, setChipSize] = useState({ width: 0, height: 0 });
  const [bursting, setBursting] = useState(false);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Perpetual flame breathe — lit-only, the single celebration loop on screen.
  useEffect(() => {
    if (isLit && !reduceMotion) {
      breathe.value = withRepeat(
        withSequence(
          withTiming(1, { duration: BREATHE_MS }),
          withTiming(0, { duration: BREATHE_MS }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(breathe);
      breathe.value = 0;
    }
    return () => {
      cancelAnimation(breathe);
    };
  }, [isLit, reduceMotion, breathe]);

  // One-shot increment reward. Reads the persisted high-water mark non-reactively
  // (getState) so persisting the new value never re-renders or loops this chip.
  useEffect(() => {
    if (currentWeeks <= 0) return;
    const settings = useSettingsStore.getState();
    if (currentWeeks <= settings.lastSeenPartyStreak) return;

    settings.setLastSeenPartyStreak(currentWeeks);
    if (reduceMotion) return; // number just updates — no burst, no haptic

    popScale.value = withSequence(
      withTiming(1.18, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }),
    );

    // Defer the burst mount one frame so the setState lands in a timer callback,
    // not synchronously inside the effect (the cascading render the rule guards
    // against); it then self-clears after BURST_MS. A one-frame delay on a
    // celebration burst is imperceptible. The single timer ref tracks whichever
    // phase is pending so the unmount cleanup always clears it.
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => {
      setBursting(true);
      burstTimer.current = setTimeout(() => setBursting(false), BURST_MS);
    }, 0);

    if (settings.hapticEnabled) fireSuccessHaptic();
  }, [currentWeeks, reduceMotion, popScale]);

  useEffect(
    () => () => {
      if (burstTimer.current) clearTimeout(burstTimer.current);
      cancelAnimation(popScale);
    },
    [popScale],
  );

  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(breathe.value, [0, 1], [1, 1.08]) }],
    opacity: interpolate(breathe.value, [0, 1], [1, 0.85]),
  }));

  const numeralStyle = useAnimatedStyle(() => ({
    transform: [{ scale: popScale.value }],
  }));

  const onChipLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setChipSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  };

  const handlePress = () => {
    const detail = isLit ? t.friends.streakThisWeek : t.friends.streakDead;
    showToast(detail, {
      icon: (
        <FlameIcon size={20} color={isLit ? Colors.amber : Colors.mutedText} />
      ),
    });
  };

  const flameColor = isDead
    ? Colors.mutedText
    : isLit
      ? Colors.amber
      : withAlpha(Colors.amber, 0.55);

  const showBurst =
    bursting && !reduceMotion && chipSize.width > 0 && chipSize.height > 0;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={t.friends.streakWeeks(currentWeeks)}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      <View
        onLayout={onChipLayout}
        style={[styles.chip, isDead ? styles.chipDead : styles.chipAmber]}
      >
        {showBurst ? (
          <BeerBubbles
            width={chipSize.width}
            height={chipSize.height}
            bubbleCount={10}
            overflowVisible
          />
        ) : null}

        <Animated.View
          style={flameStyle}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          <FlameIcon size={16} color={flameColor} />
        </Animated.View>

        {isDead ? (
          <Text
            style={styles.deadLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {t.friends.streakEmpty}
          </Text>
        ) : (
          <Animated.Text
            style={[styles.numeral, numeralStyle]}
            allowFontScaling={false}
          >
            {currentWeeks}
          </Animated.Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipAmber: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderColor: withAlpha(Colors.amber, 0.32),
  },
  chipDead: {
    backgroundColor: withAlpha(Colors.foam, 0.06),
    borderColor: withAlpha(Colors.border, 0.6),
  },
  numeral: {
    fontWeight: '800',
    fontSize: 16,
    color: Colors.amber,
  },
  deadLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.mutedText,
  },
});

export default memo(StreakBadgeImpl);
