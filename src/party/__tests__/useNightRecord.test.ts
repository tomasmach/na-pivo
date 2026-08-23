import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  hasRenderableNightRecord,
  mergeNightRecords,
  mergeNightGames,
  sessionForRecord,
  sessionsForRecord,
  sessionsForSharedMembership,
  stopsForSessions,
  useNightRecord,
} from '@/party/useNightRecord';
import {
  nightMinutes,
  nightStandings,
  type NightRecord,
} from '@/party/nightRecord';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { useBeerPhotosStore, type BeerPhotoLocal } from '@/stores/beerPhotosStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import { useTallyStore } from '@/stores/tallyStore';
import type { TallySession } from '@/stores/tallyStore';
import { useAccountStore } from '@/stores/accountStore';
import { fetchPartyEveningHistory, fetchPartyNightRecord } from '@/data/partyClient';
import { clearNightRecordCache, writeNightRecordCache } from '@/party/nightRecordCache';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@/data/partyClient', () => ({
  fetchPartyEveningHistory: jest.fn(),
  fetchPartyNightRecord: jest.fn(),
}));

jest.mock('@/liveActivity/liveBeerActivity', () => ({
  clearLiveBeerActivityForAccountBoundary: jest.fn(async () => undefined),
}));

const fetchHistoryMock = fetchPartyEveningHistory as jest.MockedFunction<
  typeof fetchPartyEveningHistory
>;
const fetchRecordMock = fetchPartyNightRecord as jest.MockedFunction<typeof fetchPartyNightRecord>;

