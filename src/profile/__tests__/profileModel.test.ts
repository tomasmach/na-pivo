import type { WireDrink } from '@/data/drinksClient';
import type { PubFavorite } from '@/stores/pubFavoritesStore';
import type { TallySession } from '@/stores/tallyStore';

import { favoriteBeerName, savedFavoritePubs } from '../profileModel';

function remote(id: string, name: string, at: string, extra: Partial<WireDrink> = {}): WireDrink {
  return {
    client_id: id,
    cache_key: 'u2fkbnhu',
    name: 'U Hrocha',
    lat: 50.09,
    lng: 14.4,
    city: 'Praha',
    external_id: '',
    place_context: 'pub',
    drink_type: 'beer',
    beer: { name, price_czk: 60, volume_ml: 500, serving_type: 'tap' },
    drank_at: at,
    is_suspect: false,
    ...extra,
  } as WireDrink;
}

function session(drinks: { id: string; name: string; at: string; drinkType?: string }[]): TallySession {
  return {
    clientId: 's1',
    pubKey: 'u2fkbnhu',
    pubName: 'U Hrocha',
    startedAt: drinks[0]?.at ?? '2026-10-01T18:00:00.000Z',
    drinks: drinks.map((drink) => ({
      id: drink.id,
      beerName: drink.name,
      drinkType: drink.drinkType ?? 'beer',
      at: drink.at,
    })),
  } as TallySession;
}

describe('favoriteBeerName', () => {
  it('counts a drink that is both local and in the snapshot once', () => {
    const drinks = [
      remote('a', 'Pilsner Urquell', '2026-10-01T18:00:00.000Z'),
      remote('b', 'Pilsner Urquell', '2026-10-01T19:00:00.000Z'),
    ];
    const local = session([
      { id: 'a', name: 'Pilsner Urquell', at: '2026-10-01T18:00:00.000Z' },
      { id: 'b', name: 'Pilsner Urquell', at: '2026-10-01T19:00:00.000Z' },
    ]);
    expect(favoriteBeerName(drinks, [local])).toBeNull();
    expect(
      favoriteBeerName(drinks, [
        local,
        session([{ id: 'c', name: 'pilsner urquell ', at: '2026-10-02T18:00:00.000Z' }]),
      ]),
    ).toBe('pilsner urquell');
  });

  it('skips suspect rows and drinks that are not beer', () => {
    const drinks = [
      remote('a', 'Kozel', '2026-10-01T18:00:00.000Z'),
      remote('b', 'Kozel', '2026-10-01T19:00:00.000Z', { is_suspect: true }),
      remote('c', 'Kozel', '2026-10-01T20:00:00.000Z', { drink_type: 'wine' }),
      remote('d', 'Kozel', '2026-10-01T21:00:00.000Z'),
    ];
    expect(favoriteBeerName(drinks, [])).toBeNull();
  });

  it('gives a tie to the beer drunk most recently', () => {
    const local = session([
      { id: '1', name: 'Kozel', at: '2026-10-01T18:00:00.000Z' },
      { id: '2', name: 'Kozel', at: '2026-10-01T19:00:00.000Z' },
      { id: '3', name: 'Kozel', at: '2026-10-01T20:00:00.000Z' },
      { id: '4', name: 'Bernard', at: '2026-10-02T18:00:00.000Z' },
      { id: '5', name: 'Bernard', at: '2026-10-02T19:00:00.000Z' },
      { id: '6', name: 'Bernard', at: '2026-10-02T20:00:00.000Z' },
    ]);
    expect(favoriteBeerName(null, [local])).toBe('Bernard');
  });
});

describe('savedFavoritePubs', () => {
  const favorite = (name: string, updatedAt: string, extra: Partial<PubFavorite> = {}): PubFavorite => ({
    name,
    lat: 50.08,
    lng: 14.42,
    updatedAt,
    ...extra,
  });

  it('lists the newest heart first and leaves out reported pubs', () => {
    const pubs = savedFavoritePubs(
      {
        aaa: favorite('Lokál', '2026-10-01T10:00:00.000Z', { city: 'Praha', externalId: 'ext-1' }),
        bbb: favorite('U Hrocha', '2026-10-03T10:00:00.000Z'),
        ccc: favorite('Bašta', '2026-10-02T10:00:00.000Z'),
        ddd: favorite('Výčep', '2026-10-04T10:00:00.000Z', { externalId: 'ext-2' }),
      },
      ['ccc'],
      ['ext-2'],
    );
    expect(pubs.map((pub) => pub.name)).toEqual(['U Hrocha', 'Lokál']);
    expect(pubs[0].id).toBe('');
    expect(pubs[1]).toMatchObject({ id: 'ext-1', city: 'Praha' });
  });
});
