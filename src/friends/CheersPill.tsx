/**
 * CheersPill — the one-tap "Na zdraví" reaction (Parta 3.0 §C).
 *
 * A small pill (BeerIcon glyph — never an emoji — + count) that lets the quiet
 * majority acknowledge a friend's broadcast/plan/feed row without RSVPing. One
 * tap fills amber, bumps the count with the shared GoingRoster/StreakBadge
 * `countScale` numeral pop (120/160 ms) + a light haptic, and fires the reaction;
 * tapping again retracts it (mirrors the RSVP clear idiom).
 *
 * Motion rationing (binding, §C1): this reaction MUST NOT fire the BeerBubbles
 * one-shot — that signature burst stays reserved for a net-new "Jdu" and streak
 * increments. A frequent action never gets to cheapen it.
 *
 * Optimistic + offline-first: the pill flips immediately; a transient failure
 * (offline bar wifi) routes the op through `friendsQueue` and keeps the flip, a
 * hard reject reverts and toasts. A `seqRef` guard stops a stale async result
 * from clobbering a newer tap, and a ~1.5 s cooldown rate-limits double taps.
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

import { BeerIcon } from '@/components/shared/IconGlyph';
import {
  clearActivityReaction,
  reactToActivity,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
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

interface CheersPillProps {
  activityId: string;
  /** Server reaction tally for the glyph. */
  count: number;
  /** Whether I have already cheered this activity. */
  mine: boolean;
  /** Fired after a successful (server-reached) toggle — parent reloads to reconcile. */
  onChanged?: () => void;
  /** Compact variant for feed rows (glyph + count only, no word). */
  compact?: boolean;
  /** Owner handle for the a11y label, e.g. "@Pepa". */
  ownerName?: string;
}

function CheersPillBase({
  activityId,
  count,
  mine,
  onChanged,
  compact = false,
  ownerName,
}: CheersPillProps) {
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  const [active, setActive] = useState(mine);
  const [displayCount, setDisplayCount] = useState(count);
  const [busy, setBusy] = useState(false);

  // Keep the optimistic flip while a tap settles so a parent reload can't bounce
  // it back to the not-yet-committed server value (RSVP pendingRef idiom).
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

  // Reconcile with server truth on a parent reload, unless my own tap is settling.
  useEffect(() => {
    if (pendingRef.current) return;
    setActive(mine);
    setDisplayCount(count);
  }, [mine, count]);

  // Numeral pop on each increment — the shared value is written ONLY in this
  // effect (GoingRoster/StreakBadge idiom the compiler accepts). Never on
  // decrement. Kept above the cancel-on-unmount effect so the write precedes the
  // effect that uses `countScale` as a dependency (immutability rule).
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
    const call = turningOn
      ? reactToActivity(activityId, 'cheers')
      : clearActivityReaction(activityId);
    void call.then((res) => {
      if (seq !== seqRef.current) return;
      pendingRef.current = false;
      if (res.ok) {
        showToast(turningOn ? cs.friends.cheersDone : cs.friends.cheersUndone, {
          icon: <BeerIcon size={20} color={Colors.amber} />,
        });
        onChanged?.();
        return;
      }
      if (isRetriableFriendError(res)) {
        // Offline / transient: keep the optimistic flip and queue the op so it
        // lands on the next flush (honest — it WILL send).
        void enqueueFriendOp(
          turningOn ? { op: 'cheer', activityId } : { op: 'cheer-clear', activityId },
        );
        showToast(cs.friends.reactQueued, {
          icon: <BeerIcon size={20} color={Colors.amber} />,
        });
        return;
      }
      // Hard reject: revert.
      setActive(prevActive);
      setDisplayCount(prevCount);
      showToast(cs.friends.reactError, { icon: <BeerIcon size={20} color={Colors.amber} /> });
    });
  }, [active, busy, displayCount, activityId, showToast, onChanged]);

  const glyphColor = active ? Colors.amber : Colors.mutedText;
  const label =
    displayCount > 0
      ? compact
        ? String(displayCount)
        : cs.friends.cheersCount(displayCount)
      : cs.friends.cheers;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={cs.friends.cheersA11y(ownerName ?? cs.friends.cheers)}
      style={({ pressed }) => [
        compact ? styles.pillCompact : styles.pill,
        active && styles.pillActive,
        pressed && styles.pressed,
      ]}
    >
      <BeerIcon size={compact ? 16 : 17} color={glyphColor} />
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
  pillCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: HitArea.min - 12,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
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

export default memo(CheersPillBase);
