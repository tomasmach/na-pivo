/* eslint-disable import/first -- Jest module mocks must be installed before imports. */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../account', () => ({
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
  ensureAccount: jest.fn(async () => ({ accountId: 'me', token: 'token' })),
  generateUuidV4: jest.fn(() => '44444444-4444-4444-8444-444444444444'),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

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
  fetchProfileNights,
  fetchPubNightsFeed,
  isRetriableNightError,
  nightPublishWire,
  parsePublishedNight,
  type NightPublishPayload,
} from '../nightsClient';
import {
  clearNightsQueue,
  enqueueNightOp,
  flushNightsQueue,
  type NightQueueItem,
} from '../nightsQueue';
import {
  UGC_POLICY_HEADER,
  clearUgcConsentStateForTests,
  rememberUgcConsent,
  subscribeUgcConsentRequired,
} from '../ugcConsent';

// Direct-client tests below bypass the queue-level mocks on purpose: they pin
// the wire contract of the real request builders via jest.requireActual.
const actualNightsClient = jest.requireActual('../nightsClient') as typeof import('../nightsClient');

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
  title: 'Čtyři kousky a domů',
  roastLine: 'Domů ses vydal na třetí pokus.',
  roastBasis: '4 piva · 2 hospody',
  partyCode: 'STUL12',
  participantIds: ['11111111-1111-4111-8111-111111111111'],
  photoIds: ['22222222-2222-4222-8222-222222222222'],
  gameIds: ['33333333-3333-4333-8333-333333333333'],
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
      title: 'Čtyři kousky a domů',
      roast_line: 'Domů ses vydal na třetí pokus.',
      roast_basis: '4 piva · 2 hospody',
      party_code: 'STUL12',
      participant_ids: ['11111111-1111-4111-8111-111111111111'],
      photo_ids: ['22222222-2222-4222-8222-222222222222'],
      game_ids: ['33333333-3333-4333-8333-333333333333'],
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
      title: '',
      roastLine: '',
      roastBasis: '',
      participants: [],
      heroPhotos: [],
      heroGames: [],
      visibility: 'friends',
      createdAt: '',
      rounds: 0,
      myRound: false,
      isMine: false,
      commentCount: 0,
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
      title: 'Pepa se rozjel',
      roast_line: 'Lokál zavíral, Pepa ne.',
      roast_basis: '3 piva · 180 minut',
      participants: [
        { id: 'a3', nickname: 'jana', display_name: 'Jana', is_public: true },
        null,
      ],
      hero_photos: [
        { id: 'photo-1', image_url: 'https://cdn.example/photo.jpg', caption: 'Na zdraví' },
        { id: 'broken' },
      ],
      hero_games: [
        { id: 'game-1', catalog_key: 'quiz', name: 'Pivní kvíz', scoring: 'points' },
      ],
      visibility: 'public',
      created_at: 'created',
      rounds: 5,
      my_round: true,
      is_mine: true,
      comment_count: 7,
    });
    expect(night).toEqual(
      expect.objectContaining({
        clientId: 'client-2',
        beerCount: 3,
        pubNames: ['U Testu', 'Lokál'],
        durationMinutes: 180,
        title: 'Pepa se rozjel',
        roastLine: 'Lokál zavíral, Pepa ne.',
        roastBasis: '3 piva · 180 minut',
        participants: [
          {
            id: 'a3',
            nickname: 'jana',
            displayName: 'Jana',
            avatarUrl: null,
            isPublic: true,
          },
        ],
        heroPhotos: [
          {
            id: 'photo-1',
            imageUrl: 'https://cdn.example/photo.jpg',
            caption: 'Na zdraví',
          },
        ],
        heroGames: [
          {
            id: 'game-1',
            catalogKey: 'quiz',
            name: 'Pivní kvíz',
            scoring: 'points',
          },
        ],
        visibility: 'public',
        rounds: 5,
        myRound: true,
        isMine: true,
        commentCount: 7,
      }),
    );
  });
});

describe('pub activity feed', () => {
  it('sends the normalized-name filter and cursor to the server', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ nights: [], next_cursor: 'next-page' }),
    })) as jest.Mock;
    global.fetch = fetchMock;

    await expect(fetchPubNightsFeed('U Zlatého tygra', 'page+/=')).resolves.toEqual({
      ok: true,
      nights: [],
      nextCursor: 'next-page',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/nights/feed?scope=friends&pub=U%20Zlat%C3%A9ho%20tygra&cursor=page%2B%2F%3D&limit=20',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });
});

describe('public profile activity feed', () => {
  it('uses the server-enforced public-author contract', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ nights: [], next_cursor: null }),
    })) as jest.Mock;
    global.fetch = fetchMock;

    await expect(fetchProfileNights('account+/=', 'page+/=')).resolves.toEqual({
      ok: true,
      nights: [],
      nextCursor: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/nights/feed?public_author=account%2B%2F%3D&cursor=page%2B%2F%3D&limit=20',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });
});

