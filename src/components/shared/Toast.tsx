/**
 * Global toast/snackbar. Mounted once at the app root so it overlays every
 * screen and outlives the trigger (e.g. the contribute modal dismisses itself
 * via router.back() while this confirms "saved" on the screen underneath).
 *
 * Driven entirely by toastStore: it slides+fades in from the top, holds briefly,
 * then auto-dismisses. Tapping it dismisses early, and so does a flick up, like
 * a system notification; holding it keeps it up. Brass Taproom styling — a
 * raised stout pill with an amber hairline, matching WhatsNewModal.
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { BeerIcon, ChevronRightIcon } from '@/components/shared/IconGlyph';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useToastStore } from '@/stores/toastStore';
import { useReduceMotion } from '@/utils/useReduceMotion';

/** How long the toast stays fully visible before auto-dismissing. */
const VISIBLE_MS = 2400;
/** A flick up past this distance or speed sends the toast away. */
const FLICK_DISTANCE = 24;
const FLICK_VELOCITY = 500;
/** Pulling the toast down only gives a little: it has nowhere to go. */
const PULL_DOWN_RESISTANCE = 0.2;

export function Toast() {
  const message = useToastStore((s) => s.message);
  const token = useToastStore((s) => s.token);
  const icon = useToastStore((s) => s.icon);
  const subtitle = useToastStore((s) => s.subtitle);
  const onPress = useToastStore((s) => s.onPress);
  const durationMs = useToastStore((s) => s.durationMs);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keyed by token so a new toast is never born held.
  const held = useToastStore((s) => s.heldToken !== null && s.heldToken === s.token);
  const setHeldToken = useToastStore((s) => s.setHeldToken);

  // Plain handler (not memoized): the immutability rule forbids mutating a
  // shared value that was passed into a hook's dep array, so `progress` stays
  // out of every deps list and we drive it from here / the effect directly.
  const dismiss = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    progress.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) runOnJS(hide)();
    });
  };

  // A finger resting on the toast holds it before any pan starts.
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => {
      runOnJS(setHeldToken)(token);
    })
    .onUpdate((event) => {
      drag.value =
        event.translationY < 0 ? event.translationY : event.translationY * PULL_DOWN_RESISTANCE;
    })
    .onEnd((event) => {
      if (event.translationY < -FLICK_DISTANCE || event.velocityY < -FLICK_VELOCITY) {
        drag.value = withTiming(-160, { duration: reduceMotion ? 0 : 180 }, (finished) => {
          if (finished) runOnJS(hide)();
        });
      } else {
        drag.value = withSpring(0, { damping: 20, stiffness: 260 });
      }
    })
    .onFinalize(() => {
      runOnJS(setHeldToken)(null);
    });

  useEffect(() => {
    if (!message) return;
    drag.value = 0;
    // Spring in (or snap directly when the user asked for reduced motion), then
    // arm the auto-dismiss. Re-runs on every token bump.
    progress.value = reduceMotion
      ? withTiming(1, { duration: 0 })
      : withSpring(1, { damping: 18, stiffness: 180, mass: 0.8 });
    // progress/drag are stable enough for this animation effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, message, reduceMotion]);

  // Auto-dismiss, paused while a finger holds the toast.
  useEffect(() => {
    if (!message || held) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, durationMs ?? VISIBLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // dismiss is a plain handler; re-arming on its identity would restart the clock every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, message, held, durationMs]);

  const anim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -24 + drag.value }],
  }));

  if (!message) return null;

  return (
    <GestureDetector gesture={pan}>
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, subtitle ? styles.wrapWide : null, { top: insets.top + (subtitle ? 0 : Spacing.sm) }, anim]}
    >
      <Pressable
        onPress={() => {
          onPress?.();
          dismiss();
        }}
        // Lifting a finger that held the toast still is not a tap: it lets the toast time out.
        onLongPress={() => undefined}
        style={[styles.toast, subtitle ? styles.toastTall : null, softDrop()]}
        accessibilityRole="button"
      >
        {/* Leading visual: a caller-supplied IconGlyph, or a drawn beer glyph.
            It used to fall back to a 🍺 emoji — emoji are banned in UI chrome
            (§12), and a toast is chrome. */}
        <View style={styles.iconSlot}>
          {icon ?? <BeerIcon size={18} color={Colors.amber} />}
        </View>
        <View style={styles.textColumn}>
          <Text
            style={styles.text}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {message}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onPress ? <ChevronRightIcon size={18} color={Colors.mutedText} /> : null}
      </Pressable>
    </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    alignItems: 'center',
    zIndex: 100,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: '100%',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.1),
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  wrapWide: {
    left: Spacing.md - 2,
    right: Spacing.md - 2,
    alignItems: 'stretch',
  },
  // The two-line toast announces a medal: full width so nothing peeks out from under it.
  toastTall: {
    borderRadius: Radius.card,
    borderColor: withAlpha(Colors.amber, 0.5),
    paddingLeft: Spacing.sm + 2,
    paddingRight: Spacing.md,
  },
  iconSlot: {
    minWidth: 22,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flexShrink: 1,
  },
  text: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
  },
});
