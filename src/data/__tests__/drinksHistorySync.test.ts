import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockEnsureBatch = jest.fn();
const mockFlushQueue = jest.fn(async () => undefined);
const mockGetQueuedIds = jest.fn(async (_ids: readonly string[]) => [] as string[]);
const mockGetBoundary = jest.fn(() => 0);

jest.mock('../drinksQueue', () => ({
  ensureHistoricalDrinkBatchQueued: (...args: unknown[]) => mockEnsureBatch(...args),
  flushDrinksQueue: () => mockFlushQueue(),
  getDrinksQueueBoundaryGeneration: () => mockGetBoundary(),
  getQueuedDrinkIds: (ids: readonly string[]) => mockGetQueuedIds(ids),
  releaseHistoricalDrinkBatch: jest.fn(),
}));

import {
  buildHistoricalDrinkEntry,
  cancelDrinksHistorySeed,
  DRINKS_HISTORY_SEEDED_KEY,
  seedDrinksFromHistory,
} from '../drinksHistorySync';
import { geohash8 } from '../geohash';
import { useTallyStore, type TallyDrink, type TallySession } from '@/stores/tallyStore';

const PUB_KEY = geohash8(50.0876, 14.4214);

function drink(index: number, overrides: Partial<TallyDrink> = {}): TallyDrink {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    beerName: 'Plzeň',
    priceCzk: 62,
    volumeMl: 500,
    at: new Date(Date.UTC(2026, 5, 14, 18, index % 60)).toISOString(),
    ...overrides,
  };
}

function session(overrides: Partial<TallySession> = {}): TallySession {
  return {
    clientId: '10000000-0000-4000-8000-000000000001',
    pubKey: PUB_KEY,
    pubName: 'U Zlatého tygra',
    pubCity: 'Praha',
    pubExternalId: 'mapy:pub-1',
    startedAt: '2026-06-14T18:00:00.000Z',
    drinks: [drink(1)],
    ...overrides,
  };
}

