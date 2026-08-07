import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import {
  beerFilterOptions,
  formatLastVisit,
  presentOpenStatus,
  presentPub,
  pubMatchesFilters,
  serverFiltersForPubList,
  sortPubs,
  summarizePubVisits,
} from '@/pubs/pubPresentation';

function pub(overrides: Partial<Pub> = {}): Pub {
  return {
    id: 'pub-1',
    name: 'U Tygra',
    lat: 50.087,
    lng: 14.42,
    city: 'Praha',
    ...overrides,
  };
}

function visit(target: Pub, overrides: Partial<WireVisit> = {}): WireVisit {
  return {
    client_id: 'visit-1',
    cache_key: geohash8(target.lat, target.lng),
    name: target.name,
    lat: target.lat,
    lng: target.lng,
    city: target.city ?? null,
    external_id: target.id,
    started_at: '2026-08-01T18:00:00+02:00',
    ended_at: '2026-08-01T22:00:00+02:00',
    updated_at: '2026-08-01T22:00:00+02:00',
    ...overrides,
  };
}

describe('pubPresentation', () => {
  it('presents real distance, address, rating, tap and its own price', () => {
    const model = presentPub(
      pub({
        address: 'Husova 17',
        rating: 4.7,
        isOpenNow: true,
        nextChange: '2026-08-06T23:00:00+02:00',
        hoursStatus: 'ok',
        beers: [{ name: 'Únětická 12°', priceCzk: 59 }],
      }),
      { lat: 50.087, lng: 14.42 },
    );

    expect(model.distanceLabel).toBe('0 m');
    expect(model.distanceValue).toBe('0');
    expect(model.distanceUnit).toBe('m');
    expect(model.address).toBe('Husova 17');
    expect(model.rating).toBe(4.7);
    expect(model.openLabel).toBe('Otevřeno do 23:00');
    expect(model.featuredTap).toEqual({ name: 'Únětická 12°', priceCzk: 59 });
    expect(model.beerLine).toBe('Únětická 12°  (59 Kč)');
  });

  it('keeps open, closed, pending and unknown states distinct', () => {
    expect(presentOpenStatus(pub({ isOpenNow: false, nextChange: 'xT17:30:00+02:00' }))).toEqual({
      state: 'closed',
      label: 'Zavřeno · otevře v 17:30',
    });
    expect(presentOpenStatus(pub({ isOpenNow: null, hoursStatus: 'pending' }))).toEqual({
      state: 'loading',
      label: 'Načítám otevíračku',
    });
    expect(presentOpenStatus(pub({ isOpenNow: null, hoursStatus: 'unknown' }))).toEqual({
      state: 'unknown',
      label: 'Otevírací doba neznámá',
    });
  });

  it('never assigns a reference price to an unknown beer', () => {
    const model = presentPub(pub({ price: {
      czk: 54,
      volumeMl: 500,
      observedAt: '2026-08-01T12:00:00+02:00',
      source: 'community',
    } }), null);

    expect(model.featuredTap).toBeNull();
    expect(model.beerLine).toBe('Pivo od 54 Kč');
    expect(model.distanceLabel).toBeNull();
  });

  it('aggregates visits by the server cache key and keeps the latest date', () => {
    const target = pub();
    const visits = [
      visit(target),
      visit(target, {
        client_id: 'visit-2',
        started_at: '2026-08-05T19:00:00+02:00',
        ended_at: null,
      }),
      visit(pub({ id: 'other', lat: 49, lng: 15 }), { client_id: 'other' }),
    ];

    expect(summarizePubVisits(target, visits)).toEqual({
      count: 2,
      lastVisitedAt: '2026-08-05T19:00:00+02:00',
    });
    expect(presentPub(target, null, visits).visitCount).toBe(2);
    expect(
      formatLastVisit(
        '2026-08-05T19:00:00+02:00',
        new Date('2026-08-06T12:00:00+02:00'),
      ),
    ).toBe('včera');
  });

  it('keeps server-filtered pubs even when bulk rows omit beer and amenity details', () => {
    const model = presentPub(
      pub({
        isOpenNow: true,
        beers: [{ name: 'Matuška Raptor' }],
        hasGarden: true,
        amenities: [
          {
            amenity_key: 'practical_tank_beer',
            status: 'yes',
            confidence: 1,
            yes_count: 2,
            no_count: 0,
            distinct_voter_count: 2,
          },
        ],
      }),
      null,
    );

    expect(
      pubMatchesFilters(model, {
        beers: ['matuška raptor'],
        openOnly: true,
        tankOnly: true,
        gardenOnly: true,
      }),
    ).toBe(true);
    expect(
      pubMatchesFilters(model, {
        beers: ['Pilsner Urquell'],
        openOnly: false,
        tankOnly: true,
        gardenOnly: true,
      }),
    ).toBe(true);
    expect(
      pubMatchesFilters(presentPub(pub({ isOpenNow: false }), null), {
        beers: [],
        openOnly: true,
        tankOnly: false,
        gardenOnly: false,
      }),
    ).toBe(false);
    expect(
      presentPub(pub({ name: 'Tankovna bez dat' }), null).hasTankBeer,
    ).toBe(false);
  });

  it('maps selected brand, tank and garden choices to canonical server keys', () => {
    expect(
      serverFiltersForPubList({
        beers: ['radegast', 'pilsner-urquell', 'radegast'],
        openOnly: true,
        tankOnly: true,
        gardenOnly: true,
      }),
    ).toEqual({
      beerBrandKeys: ['pilsner-urquell', 'radegast'],
      amenityKeys: ['practical_tank_beer', 'seating_garden'],
    });
  });

  it('derives beer choices from loaded menus and sorts nullable fields honestly', () => {
    const loaded = [
      pub({ id: 'a', beers: [{ name: 'Kozel' }, { name: 'Pilsner Urquell' }], rating: null }),
      pub({ id: 'b', beers: [{ name: 'kozel' }], rating: 4.8 }),
    ];
    expect(beerFilterOptions(loaded)).toEqual(['kozel', 'Pilsner Urquell']);

    const models = loaded.map((item) => presentPub(item, null));
    expect(sortPubs(models, 'rating').map((item) => item.id)).toEqual(['b', 'a']);
    expect(sortPubs(models, 'nearest').map((item) => item.id)).toEqual(['a', 'b']);
    expect(sortPubs(models, 'random', 7)).toEqual(sortPubs(models, 'random', 7));
  });
});
