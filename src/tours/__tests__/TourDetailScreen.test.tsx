import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { t } from '@/i18n';
import { showAppDialog } from '@/components/shared/AppDialog';
import { openPubInMaps } from '@/utils/maps';
import type { TourPlan, TourRun } from '../model';
import { TourJourneyIllustration } from '../TourJourneyIllustration';
import TourDetailScreen from '../TourDetailScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tourId = '11111111-1111-4111-8111-111111111111';
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockStore = {
  plans: [] as TourPlan[],
  activeRun: null as TourRun | null,
  runs: [] as TourRun[],
  published: {} as Record<string, string>,
  pending: {},
  hydrated: true,
  error: null,
  busy: false,
  hydrate: jest.fn(async () => ({ ok: true })),
  markStop: jest.fn(async (id: string, status: 'visited' | 'skipped' | null) => {
    if (!mockStore.activeRun) throw new Error('No active run');
    const statuses = { ...mockStore.activeRun.statuses };
    if (status === null) delete statuses[id]; else statuses[id] = status;
    mockStore.activeRun = { ...mockStore.activeRun, statuses };
    return { ok: true as const };
  }),
};

jest.mock('react-native', () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    ...native,
    AccessibilityInfo: { ...native.AccessibilityInfo, announceForAccessibility: jest.fn() },
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    ScrollView: react.forwardRef((props: { children?: React.ReactNode }, ref) => {
      react.useImperativeHandle(ref, () => ({ scrollTo: jest.fn() }));
      return react.createElement('ScrollView', props, props.children);
    }),
  };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: tourId }),
  useRouter: () => ({ replace: mockReplace, canGoBack: () => true, back: mockBack, push: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/stores/toursStore', () => ({
  useToursStore: Object.assign(() => mockStore, { getState: () => mockStore }),
  tourContentSignature: (plan: TourPlan) => JSON.stringify(plan.stops),
}));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/amenities/MapPubSheet', () => ({ MapPubSheet: () => null }));
jest.mock('@/components/amenities/pubInfoContext', () => ({ pubInfoFromPub: jest.fn() }));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn(async () => undefined) }));
jest.mock('../TourJourneyIllustration', () => ({ TourJourneyIllustration: jest.fn(() => null) }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null, ChevronLeftIcon: () => null, ChevronRightIcon: () => null,
  CompassIcon: () => null, EllipsisIcon: () => null, HistoryIcon: () => null,
  LockKeyholeIcon: () => null, MapIcon: () => null, MinusIcon: () => null,
}));
jest.mock('../TourMap', () => ({
  TourMap: ({ stops, onSelect, preview }: {
    stops: TourPlan['stops']; onSelect: (id: string) => void; preview?: boolean;
  }) => {
    const react = jest.requireActual<typeof import('react')>('react');
    const native = jest.requireActual<typeof import('react-native')>('react-native');
    return preview ? null : react.createElement(native.View, { testID: 'full-tour-map' },
      stops.map((stop) => react.createElement(native.Pressable, {
        key: stop.id, accessibilityRole: 'button', accessibilityLabel: `Map: ${stop.name}`,
        onPress: () => onSelect(stop.id),
      })));
  },
}));

function plan(title: string, prefix: string): TourPlan {
  return {
    id: tourId, title, revision: 1, updatedAt: '2026-09-18T10:00:00Z',
    scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague',
    stops: [1, 2].map((number) => ({
      id: `${prefix}-${number}`, pubId: `${prefix}-pub-${number}`, cacheKey: null,
      name: `${prefix} hospoda ${number}`, address: 'Praha', lat: 50 + number / 100, lon: 14,
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.plans = [plan('Současný plán', 'Plán')];
  mockStore.activeRun = {
    id: 'active-run', planId: tourId, snapshot: plan('Probíhající večer', 'Aktivní'),
    startedAt: '2026-09-18T17:00:00Z', endedAt: null, statuses: {},
  };
  mockStore.runs = [];
  mockStore.published = {};
});

it('marks the next stop, navigates to the following one, and restores the first with undo', async () => {
  const first = mockStore.activeRun!.snapshot.stops[0];
  const second = mockStore.activeRun!.snapshot.stops[1];
  const screen = render(<TourDetailScreen />);
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.nextStop}`)).toBeTruthy();

  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.markVisited)); });
  screen.rerender(<TourDetailScreen />);
  expect(mockStore.markStop).toHaveBeenLastCalledWith(first.id, 'visited');
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.visited}`)).toBeTruthy();
  expect(screen.getByLabelText(`2. ${second.name}. ${t.tours.nextStop}`)).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.navigate));
  expect(openPubInMaps).toHaveBeenLastCalledWith({ lat: second.lat, lng: second.lon, name: second.name });

  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.undo)); });
  screen.rerender(<TourDetailScreen />);
  expect(mockStore.markStop).toHaveBeenLastCalledWith(first.id, null);
  expect(screen.getByLabelText(`1. ${first.name}. ${t.tours.nextStop}`)).toBeTruthy();
  expect(screen.getByLabelText(`2. ${second.name}. ${t.tours.pending}`)).toBeTruthy();
  expect(screen.queryByLabelText(t.tours.undo)).toBeNull();
});

