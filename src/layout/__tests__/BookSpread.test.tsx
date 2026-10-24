import React from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Modal } from '@/components/shared/Modal';
import { BookSpread } from '@/layout/BookSpread';
import { TabScreen } from '@/navigation/TabScreen';
import { useBookStore } from '@/stores/bookStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAIL_RIGHT = { top: 0, right: 84, bottom: 20, left: 0 };
let mockInsets = RAIL_RIGHT;

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn(), useRouter: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext } = jest.requireActual<typeof import('react')>('react');
  return {
    SafeAreaInsetsContext: createContext(null),
    // The open Duo on its side: the status column on the right.
    useSafeAreaInsets: () => mockInsets,
  };
});
// The pages have their own tests; here only the half under them matters.
jest.mock('@/layout/RightPage', () => ({ RightPage: () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function setWindow(width: number, height: number) {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

function Sheet({ label }: { label: string }) {
  return (
    <Modal visible transparent>
      <Text>{label}</Text>
    </Modal>
  );
}

function spread(phoneShows: 'primary' | 'secondary', sheet: boolean) {
  return (
    <BookSpread
      tab="stamgast"
      primary={<Text>counter</Text>}
      secondary={
        <>
          <Text>diary</Text>
          {sheet ? <Sheet label="stats" /> : null}
        </>
      }
      phoneShows={phoneShows}
    />
  );
}

const mounted: any[] = [];

function render(element: React.ReactElement) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer);
  return renderer;
}

const text = (renderer: any) => JSON.stringify(renderer.toJSON());
/** The host view that holds the secondary half's own screen. */
const underPage = (renderer: any) =>
  renderer.root.find(
    (node: any) => node.type === 'View' && node.props.importantForAccessibility !== undefined,
  ).props;

describe('BookSpread', () => {
  beforeEach(() => {
    useBookStore.setState(useBookStore.getInitialState(), true);
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
  });

  afterAll(() => setWindow(390, 844));

  it('lets a phone drop the hidden half with its sheet, as before', () => {
    // A notification turns the switch while the diary has a sheet open.
    setWindow(402, 874);
    const renderer = render(spread('secondary', true));
    expect(text(renderer)).toContain('stats');
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(1);

    act(() => renderer.update(spread('primary', true)));
    expect(text(renderer)).not.toContain('diary');
    expect(text(renderer)).not.toContain('stats');
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(0);
  });

  it('keeps the half that folded away with a sheet until that sheet closes', () => {
    setWindow(951, 669);
    const renderer = render(spread('primary', true));

    setWindow(466, 678);
    act(() => renderer.update(spread('primary', true)));
    expect(text(renderer)).toContain('counter');
    expect(text(renderer)).toContain('stats');

    act(() => renderer.update(spread('primary', false)));
    expect(text(renderer)).not.toContain('diary');

    // The next sheet on the phone is a phone sheet again: switching away drops it.
    act(() => renderer.update(spread('secondary', true)));
    act(() => renderer.update(spread('primary', true)));
    expect(text(renderer)).not.toContain('stats');
  });

  it('hides the half under a right page from VoiceOver while the page is open', () => {
    setWindow(951, 669);
    const renderer = render(spread('primary', false));
    expect(underPage(renderer)).toMatchObject({ accessibilityElementsHidden: false, importantForAccessibility: 'auto' });

    act(() => useBookStore.getState().show('stamgast', { kind: 'evening', startedAt: 's1' }));
    expect(underPage(renderer)).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });

    act(() => useBookStore.getState().back('stamgast'));
    expect(underPage(renderer).accessibilityElementsHidden).toBe(false);
  });

  it('ends the right half where the measured spread ends, short of the side rail', () => {
    setWindow(951, 669);
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(spread('primary', false), {
        createNodeMock: () => ({
          measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) =>
            done(0, 0, 951 - 84, 669),
        }),
      });
    });
    mounted.push(renderer);
    const root = renderer.root.find((node: any) => node.type === 'View' && node.props.onLayout);
    act(() => root.props.onLayout());
    const right = root.children[1].findAll((node: any) => node.type === 'View')[0];
    expect(StyleSheet.flatten(right.props.style)).toEqual({ width: 951 - 84 - 951 / 2 });
  });

  it('measures again when the side rail swaps sides, which moves the spread without resizing it', () => {
    setWindow(951, 669);
    let spreadX = 0;
    const tab = () => <TabScreen>{spread('primary', false)}</TabScreen>;
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(tab(), {
        createNodeMock: () => ({
          measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) =>
            done(spreadX, 0, 951 - 84, 669),
        }),
      });
    });
    mounted.push(renderer);
    const leftHalf = () =>
      StyleSheet.flatten(renderer.root.find((node: any) => node.type === 'View' && node.props.onLayout).children[0].props.style);
    expect(leftHalf()).toEqual({ width: 951 / 2 });

    // Turned the other way: the rail is on the left now, and only the screen's margin changed.
    spreadX = 84;
    mockInsets = { ...RAIL_RIGHT, right: 0, left: 84 };
    try {
      act(() => renderer.update(tab()));
    } finally {
      mockInsets = RAIL_RIGHT;
    }
    expect(leftHalf()).toEqual({ width: 951 / 2 - 84 });
  });

  it('moves the fold margin to the fold side only of a half that has a twin', () => {
    function Probe({ name }: { name: string }) {
      return React.createElement('Probe', { name, insets: React.useContext(SafeAreaInsetsContext) });
    }
    const insetsOf = (renderer: any, name: string) =>
      renderer.root.find((node: any) => node.type === 'Probe' && node.props.name === name).props.insets;
    setWindow(951, 669);

    const halves = render(
      <BookSpread tab="stamgast" primary={<Probe name="counter" />} secondary={<Probe name="diary" />} />,
    );
    expect(insetsOf(halves, 'counter')).toEqual({ top: 0, right: 20, bottom: 20, left: 0 });
    expect(insetsOf(halves, 'diary')).toEqual({ top: 0, right: 84, bottom: 20, left: 20 });

    // Parta spans the window: its right edge is the window's, not the fold.
    const whole = render(<BookSpread tab="parta" primary={<Probe name="parta" />} />);
    expect(insetsOf(whole, 'parta')).toEqual({ top: 0, right: 84, bottom: 20, left: 0 });
  });

  it('never hides the phone screen for a page kept from the open window', () => {
    act(() => useBookStore.getState().show('stamgast', { kind: 'evening', startedAt: 's1' }));
    setWindow(402, 874);
    const renderer = render(spread('secondary', false));
    expect(underPage(renderer).accessibilityElementsHidden).toBe(false);
  });
});
