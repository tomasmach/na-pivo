import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  initializeLiveBeerActivity,
  clearLiveBeerActivityForAccountBoundary,
  reconcileLiveBeerActivityAndAutoArchive,
  reconcilePendingLiveBeerAdds,
} from '@/liveActivity/liveBeerActivity';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import type { PartyEvening } from '@/data/partyClient';
import {
  ackPendingAdds,
  clearPendingAdds,
  getPendingAdds,
} from '../../../modules/beer-live-activity';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';
import { ensureDrinkQueued, isDrinkQueued } from '@/data/drinksQueue';
import { syncVisit } from '@/data/visitsSync';
import { refreshBeerCountReminderAfterBeer } from '@/notifications/beerCountReminder';

const mockAddUserInteractionListener = jest.fn();

jest.mock('expo-widgets', () => ({
  addUserInteractionListener: mockAddUserInteractionListener,
}));

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockIosEnd = jest.fn(async () => undefined);
const mockIosGetInstances = jest.fn(() => [] as { end: typeof mockIosEnd }[]);

jest.mock('@/liveActivity/BeerEveningLiveActivity', () => ({
  default: {
    getInstances: mockIosGetInstances,
    start: jest.fn(),
  },
}));

jest.mock('../../../modules/beer-live-activity', () => ({
  ackPendingAdds: jest.fn(async () => undefined),
  clearPendingAdds: jest.fn(async () => true),
  end: jest.fn(async () => undefined),
  getPendingAdds: jest.fn(async () => []),
  getStatus: jest.fn(async () => ({ active: false, sessionId: null })),
  startOrUpdate: jest.fn(async () => undefined),
}));

jest.mock('@/data/drinksQueue', () => ({
  ensureDrinkQueued: jest.fn(async () => 'queued'),
  flushDrinksQueue: jest.fn(async () => undefined),
  isDrinkQueued: jest.fn(async () => true),
}));

jest.mock('@/data/visitsSync', () => ({
  syncVisit: jest.fn(),
}));

jest.mock('@/notifications/beerCountReminder', () => ({
  ensureNotificationPermissionForBeerFeatures: jest.fn(async () => ({ ok: true })),
  refreshBeerCountReminderAfterBeer: jest.fn(async () => ({ ok: true })),
}));

jest.mock('@/data/telemetryClient', () => ({
  trackClientEvent: jest.fn(async () => undefined),
}));

const TALLY_STORAGE_KEY = 'na-pivo-tally';
const PARTY_EVENING = {
  id: 'party-1',
  joinCode: 'PIVOXY',
  joinUrl: 'https://na-pivo.cz/party/PIVOXY',
  host: { id: 'me', nickname: 'tomas', displayName: 'Tomáš', avatarUrl: null },
  pubName: 'U Fleků',
  pubCity: 'Praha',
  active: true,
  startedAt: '2026-07-21T18:00:00.000Z',
  endedAt: null,
  isHost: true,
  members: [],
  events: [],
} as PartyEvening;

function liveSession(extraDrinks: TallySession['drinks'] = []): TallySession {
  return {
    clientId: 'session-live',
    pubKey: 'ctx:private',
    pubName: 'Doma',
    placeContext: 'private',
    startedAt: '2026-07-21T18:00:00.000Z',
    drinks: [
      {
        id: 'first-beer',
        beerName: 'Bernard 11°',
        volumeMl: 500,
        servingType: 'bottle',
        at: '2026-07-21T18:00:00.000Z',
      },
      ...extraDrinks,
    ],
  };
}

async function seedTally(current: TallySession): Promise<void> {
  useTallyStore.setState({ current, history: [] });
  await AsyncStorage.setItem(
    TALLY_STORAGE_KEY,
    JSON.stringify({ state: { current, history: [] }, version: 1 }),
  );
}

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  jest.clearAllMocks();
  mockIosGetInstances.mockReturnValue([]);
  await AsyncStorage.clear();
  await seedTally(liveSession());
  usePartyEveningStore.setState({
    evening: null,
    confirmedIdentity: null,
    lastEvening: null,
    pendingJoinCode: null,
  });
  (isDrinkQueued as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  resetPrivateAccountBoundaryForTests();
});

