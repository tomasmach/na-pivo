import AsyncStorage from '@react-native-async-storage/async-storage';

import { publishNight, type NightPublishPayload } from '../nightsClient';
import { enqueueNightOp } from '../nightsQueue';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../nightsClient', () => ({
  ...jest.requireActual('../nightsClient'),
  publishNight: jest.fn(async () => ({ ok: false, code: 'offline', detail: '' })),
}));

const NIGHT: NightPublishPayload = {
  clientId: 'night-2026-11-07',
  drinkingDay: '2026-11-07',
  startedAt: '2026-11-07T18:00:00.000Z',
  endedAt: '2026-11-07T21:00:00.000Z',
  beerCount: 3,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: ['Palanda'],
  visibility: 'public',
  updatedAt: '2026-11-07T21:00:00.000Z',
};

async function queuedPayloads(): Promise<NightPublishPayload[]> {
  const raw = await AsyncStorage.getItem('na-pivo-nights-queue');
  return (JSON.parse(raw ?? '[]') as { payload: NightPublishPayload }[]).map((item) => item.payload);
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('nights queue', () => {
  it('keeps a removed photo removed when Dopito re-queues the night offline', async () => {
    await enqueueNightOp({ op: 'publish', payload: { ...NIGHT, photoIds: [] } });
    await enqueueNightOp({ op: 'publish', payload: { ...NIGHT, updatedAt: '2026-11-07T22:00:00.000Z' } });

    const queued = await queuedPayloads();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ updatedAt: '2026-11-07T22:00:00.000Z', photoIds: [] });
    expect(publishNight).toHaveBeenLastCalledWith(expect.objectContaining({ photoIds: [] }));
  });
});
