import React from 'react';
import { Modal as RNModal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { Modal, WindowSafeAreaProvider } from '@/components/shared/Modal';
import { GlowButton } from '@/components/shared/GlowButton';
import { PaneContext, ToneContext, type PaneInfo } from '@/layout/pane';
import { OUTSIDE_TABS, useBookStore } from '@/stores/bookStore';
import { Colors } from '@/theme/colors';

// The native provider is out of reach in Jest; the context and the hook are what matter here.
jest.mock('react-native-safe-area-context', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react');
  const SafeAreaInsetsContext = createContext(null);
  return {
    SafeAreaInsetsContext,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => useContext(SafeAreaInsetsContext),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const windowSize = useWindowDimensions as jest.Mock;

function setWindow(width: number, height: number) {
  windowSize.mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

function render(element: React.ReactElement, pane: PaneInfo | null = null) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(<PaneContext.Provider value={pane}>{element}</PaneContext.Provider>);
  });
  return renderer;
}

/** A length on the 3x pixel grid, where the frame's edges land. */
const px = (value: number) => Math.round(value * 3) / 3;

/** Host views laid out absolutely with a left edge: the frame and the scrim. */
function placed(renderer: any) {
  return renderer.root
    .findAll((node: any) => node.type === 'View')
    .map((node: any) => StyleSheet.flatten(node.props.style))
    .filter((style: any) => style.position === 'absolute' && style.left !== undefined);
}

const sheet = (props: Partial<React.ComponentProps<typeof Modal>> = {}) => (
  <Modal visible transparent animationType="fade" onRequestClose={jest.fn()} {...props}>
    <Text>sheet</Text>
  </Modal>
);

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('Modal', () => {
  beforeEach(() => {
    setWindow(402, 874);
    useBookStore.setState(useBookStore.getInitialState(), true);
  });

  afterAll(() => setWindow(390, 844));

  it('is React Native Modal on a phone, allowed in every orientation', () => {
    const onRequestClose = jest.fn();
    const renderer = render(sheet({ onRequestClose, statusBarTranslucent: true }));
    const modal = renderer.root.findByType(RNModal);
    expect(modal.props).toMatchObject({
      visible: true,
      transparent: true,
      animationType: 'fade',
      statusBarTranslucent: true,
      onRequestClose,
      supportedOrientations: ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'],
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('sheet');
    expect(placed(renderer)).toEqual([]);
  });

  it('keeps a sheet from the left half in the left half and dims the right one', () => {
    setWindow(951, 669);
    const onRequestClose = jest.fn();
    const renderer = render(sheet({ onRequestClose }), { tab: 'kompas', side: 'primary' });
    const [frame, scrim] = placed(renderer);
    expect(frame).toMatchObject({ left: 0, width: px(951 / 2 - 20) });
    expect(scrim).toMatchObject({ left: px(951 / 2 - 20), right: 0 });

    act(() => renderer.root.findByType(Pressable).props.onPress());
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a sheet from the right half, or from the root, in the right half', () => {
    setWindow(951, 669);
    for (const pane of [{ tab: 'stamgast', side: 'secondary' } as const, null]) {
      const [frame, scrim] = placed(render(sheet(), pane));
      expect(frame).toMatchObject({ left: px(951 / 2 + 20), width: 951 - px(951 / 2 + 20) });
      expect(scrim).toMatchObject({ left: 0, width: px(951 / 2 + 20) });
    }
  });

  it('gives full-screen pages and the upright open phone the whole window', () => {
    setWindow(951, 669);
    expect(placed(render(sheet({ transparent: false }), { tab: 'kompas', side: 'primary' }))).toEqual([]);
    setWindow(669, 951);
    expect(placed(render(sheet(), { tab: 'kompas', side: 'primary' }))).toEqual([]);
  });

  it('counts itself open for its half until the native dismissal ends', () => {
    const pane = { tab: 'stamgast', side: 'secondary' } as const;
    const onDismiss = jest.fn();
    const renderer = render(sheet({ onDismiss }), pane);
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(1);

    act(() => renderer.update(<PaneContext.Provider value={pane}>{sheet({ visible: false, onDismiss })}</PaneContext.Provider>));
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(1);
    act(() => renderer.root.findByType(RNModal).props.onDismiss());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(0);

    act(() => renderer.update(<PaneContext.Provider value={pane}>{sheet()}</PaneContext.Provider>));
    act(() => renderer.unmount());
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(0);
  });

  it('counts a sheet outside the tabs on its own', () => {
    const renderer = render(sheet());
    expect(useBookStore.getState().openModals).toEqual({ [OUTSIDE_TABS]: 1 });
    act(() => renderer.unmount());
    expect(useBookStore.getState().openModals).toEqual({ [OUTSIDE_TABS]: 0 });
  });

  it('lets a sheet opened from the quiet half have its own amber button', () => {
    const renderer = render(
      <ToneContext.Provider value="quiet">
        <GlowButton label="outside" onPress={jest.fn()} />
        <Modal visible transparent>
          <GlowButton label="inside" onPress={jest.fn()} />
        </Modal>
      </ToneContext.Provider>,
    );
    const background = (label: string) =>
      StyleSheet.flatten(
        renderer.root
          .find((node: any) => typeof node.type === 'string' && node.props.accessibilityLabel === label)
          .children.at(-1).props.style,
      ).backgroundColor;
    expect(background('outside')).toBe(Colors.stout3);
    expect(background('inside')).toBe(Colors.amber);
  });

  describe('insets', () => {
    // The window on its side has the island on the left and the home indicator below.
    const WINDOW: EdgeInsets = { top: 24, right: 30, bottom: 20, left: 59 };
    function Probe() {
      return React.createElement('Probe', { insets: useSafeAreaInsets() });
    }

    /** A sheet opened from a half whose insets were changed the way BookSpread changes them. */
    function openFrom(
      pane: PaneInfo | null,
      halfInsets: EdgeInsets,
      props: Partial<React.ComponentProps<typeof Modal>> = {},
      window: EdgeInsets = WINDOW,
    ) {
      const renderer = render(
        <SafeAreaInsetsContext.Provider value={window}>
          <WindowSafeAreaProvider>
            <SafeAreaInsetsContext.Provider value={halfInsets}>
              <PaneContext.Provider value={pane}>
                <Modal visible transparent onRequestClose={jest.fn()} {...props}>
                  <Probe />
                </Modal>
              </PaneContext.Provider>
            </SafeAreaInsetsContext.Provider>
          </WindowSafeAreaProvider>
        </SafeAreaInsetsContext.Provider>,
      );
      return renderer;
    }
    const insetsOf = (renderer: any): EdgeInsets => renderer.root.findByType('Probe').props.insets;

    it('gives a bottom sheet on a table the window, without its sides, so it clears the status bar', () => {
      setWindow(669, 951);
      // The bottom half's top edge is the fold, so its top inset is the fold margin.
      const fromBottom = openFrom({ tab: 'stamgast', side: 'primary' }, { ...WINDOW, top: 20 });
      expect(insetsOf(fromBottom)).toEqual({ ...WINDOW, left: 0, right: 0 });
      expect(placed(fromBottom)[0]).toMatchObject({ left: 59, top: 0, width: 669 - 59 - 30, height: 951 });
      const fromTop = openFrom({ tab: 'kompas', side: 'secondary' }, { ...WINDOW, bottom: 20 });
      expect(insetsOf(fromTop)).toEqual({ ...WINDOW, left: 0, right: 0 });
    });

    it('drops the sides for a sheet kept to one half of the book', () => {
      setWindow(951, 669);
      expect(insetsOf(openFrom({ tab: 'kompas', side: 'primary' }, { ...WINDOW, right: 20 }))).toEqual({
        ...WINDOW,
        left: 0,
        right: 0,
      });
      expect(insetsOf(openFrom({ tab: 'kompas', side: 'secondary' }, { ...WINDOW, left: 20 }))).toEqual({
        ...WINDOW,
        left: 0,
        right: 0,
      });
    });

    it('keeps a sheet in the right half of the book off the status column and dims it in the sheet colour', () => {
      // The open Duo on its side: the clock, the camera and the tab rail take the right edge.
      setWindow(951, 669);
      const BOOK: EdgeInsets = { top: 0, right: 84, bottom: 20, left: 0 };
      const scrim = 'rgba(0, 0, 0, 0.85)';
      const renderer = openFrom(null, BOOK, { scrimColor: scrim }, BOOK);
      const [frame, ...pieces] = placed(renderer);
      expect(frame).toMatchObject({ left: px(951 / 2 + 20), width: 951 - 84 - px(951 / 2 + 20) });
      expect(pieces).toEqual([
        expect.objectContaining({ left: 0, width: px(951 / 2 + 20), backgroundColor: scrim }),
        expect.objectContaining({ left: 951 - 84, right: 0, backgroundColor: scrim }),
      ]);
      expect(insetsOf(renderer)).toEqual({ top: 0, right: 0, bottom: 20, left: 0 });
    });

    it('keeps a centred card in its half of the table and dims the whole window', () => {
      setWindow(669, 951);
      const TABLE: EdgeInsets = { top: 82, right: 0, bottom: 20, left: 0 };
      const fold = 951 / 2;

      const fromBottom = openFrom({ tab: 'stamgast', side: 'primary' }, { ...TABLE, top: 20 }, { centered: true }, TABLE);
      const [lower, ...aboveAndBelow] = placed(fromBottom);
      expect(lower).toMatchObject({ top: px(fold + 20), height: 951 - 20 - px(fold + 20), left: 0, width: 669 });
      expect(aboveAndBelow).toEqual([
        expect.objectContaining({ top: 0, height: px(fold + 20) }),
        expect.objectContaining({ top: 951 - 20, bottom: 0 }),
      ]);
      expect(insetsOf(fromBottom)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });

      // A card from the root takes the upper half, below the status bar.
      const fromRoot = openFrom(null, TABLE, { centered: true }, TABLE);
      const [upper] = placed(fromRoot);
      expect(upper).toMatchObject({ top: 82, height: px(fold - 20) - 82 });
      expect(insetsOf(fromRoot)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });

      // A full-screen page keeps the window.
      expect(placed(openFrom(null, TABLE, { centered: true, transparent: false }, TABLE))).toEqual([]);
    });

    it('closes from the dimmed half of the table but not from the strip along the fold', () => {
      setWindow(669, 951);
      const onRequestClose = jest.fn();
      const renderer = openFrom({ tab: 'kompas', side: 'primary' }, NO_INSETS, { centered: true, onRequestClose }, NO_INSETS);
      const [upperHalf, homeIndicator] = renderer.root.findAllByType(Pressable);
      expect(StyleSheet.flatten(upperHalf.props.style)).toMatchObject({ marginBottom: 40 });
      expect(homeIndicator).toBeUndefined();
      act(() => upperHalf.props.onPress());
      expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the window and its insets on an upright phone', () => {
      const PHONE: EdgeInsets = { top: 62, right: 0, bottom: 34, left: 0 };
      const renderer = openFrom({ tab: 'kompas', side: 'primary' }, PHONE, {}, PHONE);
      expect(placed(renderer)).toEqual([]);
      expect(insetsOf(renderer)).toEqual(PHONE);
      expect(insetsOf(openFrom(null, PHONE, { centered: true }, PHONE))).toEqual(PHONE);
    });

    it('keeps a sheet on the folded Duo off the camera column and dims the column', () => {
      setWindow(466, 678);
      const FOLDED: EdgeInsets = { top: 0, right: 84, bottom: 34, left: 0 };
      const renderer = openFrom({ tab: 'stamgast', side: 'primary' }, FOLDED, {}, FOLDED);
      const [frame, column] = placed(renderer);
      expect(frame).toMatchObject({ left: 0, top: 0, width: 466 - 84, height: 678 });
      expect(column).toMatchObject({ left: 466 - 84, right: 0 });
      expect(insetsOf(renderer)).toEqual({ top: 0, right: 0, bottom: 34, left: 0 });
    });
  });
});
