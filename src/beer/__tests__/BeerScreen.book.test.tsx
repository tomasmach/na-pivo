import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { t } from '@/i18n';
import { Colors } from '@/theme/colors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
}));
// The right-half pages have their own tests and pull in every detail screen.
jest.mock('@/layout/RightPage', () => ({ RightPage: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaInsetsContext: jest.requireActual<typeof import('react')>('react').createContext(null),
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/liveActivity/liveBeerActivity', () => ({
  reconcileLiveBeerActivityAndAutoArchive: jest.fn(async () => undefined),
}));
jest.mock('@/components/shared/IconGlyph', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/counter/NudgeSlot', () => ({ NudgeSlot: () => null }));
jest.mock('@/stats/useMyStats', () => ({ useMyStats: () => null }));
jest.mock('@/data/beerCheckinsClient', () => ({ fetchMyBeerCheckIns: jest.fn(async () => null) }));
jest.mock('@/data/beerCheckinsQueue', () => ({ getPendingBeerCheckIns: jest.fn(async () => []) }));
jest.mock('@/diary/DiaryStatsSheet', () => ({ DiaryStatsSheet: () => null }));
// The counter has its own tests; here it only has to show which half it is in.
const mockCounterMounted = jest.fn();
jest.mock('@/counter/CounterScreen', () => {
  const { useEffect } = jest.requireActual('react');
  const { Text: MockText } = jest.requireActual('react-native');
  const Counter = jest.fn(() => {
    useEffect(() => mockCounterMounted(), []);
    return <MockText>counter</MockText>;
  });
  return { __esModule: true, default: Counter };
});
// A draft sheet on the real shared Modal, so the half that owns it is counted.
jest.mock('@/myBeers/HistoricalBeerEntrySheet', () => {
  const { Modal: SharedModal } = jest.requireActual('@/components/shared/Modal');
  const { Text: MockText } = jest.requireActual('react-native');
  const Sheet = jest.fn(({ visible, onClose }: { visible: boolean; onClose: () => void }) => (
    <SharedModal visible={visible} transparent onRequestClose={onClose}>
      <MockText>draft sheet</MockText>
    </SharedModal>
  ));
  return { HistoricalBeerEntrySheet: Sheet };
});

const BeerScreen = require('@/beer/BeerScreen').default;
const CounterScreen = require('@/counter/CounterScreen').default as jest.Mock;
const { HistoricalBeerEntrySheet } = require('@/myBeers/HistoricalBeerEntrySheet') as {
  HistoricalBeerEntrySheet: jest.Mock;
};
const { useTallyStore } = require('@/stores/tallyStore');
const { useBookStore } = require('@/stores/bookStore');
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const windowSize = useWindowDimensions as jest.Mock;
function setWindow(width: number, height: number) {
  windowSize.mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

function render() {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(<BeerScreen />);
  });
  return renderer;
}

const host = (renderer: any, label: string) =>
  renderer.root.findAll((node: any) => typeof node.type === 'string' && node.props.accessibilityLabel === label);
const text = (renderer: any) => JSON.stringify(renderer.toJSON());
const counterShown = (renderer: any) => renderer.root.findAllByType(CounterScreen).length > 0;
const diaryShown = (renderer: any) => host(renderer, t.a11y.myBeersAddHistorical).length > 0;

function finishButtonColor(renderer: any): string {
  const [button] = host(renderer, t.a11y.myBeersAddHistorical);
  return StyleSheet.flatten(button.props.style({ pressed: false })).backgroundColor;
}

describe('Štamgast on the open iPhone Duo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useTallyStore.setState({ current: null, history: [] });
      useBookStore.setState(useBookStore.getInitialState(), true);
    });
  });

  afterAll(() => setWindow(390, 844));

  it.each([
    ['on its side', 951, 669],
    ['upright on a table', 669, 951],
  ])('shows the counter and the diary at once %s, without the switch', (_pose, width, height) => {
    setWindow(width, height);
    const renderer = render();
    expect(counterShown(renderer)).toBe(true);
    expect(diaryShown(renderer)).toBe(true);
    expect(renderer.root.findAllByProps({ testID: 'diary-segment' })).toHaveLength(0);
    // Each half keeps its own header and "…" door.
    expect(CounterScreen.mock.calls.at(-1)?.[0]).toMatchObject({ embedded: false, moreOpen: undefined });
    expect(host(renderer, t.a11y.diaryStats)).toHaveLength(1);
  });

  it('leaves the amber to the counter: "Dopiš večer" on the right is quiet', () => {
    setWindow(951, 669);
    expect(finishButtonColor(render())).toBe(Colors.stout3);
  });

  it('shows the empty trail on the right before the first evening', () => {
    setWindow(951, 669);
    expect(text(render())).toContain(t.diary.emptyTitle);
  });

  it('folds onto the counter and keeps a draft in the diary open until it is closed', () => {
    setWindow(951, 669);
    const renderer = render();
    act(() => host(renderer, t.a11y.myBeersAddHistorical)[0].props.onPress());
    expect(text(renderer)).toContain('draft sheet');
    expect(useBookStore.getState().openModals['stamgast:secondary']).toBe(1);

    setWindow(466, 678);
    act(() => renderer.update(<BeerScreen />));
    expect(counterShown(renderer)).toBe(true);
    // The counter on the left stays the same counter through the fold.
    expect(mockCounterMounted).toHaveBeenCalledTimes(1);
    expect(text(renderer)).toContain('draft sheet');
    // The phone header is back, on the counter.
    expect(renderer.root.findAllByProps({ testID: 'counter-segment' }).length).toBeGreaterThan(0);

    act(() => HistoricalBeerEntrySheet.mock.calls.at(-1)?.[0].onClose());
    expect(text(renderer)).not.toContain('draft sheet');
    expect(diaryShown(renderer)).toBe(false);
  });

  it('keeps the phone as it was: one half at a time behind the switch, the amber button lit', () => {
    setWindow(402, 874);
    const renderer = render();
    expect(counterShown(renderer)).toBe(true);
    expect(diaryShown(renderer)).toBe(false);
    expect(CounterScreen.mock.calls.at(-1)?.[0]).toMatchObject({ embedded: true, moreOpen: false });

    act(() => renderer.root.findAllByProps({ testID: 'diary-segment' })[0].props.onPress());
    expect(counterShown(renderer)).toBe(false);
    expect(diaryShown(renderer)).toBe(true);
    expect(finishButtonColor(renderer)).toBe(Colors.amber);
  });

  it('closes the phone\'s "…" when the phone opens, so folding does not bring it back', () => {
    setWindow(402, 874);
    const renderer = render();
    act(() => renderer.root.findAllByProps({ testID: 'counter-more' })[0].props.onPress());
    expect(CounterScreen.mock.calls.at(-1)?.[0].moreOpen).toBe(true);

    setWindow(951, 669);
    act(() => renderer.update(<BeerScreen />));
    // The open window gives the counter its own door.
    expect(CounterScreen.mock.calls.at(-1)?.[0].moreOpen).toBeUndefined();

    setWindow(466, 678);
    act(() => renderer.update(<BeerScreen />));
    expect(CounterScreen.mock.calls.at(-1)?.[0].moreOpen).toBe(false);
  });
});