describe('reconcilePendingLiveBeerAdds', () => {
  it('repeats the latest beer and acknowledges only after persistence', async () => {
    (getPendingAdds as jest.Mock).mockResolvedValue([
      { id: '5caab85d-0b3f-4a8f-84bf-2dcbb9b80e24', sessionId: 'session-live', createdAt: Date.now() },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
    expect(useTallyStore.getState().current?.drinks[1]).toMatchObject({
      id: '5caab85d-0b3f-4a8f-84bf-2dcbb9b80e24',
      beerName: 'Bernard 11°',
      volumeMl: 500,
      servingType: 'bottle',
    });
    expect(ensureDrinkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: '5caab85d-0b3f-4a8f-84bf-2dcbb9b80e24',
        place_context: 'private',
        beer: expect.objectContaining({ name: 'Bernard 11°', volume_ml: 500 }),
      }),
    );
    expect(ackPendingAdds).toHaveBeenCalledWith([
      '5caab85d-0b3f-4a8f-84bf-2dcbb9b80e24',
    ]);
    expect(syncVisit).toHaveBeenCalledWith(useTallyStore.getState().current);
    expect(refreshBeerCountReminderAfterBeer).toHaveBeenCalledWith('session-live');
  });

  it('leaves the native tap pending when retry-queue persistence fails', async () => {
    const event = {
      id: '15cae85d-0b3f-4a8f-84bf-2dcbb9b80e25',
      sessionId: 'session-live',
      createdAt: Date.now(),
    };
    (getPendingAdds as jest.Mock).mockResolvedValue([event]);
    (ensureDrinkQueued as jest.Mock).mockResolvedValueOnce('storage-error');

    await reconcilePendingLiveBeerAdds();

    expect(ackPendingAdds).not.toHaveBeenCalled();
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
  });

  it('does not resurrect a tap from an evening that has already ended', async () => {
    (getPendingAdds as jest.Mock).mockResolvedValue([
      { id: '70c0d363-f6f1-492f-87e5-e89ced398544', sessionId: 'session-old', createdAt: Date.now() },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
    expect(ensureDrinkQueued).not.toHaveBeenCalled();
    expect(ackPendingAdds).toHaveBeenCalledWith([
      '70c0d363-f6f1-492f-87e5-e89ced398544',
    ]);
  });

  it('only acknowledges a late A action after the account boundary installed B', async () => {
    const transition = beginPrivateAccountTransition('account-switch', 'account-A');
    expect(transition).not.toBeNull();
    await transition!.drain();
    transition!.release();

    await seedTally({
      ...liveSession(),
      clientId: 'session-B',
      drinks: [
        {
          id: 'beer-B',
          beerName: 'Pivo B',
          at: '2026-07-21T20:00:00.000Z',
        },
      ],
    });
    (getPendingAdds as jest.Mock).mockResolvedValue([
      {
        id: '2170d363-f6f1-492f-87e5-e89ced398599',
        sessionId: 'session-A',
        createdAt: Date.now(),
      },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(useTallyStore.getState().current?.clientId).toBe('session-B');
    expect(useTallyStore.getState().current?.drinks).toEqual([
      expect.objectContaining({ id: 'beer-B' }),
    ]);
    expect(ensureDrinkQueued).not.toHaveBeenCalled();
    expect(syncVisit).not.toHaveBeenCalled();
    expect(refreshBeerCountReminderAfterBeer).not.toHaveBeenCalled();
    expect(ackPendingAdds).toHaveBeenCalledWith([
      '2170d363-f6f1-492f-87e5-e89ced398599',
    ]);
  });

  it('strictly ends the iOS activity and drains a late native add with readback', async () => {
    mockIosGetInstances
      .mockReturnValueOnce([{ end: mockIosEnd }])
      .mockReturnValueOnce([]);
    (getPendingAdds as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: '3170d363-f6f1-492f-87e5-e89ced398511',
          sessionId: 'session-A',
          createdAt: Date.now(),
        },
      ])
      .mockResolvedValueOnce([]);
    const transition = beginPrivateAccountTransition('account-switch', 'account-A');
    await transition!.drain();

    await expect(clearLiveBeerActivityForAccountBoundary()).resolves.toBe(true);

    expect(mockIosEnd).toHaveBeenCalledWith('immediate');
    expect(clearPendingAdds).toHaveBeenCalledTimes(2);
    expect(ackPendingAdds).toHaveBeenCalledWith([
      '3170d363-f6f1-492f-87e5-e89ced398511',
    ]);
    transition!.release();
  });

  it('is idempotent when a committed event is replayed before native ack', async () => {
    const repeated = {
      id: '54daa210-cf41-48c4-a839-3759734eed5a',
      beerName: 'Bernard 11°',
      volumeMl: 500,
      at: '2026-07-21T18:20:00.000Z',
    };
    await seedTally(liveSession([repeated]));
    (getPendingAdds as jest.Mock).mockResolvedValue([
      { id: repeated.id, sessionId: 'session-live', createdAt: Date.now() },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
    expect(ackPendingAdds).toHaveBeenCalledWith([repeated.id]);
  });

  it('repeats the beer snapshotted when the native action was tapped', async () => {
    await seedTally(
      liveSession([
        {
          id: 'newer-in-app-beer',
          beerName: 'Kozel 11°',
          priceCzk: 49,
          volumeMl: 400,
          servingType: 'draft',
          at: '2026-07-21T18:30:00.000Z',
        },
      ]),
    );
    (getPendingAdds as jest.Mock).mockResolvedValue([
      {
        id: 'ec293932-bcf1-4864-902d-30d50c1707e5',
        sessionId: 'session-live',
        createdAt: Date.now(),
        beerName: 'Bernard 11°',
        priceCzk: 65,
        volumeMl: 500,
        servingType: 'bottle',
      },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(useTallyStore.getState().current?.drinks.at(-1)).toMatchObject({
      beerName: 'Bernard 11°',
      priceCzk: 65,
      volumeMl: 500,
      servingType: 'bottle',
    });
    expect(ensureDrinkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'ec293932-bcf1-4864-902d-30d50c1707e5',
        beer: expect.objectContaining({
          name: 'Bernard 11°',
          price_czk: 65,
          volume_ml: 500,
          serving_type: 'bottle',
        }),
      }),
    );
  });

  it('tags a lock-screen +1 and its visit with the active shared table', async () => {
    usePartyEveningStore.setState({ evening: PARTY_EVENING });
    (getPendingAdds as jest.Mock).mockResolvedValue([
      {
        id: 'ca66db75-06a2-46c0-a2a0-f57d7d65f277',
        sessionId: 'session-live',
        createdAt: Date.now(),
      },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(ensureDrinkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'ca66db75-06a2-46c0-a2a0-f57d7d65f277',
        party_code: 'PIVOXY',
      }),
    );
    expect(syncVisit).toHaveBeenCalledWith(
      useTallyStore.getState().current,
      undefined,
      'PIVOXY',
    );
  });

  it('tags a lock-screen +1 after a cold relaunch restored only the table identity', async () => {
    usePartyEveningStore.setState({
      evening: null,
      confirmedIdentity: {
        id: PARTY_EVENING.id,
        joinCode: PARTY_EVENING.joinCode,
        isHost: PARTY_EVENING.isHost,
        confirmedAt: Date.now(),
      },
    });
    (getPendingAdds as jest.Mock).mockResolvedValue([
      {
        id: 'da77db75-06a2-46c0-a2a0-f57d7d65f288',
        sessionId: 'session-live',
        createdAt: Date.now(),
      },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(ensureDrinkQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'da77db75-06a2-46c0-a2a0-f57d7d65f288',
        party_code: 'PIVOXY',
      }),
    );
    expect(syncVisit).toHaveBeenCalledWith(
      useTallyStore.getState().current,
      undefined,
      'PIVOXY',
    );
  });

  it('does not leak a code reserved by a slow table create from the lock screen', async () => {
    usePartyEveningStore.setState({
      evening: null,
      confirmedIdentity: null,
      pendingJoinCode: 'PIVOXY',
    });
    (getPendingAdds as jest.Mock).mockResolvedValue([
      {
        id: 'ea77db75-06a2-46c0-a2a0-f57d7d65f299',
        sessionId: 'session-live',
        createdAt: Date.now(),
      },
    ]);

    await reconcilePendingLiveBeerAdds();

    expect(ensureDrinkQueued).toHaveBeenCalledWith(
      expect.not.objectContaining({ party_code: expect.anything() }),
    );
    expect(syncVisit).toHaveBeenCalledWith(useTallyStore.getState().current);
  });

  it('commits a fresh native tap before applying the idle cutoff', async () => {
    const stale = liveSession();
    stale.drinks[0] = {
      ...stale.drinks[0],
      at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    };
    await seedTally(stale);
    (getPendingAdds as jest.Mock).mockResolvedValue([
      {
        id: '947bd43c-d4d1-42e9-b59c-99b1b9414e31',
        sessionId: 'session-live',
        createdAt: Date.now(),
        beerName: 'Bernard 11°',
        volumeMl: 500,
        servingType: 'bottle',
      },
    ]);

    await reconcileLiveBeerActivityAndAutoArchive();

    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
    expect(useTallyStore.getState().history).toHaveLength(0);
  });

  it('reconciles an iOS Live Activity tap while the app process is running', async () => {
    await seedTally(
      liveSession([
        {
          id: 'recent-beer',
          beerName: 'Bernard 11°',
          at: new Date().toISOString(),
        },
      ]),
    );
    let onInteraction: ((event: { target?: string }) => void) | undefined;
    mockAddUserInteractionListener.mockImplementation((listener) => {
      onInteraction = listener;
      return { remove: jest.fn() };
    });
    const event = {
      id: 'f4296115-ef71-43f0-8d8c-817d19db573c',
      sessionId: 'session-live',
      createdAt: Date.now(),
    };
    (getPendingAdds as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([event])
      .mockResolvedValue([]);

    await initializeLiveBeerActivity();
    expect(onInteraction).toBeDefined();

    onInteraction?.({ target: 'add-beer' });
    // Queue another pass so the listener's fire-and-forget reconciliation has
    // completed before assertions run.
    await reconcilePendingLiveBeerAdds();

    expect(useTallyStore.getState().current?.drinks.at(-1)?.id).toBe(event.id);
    expect(refreshBeerCountReminderAfterBeer).toHaveBeenCalledWith('session-live');
  });
});