function record(over: Partial<NightRecord> = {}): NightRecord {
  return {
    id: 'n1',
    code: 'PIVOXY',
    startedAt: '2026-08-05T18:00:00Z',
    endedAt: null,
    people: [{ id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' }],
    stops: [],
    drinks: [],
    games: [],
    photos: [],
    ...over,
  };
}

describe('mergeNightRecords', () => {
  it('replaces a synced drink with its optimistic twin instead of counting it twice', () => {
    const drink = {
      id: 'client-drink-1',
      at: '2026-08-05T18:30:00Z',
      by: 'me',
      beerName: 'Ležák',
      drinkType: 'beer' as const,
      stopId: null,
    };

    const merged = mergeNightRecords(record({ drinks: [drink] }), record({ drinks: [drink] }));

    expect(merged.drinks).toEqual([drink]);
  });

  it('keeps server participants and adds an offline pending photo', () => {
    const remote = record({
      people: [
        { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
        { id: 'friend', name: 'Honza', avatarUrl: null, tint: '#7DD66B' },
      ],
    });
    const local = record({
      photos: [
        {
          id: 'pending-photo',
          url: 'file:///photo.jpg',
          at: '2026-08-05T19:00:00Z',
          by: 'me',
        },
      ],
    });

    const merged = mergeNightRecords(remote, local);

    expect(merged.people.map((person) => person.id)).toEqual(['me', 'friend']);
    expect(merged.photos[0].url).toBe('file:///photo.jpg');
  });

  it('puts this phone first and repairs blank server names in the recap', () => {
    const remote = record({
      people: [
        { id: 'friend', name: '', avatarUrl: null, tint: '#7DD66B' },
        { id: 'me', name: '   ', avatarUrl: null, tint: '#7DD66B' },
      ],
    });
    const local = record({
      people: [
        { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
        { id: 'friend', name: 'machtest', avatarUrl: null, tint: '#7DD66B' },
      ],
    });

    const merged = mergeNightRecords(remote, local);

    expect(merged.people).toEqual([
      expect.objectContaining({ id: 'me', name: 'Ty', tint: '#E8A317' }),
      expect.objectContaining({ id: 'friend', name: 'machtest' }),
    ]);
  });

  it("does not add the legacy evening copy of somebody else's server drink", () => {
    const remoteDrink = {
      id: 'legacy:server-id:0',
      at: '2026-08-05T18:30:00Z',
      by: 'friend',
      beerName: 'Ležák',
      drinkType: 'beer' as const,
      stopId: null,
    };
    const localLegacyCopy = { ...remoteDrink, id: 'drink:event-id:0' };

    const merged = mergeNightRecords(
      record({ drinks: [remoteDrink] }),
      record({ drinks: [localLegacyCopy] }),
    );

    expect(merged.drinks).toEqual([remoteDrink]);
  });

  it('canonicalizes a synced local visit id without losing the optimistic drink', () => {
    const localStop = {
      id: 'visit-client-1',
      by: 'me',
      pubName: 'U Fleků',
      cacheKey: 'u2fkbjgx',
      arrivedAt: '2026-08-05T18:00:00Z',
    };
    const serverStop = {
      ...localStop,
      id: 'visit:account-public-id:visit-client-1',
    };
    const localDrink = {
      id: 'client-drink-1',
      at: '2026-08-05T18:30:00Z',
      by: 'me',
      beerName: 'Čerstvě opravený ležák',
      drinkType: 'beer' as const,
      stopId: localStop.id,
    };
    const remoteDrink = {
      ...localDrink,
      beerName: 'Ležák',
      stopId: serverStop.id,
    };

    const merged = mergeNightRecords(
      record({ stops: [serverStop], drinks: [remoteDrink] }),
      record({ stops: [localStop], drinks: [localDrink] }),
    );

    expect(merged.stops).toEqual([serverStop]);
    expect(merged.drinks).toEqual([
      expect.objectContaining({
        id: localDrink.id,
        beerName: 'Čerstvě opravený ležák',
        stopId: serverStop.id,
      }),
    ]);
  });

  it('keeps a no-beer pub crawl visible and collapses synced visit aliases exactly once', () => {
    const localStops = [
      {
        id: 'visit-client-a',
        by: 'me',
        pubName: 'Lokál',
        cacheKey: 'u2fkbn1x',
        arrivedAt: '2026-08-05T18:00:00Z',
      },
      {
        id: 'visit-client-b',
        by: 'me',
        pubName: 'U Pinkasů',
        cacheKey: 'u2fkbn2y',
        arrivedAt: '2026-08-05T19:00:00Z',
      },
    ];
    const remoteStops = localStops.map((stop) => ({
      ...stop,
      id: `visit:account-public-id:${stop.id}`,
    }));

    expect(mergeNightRecords(record(), record({ stops: localStops })).stops).toEqual(localStops);
    expect(
      mergeNightRecords(record({ stops: remoteStops }), record({ stops: localStops })).stops,
    ).toEqual(remoteStops);
  });

  it('repairs a late cached start with the earlier local sitting from the same night', () => {
    const endedAt = '2026-08-06T01:14:00Z';
    const merged = mergeNightRecords(
      record({ startedAt: '2026-08-06T01:12:00Z', endedAt }),
      record({ startedAt: '2026-08-05T22:03:00Z', endedAt }),
    );

    expect(merged.startedAt).toBe('2026-08-05T22:03:00Z');
    expect(nightMinutes(merged, Date.parse(endedAt))).toBe(191);
  });

  it('treats a fresh server record as authoritative for people', () => {
    const remote = record({
      people: [{ id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' }],
    });
    const myOptimisticDrink = {
      id: 'client-drink-1',
      at: '2026-08-05T19:30:00Z',
      by: 'me',
      beerName: 'Ležák',
      drinkType: 'beer' as const,
      stopId: null,
    };
    const local = record({
      people: [
        { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
        {
          id: 'friend',
          name: 'Honza',
          avatarUrl: null,
          tint: '#7DD66B',
          active: false,
          leftAt: '2026-08-05T19:00:00Z',
        },
      ],
      drinks: [
        myOptimisticDrink,
        {
          id: 'stale-peer-beer',
          at: '2026-08-05T18:40:00Z',
          by: 'friend',
          beerName: 'Kozel',
          drinkType: 'beer' as const,
          stopId: null,
        },
      ],
      photos: [
        {
          id: 'stale-peer-photo',
          url: 'file:///peer.jpg',
          at: '2026-08-05T18:45:00Z',
          by: 'friend',
        },
      ],
      stops: [
        {
          id: 'visit-friend',
          by: 'friend',
          pubName: 'U Orlů',
          cacheKey: null,
          arrivedAt: '2026-08-05T18:10:00Z',
        },
      ],
      games: [
        {
          key: 'stale-peer-game',
          name: 'Kdo platí rundu',
          startedAt: '2026-08-05T18:50:00Z',
          by: 'friend',
          result: { winner: 'friend', paying: null, scores: [] },
        },
        {
          key: 'own-optimistic-game',
          name: 'Piškvorky',
          startedAt: '2026-08-05T19:20:00Z',
          by: 'me',
        },
      ],
    });

    const merged = mergeNightRecords(remote, local);

    // The whole merged record stays clean, not just the standings view.
    expect(merged.people.map((person) => person.id)).toEqual(['me']);
    expect(merged.drinks).toEqual([myOptimisticDrink]);
    expect(merged.drinks.some((drink) => drink.by === 'friend')).toBe(false);
    expect(merged.photos).toEqual([]);
    expect(merged.stops).toEqual([]);
    // Games are owner-attributed too: an omitted peer's local-only game never
    // comes back, while this account's own unsynced one survives.
    expect(merged.games.some((game) => game.by === 'friend')).toBe(false);
    expect(merged.games.find((game) => game.key === 'own-optimistic-game')).toEqual(
      expect.objectContaining({ by: 'me' }),
    );
  });

  it('keeps only a provable local self when a successful remote roster is empty', () => {
    const remote = record({ people: [] });
    const myOptimisticDrink = {
      id: 'client-drink-1',
      at: '2026-08-05T19:30:00Z',
      by: 'me',
      beerName: 'Ležák',
      drinkType: 'beer' as const,
      stopId: null,
    };
    const local = record({
      people: [
        { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
        { id: 'friend', name: 'Honza', avatarUrl: null, tint: '#7DD66B' },
      ],
      drinks: [
        myOptimisticDrink,
        {
          id: 'stale-peer-beer',
          at: '2026-08-05T18:40:00Z',
          by: 'friend',
          beerName: 'Kozel',
          drinkType: 'beer' as const,
          stopId: null,
        },
      ],
    });

    const merged = mergeNightRecords(remote, local);

    // An empty roster from the server is still an authoritative answer: only
    // this account's own identity and its own unsynced rows survive.
    expect(merged.people.map((person) => person.id)).toEqual(['me']);
    expect(merged.drinks).toEqual([myOptimisticDrink]);
  });

  it('keeps the roster and the standings in agreement after a peer leaves', () => {
    const myBeer = {
      id: 'beer-me',
      at: '2026-08-05T18:30:00Z',
      by: 'me',
      beerName: 'Ležák',
      drinkType: 'beer' as const,
      stopId: null,
    };
    const remote = record({
      people: [{ id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' }],
      drinks: [myBeer],
    });
    const local = record({
      people: [
        { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
        {
          id: 'friend',
          name: 'Honza',
          avatarUrl: null,
          tint: '#7DD66B',
          active: false,
          leftAt: '2026-08-05T19:00:00Z',
        },
      ],
      drinks: [
        myBeer,
        {
          id: 'beer-friend',
          at: '2026-08-05T18:40:00Z',
          by: 'friend',
          beerName: 'Kozel',
          drinkType: 'beer' as const,
          stopId: null,
        },
      ],
    });

    const standings = nightStandings(mergeNightRecords(remote, local));

    expect(standings.map((row) => row.id)).toEqual(['me']);
    expect(standings[0].beers).toBe(1);
  });
});

describe('mergeNightGames', () => {
  it('puts a remote finish onto the local cover with the same catalogue key', () => {
    const result = { winner: null, paying: 'Honza', scores: [] };
    const games = mergeNightGames(
      [{ key: 'round', name: 'Kdo platí rundu', startedAt: '2026-08-05T19:00:00Z' }],
      [{
        id: 'game-1',
        catalogKey: 'round',
        name: 'Kdo platí rundu',
        scoring: 'drinks',
        startedBy: { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
        roster: [],
        startedAt: '2026-08-05T19:00:00Z',
        endedAt: '2026-08-05T19:01:00Z',
        seed: 17,
      }],
      new Map([['game-1', result]]),
    );

    expect(games).toEqual([
      expect.objectContaining({ key: 'round', result }),
    ]);
  });

  it('attributes games to their real starter, not to whoever merged them', () => {
    const profile = (id: string) => ({
      id,
      nickname: id,
      displayName: id === 'me' ? 'Ty' : 'Honza',
      avatarUrl: null,
    });
    const games = mergeNightGames(
      // This phone's own local row correlates with the server game below.
      [{ key: 'round', name: 'Kdo platí rundu', startedAt: '2026-08-05T19:00:00Z' }],
      [
        {
          id: 'game-friend',
          catalogKey: 'rival',
          name: 'Šibenice',
          scoring: 'drinks',
          startedBy: profile('friend'),
          roster: [],
          startedAt: '2026-08-05T19:10:00Z',
          endedAt: null,
          seed: 3,
        },
        {
          id: 'game-mine',
          catalogKey: 'round',
          name: 'Kdo platí rundu',
          scoring: 'drinks',
          startedBy: profile('me'),
          roster: [],
          startedAt: '2026-08-05T19:00:00Z',
          endedAt: null,
          seed: 7,
        },
      ],
      new Map(),
    );

    expect(games.find((game) => game.key === 'rival')?.by).toBe('friend');
    expect(games.find((game) => game.key === 'round')?.by).toBe('me');
  });
});

describe('sessionsForRecord', () => {
  const session = (
    clientId: string,
    startedAt: string,
    pubKey = 'u2fkbjgx',
    drinkIds: string[] = [],
  ): TallySession => ({
    clientId,
    pubKey,
    pubName: pubKey,
    startedAt,
    drinks: drinkIds.map((id) => ({ id, beerName: id, at: startedAt })),
  });

  it("does not bleed today's current tally into an older recap", () => {
    const current = session('today', '2026-08-06T18:00:00Z');
    const yesterday = session('yesterday', '2026-08-05T18:00:00Z');

    expect(sessionForRecord(current, [yesterday], '2026-08-05T19:00:00Z')).toBe(yesterday);
  });

  it('collects the full pub crawl from current and history on one drinking day', () => {
    const first = session('stop-a', '2026-08-05T18:00:00Z', 'pub-a', ['beer-a']);
    const second = session('stop-b', '2026-08-05T21:00:00Z', 'pub-b', ['beer-b']);
    // Before the 04:00 cutoff, so this is still the 5 August drinking day.
    const current = session('stop-c', '2026-08-06T01:00:00Z', 'pub-c', ['beer-c']);
    const yesterday = session('old', '2026-08-04T18:00:00Z', 'old-pub', ['old-beer']);

    const selected = sessionsForRecord(current, [second, yesterday, first], '2026-08-05T18:00:00Z');

    expect(selected.map((row) => row.clientId)).toEqual(['stop-a', 'stop-b', 'stop-c']);
    expect(selected.flatMap((row) => row.drinks.map((drink) => drink.id))).toEqual([
      'beer-a',
      'beer-b',
      'beer-c',
    ]);
  });

  it('keeps only drinks logged after this account joined a new shared table', () => {
    const earlier = session('old-stop', '2026-08-05T17:00:00Z', 'old-pub', ['old-beer']);
    earlier.drinks[0].at = '2026-08-05T17:30:00Z';
    const current = session('current-stop', '2026-08-05T18:00:00Z', 'new-pub', [
      'before-join',
      'after-join',
    ]);
    current.drinks[0].at = '2026-08-05T18:30:00Z';
    current.drinks[1].at = '2026-08-05T19:30:00Z';

    const selected = sessionsForSharedMembership(
      [earlier, current],
      {
        id: 'evening',
        joinCode: 'PIVOXY',
        joinUrl: 'https://na-pivo.cz/party/PIVOXY',
        host: { id: 'host', nickname: 'host', displayName: 'Host', avatarUrl: null },
        pubName: 'Nový stůl',
        pubCity: 'Praha',
        active: true,
        startedAt: '2026-08-05T18:00:00Z',
        endedAt: null,
        isHost: false,
        members: [],
        events: [
          {
            id: 'join-me',
            kind: 'joined',
            at: '2026-08-05T19:00:00Z',
            account: { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
            beerName: '',
            quantity: 0,
          },
        ],
      },
      'me',
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      clientId: 'current-stop',
      startedAt: '2026-08-05T19:00:00Z',
      drinks: [{ id: 'after-join' }],
    });
  });

  it('keeps private drinks between leaving and rejoining out of the shared record', () => {
    const current = session('current-stop', '2026-08-05T18:00:00Z', 'new-pub', [
      'before-leave',
      'private-gap',
      'after-rejoin',
    ]);
    current.drinks[0].at = '2026-08-05T18:30:00Z';
    current.drinks[1].at = '2026-08-05T19:30:00Z';
    current.drinks[2].at = '2026-08-05T20:30:00Z';

    const selected = sessionsForSharedMembership(
      [current],
      {
        id: 'evening',
        joinCode: 'PIVOXY',
        joinUrl: 'https://na-pivo.cz/party/PIVOXY',
        host: { id: 'host', nickname: 'host', displayName: 'Host', avatarUrl: null },
        pubName: 'Nový stůl',
        pubCity: 'Praha',
        active: true,
        startedAt: '2026-08-05T18:00:00Z',
        endedAt: null,
        isHost: false,
        members: [],
        events: [
          {
            id: 'join-old',
            kind: 'joined',
            at: '2026-08-05T18:00:00Z',
            account: { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
            beerName: '',
            quantity: 0,
          },
          {
            id: 'leave',
            kind: 'left',
            at: '2026-08-05T19:00:00Z',
            account: { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
            beerName: '',
            quantity: 0,
          },
          {
            id: 'join-latest',
            kind: 'joined',
            at: '2026-08-05T20:00:00Z',
            account: { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
            beerName: '',
            quantity: 0,
          },
        ],
      },
      'me',
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].startedAt).toBe('2026-08-05T20:00:00Z');
    expect(selected[0].drinks.map((drink) => drink.id)).toEqual(['after-rejoin']);
  });

  it('keeps the whole sitting for the host even with no event timeline', () => {
    const current = session('host-stop', '2026-08-05T18:00:00Z', 'pub-a', ['host-beer']);
    current.drinks[0].at = '2026-08-05T18:30:00Z';

    const selected = sessionsForSharedMembership(
      [current],
      {
        id: 'evening',
        joinCode: 'PIVOXY',
        joinUrl: 'https://na-pivo.cz/party/PIVOXY',
        host: { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
        pubName: 'Nový stůl',
        pubCity: 'Praha',
        active: true,
        startedAt: '2026-08-05T18:00:00Z',
        endedAt: null,
        isHost: true,
        members: [],
        events: [],
      },
      'me',
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].drinks.map((drink) => drink.id)).toEqual(['host-beer']);
  });

  it('contributes zero local sessions for a non-host without membership evidence', () => {
    // A private beer logged before (or outside) any provable presence at the
    // table must never leak into the shared night just because the server
    // sent no join row. Privacy beats completeness.
    const current = session('mixed-stop', '2026-08-05T18:00:00Z', 'pub-a', [
      'private-before-join',
      'after-sometime',
    ]);
    current.drinks[0].at = '2026-08-05T18:30:00Z';
    current.drinks[1].at = '2026-08-05T19:30:00Z';

    const selected = sessionsForSharedMembership(
      [current],
      {
        id: 'evening',
        joinCode: 'PIVOXY',
        joinUrl: 'https://na-pivo.cz/party/PIVOXY',
        host: { id: 'host', nickname: 'host', displayName: 'Host', avatarUrl: null },
        pubName: 'Nový stůl',
        pubCity: 'Praha',
        active: true,
        startedAt: '2026-08-05T18:00:00Z',
        endedAt: null,
        isHost: false,
        members: [],
        events: [
          {
            id: 'join-other',
            kind: 'joined',
            at: '2026-08-05T18:10:00Z',
            account: { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
            beerName: '',
            quantity: 0,
          },
        ],
      },
      'me',
    );

    expect(selected).toEqual([]);
  });

  it('contributes zero local sessions for a non-host when the backend sends no events at all', () => {
    const current = session('old-stop', '2026-08-05T18:00:00Z', 'pub-a', ['private-beer']);
    current.drinks[0].at = '2026-08-05T19:30:00Z';

    const selected = sessionsForSharedMembership(
      [current],
      {
        id: 'evening',
        joinCode: 'PIVOXY',
        joinUrl: 'https://na-pivo.cz/party/PIVOXY',
        host: { id: 'host', nickname: 'host', displayName: 'Host', avatarUrl: null },
        pubName: 'Nový stůl',
        pubCity: 'Praha',
        active: true,
        startedAt: '2026-08-05T18:00:00Z',
        endedAt: null,
        isHost: false,
        members: [],
        events: [],
      },
      'me',
    );

    expect(selected).toEqual([]);
  });

  it('prefers current and de-duplicates resumed sessions and their drinks', () => {
    const current = session('same-stop', '2026-08-05T18:00:00Z', 'pub-a', ['beer-a', 'beer-a']);
    const staleHistoryCopy = session('same-stop', '2026-08-05T18:00:00Z', 'pub-a', ['stale-beer']);

    const selected = sessionsForRecord(current, [staleHistoryCopy], current.startedAt);

    expect(selected).toHaveLength(1);
    expect(selected[0].drinks.map((drink) => drink.id)).toEqual(['beer-a']);
  });

  it('creates one stable local stop per selected sitting', () => {
    const sessions = [
      session('stop-a', '2026-08-05T18:00:00Z', 'pub-a'),
      session('stop-b', '2026-08-05T21:00:00Z', 'pub-b'),
      session('stop-a', '2026-08-05T18:00:00Z', 'pub-a'),
    ];

    expect(stopsForSessions(sessions, 'me')).toEqual([
      {
        id: 'stop-a',
        by: 'me',
        pubName: 'pub-a',
        cacheKey: 'pub-a',
        arrivedAt: '2026-08-05T18:00:00Z',
      },
      {
        id: 'stop-b',
        by: 'me',
        pubName: 'pub-b',
        cacheKey: 'pub-b',
        arrivedAt: '2026-08-05T21:00:00Z',
      },
    ]);
  });
});

describe('useNightRecord offline photos', () => {
  it('keeps only the photo explicitly marked for the local drinking day', () => {
    const startedAt = '2026-08-05T18:00:00.000Z';
    const session: TallySession = {
      clientId: 'stop-a',
      pubKey: 'pub-a',
      pubName: 'První hospoda',
      startedAt,
      drinks: [],
    };
    const photo = (clientId: string, extra: Partial<BeerPhotoLocal> = {}): BeerPhotoLocal => ({
      id: null,
      clientId,
      imageUrl: null,
      caption: '',
      pubCacheKey: 'pub-a',
      pubName: 'První hospoda',
      pubCity: 'Praha',
      visibility: 'private',
      takenAt: '2026-08-05T19:00:00.000Z',
      createdAt: '2026-08-05T19:00:00.000Z',
      inContest: false,
      localUri: `file:///${clientId}.jpg`,
      syncState: 'pending',
      ...extra,
    });
    const originals = {
      tally: useTallyStore.getState(),
      live: useLivePartyStore.getState(),
      evening: usePartyEveningStore.getState(),
      games: usePartyGamesStore.getState(),
      photos: useBeerPhotosStore.getState(),
    };
    let unmount: (() => void) | undefined;

    try {
      useTallyStore.setState({ current: session, history: [] });
      useLivePartyStore.setState({
        live: true,
        pubName: session.pubName,
        pubKey: session.pubKey,
        startedAt: Date.parse(startedAt),
        games: [],
      });
      usePartyEveningStore.setState({
        evening: null,
        lastEvening: null,
        pendingJoinCode: null,
      });
      usePartyGamesStore.setState({
        code: null,
        games: [],
        events: [],
        live: false,
      });
      useBeerPhotosStore.setState({
        photos: [photo('party-photo', { partyDrinkingDay: '2026-08-05' }), photo('diary-photo')],
      });

      const rendered = renderHook(() => useNightRecord());
      unmount = rendered.unmount;

      expect(rendered.result.current.code).toBeNull();
      expect(rendered.result.current.photos).toEqual([
        {
          id: 'party-photo',
          url: 'file:///party-photo.jpg',
          at: '2026-08-05T19:00:00.000Z',
          by: 'me',
        },
      ]);
    } finally {
      unmount?.();
      useTallyStore.setState(originals.tally);
      useLivePartyStore.setState(originals.live);
      usePartyEveningStore.setState(originals.evening);
      usePartyGamesStore.setState(originals.games);
      useBeerPhotosStore.setState(originals.photos);
    }
  });
});

describe('useNightRecord drinking-day duration', () => {
  it('starts the recap at the first sitting even when Party was opened at the last pub', () => {
    const first: TallySession = {
      clientId: 'stop-a',
      pubKey: 'pub-a',
      pubName: 'První hospoda',
      startedAt: '2026-08-05T22:03:00Z',
      drinks: [
        { id: 'beer-a', beerName: 'Ležák', at: '2026-08-05T22:03:00Z' },
      ],
      archivedReason: 'pub-change',
    };
    const current: TallySession = {
      clientId: 'stop-b',
      pubKey: 'pub-b',
      pubName: 'Druhá hospoda',
      startedAt: '2026-08-06T01:12:00Z',
      drinks: [
        { id: 'beer-b', beerName: 'Ležák', at: '2026-08-06T01:12:00Z' },
      ],
    };
    const originals = {
      account: useAccountStore.getState(),
      tally: useTallyStore.getState(),
      live: useLivePartyStore.getState(),
      evening: usePartyEveningStore.getState(),
      games: usePartyGamesStore.getState(),
      photos: useBeerPhotosStore.getState(),
    };
    let unmount: (() => void) | undefined;

    try {
      useAccountStore.setState({ session: null, status: 'ready' });
      useTallyStore.setState({ current, history: [first] });
      useLivePartyStore.setState({
        live: true,
        pubName: current.pubName,
        pubKey: current.pubKey,
        startedAt: Date.parse(current.startedAt),
        games: [],
      });
      usePartyEveningStore.setState({
        evening: null,
        confirmedIdentity: null,
        lastEvening: null,
        pendingJoinCode: null,
      });
      usePartyGamesStore.setState({ code: null, games: [], events: [], live: false });
      useBeerPhotosStore.setState({ photos: [] });

      const rendered = renderHook(() => useNightRecord());
      unmount = rendered.unmount;

      expect(rendered.result.current.startedAt).toBe(first.startedAt);
      expect(
        nightMinutes(rendered.result.current, Date.parse('2026-08-06T01:14:00Z')),
      ).toBe(191);
    } finally {
      unmount?.();
      useAccountStore.setState(originals.account);
      useTallyStore.setState(originals.tally);
      useLivePartyStore.setState(originals.live);
      usePartyEveningStore.setState(originals.evening);
      usePartyGamesStore.setState(originals.games);
      useBeerPhotosStore.setState(originals.photos);
    }
  });
});

describe('useNightRecord recap recovery', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearNightRecordCache();
  });

  it('loads the latest ended server record when this device has no evening state', async () => {
    const ended = record({
      id: 'ended-night',
      endedAt: '2026-08-05T22:00:00Z',
      stops: [
        {
          id: 'stop-1',
          pubName: 'U Fleků',
          cacheKey: 'u2fkbjgx',
          arrivedAt: '2026-08-05T18:00:00Z',
        },
      ],
    });
    fetchHistoryMock.mockResolvedValueOnce({
      ok: true,
      evenings: [
        {
          id: 'ended-night',
          joinCode: 'PIVOXY',
          pubName: 'U Fleků',
          pubCity: 'Praha',
          startedAt: ended.startedAt,
          endedAt: ended.endedAt!,
          isHost: false,
        },
      ],
      truncated: false,
    });
    fetchRecordMock.mockResolvedValueOnce({ ok: true, record: ended });
    const originals = {
      account: useAccountStore.getState(),
      tally: useTallyStore.getState(),
      live: useLivePartyStore.getState(),
      evening: usePartyEveningStore.getState(),
      games: usePartyGamesStore.getState(),
      photos: useBeerPhotosStore.getState(),
    };
    const recoveryState = jest.fn();
    let unmount: (() => void) | undefined;

    try {
      useAccountStore.setState({
        session: {
          deviceId: 'device-a',
          accountId: 'account-a',
          token: 'secret',
        },
        status: 'ready',
      });
      useTallyStore.setState({ current: null, history: [] });
      useLivePartyStore.setState({
        live: false,
        pubName: '',
        pubKey: null,
        startedAt: null,
        games: [],
      });
      usePartyEveningStore.setState({
        evening: null,
        lastEvening: null,
        pendingJoinCode: null,
      });
      usePartyGamesStore.setState({
        code: null,
        games: [],
        events: [],
        live: false,
      });
      useBeerPhotosStore.setState({ photos: [] });

      const rendered = renderHook(() =>
        useNightRecord({
          recoverLatestEnded: true,
          onRecoveryStateChange: recoveryState,
        }),
      );
      unmount = rendered.unmount;

      await waitFor(() => expect(rendered.result.current.id).toBe('ended-night'));
      expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
      expect(recoveryState).toHaveBeenCalledWith('loading');
      expect(recoveryState).toHaveBeenLastCalledWith('ready');
      expect(fetchRecordMock).toHaveBeenCalledWith('PIVOXY', 'account-a', expect.any(AbortSignal));
      expect(rendered.result.current.stops[0].pubName).toBe('U Fleků');
    } finally {
      unmount?.();
      useAccountStore.setState(originals.account);
      useTallyStore.setState(originals.tally);
      useLivePartyStore.setState(originals.live);
      usePartyEveningStore.setState(originals.evening);
      usePartyGamesStore.setState(originals.games);
      useBeerPhotosStore.setState(originals.photos);
    }
  });

  it('settles on an empty state instead of rendering the epoch forever', async () => {
    fetchHistoryMock.mockResolvedValueOnce({ ok: true, evenings: [], truncated: false });
    const recoveryState = jest.fn();
    const originalAccount = useAccountStore.getState();
    const originalLive = useLivePartyStore.getState();
    const originalEvening = usePartyEveningStore.getState();
    let unmount: (() => void) | undefined;

    try {
      useAccountStore.setState({
        session: { deviceId: 'device-a', accountId: 'account-a', token: 'secret' },
        status: 'ready',
      });
      useLivePartyStore.setState({ live: false, startedAt: null });
      usePartyEveningStore.setState({ evening: null, lastEvening: null });

      const rendered = renderHook(() =>
        useNightRecord({
          recoverLatestEnded: true,
          onRecoveryStateChange: recoveryState,
        }),
      );
      unmount = rendered.unmount;

      await waitFor(() => expect(recoveryState).toHaveBeenLastCalledWith('empty'));
      expect(hasRenderableNightRecord(rendered.result.current)).toBe(false);
      expect(fetchRecordMock).not.toHaveBeenCalled();
    } finally {
      unmount?.();
      useAccountStore.setState(originalAccount);
      useLivePartyStore.setState(originalLive);
      usePartyEveningStore.setState(originalEvening);
    }
  });

  it('recovers a finished local-only party without a server code', async () => {
    const localOnly = record({
      id: 'offline-night',
      code: null,
      endedAt: '2026-08-05T22:00:00Z',
      drinks: [{
        id: 'offline-beer',
        at: '2026-08-05T19:00:00Z',
        by: 'me',
        beerName: 'Ležák',
        drinkType: 'beer',
        stopId: null,
      }],
    });
    await writeNightRecordCache('account-a', localOnly);
    fetchHistoryMock.mockResolvedValueOnce({ ok: true, evenings: [], truncated: false });
    const recoveryState = jest.fn();
    const originalAccount = useAccountStore.getState();
    const originalLive = useLivePartyStore.getState();
    const originalEvening = usePartyEveningStore.getState();
    let unmount: (() => void) | undefined;

    try {
      useAccountStore.setState({
        session: { deviceId: 'device-a', accountId: 'account-a', token: 'secret' },
        status: 'ready',
      });
      useLivePartyStore.setState({ live: false, startedAt: null });
      usePartyEveningStore.setState({ evening: null, lastEvening: null });

      const rendered = renderHook(() =>
        useNightRecord({
          recoverLatestEnded: true,
          onRecoveryStateChange: recoveryState,
        }),
      );
      unmount = rendered.unmount;

      await waitFor(() => expect(rendered.result.current.id).toBe('offline-night'));
      expect(recoveryState).toHaveBeenLastCalledWith('ready');
      expect(hasRenderableNightRecord(rendered.result.current)).toBe(true);
      expect(fetchRecordMock).not.toHaveBeenCalled();
    } finally {
      unmount?.();
      useAccountStore.setState(originalAccount);
      useLivePartyStore.setState(originalLive);
      usePartyEveningStore.setState(originalEvening);
    }
  });
});

describe('useNightRecord live refresh ordering', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearNightRecordCache();
  });

  it('never lets a delayed stale cache overwrite a newer server record', async () => {
    let releaseCache: ((value: string | null) => void) | undefined;
    const delayedCache = new Promise<string | null>((resolve) => {
      releaseCache = resolve;
    });
    (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(delayedCache);

    const fresh = record({ id: 'fresh-server-record' });
    fetchRecordMock.mockResolvedValueOnce({ ok: true, record: fresh });
    const originalAccount = useAccountStore.getState();
    const originalEvening = usePartyEveningStore.getState();
    let unmount: (() => void) | undefined;

    try {
      useAccountStore.setState({
        session: { deviceId: 'device-a', accountId: 'account-a', token: 'secret' },
        status: 'ready',
      });
      usePartyEveningStore.setState({
        evening: {
          id: 'evening',
          joinCode: 'PIVOXY',
          joinUrl: 'https://na-pivo.cz/party/PIVOXY',
          host: { id: 'account-a', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
          pubName: 'U Fleků',
          pubCity: 'Praha',
          active: true,
          startedAt: fresh.startedAt,
          endedAt: null,
          isHost: true,
          members: [],
          events: [],
        },
        lastEvening: null,
      });

      const rendered = renderHook(() => useNightRecord());
      unmount = rendered.unmount;

      await waitFor(() => expect(rendered.result.current.id).toBe('fresh-server-record'));

      releaseCache?.(JSON.stringify({
        version: 1,
        entries: [{
          accountId: 'account-a',
          code: 'PIVOXY',
          savedAt: 1,
          record: record({ id: 'stale-cache-record' }),
        }],
      }));

      await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rendered.result.current.id).toBe('fresh-server-record');
    } finally {
      releaseCache?.(null);
      unmount?.();
      useAccountStore.setState(originalAccount);
      usePartyEveningStore.setState(originalEvening);
    }
  });
});

describe('useNightRecord terminal table loss', () => {
  const ACTIVE_EVENING = {
    id: 'evening-1',
    joinCode: 'PIVOXY',
    joinUrl: 'https://na-pivo.cz/party/PIVOXY',
    host: { id: 'account-a', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
    pubName: 'U Fleků',
    pubCity: 'Praha',
    active: true,
    startedAt: '2026-08-05T18:00:00Z',
    endedAt: null,
    isHost: false,
    members: [],
    events: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await clearNightRecordCache();
  });

  async function renderAtActiveTable(): Promise<{
    unmount: () => void;
    restore: () => void;
    result: { current: NightRecord };
  }> {
    const originals = {
      account: useAccountStore.getState(),
      evening: usePartyEveningStore.getState(),
    };
    useAccountStore.setState({
      session: { deviceId: 'device-a', accountId: 'account-a', token: 'secret' },
      status: 'ready',
    });
    usePartyEveningStore.setState({
      evening: ACTIVE_EVENING,
      confirmedIdentity: {
        id: 'evening-1',
        joinCode: 'PIVOXY',
        isHost: false,
        confirmedAt: Date.now(),
      },
      lastEvening: null,
      pendingJoinCode: null,
    });
    const rendered = renderHook(() => useNightRecord());
    return {
      unmount: rendered.unmount,
      result: rendered.result,
      restore: () => {
        useAccountStore.setState(originals.account);
        usePartyEveningStore.setState(originals.evening);
      },
    };
  }

  it('closes the active table when the server reports it gone', async () => {
    await writeNightRecordCache('account-a', record({ id: 'cached-live-record' }));
    fetchRecordMock.mockResolvedValue({
      ok: false,
      code: 'party_not_found',
      detail: 'Takový večer tu není.',
    });

    const harness = await renderAtActiveTable();

    try {
      await waitFor(() => expect(fetchRecordMock).toHaveBeenCalled());
      await waitFor(() =>
        expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull(),
      );
      expect(usePartyEveningStore.getState().evening).toBeNull();
    } finally {
      harness.unmount();
      harness.restore();
    }
  });

  it('keeps the table and the cached record through a plain network failure', async () => {
    await writeNightRecordCache('account-a', record({ id: 'cached-live-record' }));
    fetchRecordMock.mockResolvedValue({ ok: false, code: 'network', detail: '' });

    const harness = await renderAtActiveTable();

    try {
      await waitFor(() => expect(fetchRecordMock).toHaveBeenCalled());
      expect(usePartyEveningStore.getState().confirmedIdentity?.joinCode).toBe('PIVOXY');
      expect(usePartyEveningStore.getState().evening).toEqual(ACTIVE_EVENING);
      expect(harness.result.current.id).toBe('cached-live-record');
    } finally {
      harness.unmount();
      harness.restore();
    }
  });

  it('carries real game provenance and never restores an omitted starter’s game', async () => {
    const originalAccount = useAccountStore.getState();
    const originalEvening = usePartyEveningStore.getState();
    const originalLive = useLivePartyStore.getState();
    const originalGames = usePartyGamesStore.getState();

    useAccountStore.setState({
      session: { deviceId: 'device-a', accountId: 'account-a', token: 'secret' },
      status: 'ready',
    });
    usePartyEveningStore.setState({
      evening: ACTIVE_EVENING,
      confirmedIdentity: null,
      lastEvening: null,
      pendingJoinCode: null,
    });
    useLivePartyStore.setState({
      live: false,
      pubName: '',
      pubKey: null,
      startedAt: null,
      games: [],
    });
    // The real shared-games sync path: a PartyGame started by a friend who the
    // fresh server record below no longer lists.
    usePartyGamesStore.setState({
      code: 'PIVOXY',
      games: [
        {
          id: 'game-friend',
          catalogKey: 'rival',
          name: 'Šibenice',
          scoring: 'drinks',
          startedBy: { id: 'friend', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
          roster: [],
          startedAt: '2026-08-05T19:00:00Z',
          endedAt: null,
          seed: 1,
        },
      ],
      events: [],
      live: true,
    });

    try {
      fetchRecordMock.mockResolvedValueOnce({ ok: false, code: 'network', detail: '' });
      const first = renderHook(() => useNightRecord());

      await waitFor(() => expect(fetchRecordMock).toHaveBeenCalled());
      // Construction attribution comes from startedBy, not from this phone.
      expect(first.result.current.games[0]?.by).toBe('friend');
      first.unmount();

      const mine = record({
        people: [{ id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' }],
        drinks: [
          {
            id: 'beer-me',
            at: '2026-08-05T18:30:00Z',
            by: 'me',
            beerName: 'Ležák',
            drinkType: 'beer',
            stopId: null,
          },
        ],
      });
      fetchRecordMock.mockResolvedValue({ ok: true, record: mine });
      const second = renderHook(() => useNightRecord());

      // The authoritative roster omits the friend, so their game cannot stay.
      await waitFor(() =>
        expect(second.result.current.games.some((game) => game.by === 'friend')).toBe(false),
      );
      second.unmount();
    } finally {
      useAccountStore.setState(originalAccount);
      usePartyEveningStore.setState(originalEvening);
      useLivePartyStore.setState(originalLive);
      usePartyGamesStore.setState(originalGames);
    }
  });
});

describe('useNightRecord focus-gated polling', () => {
  const FOCUSED_EVENING = {
    id: 'evening-1',
    joinCode: 'PIVOXY',
    joinUrl: 'https://na-pivo.cz/party/PIVOXY',
    host: { id: 'account-a', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
    pubName: 'U Fleků',
    pubCity: 'Praha',
    active: true,
    startedAt: '2026-08-05T18:00:00Z',
    endedAt: null,
    isHost: false,
    members: [],
    events: [],
  };
  const REFRESH_MS = 10_000;

  beforeEach(async () => {
    jest.clearAllMocks();
    await clearNightRecordCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls only while enabled: one immediate refresh, abort on disable, clean restart on enable', async () => {
    jest.useFakeTimers();
    const originalAccount = useAccountStore.getState();
    const originalEvening = usePartyEveningStore.getState();
    let unmount: (() => void) | undefined;
    const signals: AbortSignal[] = [];
    fetchRecordMock.mockImplementation((_code, _accountId, signal) => {
      signals.push(signal ?? new AbortController().signal);
      return Promise.resolve({ ok: true, record: record() });
    });

    try {
      useAccountStore.setState({
        session: { deviceId: 'device-a', accountId: 'account-a', token: 'secret' },
        status: 'ready',
      });
      usePartyEveningStore.setState({
        evening: FOCUSED_EVENING,
        confirmedIdentity: null,
        lastEvening: null,
        pendingJoinCode: null,
      });

      const rendered = renderHook(
        (props: { enabled: boolean }) => useNightRecord({ pollingEnabled: props.enabled }),
        { initialProps: { enabled: true } },
      );
      unmount = rendered.unmount;

      // Enabled: exactly one immediate remote refresh…
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(fetchRecordMock).toHaveBeenCalledTimes(1);
      // …followed by exactly one interval tick per REFRESH_MS.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(REFRESH_MS * 2);
      });
      expect(fetchRecordMock).toHaveBeenCalledTimes(3);

      // Disable while a refresh is in flight: the signal aborts and no timer
      // survives — advancing well past the interval fires nothing new.
      let releasePending!: (value: { ok: true; record: NightRecord }) => void;
      const pending = new Promise<{ ok: true; record: NightRecord }>((resolve) => {
        releasePending = resolve;
      });
      fetchRecordMock.mockImplementationOnce((_code, _accountId, signal) => {
        signals.push(signal ?? new AbortController().signal);
        return pending;
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(REFRESH_MS);
      });
      expect(fetchRecordMock).toHaveBeenCalledTimes(4);

      rendered.rerender({ enabled: false });
      expect(signals[signals.length - 1].aborted).toBe(true);
      releasePending({ ok: true, record: record() });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchRecordMock).toHaveBeenCalledTimes(4);

      // Re-enable: one fresh immediate refresh, then a single interval again
      // (three ticks over three intervals — never a duplicated poller).
      rendered.rerender({ enabled: true });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(fetchRecordMock).toHaveBeenCalledTimes(5);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(REFRESH_MS * 3);
      });
      expect(fetchRecordMock).toHaveBeenCalledTimes(8);
    } finally {
      unmount?.();
      useAccountStore.setState(originalAccount);
      usePartyEveningStore.setState(originalEvening);
    }
  });
});