it('shows the historical snapshot without active-run actions and returns to the active run', () => {
  const snapshot = plan('Minulý večer', 'Historická');
  mockStore.runs = [{
    id: 'past-run', planId: tourId, snapshot, startedAt: '2026-09-10T17:00:00Z',
    endedAt: '2026-09-10T21:00:00Z', statuses: { [snapshot.stops[0].id]: 'visited' },
  }];
  const screen = render(<TourDetailScreen />);
  fireEvent.press(screen.getByLabelText(new RegExp(`^${t.tours.pastRun}\\.`)));

  expect(screen.getByText(snapshot.title)).toBeTruthy();
  expect(screen.getByLabelText(`1. ${snapshot.stops[0].name}. ${t.tours.visited}`)).toBeTruthy();
  expect(screen.queryByText(mockStore.plans[0].title)).toBeNull();
  expect(screen.queryByText(mockStore.activeRun!.snapshot.title)).toBeNull();
  expect(screen.queryByLabelText(t.tours.markVisited)).toBeNull();
  expect(screen.queryByLabelText(t.tours.navigate)).toBeNull();
  expect(screen.getByLabelText(t.tours.repeat)).toBeTruthy();

  fireEvent.press(screen.getByLabelText(t.tours.back));
  expect(screen.getByText(mockStore.activeRun!.snapshot.title)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.markVisited)).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});

it('shows only plan content in share mode, including the illustration and stop detail', () => {
  // Use the same stop IDs so accidentally leaked run states cannot hide behind different IDs.
  mockStore.plans[0].stops = mockStore.activeRun!.snapshot.stops;
  mockStore.activeRun!.statuses = { [mockStore.plans[0].stops[0].id]: 'visited', [mockStore.plans[0].stops[1].id]: 'skipped' };
  const screen = render(<TourDetailScreen />);
  fireEvent.press(screen.getByLabelText(t.tours.more));
  const dialog = jest.mocked(showAppDialog).mock.calls[0][0];
  act(() => { dialog.buttons!.find((button) => button.text === t.tours.share)!.onPress!(); });

  expect(screen.getByText(mockStore.plans[0].title)).toBeTruthy();
  expect(screen.queryByText(mockStore.activeRun!.snapshot.title)).toBeNull();
  expect(screen.queryByText(t.tours.visited)).toBeNull();
  expect(screen.queryByText(t.tours.skipped)).toBeNull();
  expect(screen.queryByLabelText(t.tours.markVisited)).toBeNull();
  expect(screen.queryByLabelText(t.tours.privateRun)).toBeNull();
  expect(screen.queryByLabelText(t.tours.end)).toBeNull();
  const artworkCalls = jest.mocked(TourJourneyIllustration).mock.calls;
  const artworkProps = artworkCalls[artworkCalls.length - 1][0];
  expect(artworkProps.statuses).toBeUndefined();
  expect(artworkProps.nextStopId).toBeUndefined();
  expect(screen.getByLabelText(t.tours.createLink)).toBeTruthy();

  const first = mockStore.plans[0].stops[0];
  fireEvent.press(screen.getByLabelText(`1. ${first.name}. ${t.tours.firstStop} · ${first.address}`));
  expect(screen.queryByLabelText(t.tours.markVisited)).toBeNull();
  expect(screen.queryByLabelText(t.tours.undoMark)).toBeNull();
  expect(screen.queryByLabelText(t.tours.skip)).toBeNull();
});

it('opens the full map, selects a stop, and restores the main controls on close', async () => {
  const screen = render(<TourDetailScreen />);
  expect(screen.queryByTestId('full-tour-map')).toBeNull();
  fireEvent.press(screen.getByLabelText(t.tours.openMap));
  expect(screen.getByTestId('full-tour-map')).toBeTruthy();
  expect(screen.queryByLabelText(t.tours.markVisited)).toBeNull();

  const second = mockStore.activeRun!.snapshot.stops[1];
  fireEvent.press(screen.getByLabelText(`Map: ${second.name}`));
  expect(screen.getByText(`2. ${second.name}`)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.fullPubDetail)).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.back));
  await waitFor(() => expect(screen.queryByTestId('full-tour-map')).toBeNull());
  expect(screen.getByLabelText(t.tours.markVisited)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.openMap)).toBeTruthy();
  expect(mockBack).not.toHaveBeenCalled();
});
