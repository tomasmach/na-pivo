import { geohash8 } from '@/data/geohash';
import type { FriendPubActivity } from '@/data/friendsClient';
import type { WireVisit } from '@/data/visitsClient';
import type { TallySession } from '@/stores/tallyStore';
import {
  buildMapPubPoints,
  buildLivePubs,
  buildVisitedCities,
  buildVisitedPubs,
  clusterCoordinates,
  pubOpeningVerdict,
} from '../mapModel';

const PRAGUE = { lat: 50.0876, lng: 14.4214 };
const BRNO = { lat: 49.1951, lng: 16.6068 };

function visit(over: Partial<WireVisit> = {}): WireVisit {
  return {
    client_id: 'visit-1',
    cache_key: geohash8(PRAGUE.lat, PRAGUE.lng),
    name: 'U Zlatého tygra',
    ...PRAGUE,
    city: 'Praha',
    external_id: null,
    started_at: '2026-06-10T18:00:00.000Z',
    ended_at: '2026-06-10T21:00:00.000Z',
    updated_at: '2026-06-10T21:00:00.000Z',
    ...over,
  };
}

function session(over: Partial<TallySession> = {}): TallySession {
  return {
    clientId: 'local-1',
    pubKey: geohash8(BRNO.lat, BRNO.lng),
    pubName: 'U Třech čertů',
    pubCity: 'Brno',
    startedAt: '2026-07-01T18:00:00.000Z',
    drinks: [{ id: 'beer-1', beerName: 'Ležák', priceCzk: 58, at: '2026-07-01T19:00:00.000Z' }],
    ...over,
  };
}

function activity(over: Partial<FriendPubActivity> = {}): FriendPubActivity {
  const now = Date.now();
  return {
    id: 'activity-1',
    account: {
      id: 'friend-1',
      nickname: 'pepa',
      displayName: 'Pepa',
      avatarUrl: null,
      isPublic: true,
    },
    cacheKey: geohash8(PRAGUE.lat, PRAGUE.lng),
    name: 'Lokál',
    city: 'Praha',
    externalId: '',
    message: '',
    startedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    active: true,
    createdAt: new Date(now - 60_000).toISOString(),
    updatedAt: new Date(now - 60_000).toISOString(),
    responses: { going: 0, maybe: 0, cant: 0, goingProfiles: [] },
    myResponse: null,
    kind: 'live',
    scheduledFor: null,
    reactions: { cheers: 0 },
    myReaction: null,
    ...over,
  };
}

