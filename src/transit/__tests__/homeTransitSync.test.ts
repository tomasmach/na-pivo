jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockLoadTransitStops = jest.fn();
const mockFetchLastDirectDeparture = jest.fn();
jest.mock('@/data/transitClient', () => ({
  loadTransitStops: () => mockLoadTransitStops(),
  fetchLastDirectDeparture: (...args: unknown[]) => mockFetchLastDirectDeparture(...args),
}));

import { geohash8 } from '@/data/geohash';
import { useHomeTransitStore } from '@/stores/homeTransitStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import {
  homeTransitForCurrentEvening,
  refreshHomeTransit,
  resetHomeTransitSync,
} from '@/transit/homeTransitSync';

const HOME = { lat: 50.0905, lng: 14.4392 };
const SESSION: TallySession = {
  clientId: 'session-1',
  pubKey: geohash8(50.0712, 14.4034),
  pubName: 'U Anděla',
  startedAt: '2026-10-07T18:00:00.000Z',
  drinks: [{ id: 'beer-1', beerName: 'Plzeň', at: '2026-10-07T18:00:00.000Z' }],
};
const departure = {
  line: '9',
  headsign: 'Spojovací',
  routeType: 0,
  fromStopId: 'U1Z1P',
  fromStopName: 'Anděl',
  toStopId: 'NEAR',
  toStopName: 'Florenc',
  departsAtMs: Date.now() + 60 * 60_000,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetHomeTransitSync();
  useHomeTransitStore.getState().clear();
  useSettingsStore.setState({ homePoint: HOME });
  useTallyStore.setState({ current: SESSION, history: [] });
  mockLoadTransitStops.mockResolvedValue([
    { id: 'NEAR', lat: HOME.lat + 0.001, lng: HOME.lng },
    { id: 'FAR', lat: HOME.lat + 0.05, lng: HOME.lng },
  ]);
  mockFetchLastDirectDeparture.mockResolvedValue({ ok: true, departure });
});

it('asks with the pub point and only the stop ids near home', async () => {
  await refreshHomeTransit();

  const [params] = mockFetchLastDirectDeparture.mock.calls[0] as [Record<string, unknown>];
  expect(params.toStopIds).toEqual(['NEAR']);
  expect(params.fromLat).toBeCloseTo(50.0712, 3);
  expect(JSON.stringify(params)).not.toContain(String(HOME.lat));
  expect(useHomeTransitStore.getState().departure).toEqual(departure);
});

it('stays quiet without a home point or outside a pub', async () => {
  useSettingsStore.setState({ homePoint: null });
  await refreshHomeTransit();
  useSettingsStore.setState({ homePoint: HOME });
  useTallyStore.setState({ current: { ...SESSION, pubKey: 'ctx:private' } });
  await refreshHomeTransit({ force: true });

  expect(mockFetchLastDirectDeparture).not.toHaveBeenCalled();
  expect(useHomeTransitStore.getState().departure).toBeNull();
});

it('keeps the known connection when the network fails and drops it with the evening', async () => {
  await refreshHomeTransit();
  mockFetchLastDirectDeparture.mockResolvedValue({ ok: false });
  await refreshHomeTransit({ force: true });
  expect(useHomeTransitStore.getState().departure).toEqual(departure);

  useTallyStore.setState({ current: null });
  await refreshHomeTransit();
  expect(useHomeTransitStore.getState()).toMatchObject({ lookupKey: null, departure: null });
});

it('never shows another pub’s connection after the pub changes', async () => {
  await refreshHomeTransit();
  mockFetchLastDirectDeparture.mockResolvedValue({ ok: false });
  useTallyStore.setState({ current: { ...SESSION, pubKey: geohash8(50.08, 14.42) } });
  await refreshHomeTransit();

  expect(useHomeTransitStore.getState().departure).toBeNull();
});

it('forgets the previous evening at once, even while its request is still out', async () => {
  await refreshHomeTransit();
  let release: (value: unknown) => void = () => undefined;
  mockFetchLastDirectDeparture.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const pending = refreshHomeTransit({ force: true });

  useTallyStore.setState({ current: { ...SESSION, clientId: 'session-2' } });
  void refreshHomeTransit();

  expect(useHomeTransitStore.getState().departure).toBeNull();
  expect(homeTransitForCurrentEvening()).toBeNull();
  release({ ok: true, departure });
  await pending;
});
