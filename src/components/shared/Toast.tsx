/**
 * Global toast/snackbar. Mounted once at the app root so it overlays every
 * screen and outlives the trigger (e.g. the contribute modal dismisses itself
 * via router.back() while this confirms "saved" on the screen underneath).
 *
 * Driven entirely by toastStore: it slides+fades in from the top, holds briefly,
 * then auto-dismisses. Tapping it dismisses early. Brass Taproom styling — a
 * raised stout pill with an amber hairline, matching WhatsNewModal.
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, Pressable, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { BeerIcon } from '@/components/shared/IconGlyph';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useToastStore } from '@/stores/toastStore';
import { useReduceMotion } from '@/utils/useReduceMotion';

/** How long the toast stays fully visible before auto-dismissing. */
const VISIBLE_MS = 2400;

export function Toast() {
  const message = useToastStore((s) => s.message);
  const token = useToastStore((s) => s.token);
  const icon = useToastStore((s) => s.icon);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!message) return;
    // Spring in (or snap directly when the user asked for reduced motion), then
    // arm the auto-dismiss. Re-runs on every token bump.
    progress.value = reduceMotion
      ? withTiming(1, { duration: 0 })
      : withSpring(1, { damping: 18, stiffness: 180, mass: 0.8 });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, VISIBLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // progress/dismiss are stable enough for this animation effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, message, reduceMotion]);

  const anim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -24 }],
  }));

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + Spacing.sm }, anim]}
    >
      <Pressable
        onPress={dismiss}
        style={[styles.toast, softDrop()]}
        accessibilityRole="button"
      >
        {/* Leading visual: a caller-supplied IconGlyph, or a drawn beer glyph.
            It used to fall back to a 🍺 emoji — emoji are banned in UI chrome
            (§12), and a toast is chrome. */}
        <View style={styles.iconSlot}>
          {icon ?? <BeerIcon size={18} color={Colors.amber} />}
        </View>
        <Text
          style={styles.text}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {message}
        </Text>
      </Pressable>
    </Animated.View>
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
  iconSlot: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
});