describe('pivní mapový model', () => {
  it('považuje otevíračku za známou jen po úspěšném dohledání', () => {
    expect(pubOpeningVerdict({ id: 'closed', name: 'Zavřeno', ...PRAGUE, isOpenNow: false })).toBeNull();
    expect(
      pubOpeningVerdict({
        id: 'closed',
        name: 'Zavřeno',
        ...PRAGUE,
        isOpenNow: false,
        hoursStatus: 'ok',
      }),
    ).toBe(false);
  });

  it('schová jen známé zavřené hospody a použije stejný dataset pro mapu i seznam', () => {
    const visited = buildVisitedPubs([visit()], [], []);
    const result = buildMapPubPoints(
      [
        { id: 'closed', name: 'Zavřeno', ...PRAGUE, isOpenNow: false, hoursStatus: 'ok' },
        { id: 'open', name: 'Otevřeno', ...BRNO, isOpenNow: true, hoursStatus: 'ok' },
        { id: 'unknown', name: 'Bez otevíračky', lat: 49.2, lng: 16.61 },
      ],
      visited,
      false,
      true,
    );

    expect(result.points.map((point) => point.pub.name)).toEqual(['Otevřeno', 'Bez otevíračky']);
  });

  it('nevrátí zavřenou navštívenou hospodu zpět jako bod bez otevíračky', () => {
    const visited = buildVisitedPubs([visit()], [], []);
    const result = buildMapPubPoints(
      [{ id: 'closed', name: 'Zavřeno', ...PRAGUE, isOpenNow: false, hoursStatus: 'ok' }],
      visited,
      true,
      true,
    );

    expect(result.points).toEqual([]);
  });

  it('sloučí serverové a lokální návštěvy bez zdvojení stejného client id', () => {
    const remote = visit({ client_id: 'same' });
    const local = session({
      clientId: 'same',
      pubKey: remote.cache_key,
      pubName: remote.name,
      pubCity: remote.city ?? undefined,
    });
    const result = buildVisitedPubs([remote], [local], []);
    expect(result).toHaveLength(1);
    expect(result[0].visitCount).toBe(1);
  });

  it('zachová lokální nesynchronizovanou návštěvu a město', () => {
    const result = buildVisitedPubs([], [session()], []);
    expect(result[0]).toEqual(
      expect.objectContaining({ name: 'U Třech čertů', city: 'Brno', visitCount: 1 }),
    );
  });

  it('upřednostní novější lokální visit a počítá skutečně nejpozdější drink', () => {
    const key = geohash8(BRNO.lat, BRNO.lng);
    const result = buildVisitedPubs(
      [
        visit({
          client_id: 'same',
          cache_key: key,
          lat: BRNO.lat,
          lng: BRNO.lng,
          name: 'Starý název',
          city: null,
          updated_at: '2026-07-01T18:30:00.000Z',
        }),
      ],
      [
        session({
          clientId: 'same',
          drinks: [
            { id: 'late', beerName: 'Ležák', priceCzk: 58, at: '2026-07-01T21:00:00.000Z' },
            { id: 'backdate', beerName: 'Ležák', priceCzk: 58, at: '2026-07-01T17:00:00.000Z' },
          ],
        }),
      ],
      [],
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        name: 'U Třech čertů',
        city: 'Brno',
        lastVisitedAt: '2026-07-01T21:00:00.000Z',
      }),
    );
  });

  it('agreguje pivní stopu města přes více hospod a večerů', () => {
    const visited = buildVisitedPubs(
      [
        visit({ client_id: 'p1' }),
        visit({ client_id: 'p2', started_at: '2026-06-11T18:00:00.000Z' }),
        visit({
          client_id: 'b1',
          cache_key: geohash8(BRNO.lat, BRNO.lng),
          name: 'U Třech čertů',
          lat: BRNO.lat,
          lng: BRNO.lng,
          city: 'Brno',
        }),
      ],
      [],
      [],
    );
    const cities = buildVisitedCities(visited);
    expect(cities.find((city) => city.name === 'Praha')).toEqual(
      expect.objectContaining({ visitCount: 2, pubCount: 1 }),
    );
    expect(cities.find((city) => city.name === 'Brno')).toEqual(
      expect.objectContaining({ visitCount: 1, pubCount: 1 }),
    );
  });

  it('live pin ukáže jen aktivní, neexpirované ohlášení a seskupí partu v hospodě', () => {
    const now = Date.now();
    const result = buildLivePubs(
      [
        activity({ id: 'a' }),
        activity({ id: 'b', account: { ...activity().account, id: 'friend-2' } }),
        activity({ id: 'expired', expiresAt: new Date(now - 1).toISOString() }),
        activity({ id: 'plan', kind: 'plan' }),
      ],
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0].activities).toHaveLength(2);
  });

  it('grid clustering se při přiblížení rozpadne do samostatných pinů', () => {
    const points = [
      { lat: 50.0876, lng: 14.4214 },
      { lat: 50.088, lng: 14.422 },
    ];
    const wide = clusterCoordinates(points, {
      latitude: 50.0878,
      longitude: 14.4217,
      latitudeDelta: 1,
      longitudeDelta: 1,
    });
    const close = clusterCoordinates(points, {
      latitude: 50.0878,
      longitude: 14.4217,
      latitudeDelta: 0.003,
      longitudeDelta: 0.003,
    });
    expect(wide).toHaveLength(1);
    expect(wide[0].items).toHaveLength(2);
    expect(close).toHaveLength(2);
  });

  it('grid clustering zůstane při posunu mapy na stejném zoomu stabilní', () => {
    const points = [
      { key: 'a', lat: 50.0876, lng: 14.4214 },
      { key: 'b', lat: 50.088, lng: 14.422 },
      { key: 'c', lat: 50.095, lng: 14.43 },
    ];
    const beforePan = clusterCoordinates(points, {
      latitude: 50.0878,
      longitude: 14.4217,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    });
    const afterPan = clusterCoordinates([...points].reverse(), {
      latitude: 50.12,
      longitude: 14.46,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    });
    const membership = (clusters: typeof beforePan) =>
      clusters
        .map((cluster) => ({
          id: cluster.id,
          keys: cluster.items.map((item) => item.key).sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(membership(afterPan)).toEqual(membership(beforePan));
  });
});
