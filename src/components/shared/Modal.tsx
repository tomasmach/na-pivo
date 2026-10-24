/**
 * The app's only `Modal`: React Native's, plus what an open iPhone Duo needs.
 *
 * - Every orientation is allowed, because the Duo's inner display ignores the
 *   portrait lock. Phones stay portrait through the Info.plist.
 * - A transparent sheet keeps off the window's side insets (the Duo's status
 *   column and tab rail, also when folded). On a book-shaped window it also stays
 *   in the half it was opened from (a sheet hosted at the root takes the right
 *   half); on a table a centred card stays in its half (from the root, the
 *   upper one) and a bottom sheet keeps the window. Everything outside the
 *   frame gets the sheet's own dimming (`scrimColor`), and a tap there closes
 *   the sheet. Opaque modals are full-screen pages and keep the whole window.
 * - It lays out against the window's insets, not the ones of the half it was
 *   opened from (a half swaps the fold side for the fold margin), minus the
 *   part its frame already keeps clear of.
 * - It counts itself open per half (or outside the tabs), so folding the phone
 *   keeps the half that owns it mounted and unfolding leaves a pushed page in
 *   place until it closes (a draft never disappears). On iOS it stays open
 *   until the native dismissal ends: a dialog runs the chosen action from
 *   `onDismiss`, and its host must still be there.
 * - Inside it the amber button is allowed again: the sheet is its own window.
 *
 * The child tree is the same in every mode, so a sheet never remounts when the
 * window changes size under it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  Modal as RNModal,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ColorValue,
  type ModalProps as RNModalProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';

import { FOLD_MARGIN, useBookLayout } from '@/layout/bookLayout';
import { ToneContext, usePane } from '@/layout/pane';
import { OUTSIDE_TABS, useBookStore } from '@/stores/bookStore';
import { Colors, withAlpha } from '@/theme/colors';

export interface ModalProps extends RNModalProps {
  /**
   * The sheet's own backdrop colour. A wide window dims what lies outside the
   * sheet's frame with it, so the dimming reads as one surface.
   */
  scrimColor?: ColorValue;
  /** A card centred in its frame, not a sheet from the bottom edge: on a table it keeps to its half. */
  centered?: boolean;
}

const ALL_ORIENTATIONS: ModalProps['supportedOrientations'] = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];

const DEFAULT_SCRIM = withAlpha(Colors.black, 0.6);
const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

const WindowInsetsContext = createContext<EdgeInsets | null>(null);

function WindowInsets({ children }: PropsWithChildren) {
  return <WindowInsetsContext.Provider value={useSafeAreaInsets()}>{children}</WindowInsetsContext.Provider>;
}

/** The app's root SafeAreaProvider; it keeps the window's insets for every modal below it. */
export function WindowSafeAreaProvider({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider>
      <WindowInsets>{children}</WindowInsets>
    </SafeAreaProvider>
  );
}

/** What a sheet's content sees: the window's insets, and an amber button of its own. */
function SheetContext({ insets, children }: PropsWithChildren<{ insets: EdgeInsets | null }>) {
  const content = <ToneContext.Provider value="primary">{children}</ToneContext.Provider>;
  return insets ? <SafeAreaInsetsContext.Provider value={insets}>{content}</SafeAreaInsetsContext.Provider> : content;
}

/**
 * A view inside a `Modal` styled by the modal's insets. The component that
 * renders the `Modal` sees the insets of its half instead: on a table the lower
 * half starts at the fold margin, while a sheet from it reaches the status bar.
 */
export function ModalInsetView({
  style,
  ...rest
}: Omit<ViewProps, 'style'> & { style: (insets: EdgeInsets) => StyleProp<ViewStyle>; children?: ReactNode }) {
  return <View {...rest} style={style(useSafeAreaInsets())} />;
}

/** Where a modal lays out, in window coordinates. */
export interface ModalFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FrameOptions {
  transparent?: boolean;
  centered?: boolean;
}

/**
 * Where a modal opened from here lays out. Call it in the component that
 * renders the `Modal` (it reads the same half), with the same `transparent`
 * and `centered`, to size content by the frame instead of the window.
 */
export function useModalFrame({ transparent = true, centered = false }: FrameOptions = {}): ModalFrame {
  const pane = usePane();
  const { mode, foldX, foldY } = useBookLayout();
  const window = useWindowDimensions();
  const insets = useContext(WindowInsetsContext) ?? NO_INSETS;
  if (!transparent) return { x: 0, y: 0, width: window.width, height: window.height };

  const primary = pane?.side === 'primary';
  let left = insets.left;
  let right = window.width - insets.right;
  let top = 0;
  let bottom = window.height;
  if (mode === 'book') {
    if (primary) right = Math.min(right, foldX - FOLD_MARGIN);
    else left = Math.max(left, foldX + FOLD_MARGIN);
  } else if (mode === 'tabletop' && centered) {
    // Its half, clear of the status bar above and the home indicator below.
    if (primary) {
      top = foldY + FOLD_MARGIN;
      bottom -= insets.bottom;
    } else {
      top = insets.top;
      bottom = foldY - FOLD_MARGIN;
    }
  }
  // Whole pixels: on a half pixel Yoga can round the frame and the scrim beside
  // it apart, leaving a bright hairline between them.
  const x = PixelRatio.roundToNearestPixel(left);
  const y = PixelRatio.roundToNearestPixel(top);
  return {
    x,
    y,
    width: PixelRatio.roundToNearestPixel(right) - x,
    height: PixelRatio.roundToNearestPixel(bottom) - y,
  };
}

