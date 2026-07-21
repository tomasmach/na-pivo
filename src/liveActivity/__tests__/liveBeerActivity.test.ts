import AsyncStorage from '@react-native-async-storage/async-storage';

import { reconcilePendingLiveBeerAdds } from '@/liveActivity/liveBeerActivity';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import {
  ackPendingAdds,
  getPendingAdds,
} from '../../../modules/beer-live-activity';
import { ensureDrinkQueued, isDrinkQueued } from '@/data/drinksQueue';
import { syncVisit } from '@/data/visitsSync';
import { refreshBeerCountReminderAfterBeer } from '@/notifications/beerCountReminder';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../../modules/beer-live-activity', () => ({
  ackPendingAdds: jest.fn(async () => undefined),
  end: jest.fn(async () => undefined),
  getPendingAdds: jest.fn(async () => []),
  startOrUpdate: jest.fn(async () => undefined),
}));

jest.mock('@/data/drinksQueue', () => ({
  ensureDrinkQueued: jest.fn(async () => undefined),
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
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await seedTally(liveSession());
  (isDrinkQueued as jest.Mock).mockResolvedValue(true);
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
});
