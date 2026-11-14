import {
  buildCommunityEntry,
  beerToWire,
  beerFromWire,
  rebaseCommunityEntry,
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

  it('tells the server a menu keeps every size, so it never restores one', () => {
    expect(buildCommunityEntry({ ...base, beers: [{ name: 'Plzeň', volumeMl: 470 }] }, 'c').beer_sizes_complete).toBe(true);
    expect(buildCommunityEntry({ ...base, hours: undefined }, 'c')).not.toHaveProperty('beer_sizes_complete');
  });

  it('sends a one-beer change with the full menu, sizes as null when unknown', () => {
    const beers = [{ name: 'Plzeň', priceCzk: 65 }];
    expect(
      buildCommunityEntry(
        { ...base, beers, beerChange: { action: 'update', name: 'Plzeň', priceCzk: 65 } },
        'c',
      ).beer_change,
    ).toEqual({ action: 'update', name: 'Plzeň', volume_ml: null, price_czk: 65, new_volume_ml: null });
    expect(
      buildCommunityEntry(
        { ...base, beers, beerChange: { action: 'remove', name: 'Kozel', volumeMl: 500 } },
        'c',
      ).beer_change,
    ).toEqual({ action: 'remove', name: 'Kozel', volume_ml: 500 });
  });

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

  it('maps the rotating-menu flag only when supplied', () => {
    const rotating = buildCommunityEntry(
      { ...base, beers: [{ name: 'Plzeň' }], beerMenuRotates: true },
      'c',
    );
    const legacy = buildCommunityEntry({ ...base, beers: [{ name: 'Kozel' }] }, 'd');

    expect(rotating.beer_menu_rotates).toBe(true);
    expect(legacy.beer_menu_rotates).toBeUndefined();
  });

  it('preserves a null external_id', () => {
    const entry = buildCommunityEntry(
      { ...base, externalId: null, beers: [{ name: 'X' }] },
      'c',
    );
    expect(entry.external_id).toBeNull();
  });
});

describe('rebaseCommunityEntry', () => {
  const pilsner = { name: 'Pilsner Urquell 12°' };
  const kozel65 = { name: 'Kozel 11°', priceCzk: 65 };
  const kozel70 = { name: 'Kozel 11°', priceCzk: 70 };
  const pub = { externalId: null, name: 'U Zlatého tygra', lat: 50.0855, lng: 14.4186 };
  const server = (beers: CommunityInput['beers'] = [], hours: CommunityInput['hours'] = undefined) => ({
    beers: beers ?? [],
    communityHours: hours ?? null,
    openingHours: null,
  });

  it('keeps a beer the offline editor never showed when it fixes another one', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [kozel70], beersBase: [kozel65] }, 'c1');
    const sent = rebaseCommunityEntry(entry, server([pilsner, kozel65]));
    expect(sent.beers).toEqual([{ name: 'Pilsner Urquell 12°' }, { name: 'Kozel 11°', price_czk: 70 }]);
    expect(sent).not.toHaveProperty('beers_base');
  });

  it('adds beers to a menu the cold-started editor did not know', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [kozel65], beersBase: [] }, 'c1');
    expect(rebaseCommunityEntry(entry, server([pilsner])).beers).toEqual([
      { name: 'Kozel 11°', price_czk: 65 },
      { name: 'Pilsner Urquell 12°' },
    ]);
  });

  it('puts an edited beer the server names differently first, so the server keeps the new price', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [kozel70], beersBase: [kozel65] }, 'c1');
    const catalogued = { name: 'Velkopopovický Kozel 11°', priceCzk: 65 };
    expect(rebaseCommunityEntry(entry, server([pilsner, catalogued])).beers).toEqual([
      { name: 'Kozel 11°', price_czk: 70 },
      { name: 'Pilsner Urquell 12°' },
      { name: 'Velkopopovický Kozel 11°', price_czk: 65 },
    ]);
  });

  it('sends the edited list as it is when the server still has the menu the editor showed', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [pilsner, kozel65, { name: 'Gambrinus 10°' }], beersBase: [pilsner, kozel65] }, 'c1');
    expect(rebaseCommunityEntry(entry, server([kozel65, pilsner])).beers).toEqual(entry.beers);
  });

  it('still removes a beer the person saw on the full menu and took off', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [kozel65], beersBase: [pilsner, kozel65] }, 'c1');
    expect(rebaseCommunityEntry(entry, server([pilsner, kozel65])).beers).toEqual([{ name: 'Kozel 11°', price_czk: 65 }]);
  });

  it('gives the same payload when the same edit is applied twice', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [kozel70], beersBase: [kozel65] }, 'c1');
    const first = rebaseCommunityEntry(entry, server([pilsner, kozel65]));
    const second = rebaseCommunityEntry(entry, server(first.beers!.map(beerFromWire)));
    expect(second).toEqual(first);
  });

  it('sends only the days the person changed and keeps the rest as the server has them', () => {
    const known = { ...emptyWeeklyHours(), mo: [['16:00', '23:00'] as [string, string]], fr: [['16:00', '01:00'] as [string, string]] };
    const edited = { ...emptyWeeklyHours(), sa: [['14:00', '23:00'] as [string, string]] };
    const entry = buildCommunityEntry({ ...pub, hours: edited, hoursBase: emptyWeeklyHours() }, 'c1');
    expect(rebaseCommunityEntry(entry, server([], known)).hours).toEqual({ ...known, sa: [['14:00', '23:00']] });
    expect(rebaseCommunityEntry(entry, server([], known))).not.toHaveProperty('hours_base');
  });

  it('leaves an entry without a base, as released apps store it, unchanged', () => {
    const entry = buildCommunityEntry({ ...pub, beers: [kozel70] }, 'c1');
    expect(rebaseCommunityEntry(entry, server([pilsner]))).toEqual(entry);
  });
});
