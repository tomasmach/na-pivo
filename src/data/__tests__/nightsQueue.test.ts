import AsyncStorage from '@react-native-async-storage/async-storage';

import { publishNight, type NightPublishPayload } from '../nightsClient';
import { enqueueNightOp, flushNightsQueue } from '../nightsQueue';
import { useToastStore } from '@/stores/toastStore';
import { useVycepStore } from '@/stores/vycepStore';

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
  useVycepStore.setState({ published: {} });
  useToastStore.getState().hide();
});

const refused = { ok: false as const, code: 'http_400', detail: '' };
const offline = { ok: false as const, code: 'offline', detail: '' };

describe('nights queue', () => {
  it('keeps a removed photo removed when Dopito re-queues the night offline', async () => {
    await enqueueNightOp({ op: 'publish', payload: { ...NIGHT, photoIds: [] } });
    await enqueueNightOp({ op: 'publish', payload: { ...NIGHT, updatedAt: '2026-11-07T22:00:00.000Z' } });

    const queued = await queuedPayloads();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ updatedAt: '2026-11-07T22:00:00.000Z', photoIds: [] });
    expect(publishNight).toHaveBeenLastCalledWith(expect.objectContaining({ photoIds: [] }));
  });

  it('stops saying a night hangs on the Výčep once the server refuses it for good', async () => {
    useVycepStore.getState().markPublished(NIGHT.clientId, 'friends');
    jest.mocked(publishNight).mockResolvedValueOnce(refused);

    await enqueueNightOp({ op: 'publish', payload: NIGHT });

    expect(await queuedPayloads()).toEqual([]);
    expect(useVycepStore.getState().published[NIGHT.clientId]).toBeUndefined();
    expect(useToastStore.getState().message).toBe('Noc se mi nepovedlo vyvěsit na Výčep.');
  });

  it('keeps the night marked and queued while there is no signal', async () => {
    useVycepStore.getState().markPublished(NIGHT.clientId, 'friends');
    jest.mocked(publishNight).mockResolvedValueOnce(offline);

    await enqueueNightOp({ op: 'publish', payload: NIGHT });

    expect(await queuedPayloads()).toHaveLength(1);
    expect(useVycepStore.getState().published[NIGHT.clientId]).toBeDefined();
    expect(useToastStore.getState().message).toBeNull();
  });

  it('keeps the mark when a newer publish of the same night is still waiting', async () => {
    useVycepStore.getState().markPublished(NIGHT.clientId, 'friends');
    let answer: (value: typeof refused) => void = () => undefined;
    jest.mocked(publishNight)
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValue(offline);

    const first = enqueueNightOp({ op: 'publish', payload: NIGHT });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = enqueueNightOp({ op: 'publish', payload: { ...NIGHT, updatedAt: '2026-11-07T23:00:00.000Z' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer(refused);
    await Promise.all([first, second, flushNightsQueue()]);

    expect(await queuedPayloads()).toEqual([expect.objectContaining({ updatedAt: '2026-11-07T23:00:00.000Z' })]);
    expect(useVycepStore.getState().published[NIGHT.clientId]).toBeDefined();
  });
});
