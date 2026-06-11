import {
  buildCommunityEntry,
  beerToWire,
  beerFromWire,
  type CommunityInput,
} from '../communityClient';
import { emptyWeeklyHours } from '../communityHours';

// communityClient imports account → expo-secure-store, which isn't transformed
// for the node test env; mock it so the module loads (these tests exercise the
// pure mapping helpers, which never touch the secure store). jest hoists this
// above the imports above.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

describe('beer wire mapping', () => {
  it('maps camelCase → snake_case, dropping empty optionals', () => {
    expect(beerToWire({ name: 'Plzeň 12°', priceCzk: 65, volumeMl: 500 })).toEqual({
      name: 'Plzeň 12°',
      price_czk: 65,
      volume_ml: 500,
    });
    expect(beerToWire({ name: 'Kozel' })).toEqual({ name: 'Kozel' });
  });

  it('maps snake_case → camelCase, dropping absent optionals', () => {
    expect(beerFromWire({ name: 'Plzeň 12°', price_czk: 65, volume_ml: 500 })).toEqual({
      name: 'Plzeň 12°',
      priceCzk: 65,
      volumeMl: 500,
    });
    expect(beerFromWire({ name: 'Kozel' })).toEqual({ name: 'Kozel' });
  });
});

describe('buildCommunityEntry', () => {
  const base: CommunityInput = {
    externalId: 'mapy:50.08,14.42',
    name: 'U Testu',
    lat: 50.08,
    lng: 14.42,
    city: '  Praha  ',
  };

  it('includes the client_id and core fields, trimming city', () => {
    const entry = buildCommunityEntry(
      { ...base, hours: emptyWeeklyHours() },
      'client-1',
    );
    expect(entry.client_id).toBe('client-1');
    expect(entry.name).toBe('U Testu');
    expect(entry.lat).toBe(50.08);
    expect(entry.lng).toBe(14.42);
    expect(entry.external_id).toBe('mapy:50.08,14.42');
    expect(entry.city).toBe('Praha');
  });

  it('omits an empty city', () => {
    const entry = buildCommunityEntry(
      { ...base, city: '   ', hours: emptyWeeklyHours() },
      'c',
    );
    expect(entry.city).toBeUndefined();
  });

  it('includes only the touched sections (hours only)', () => {
    const hours = { ...emptyWeeklyHours(), mo: [['11:00', '23:00']] as [string, string][] };
    const entry = buildCommunityEntry({ ...base, hours }, 'c');
    expect(entry.hours).toEqual(hours);
    expect(entry.beers).toBeUndefined();
  });

  it('includes only the touched sections (beers only) and maps them to wire form', () => {
    const entry = buildCommunityEntry(
      { ...base, beers: [{ name: 'Plzeň', priceCzk: 60, volumeMl: 500 }] },
      'c',
    );
    expect(entry.hours).toBeUndefined();
    expect(entry.beers).toEqual([{ name: 'Plzeň', price_czk: 60, volume_ml: 500 }]);
  });

  it('preserves a null external_id', () => {
    const entry = buildCommunityEntry(
      { ...base, externalId: null, beers: [{ name: 'X' }] },
      'c',
    );
    expect(entry.external_id).toBeNull();
  });
});