async function waitForCalls(mock: jest.Mock, count: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (mock.mock.calls.length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} calls, got ${mock.mock.calls.length}`);
}

beforeEach(async () => {
  cancelDrinksHistorySeed();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useTallyStore.setState({ current: null, history: [] });
  mockGetBoundary.mockReturnValue(0);
  mockEnsureBatch.mockImplementation(async (entries: { client_id: string }[]) => ({
    acceptedClientIds: entries.map((entry) => entry.client_id),
    boundaryMatches: true,
    persisted: true,
  }));
  mockGetQueuedIds.mockResolvedValue([]);
});

afterEach(() => {
  cancelDrinksHistorySeed();
  jest.useRealTimers();
});

describe('buildHistoricalDrinkEntry', () => {
  it('reconstructs a pub payload from the geohash cell without raw GPS history', () => {
    const original = session();
    const entry = buildHistoricalDrinkEntry(original, original.drinks[0]);

    expect(entry).toEqual({
      client_id: original.drinks[0].id,
      name: 'U Zlatého tygra',
      lat: expect.any(Number),
      lng: expect.any(Number),
      city: 'Praha',
      external_id: 'mapy:pub-1',
      beer: { name: 'Plzeň', price_czk: 62, volume_ml: 500 },
      drank_at: original.drinks[0].at,
    });
    expect(geohash8(entry!.lat!, entry!.lng!)).toBe(PUB_KEY);
  });

  it('builds an outside payload with context but no pub identity or coordinates', () => {
    const original = session({
      pubKey: 'ctx:private',
      pubName: 'Doma / na chatě',
      placeContext: 'private',
      drinks: [
        drink(2, {
          priceCzk: undefined,
          servingType: 'bottle',
        }),
      ],
    });
    const entry = buildHistoricalDrinkEntry(original, original.drinks[0]);

    expect(entry).toEqual({
      client_id: original.drinks[0].id,
      place_context: 'private',
      beer: { name: 'Plzeň', volume_ml: 500, serving_type: 'bottle' },
      drank_at: original.drinks[0].at,
    });
    expect(entry).not.toHaveProperty('lat');
    expect(entry).not.toHaveProperty('lng');
    expect(entry).not.toHaveProperty('name');
  });
});

describe('seedDrinksFromHistory', () => {
  it('sends at most 20 historical drinks and starts a fresh wave only after 60 seconds', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-24T12:00:00.000Z') });
    useTallyStore.setState({
      current: null,
      history: [session({ drinks: Array.from({ length: 25 }, (_, index) => drink(index + 1)) })],
    });

    await seedDrinksFromHistory();

    expect(mockEnsureBatch).toHaveBeenCalledTimes(1);
    expect(mockEnsureBatch.mock.calls[0][0]).toHaveLength(20);
    expect(await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)).toBeNull();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockEnsureBatch).toHaveBeenCalledTimes(1);

    // The timer must start a fresh snapshot, not retain the original payload.
    useTallyStore.setState({
      current: null,
      history: [
        session({
          drinks: [
            ...Array.from({ length: 24 }, (_, index) => drink(index + 1)),
            drink(99),
          ],
        }),
      ],
    });
    await jest.advanceTimersByTimeAsync(1_000);
    await waitForCalls(mockEnsureBatch, 2);
    expect(mockEnsureBatch.mock.calls[1][0]).toHaveLength(5);
    expect(
      mockEnsureBatch.mock.calls[1][0].map((entry: { client_id: string }) => entry.client_id),
    ).toContain(drink(99).id);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)) break;
      await Promise.resolve();
    }
    expect(await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)).not.toBeNull();
  });

  it('cancels a scheduled follow-up wave at an account boundary', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-24T12:00:00.000Z') });
    useTallyStore.setState({
      current: null,
      history: [session({ drinks: Array.from({ length: 25 }, (_, index) => drink(index + 1)) })],
    });

    await seedDrinksFromHistory();
    expect(mockEnsureBatch).toHaveBeenCalledTimes(1);

    cancelDrinksHistorySeed();
    await jest.advanceTimersByTimeAsync(61_000);
    expect(mockEnsureBatch).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)).toBeNull();
  });

  it('leaves the guard unset while any accepted IDs remain retryable', async () => {
    useTallyStore.setState({ current: session(), history: [] });
    mockGetQueuedIds.mockImplementation(async (ids: readonly string[]) => [...ids]);

    await seedDrinksFromHistory();

    expect(mockFlushQueue).toHaveBeenCalled();
    expect(await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)).toBeNull();
  });

  it('leaves the guard unset after a failed queue persistence', async () => {
    useTallyStore.setState({ current: session(), history: [] });
    mockEnsureBatch.mockResolvedValue({
      acceptedClientIds: [],
      boundaryMatches: true,
      persisted: false,
    });

    await seedDrinksFromHistory();

    expect(mockEnsureBatch).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)).toBeNull();
  });

  it('coalesces concurrent lifecycle calls', async () => {
    useTallyStore.setState({ current: session(), history: [] });
    let resolveBatch!: (value: {
      acceptedClientIds: string[];
      boundaryMatches: boolean;
      persisted: boolean;
    }) => void;
    mockEnsureBatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBatch = resolve;
      }),
    );

    const first = seedDrinksFromHistory();
    const second = seedDrinksFromHistory();
    await waitForCalls(mockEnsureBatch, 1);
    expect(first).toBe(second);

    resolveBatch({
      acceptedClientIds: [session().drinks[0].id],
      boundaryMatches: true,
      persisted: true,
    });
    await Promise.all([first, second]);
    expect(mockEnsureBatch).toHaveBeenCalledTimes(1);
  });

  it('does not stamp completion after an account-boundary cancellation', async () => {
    useTallyStore.setState({ current: session(), history: [] });
    let resolveBatch!: (value: {
      acceptedClientIds: string[];
      boundaryMatches: boolean;
      persisted: boolean;
    }) => void;
    mockEnsureBatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBatch = resolve;
      }),
    );

    const seeding = seedDrinksFromHistory();
    await waitForCalls(mockEnsureBatch, 1);
    cancelDrinksHistorySeed();
    resolveBatch({
      acceptedClientIds: [session().drinks[0].id],
      boundaryMatches: true,
      persisted: true,
    });
    await seeding;

    expect(await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)).toBeNull();
  });
});