describe('nights queue collapse', () => {
  it('does not accept a publish that failed to reach durable storage', async () => {
    mockPublishNight.mockResolvedValue(retry());
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(enqueueNightOp({ op: 'publish', payload })).resolves.toBe(false);

    expect(mockPublishNight).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });

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

describe('UGC consent retry contract — HTTP 428 keeps the queued publish', () => {
  const ugc428Failures = [
    { ok: false as const, code: 'http_428', detail: 'Precondition required.' },
    { ok: false as const, code: 'ugc_consent_required', detail: 'Potřebujeme souhlas.' },
    { ok: false as const, code: 'ugc_policy_update_required', detail: 'Pravidla se změnila.' },
  ];

  it.each(ugc428Failures)(
    'retains a pending publish when delivery returns $code until it succeeds',
    async (failure) => {
      mockPublishNight.mockResolvedValue(failure);
      await enqueueNightOp({ op: 'publish', payload });

      // REGRESSION: the consent/policy gate is transient — the evening must
      // stay durable, never be dropped like a permanent rejection.
      expect(await readQueue()).toEqual([{ op: 'publish', payload }]);

      mockPublishNight.mockResolvedValue({ ok: true, night: {} });
      await flushNightsQueue();
      expect(await readQueue()).toEqual([]);
    },
  );

  it('leaves unpublish and round keep/drop behavior unchanged on permanent errors', async () => {
    mockUnpublishNight.mockResolvedValue({ ok: false, code: 'http_404', detail: 'x' });
    await enqueueNightOp({ op: 'unpublish', clientId: payload.clientId });
    expect(await readQueue()).toEqual([]);

    mockReactToNight.mockResolvedValue({ ok: false, code: 'not_friends', detail: 'x' });
    await enqueueNightOp({ op: 'round', nightId: 'night-9' });
    expect(await readQueue()).toEqual([]);
  });
});

describe('isRetriableNightError', () => {
  it('matches the durable queue retry policy', () => {
    for (const code of [
      'offline',
      'network',
      'account',
      'auth',
      'http_401',
      'http_429',
      'http_500',
      // Consent/policy gate: transient, the queue must keep retrying.
      'http_428',
      'ugc_consent_required',
      'ugc_policy_update_required',
    ]) {
      expect(isRetriableNightError({ ok: false, code, detail: 'x' })).toBe(true);
    }
    for (const code of ['http_400', 'http_404', 'not_friends', 'self_reaction']) {
      expect(isRetriableNightError({ ok: false, code, detail: 'x' })).toBe(false);
    }
  });
});

describe('UGC consent gate — direct actual client requests', () => {
  const consentSnapshot = {
    policyVersion: '2026-08-22',
    accepted: true,
    acceptedVersion: '2026-08-22',
    acceptedAt: null,
  };

  function fetchReturning(status: number, body: unknown): jest.Mock {
    const spy = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }));
    global.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  function lastFetchInit(spy: jest.Mock): { method?: string; headers?: Record<string, string> } {
    const call = spy.mock.calls[spy.mock.calls.length - 1] as unknown as [
      string,
      { method?: string; headers?: Record<string, string> },
    ];
    return call[1];
  }

  beforeEach(() => {
    clearUgcConsentStateForTests();
  });

  it.each([
    ['publishNight', () => actualNightsClient.publishNight(payload)],
    ['createNightComment', () => actualNightsClient.createNightComment('night-1', 'Na zdraví')],
  ])('actual %s POST carries the canonical UGC policy header for account me', async (_name, call) => {
    rememberUgcConsent('me', consentSnapshot);
    const spy = fetchReturning(200, {});
    await call();

    const init = lastFetchInit(spy);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer token',
        [UGC_POLICY_HEADER]: '2026-08-22',
      }),
    );
  });

  it('actual publishNight POST on cold start (no remembered consent) carries the current UGC policy header', async () => {
    // Cold start: clearUgcConsentStateForTests already ran, rememberUgcConsent
    // is deliberately NOT called — the client must still advertise the current
    // policy version so the server can gate unconsented public writes.
    const spy = fetchReturning(200, {});
    await actualNightsClient.publishNight(payload);

    const init = lastFetchInit(spy);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer token',
        [UGC_POLICY_HEADER]: '2026-08-22',
      }),
    );
  });

  it.each([
    ['unpublishNight DELETE', () => actualNightsClient.unpublishNight(payload.clientId), 'DELETE'],
    ['reactToNight POST', () => actualNightsClient.reactToNight('night-1'), 'POST'],
  ])('%s must NOT carry the UGC policy header', async (_name, call, method) => {
    rememberUgcConsent('me', consentSnapshot);
    const spy = fetchReturning(200, {});
    await call();

    const init = lastFetchInit(spy);
    expect(init.method).toBe(method);
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer token' }),
    );
    expect(init.headers?.[UGC_POLICY_HEADER]).toBeUndefined();
  });

  it.each(['ugc_consent_required', 'ugc_policy_update_required'])(
    'direct publish on 428 %s returns that exact coded result and emits exactly one consent signal',
    async (code) => {
      rememberUgcConsent('me', consentSnapshot);
      const signals: string[] = [];
      subscribeUgcConsentRequired((event) => signals.push(event.code));
      fetchReturning(428, { code, detail: 'Potřebujeme aktuální souhlas.' });

      await expect(actualNightsClient.publishNight(payload)).resolves.toEqual({
        ok: false,
        code,
        detail: 'Potřebujeme aktuální souhlas.',
      });
      expect(signals).toEqual([code]);
    },
  );
});
