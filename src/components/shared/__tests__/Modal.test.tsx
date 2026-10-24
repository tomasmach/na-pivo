import React from 'react';
import { Modal as RNModal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Modal } from '@/components/shared/Modal';
import { GlowButton } from '@/components/shared/GlowButton';
import { PaneContext, ToneContext, type PaneInfo } from '@/layout/pane';
import { useBookStore } from '@/stores/bookStore';
import { Colors } from '@/theme/colors';

jest.mock('@/data/productTelemetry', () => ({ trackScreenViewed: jest.fn() }));

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
    expect(frame).toMatchObject({ left: 0, width: 951 / 2 - 20 });
    expect(scrim).toMatchObject({ left: 951 / 2 - 20, right: 0 });

    act(() => renderer.root.findByType(Pressable).props.onPress());
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a sheet from the right half, or from the root, in the right half', () => {
    setWindow(951, 669);
    for (const pane of [{ tab: 'stamgast', side: 'secondary' } as const, null]) {
      const [frame, scrim] = placed(render(sheet(), pane));
      expect(frame).toMatchObject({ left: 951 / 2 + 20, width: 951 / 2 - 20 });
      expect(scrim).toMatchObject({ left: 0, width: 951 / 2 + 20 });
    }
  });

  it('gives full-screen pages and the upright open phone the whole window', () => {
    setWindow(951, 669);
    expect(placed(render(sheet({ transparent: false }), { tab: 'kompas', side: 'primary' }))).toEqual([]);
    setWindow(669, 951);
    expect(placed(render(sheet(), { tab: 'kompas', side: 'primary' }))).toEqual([]);
  });

  it('counts itself open for its half while visible', () => {
    const pane = { tab: 'stamgast', side: 'secondary' } as const;
    const renderer = render(sheet(), pane);
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(1);

    act(() => renderer.update(<PaneContext.Provider value={pane}>{sheet({ visible: false })}</PaneContext.Provider>));
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(0);

    act(() => renderer.update(<PaneContext.Provider value={pane}>{sheet()}</PaneContext.Provider>));
    act(() => renderer.unmount());
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(0);
  });

  it('does not count a sheet hosted at the root', () => {
    render(sheet());
    expect(useBookStore.getState().openModals).toEqual({});
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
        renderer.root.findByProps({ accessibilityLabel: label }).props.style({ pressed: false }),
      ).backgroundColor;
    expect(background('outside')).toBe(Colors.stout3);
    expect(background('inside')).toBe(Colors.amber);
  });
});
