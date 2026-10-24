import React, { useState } from 'react';
import { Modal as RNModal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';

import {
  AppDialogHost,
  showAppDialog,
  useShowAppDialog,
  type AppDialogOptions,
} from '@/components/shared/AppDialog';
import { PaneContext, type PaneInfo } from '@/layout/pane';
import { PaneRouteMigrator } from '@/layout/PaneRouteMigrator';
import { useBookStore } from '@/stores/bookStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: jest.fn(),
  useRootNavigationState: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => {
  const { createContext } = jest.requireActual<typeof import('react')>('react');
  return {
    SafeAreaInsetsContext: createContext(null),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement('AnimatedView', props, children),
    },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
jest.mock('@/components/shared/IconGlyph', () => ({ BeerIcon: () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function setWindow(width: number, height: number) {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

const COUNTER: PaneInfo = { tab: 'stamgast', side: 'primary' };
const DOPITO = {
  title: 'Dopito?',
  message: 'Zavřu tenhle večer.',
  buttons: [{ text: 'Zrušit', style: 'cancel' as const }, { text: 'Dopito' }],
};
const CAMERA_MENU = {
  title: 'Foťák',
  buttons: [{ text: 'Pivo' }, { text: 'Lístek' }, { text: 'Zrušit', style: 'cancel' as const }],
};

/** A button in the counter's half that asks a question, like "Dopito?". */
function Counter({ ask }: { ask: AppDialogOptions }) {
  const showDialog = useShowAppDialog();
  return <Pressable testID="ask" onPress={() => showDialog(ask)} />;
}

const mounted: any[] = [];
function render(ask: AppDialogOptions) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(
      <>
        <PaneContext.Provider value={COUNTER}>
          <Counter ask={ask} />
        </PaneContext.Provider>
        <AppDialogHost />
      </>,
    );
  });
  mounted.push(renderer);
  return renderer;
}

const tapAsk = (renderer: any) => act(() => renderer.root.findByProps({ testID: 'ask' }).props.onPress());
const confirm = (renderer: any) =>
  act(() => renderer.root.findByProps({ testID: 'app-dialog-primary' }).props.onPress());

/** A length on the 3x pixel grid, where the frame's edges land. */
const px = (value: number) => Math.round(value * 3) / 3;

/** The modal's frame: the first host view laid out absolutely with a left edge. */
function frameOf(renderer: any) {
  return renderer.root
    .findAll((node: any) => node.type === 'View')
    .map((node: any) => StyleSheet.flatten(node.props.style))
    .find((style: any) => style.position === 'absolute' && style.left !== undefined);
}

describe('AppDialog on an open iPhone Duo', () => {
  beforeEach(() => useBookStore.setState(useBookStore.getInitialState(), true));
  afterEach(() => act(() => mounted.splice(0).forEach((renderer) => renderer.unmount())));
  afterAll(() => setWindow(390, 844));

  it('opens in the half the action came from, and from the root in the right half', () => {
    setWindow(951, 669);
    const renderer = render(DOPITO);

    tapAsk(renderer);
    expect(frameOf(renderer)).toMatchObject({ left: 0, width: px(951 / 2 - 20) });
    // It belongs to the counter's half, so folding keeps that half mounted.
    expect(useBookStore.getState().openModals['stamgast:primary']).toBe(1);

    confirm(renderer);
    act(() => showAppDialog(DOPITO));
    expect(frameOf(renderer)).toMatchObject({ left: px(951 / 2 + 20) });
  });

  it('keeps a centred dialog in its half of the table and lets an action menu take the window', () => {
    setWindow(669, 951);
    const renderer = render(DOPITO);

    tapAsk(renderer);
    expect(frameOf(renderer)).toMatchObject({ top: px(951 / 2 + 20) });

    confirm(renderer);
    const menu = render(CAMERA_MENU);
    tapAsk(menu);
    expect(frameOf(menu)).toBeUndefined();
  });

  it('passes nothing extra on a phone', () => {
    setWindow(402, 874);
    const renderer = render(DOPITO);
    tapAsk(renderer);
    expect(frameOf(renderer)).toBeUndefined();
    expect(JSON.stringify(renderer.toJSON())).toContain('Dopito?');
  });
});

describe('AppDialog action after the native dismissal', () => {
  beforeEach(() => useBookStore.setState(useBookStore.getInitialState(), true));
  afterEach(() => act(() => mounted.splice(0).forEach((renderer) => renderer.unmount())));
  afterAll(() => setWindow(390, 844));

  const nativeDismiss = (renderer: any) => act(() => renderer.root.findByType(RNModal).props.onDismiss());

  it('runs the action once, from onDismiss, on a phone', () => {
    setWindow(402, 874);
    const onPress = jest.fn();
    const renderer = render({ title: 'Smazat večer?', buttons: [{ text: 'Smazat', onPress }] });
    tapAsk(renderer);

    confirm(renderer);
    expect(onPress).not.toHaveBeenCalled();
    nativeDismiss(renderer);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(useBookStore.getState().openModals).toEqual({ 'stamgast:primary': 0 });
  });

  it('keeps the page under a confirmation until its action ran, when the phone opens under it', () => {
    const tabs = { name: '(tabs)', state: { index: 1, routes: [{ name: 'index' }, { name: 'beer' }] } };
    const evening = { name: 'evening', params: { startedAt: 's1' } };
    let closeEvening = () => undefined as void;
    const router = { dismissAll: jest.fn(() => closeEvening()), replace: jest.fn() };
    (useRouter as jest.Mock).mockReturnValue(router);
    (useRootNavigationState as jest.Mock).mockReturnValue({ routes: [{ name: '__root', state: { routes: [tabs, evening] } }] });
    const onPress = jest.fn();

    function App() {
      const [eveningShown, setEveningShown] = useState(true);
      closeEvening = () => setEveningShown(false);
      return (
        <>
          {eveningShown ? <AppDialogHost /> : null}
          <PaneRouteMigrator />
        </>
      );
    }

    setWindow(402, 874);
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<App />);
    });
    mounted.push(renderer);
    act(() => showAppDialog({ title: 'Smazat večer?', buttons: [{ text: 'Smazat', onPress }] }));

    setWindow(951, 669);
    act(() => renderer.update(<App />));
    confirm(renderer);
    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(AppDialogHost)).toHaveLength(1);

    nativeDismiss(renderer);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType(AppDialogHost)).toHaveLength(0);
  });
});
