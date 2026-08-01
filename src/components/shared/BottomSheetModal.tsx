/**
 * A bottom sheet that actually comes up from the bottom.
 *
 * The app's sheets were `animationType="fade"` — 30+ of them, and the design
 * system mandated it (§7.2) because `"slide"` "collides with positioning the
 * card ourselves and produces a double movement". Half of that is true: `slide`
 * on a transparent Modal moves the WHOLE modal, backdrop included, so the scrim
 * wipes up from the bottom instead of fading. That reads as one big sheet of
 * dark paper sliding, not as a card rising over a screen.
 *
 * The fix is not to pick one of the two built-ins. A sheet is two motions that
 * happen together and are not the same:
 *
 *   scrim   fades  — it is a state of the screen behind
 *   card    slides — it is an object arriving from off-screen
 *
 * So the Modal itself animates nothing and both are driven here. Spring on the
 * card because it is a physical object; linear-ish fade on the scrim because
 * dimming is not a thing with mass.
 *
 * Dismissal runs the same two in reverse and only unmounts the Modal at the end
 * — `visible={false}` straight away would make the card vanish rather than leave.
 */

import React from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';

/** Matches the app's other sheet springs (`PlacesSheet`). */
const SPRING = { damping: 24, stiffness: 240, mass: 0.8 } as const;
const FADE_MS = 180;

export function BottomSheetModal({
  visible,
  onClose,
  children,
  /** Label for the tap-outside target. */
  closeLabel = 'Zavřít',
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  closeLabel?: string;
}) {
  const { height } = useWindowDimensions();
  // Mounted separately from `visible`, so the leaving animation has something
  // to play on before the Modal goes.
  const [mounted, setMounted] = React.useState(visible);
  const translateY = useSharedValue(height);
  const scrim = useSharedValue(0);

  // Mounting on the way IN happens during render, not in an effect: derived
  // state from a prop is the one place React sanctions it, and doing it in an
  // effect is the cascading-render trap (`react-hooks/set-state-in-effect`).
  // Unmounting stays in the animation's completion callback, because that is a
  // real event and not a render.
  if (visible && !mounted) setMounted(true);

  React.useEffect(() => {
    if (!mounted) return;
    if (visible) {
      translateY.value = height;
      scrim.value = withTiming(1, { duration: FADE_MS });
      translateY.value = withSpring(0, SPRING);
      return;
    }
    scrim.value = withTiming(0, { duration: FADE_MS });
    translateY.value = withTiming(height, { duration: 220 }, (finished) => {
      'worklet';
      if (finished) runOnJS(setMounted)(false);
    });
  }, [visible, height, mounted, scrim, translateY]);

  // Android's back gesture has to close the sheet, not the screen behind it.
  React.useEffect(() => {
    if (!mounted) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mounted, onClose]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      // Nothing: both motions are driven above, because they differ.
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
      </Animated.View>

      <Animated.View style={[styles.card, cardStyle]} pointerEvents="box-none">
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: withAlpha(Colors.black, 0.6),
  },
  card: { flex: 1, justifyContent: 'flex-end' },
});
