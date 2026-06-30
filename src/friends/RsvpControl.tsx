/**
 * RsvpControl — the signature segmented control for the "jsem na pivu" loop.
 *
 * Three options (Jdu / Možná / Dneska ne) with one animated thumb that DRAINS
 * from full amber → half amber → neutral foam-wash as the answer gets cooler.
 * The thumb is the only colour-motion-that-means-something on the screen.
 *
 * Optimistic: a tap updates local state and animates instantly, then fires the
 * network call in the background. `respondToActivity` / `clearActivityResponse`
 * resolve to `{ ok }` only (no fresh activity), so on success we keep the
 * optimistic state and signal the parent via `onResponded` to reload the
 * dashboard and reconcile the roster from server truth; on failure we revert
 * and toast. Tapping the already-selected segment clears the response.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  clearActivityResponse,
  respondToActivity,
  type ActivityResponseKind,
  type FriendPubActivity,
} from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { fireLightImpactHaptic, fireSuccessHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

// Snappy slide: the thumb glides to the tapped segment in one quick, no-bounce
// pass and stops dead — a swipe that lands, not a spring that floats/settles.
const SLIDE_MS = 180;

const ORDER: readonly ActivityResponseKind[] = ['going', 'maybe', 'cant'];
const INDEX: Record<ActivityResponseKind, number> = { going: 0, maybe: 1, cant: 2 };

const TRACK_PADDING = 3;
const THUMB_INPUT = [0, 1, 2];
// Jdu = full amber, Možná = half amber, Dneska ne = neutral foam-wash. Never red.
const THUMB_COLORS = [Colors.amber, withAlpha(Colors.amber, 0.5), withAlpha(Colors.foam, 0.09)];
// Glow only at Jdu (pos 0); fades to nothing by Možná.
const THUMB_SHADOW = [0.55, 0, 0];

interface RsvpControlProps {
  activityId: string;
  myResponse: ActivityResponseKind | null;
  /**
   * Fired after a successful respond/clear. `respondToActivity` resolves to
   * `{ ok }` only — there is no fresh activity to hand back — so the optional
   * `activity` argument is reserved and currently always omitted. The parent
   * should treat this as a "reload the dashboard now" signal and reconcile the
   * roster from server truth.
   */
  onResponded: (activity?: FriendPubActivity) => void;
}

function fireLight(): void {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
}

function fireSuccess(): void {
  if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
}

function labelFor(kind: ActivityResponseKind): string {
  if (kind === 'going') return cs.friends.rsvpGoing;
  if (kind === 'maybe') return cs.friends.rsvpMaybe;
  return cs.friends.rsvpCant;
}

