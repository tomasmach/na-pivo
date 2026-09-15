import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockPublishNight: jest.Mock = jest.fn(async () => ({ ok: true, night: {} }));
const mockUnpublishNight: jest.Mock = jest.fn(async () => ({ ok: true }));
const mockReactToNight: jest.Mock = jest.fn(async () => ({ ok: true, rounds: 1, myRound: true }));
const mockClearNightReaction: jest.Mock = jest.fn(async () => ({ ok: true, rounds: 0, myRound: false }));

jest.mock('../nightsClient', () => ({
  ...jest.requireActual('../nightsClient'),
  publishNight: (...args: unknown[]) => mockPublishNight(...(args as [])),
  unpublishNight: (...args: unknown[]) => mockUnpublishNight(...(args as [])),
  reactToNight: (...args: unknown[]) => mockReactToNight(...(args as [])),
  clearNightReaction: (...args: unknown[]) => mockClearNightReaction(...(args as [])),
}));

import {
  isRetriableNightError,
  nightPublishWire,
  parsePublishedNight,
  type NightPublishPayload,
} from '../nightsClient';
import { clearNightsQueue, enqueueNightOp, type NightQueueItem } from '../nightsQueue';

const STORAGE_KEY = 'na-pivo-nights-queue';

const payload: NightPublishPayload = {
  clientId: 'client-1',
  drinkingDay: '2026-07-18',
  startedAt: '2026-07-18T18:00:00.000Z',
  endedAt: '2026-07-18T22:30:00.000Z',
  beerCount: 4,
  wineCount: 1,
  softDrinkCount: 2,
  shotCount: 1,
  pubNames: ['U Testu', 'Lokál'],
  city: 'Praha',
  durationMinutes: 270,
  visibility: 'friends',
  updatedAt: '2026-07-19T08:00:00.000Z',
};

async function readQueue(): Promise<NightQueueItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

const retry = () => ({ ok: false as const, code: 'network', detail: 'x' });

beforeEach(async () => {
  jest.clearAllMocks();
  mockPublishNight.mockResolvedValue({ ok: true, night: {} });
  mockUnpublishNight.mockResolvedValue({ ok: true });
  mockReactToNight.mockResolvedValue({ ok: true, rounds: 1, myRound: true });
  mockClearNightReaction.mockResolvedValue({ ok: true, rounds: 0, myRound: false });
  await AsyncStorage.clear();
  await clearNightsQueue();
});

describe('night wire and parser', () => {
  it('maps the camelCase publish payload to the snake_case wire contract', () => {
    expect(nightPublishWire(payload)).toEqual({
      client_id: 'client-1',
      drinking_day: '2026-07-18',
      started_at: '2026-07-18T18:00:00.000Z',
      ended_at: '2026-07-18T22:30:00.000Z',
      beer_count: 4,
      wine_count: 1,
      soft_drink_count: 2,
      shot_count: 1,
      pub_names: ['U Testu', 'Lokál'],
      city: 'Praha',
      duration_minutes: 270,
      visibility: 'friends',
      updated_at: '2026-07-19T08:00:00.000Z',
    });
  });

  it('survives missing additive fields and null author fields', () => {
    expect(
      parsePublishedNight({
        id: 'night-1',
        author: {
          id: 'author-1',
          nickname: null,
          display_name: null,
          avatar_url: null,
          is_public: null,
        },
        drinking_day: '2026-07-18',
      }),
    ).toEqual({
      id: 'night-1',
      author: {
        id: 'author-1',
        nickname: null,
        displayName: 'Kamarád',
        avatarUrl: null,
        isPublic: true,
      },
      drinkingDay: '2026-07-18',
      startedAt: '',
      endedAt: '',
      beerCount: 0,
      wineCount: 0,
      softDrinkCount: 0,
      shotCount: 0,
      pubNames: [],
      city: '',
      durationMinutes: null,
      visibility: 'friends',
      createdAt: '',
      rounds: 0,
      myRound: false,
      isMine: false,
    });
  });

  it('parses a complete night and filters malformed pub names', () => {
    const night = parsePublishedNight({
      id: 'night-2',
      client_id: 'client-2',
      author: { id: 'a2', nickname: 'pepa', display_name: 'Pepa', is_public: false },
      drinking_day: '2026-07-17',
      started_at: 'start',
      ended_at: 'end',
      beer_count: '3',
      wine_count: 1,
      soft_drink_count: 2,
      shot_count: 4,
      pub_names: ['U Testu', null, 42, 'Lokál'],
      city: 'Brno',
      duration_minutes: '180',
      visibility: 'public',
      created_at: 'created',
      rounds: 5,
      my_round: true,
      is_mine: true,
    });
    expect(night).toEqual(
      expect.objectContaining({
        clientId: 'client-2',
        beerCount: 3,
        pubNames: ['U Testu', 'Lokál'],
        durationMinutes: 180,
        visibility: 'public',
        rounds: 5,
        myRound: true,
        isMine: true,
      }),
    );
  });
});

describe('nights queue collapse', () => {
  it('keeps only the newest publish for one client id', async () => {
    mockPublishNight.mockResolvedValue(retry());
    await enqueueNightOp({ op: 'publish', payload });
    await enqueueNightOp({ op: 'publish', payload: { ...payload, beerCount: 6 } });

    expect(await readQueue()).toEqual([
      { op: 'publish', payload: { ...payload, beerCount: 6 } },
    ]);
  });

  it('lets unpublish replace a pending publish for the same client id', async () => {
    mockPublishNight.mockResolvedValue(retry());
    mockUnpublishNight.mockResolvedValue(retry());
    await enqueueNightOp({ op: 'publish', payload });
    await enqueueNightOp({ op: 'unpublish', clientId: payload.clientId });

    expect(await readQueue()).toEqual([{ op: 'unpublish', clientId: payload.clientId }]);
  });

  it('collapses round and round-clear per public night id', async () => {
    mockReactToNight.mockResolvedValue(retry());
    mockClearNightReaction.mockResolvedValue(retry());
    await enqueueNightOp({ op: 'round', nightId: 'night-1' });
    await enqueueNightOp({ op: 'round-clear', nightId: 'night-1' });

    expect(await readQueue()).toEqual([{ op: 'round-clear', nightId: 'night-1' }]);
  });
});

describe('isRetriableNightError', () => {
  it('matches the durable queue retry policy', () => {
    for (const code of ['offline', 'network', 'account', 'auth', 'http_401', 'http_429', 'http_500']) {
      expect(isRetriableNightError({ ok: false, code, detail: 'x' })).toBe(true);
    }
    for (const code of ['http_400', 'http_404', 'not_friends', 'self_reaction']) {
      expect(isRetriableNightError({ ok: false, code, detail: 'x' })).toBe(false);
    }
  });
});
