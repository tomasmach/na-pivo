/**
 * RoundPill — the one-tap "runda" reaction on a published night. Buying a
 * symbolic round is the Výčep counterpart of a kudos: one tap fills amber and
 * bumps the count with the shared numeral pop + a success haptic, tapping
 * again takes the round back. Deliberately its own word and glyph (a served
 * platter, never the beer glyph) so it can't be confused with the live
 * "Na zdraví" cheers on Parta broadcasts.
 *
 * Mirrors the CheersPill contract: optimistic flip, offline queueing through
 * `nightsQueue` on transient failures, hard-reject revert + toast, a `seqRef`
 * guard against stale async results and a ~1.5 s cooldown for double taps.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { HandPlatterIcon } from '@/components/shared/IconGlyph';
import { clearNightReaction, isRetriableNightError, reactToNight } from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic, fireSuccessHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

const PULSE_PEAK = 1.15;
const COOLDOWN_MS = 1500;
const HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;

interface RoundPillProps {
  nightId: string;
  /** Server round tally. */
  count: number;
  /** Whether I already sent a round for this night. */
  mine: boolean;
  /** Fired after a server-confirmed toggle so the parent can reconcile. */
  onChanged?: () => void;
  /** Owner handle for the a11y label, e.g. "@Pepa". */
  ownerName?: string;
}

function RoundPillBase({ nightId, count, mine, onChanged, ownerName }: RoundPillProps) {
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  const [active, setActive] = useState(mine);
  const [displayCount, setDisplayCount] = useState(count);
  const [busy, setBusy] = useState(false);

  // Keep the optimistic flip while a tap settles so a parent reload can't
  // bounce it back to the not-yet-committed server value (CheersPill idiom).
  const pendingRef = useRef(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const countScale = useSharedValue(1);
  const prevCountRef = useRef(displayCount);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (pendingRef.current) return;
    setActive(mine);
    setDisplayCount(count);
  }, [mine, count]);

  // Numeral pop on each increment, never on decrement (shared idiom).
  useEffect(() => {
    if (displayCount > prevCountRef.current && !reduceMotion) {
      countScale.value = withSequence(
        withTiming(PULSE_PEAK, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) }),
      );
    }
    prevCountRef.current = displayCount;
  }, [displayCount, reduceMotion, countScale]);

  useEffect(() => () => cancelAnimation(countScale), [countScale]);

  const numeralStyle = useAnimatedStyle(() => ({ transform: [{ scale: countScale.value }] }));

  const handlePress = useCallback(() => {
    if (busy) return;
    const turningOn = !active;
    const prevActive = active;
    const prevCount = displayCount;

    setActive(turningOn);
    setDisplayCount((c) => Math.max(0, c + (turningOn ? 1 : -1)));
    if (useSettingsStore.getState().hapticEnabled) {
      if (turningOn) fireSuccessHaptic();
      else fireLightImpactHaptic();
    }

    setBusy(true);
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    cooldownTimer.current = setTimeout(() => {
      if (mountedRef.current) setBusy(false);
    }, COOLDOWN_MS);

    pendingRef.current = true;
    const seq = ++seqRef.current;
    const call = turningOn ? reactToNight(nightId) : clearNightReaction(nightId);
    void call.then((res) => {
      if (seq !== seqRef.current) return;
      pendingRef.current = false;
      if (res.ok) {
        showToast(turningOn ? cs.vycep.roundSentToast : cs.vycep.roundUndoneToast, {
          icon: <HandPlatterIcon size={20} color={Colors.amber} />,
        });
        onChanged?.();
        return;
      }
      if (isRetriableNightError(res)) {
        // Offline / transient: keep the flip, queue the op (it WILL land).
        void enqueueNightOp(
          turningOn ? { op: 'round', nightId } : { op: 'round-clear', nightId },
        );
        showToast(cs.vycep.roundQueuedToast, {
          icon: <HandPlatterIcon size={20} color={Colors.amber} />,
        });
        return;
      }
      // Hard reject: revert.
      setActive(prevActive);
      setDisplayCount(prevCount);
      showToast(cs.vycep.roundErrorToast, {
        icon: <HandPlatterIcon size={20} color={Colors.amber} />,
      });
    });
  }, [active, busy, displayCount, nightId, showToast, onChanged]);

  const glyphColor = active ? Colors.amber : Colors.mutedText;
  const label = displayCount > 0 ? cs.vycep.roundCount(displayCount) : cs.vycep.round;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={cs.a11y.roundButton(ownerName ?? cs.vycep.round)}
      style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && styles.pressed]}
    >
      <HandPlatterIcon size={17} color={glyphColor} />
      <View>
        <Animated.Text
          style={[styles.count, active && styles.countActive, numeralStyle]}
          numberOfLines={1}
          allowFontScaling={false}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {label}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: HitArea.min - 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  pillActive: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderColor: withAlpha(Colors.amber, 0.32),
  },
  pressed: {
    opacity: 0.6,
  },
  count: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  countActive: {
    color: Colors.amber,
  },
});

export default memo(RoundPillBase);