function RsvpControl({ activityId, myResponse, onResponded }: RsvpControlProps) {
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  const [selected, setSelected] = useState<ActivityResponseKind | null>(myResponse);
  const [trackWidth, setTrackWidth] = useState(0);

  const segW = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / 3 : 0;
  const measured = segW > 0;

  const pos = useSharedValue(myResponse ? INDEX[myResponse] : 0);
  const thumbOpacity = useSharedValue(0);

  // Whether the thumb is currently shown. Decides JUMP (fade in from hidden) vs
  // SLIDE (spring between two visible segments = the draining amber). Starts
  // hidden even when `myResponse` is preset, so the first paint fades in cleanly
  // instead of flashing at the measured position.
  const visibleRef = useRef(false);
  // Latest-action token: a stale async result never reverts/reloads over a newer tap.
  const seqRef = useRef(0);
  // While a tap is in flight, keep the optimistic choice; don't let a parent
  // refresh clobber it back to the not-yet-committed server value.
  const pendingRef = useRef(false);

  // Single animation source of truth: drive the thumb straight from the effect
  // that owns `selected`/`measured`. Deferred until measured so the thumb never
  // animates to a zero-width position (no measure-flash). Writing the shared
  // values here (rather than inside a useCallback) is the pattern the React
  // Compiler immutability rule accepts — the effect declares them as deps.
  useEffect(() => {
    if (!measured) return;
    const kind = selected;
    if (kind === null) {
      thumbOpacity.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
      visibleRef.current = false;
      return;
    }
    const target = INDEX[kind];
    if (reduceMotion) {
      pos.value = withTiming(target, { duration: 0 });
      thumbOpacity.value = withTiming(1, { duration: 0 });
    } else if (visibleRef.current) {
      // Quick slide + colour drain between two already-visible segments.
      pos.value = withTiming(target, {
        duration: SLIDE_MS,
        easing: Easing.out(Easing.cubic),
      });
      thumbOpacity.value = withTiming(1, { duration: 100 });
    } else {
      // Appear from hidden: jump to position while invisible, then fade in.
      pos.value = target;
      thumbOpacity.value = withTiming(1, { duration: 160 });
    }
    visibleRef.current = true;
  }, [selected, measured, reduceMotion, pos, thumbOpacity]);

  // Reconcile with server truth when the parent reloads the dashboard, unless a
  // tap of our own is still settling.
  useEffect(() => {
    if (pendingRef.current) return;
    setSelected(myResponse);
  }, [myResponse]);

  // Stop any in-flight thumb animation on unmount.
  useEffect(
    () => () => {
      cancelAnimation(pos);
      cancelAnimation(thumbOpacity);
    },
    [pos, thumbOpacity],
  );

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
  }, []);

  const handlePress = useCallback(
    (kind: ActivityResponseKind) => {
      const prev = selected;

      // Tapping the selected segment clears the response.
      if (prev === kind) {
        fireLight();
        setSelected(null);
        showToast(cs.friends.rsvpClearedToast);
        pendingRef.current = true;
        const seq = ++seqRef.current;
        void clearActivityResponse(activityId).then((res) => {
          if (seq !== seqRef.current) return;
          pendingRef.current = false;
          if (res.ok) {
            onResponded();
          } else {
            setSelected(prev);
            showToast(cs.friends.rsvpError);
          }
        });
        return;
      }

      // Exactly one haptic per tap: 'going' is the warm success cue, the cooler
      // 'maybe'/'cant' answers get a light impact instead.
      if (kind === 'going') fireSuccess();
      else fireLight();
      setSelected(kind);
      pendingRef.current = true;
      const seq = ++seqRef.current;
      void respondToActivity(activityId, kind).then((res) => {
        if (seq !== seqRef.current) return;
        pendingRef.current = false;
        if (res.ok) {
          onResponded();
        } else {
          setSelected(prev);
          showToast(cs.friends.rsvpError);
        }
      });
    },
    [activityId, selected, onResponded, showToast],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    opacity: thumbOpacity.value,
    transform: [{ translateX: pos.value * segW }],
    backgroundColor: interpolateColor(pos.value, THUMB_INPUT, THUMB_COLORS),
    shadowOpacity: interpolate(pos.value, THUMB_INPUT, THUMB_SHADOW, Extrapolation.CLAMP),
  }));

  const labelColorFor = (kind: ActivityResponseKind): string => {
    if (selected !== kind) return Colors.foamMuted;
    if (kind === 'going') return Colors.stout; // dark ink on full amber
    if (kind === 'maybe') return Colors.amber;
    return Colors.foamMuted; // Dneska ne — neutral wash
  };

  return (
    <View style={styles.track} onLayout={onTrackLayout} accessibilityRole="radiogroup">
      <Animated.View
        pointerEvents="none"
        style={[styles.thumb, { width: segW }, thumbStyle]}
      />

      {measured && selected === null
        ? [1, 2].map((i) => (
            <View
              key={`divider-${i}`}
              pointerEvents="none"
              style={[styles.divider, { left: TRACK_PADDING + segW * i }]}
            />
          ))
        : null}

      {ORDER.map((kind) => {
        const isSelected = selected === kind;
        const label = labelFor(kind);
        return (
          <Pressable
            key={kind}
            onPress={() => handlePress(kind)}
            style={({ pressed }) => [styles.segment, pressed && styles.segmentPressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            accessibilityHint={isSelected ? cs.mapPub.clearHint : undefined}
          >
            <Text
              style={[styles.segmentText, { color: labelColorFor(kind) }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'relative',
    height: 50,
    flexDirection: 'row',
    padding: TRACK_PADDING,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    left: TRACK_PADDING,
    top: TRACK_PADDING,
    height: HitArea.min,
    borderRadius: Radius.pill,
    // amberGlow token supplies the shadow; shadowOpacity is animated per-position.
    ...amberGlow(8),
  },
  divider: {
    position: 'absolute',
    width: 1,
    top: Spacing.md,
    bottom: Spacing.md,
    backgroundColor: withAlpha(Colors.border, 0.5),
  },
  segment: {
    flex: 1,
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentPressed: {
    opacity: 0.9,
  },
  segmentText: {
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    textAlign: 'center',
  },
});

export default memo(RsvpControl);
