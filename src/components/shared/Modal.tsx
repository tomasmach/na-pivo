/**
 * The app's only `Modal`: React Native's, plus what an open iPhone Duo needs.
 *
 * - Every orientation is allowed, because the Duo's inner display ignores the
 *   portrait lock. Phones stay portrait through the Info.plist.
 * - On a book-shaped window a transparent sheet stays in the half it was opened
 *   from (a sheet hosted at the root takes the right half). The other half
 *   gets the same dimming and closes the sheet when tapped. Opaque modals are
 *   full-screen pages and keep the whole window.
 * - It counts itself open per half, so folding the phone keeps the half that
 *   owns it mounted until it closes (a draft never disappears).
 * - Inside it the amber button is allowed again: the sheet is its own window.
 *
 * The child tree is the same in every mode, so a sheet never remounts when the
 * window changes size under it.
 */

import { useEffect } from 'react';
import {
  Modal as RNModal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ModalProps,
} from 'react-native';

import { FOLD_MARGIN, useBookLayout } from '@/layout/bookLayout';
import { ToneContext, usePane } from '@/layout/pane';
import { useBookStore } from '@/stores/bookStore';
import { Colors, withAlpha } from '@/theme/colors';

export type { ModalProps };

const ALL_ORIENTATIONS: ModalProps['supportedOrientations'] = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];

interface ModalFrame {
  /** True when the sheet keeps to one half of a book-shaped window. */
  confined: boolean;
  /** The half it keeps to; a sheet hosted at the root takes the right one. */
  left: boolean;
  x: number;
  width: number;
  height: number;
}

/**
 * Where a modal opened from here lays out. Call it in the component that
 * renders the `Modal` (it reads the same half) to size content by the frame
 * instead of the window.
 */
export function useModalFrame(transparent = true): ModalFrame {
  const pane = usePane();
  const { mode, foldX } = useBookLayout();
  const window = useWindowDimensions();
  const confined = mode === 'book' && transparent;
  const left = (pane?.side ?? 'secondary') === 'primary';
  const x = confined && !left ? foldX + FOLD_MARGIN : 0;
  const width = !confined ? window.width : left ? foldX - FOLD_MARGIN : window.width - x;
  return { confined, left, x, width, height: window.height };
}

export function Modal({ children, visible, transparent, onRequestClose, ...rest }: ModalProps) {
  const pane = usePane();
  const { confined, left, x: frameLeft, width: frameWidth } = useModalFrame(transparent === true);
  const halfKey = pane ? `${pane.tab}:${pane.side}` : null;

  useEffect(() => {
    if (!visible || !halfKey) return;
    useBookStore.getState().modalOpened(halfKey);
    return () => useBookStore.getState().modalClosed(halfKey);
  }, [halfKey, visible]);

  return (
    <RNModal
      {...rest}
      visible={visible}
      transparent={transparent}
      onRequestClose={onRequestClose}
      supportedOrientations={ALL_ORIENTATIONS}
    >
      <ToneContext.Provider value="primary">
        <View style={styles.window} collapsable={false}>
          <View
            style={confined ? [styles.frame, { left: frameLeft, width: frameWidth }] : styles.window}
            collapsable={false}
          >
            {children}
          </View>
          {confined ? (
            <View
              style={[
                styles.scrim,
                left ? { left: frameWidth, right: 0 } : { left: 0, width: frameLeft },
              ]}
            >
              {/* The strip along the fold dims but does not react to touch. */}
              <Pressable
                style={[styles.fill, left ? { marginLeft: 2 * FOLD_MARGIN } : { marginRight: 2 * FOLD_MARGIN }]}
                onPress={onRequestClose as (() => void) | undefined}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </View>
          ) : null}
        </View>
      </ToneContext.Provider>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1 },
  fill: { flex: 1 },
  frame: { position: 'absolute', top: 0, bottom: 0 },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: withAlpha(Colors.black, 0.6),
  },
});