/** The part of each window inset that still falls inside the frame. */
function insetsInFrame(insets: EdgeInsets, frame: ModalFrame, width: number, height: number): EdgeInsets {
  return {
    top: Math.max(0, insets.top - frame.y),
    left: Math.max(0, insets.left - frame.x),
    right: Math.max(0, insets.right - (width - frame.x - frame.width)),
    bottom: Math.max(0, insets.bottom - (height - frame.y - frame.height)),
  };
}

type Edge = 'top' | 'bottom' | 'left' | 'right';

const FOLD_GAP: Record<Edge, ViewStyle> = {
  top: { marginTop: 2 * FOLD_MARGIN },
  bottom: { marginBottom: 2 * FOLD_MARGIN },
  left: { marginLeft: 2 * FOLD_MARGIN },
  right: { marginRight: 2 * FOLD_MARGIN },
};

/** Dims the window around the frame; a tap there closes the sheet. */
function Scrim({ frame, color, onPress }: { frame: ModalFrame; color: ColorValue; onPress?: () => void }) {
  const { mode, foldX, foldY } = useBookLayout();
  const window = useWindowDimensions();
  const frameRight = frame.x + frame.width;
  const frameBottom = frame.y + frame.height;
  // Each piece with the edge it shares with the frame.
  const pieces: { key: Edge; facing: Edge; style: ViewStyle }[] = [
    { key: 'top', facing: 'bottom', style: { left: 0, right: 0, top: 0, height: frame.y } },
    { key: 'bottom', facing: 'top', style: { left: 0, right: 0, top: frameBottom, bottom: 0 } },
    { key: 'left', facing: 'right', style: { left: 0, width: frame.x, top: frame.y, height: frame.height } },
    { key: 'right', facing: 'left', style: { left: frameRight, right: 0, top: frame.y, height: frame.height } },
  ];
  const size: Record<Edge, number> = {
    top: frame.y,
    bottom: window.height - frameBottom,
    left: frame.x,
    right: window.width - frameRight,
  };
  // The strip along the fold dims but does not react to touch.
  const acrossFold: Record<Edge, boolean> = {
    top: mode === 'tabletop' && frame.y > foldY,
    bottom: mode === 'tabletop' && frameBottom < foldY,
    left: mode === 'book' && frame.x > foldX,
    right: mode === 'book' && frameRight < foldX,
  };
  return (
    <>
      {pieces
        .filter((piece) => size[piece.key] > 0)
        .map((piece) => (
          <View key={piece.key} style={[styles.scrim, piece.style, { backgroundColor: color }]}>
            <Pressable
              style={[styles.fill, acrossFold[piece.key] && FOLD_GAP[piece.facing]]}
              onPress={onPress}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
        ))}
    </>
  );
}

export function Modal({
  children,
  visible,
  transparent,
  onRequestClose,
  onDismiss,
  scrimColor = DEFAULT_SCRIM,
  centered = false,
  ...rest
}: ModalProps) {
  const pane = usePane();
  const window = useWindowDimensions();
  const frame = useModalFrame({ transparent: transparent === true, centered });
  const confined = frame.width !== window.width || frame.height !== window.height;
  const halfKey = pane ? `${pane.tab}:${pane.side}` : OUTSIDE_TABS;
  const windowInsets = useContext(WindowInsetsContext);
  const insets = useMemo(
    () => (windowInsets && confined ? insetsInFrame(windowInsets, frame, window.width, window.height) : windowInsets),
    [confined, frame, window.height, window.width, windowInsets],
  );

  const [wasVisible, setWasVisible] = useState(visible);
  const [dismissing, setDismissing] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    setDismissing(!visible && Platform.OS === 'ios');
  }
  const open = visible || dismissing;

  const handleDismiss = useCallback(() => {
    onDismiss?.();
    setDismissing(false);
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    useBookStore.getState().modalOpened(halfKey);
    return () => useBookStore.getState().modalClosed(halfKey);
  }, [halfKey, open]);

  return (
    <RNModal
      {...rest}
      visible={visible}
      transparent={transparent}
      onRequestClose={onRequestClose}
      onDismiss={handleDismiss}
      supportedOrientations={ALL_ORIENTATIONS}
    >
      <SheetContext insets={insets}>
        <View style={styles.window} collapsable={false}>
          <View
            style={
              confined
                ? [styles.frame, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]
                : styles.window
            }
            collapsable={false}
          >
            {children}
          </View>
          {confined ? (
            <Scrim frame={frame} color={scrimColor} onPress={onRequestClose as (() => void) | undefined} />
          ) : null}
        </View>
      </SheetContext>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1 },
  fill: { flex: 1 },
  frame: { position: 'absolute' },
  scrim: { position: 'absolute' },
});
