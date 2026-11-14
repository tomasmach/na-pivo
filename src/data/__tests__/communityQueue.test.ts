import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCommunityQueue, enqueuePubCommunity, flushCommunityQueue } from '../communityQueue';
import { buildCommunityEntry, submitPubCommunity, type CommunityEntry } from '../communityClient';
import { fetchPubHours } from '../hoursClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// communityClient → account → expo-secure-store, which isn't transformed for the
// node test env; mock it so requireActual('../communityClient') loads.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../communityClient', () => ({
  ...jest.requireActual('../communityClient'),
  submitPubCommunity: jest.fn(async () => ({ cacheKey: 'k', hours: null, beers: [] })),
}));

jest.mock('../hoursClient', () => ({ fetchPubHours: jest.fn(async () => new Map()) }));

const STORAGE_KEY = 'na-pivo-community-queue';

function entry(overrides: Partial<CommunityEntry> = {}): CommunityEntry {
  return {
    client_id: 'c1',
    name: 'U Testu',
    lat: 50.0812,
    lng: 14.4182,
    external_id: 'mapy:1',
    hours: { mo: [], tu: [], we: [], th: [], fr: [], sa: [], su: [] },
    ...overrides,
  };
}

async function readQueue(): Promise<CommunityEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('enqueuePubCommunity', () => {
  it('sends the entry and leaves the queue empty on success', async () => {
    await expect(enqueuePubCommunity(entry())).resolves.toMatchObject({ cacheKey: 'k' });
    expect(submitPubCommunity).toHaveBeenCalledTimes(1);
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a failed entry queued instead of dropping it', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await expect(enqueuePubCommunity(entry())).resolves.toBeNull();
    expect(await readQueue()).toHaveLength(1);
  });

  it('dedups by geohash-8 cell and keeps the latest contribution ID', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);

    // Same coordinates → same cell; the second submission has a fresh client_id
    // and becomes the identity of the combined contribution.
    await enqueuePubCommunity(entry({ client_id: 'old' }));
    await enqueuePubCommunity(entry({ client_id: 'new' }));

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('new');
  });

  it('keeps separate entries for pubs in different cells', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);

    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));

    expect(await readQueue()).toHaveLength(2);
  });

  it('keeps an offline beer menu when only opening hours are edited afterwards', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    const beers = [
      { name: 'Plzeň', price_czk: 62, volume_ml: 500 },
      { name: 'Plzeň', price_czk: 38, volume_ml: 300 },
    ];
    await enqueuePubCommunity(entry({
      client_id: 'beer-edit', hours: undefined, beers, beer_menu_rotates: true,
    }));
    await enqueuePubCommunity(entry({ client_id: 'hours-edit' }));

    expect(await readQueue()).toEqual([expect.objectContaining({
      client_id: 'hours-edit',
      hours: entry().hours,
      beers,
      beer_menu_rotates: true,
    })]);

    (submitPubCommunity as jest.Mock).mockResolvedValue({ cacheKey: 'k', hours: null, beers: [] });
    await flushCommunityQueue();
    expect(submitPubCommunity).toHaveBeenLastCalledWith(expect.objectContaining({ beers }));
    expect(await readQueue()).toEqual([]);
  });

  it('keeps offline opening hours when only the beer menu is edited afterwards', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    const beers = [{ name: 'Plzeň', price_czk: 38, volume_ml: 300 }];
    await enqueuePubCommunity(entry({ client_id: 'hours-edit' }));
    await enqueuePubCommunity(entry({ client_id: 'beer-edit', hours: undefined, beers }));

    expect(await readQueue()).toEqual([expect.objectContaining({
      client_id: 'beer-edit', hours: entry().hours, beers,
    })]);
  });

  it.each([
    { label: 'an explicit empty menu', beers: [] },
    { label: 'a replacement menu', beers: [{ name: 'Kozel', price_czk: 49, volume_ml: 300 }] },
  ])('uses $label and the latest supplied hours and tap setting', async ({ beers }) => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(entry({
      client_id: 'old',
      beers: [{ name: 'Plzeň', price_czk: 62, volume_ml: 500 }],
      beer_menu_rotates: true,
    }));
    const hours = { ...entry().hours!, mo: [['10:00', '23:00'] as [string, string]] };
    await enqueuePubCommunity(entry({ client_id: 'new', hours, beers, beer_menu_rotates: false }));

    expect(await readQueue()).toEqual([expect.objectContaining({
      client_id: 'new', hours, beers, beer_menu_rotates: false,
    })]);
  });

  it('keeps every one-beer change of a pub queued, in order, and never merges it', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    const menu = [{ name: 'Plzeň', price_czk: 62, volume_ml: 500 }];
    await enqueuePubCommunity(entry({
      client_id: 'remove-kozel',
      hours: undefined,
      beers: menu,
      beer_change: { action: 'remove', name: 'Kozel', volume_ml: 500 },
    }));
    await enqueuePubCommunity(entry({
      client_id: 'fix-plzen',
      hours: undefined,
      beers: [{ ...menu[0], price_czk: 65 }],
      beer_change: { action: 'update', name: 'Plzeň', volume_ml: 500, price_czk: 65, new_volume_ml: 500 },
    }));
    // A later hours edit neither absorbs nor rewrites the pending changes.
    await enqueuePubCommunity(entry({ client_id: 'hours' }));

    expect((await readQueue()).map((queued) => queued.client_id)).toEqual([
      'remove-kozel',
      'fix-plzen',
      'hours',
    ]);
    expect((await readQueue())[0].beer_change).toEqual({ action: 'remove', name: 'Kozel', volume_ml: 500 });
  });

  it('merges an hours edit only into the latest pending edit, never past a one-beer change', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    const menu = [
      { name: 'Plzeň', price_czk: 62, volume_ml: 500 },
      { name: 'Kozel', price_czk: 48, volume_ml: 500 },
    ];
    await enqueuePubCommunity(entry({ client_id: 'full', hours: undefined, beers: menu }));
    await enqueuePubCommunity(entry({
      client_id: 'remove-kozel',
      hours: undefined,
      beers: [menu[0]],
      beer_change: { action: 'remove', name: 'Kozel', volume_ml: 500 },
    }));
    await enqueuePubCommunity(entry({ client_id: 'hours' }));

    const queued = await readQueue();
    expect(queued.map((q) => q.client_id)).toEqual(['full', 'remove-kozel', 'hours']);
    // The hours edit carries no stale menu that would bring Kozel back.
    expect(queued[2].beers).toBeUndefined();
  });

  it('holds a pub\'s later edits while an earlier one keeps failing', async () => {
    const submit = submitPubCommunity as jest.Mock;
    submit.mockResolvedValue(null);
    await enqueuePubCommunity(entry({
      client_id: 'fix-65',
      hours: undefined,
      beers: [],
      beer_change: { action: 'update', name: 'Plzeň', volume_ml: 500, price_czk: 65, new_volume_ml: 500 },
    }));
    // The next attempt would succeed, but it must not overtake the first fix.
    submit.mockClear();
    submit.mockResolvedValueOnce(null).mockResolvedValue({ cacheKey: 'k', hours: null, beers: [] });
    await enqueuePubCommunity(entry({
      client_id: 'fix-70',
      hours: undefined,
      beers: [],
      beer_change: { action: 'update', name: 'Plzeň', volume_ml: 500, price_czk: 70, new_volume_ml: 500 },
    }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].client_id).toBe('fix-65');
    expect((await readQueue()).map((q) => q.client_id)).toEqual(['fix-65', 'fix-70']);

    await flushCommunityQueue();
    expect(submit.mock.calls.map(([sent]) => sent.client_id)).toEqual(['fix-65', 'fix-65', 'fix-70']);
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('drops an edit the server rejected for good and sends the next one', async () => {
    const submit = submitPubCommunity as jest.Mock;
    submit.mockResolvedValueOnce('permanent-error').mockResolvedValue({ cacheKey: 'k', hours: null, beers: [] });
    await enqueuePubCommunity(entry({
      client_id: 'bad',
      hours: undefined,
      beers: [],
      beer_change: { action: 'remove', name: 'Kozel', volume_ml: 500 },
    }));
    await expect(readQueue()).resolves.toEqual([]);
  });
});

describe('flushCommunityQueue', () => {
  it('re-sends queued entries once the backend recovers and clears the queue', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));
    expect(await readQueue()).toHaveLength(2);

    (submitPubCommunity as jest.Mock).mockResolvedValue({ cacheKey: 'k', hours: null, beers: [] });
    await flushCommunityQueue();

    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps only the entries that failed again', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(entry({ client_id: 'a', lat: 50.0812, lng: 14.4182 }));
    await enqueuePubCommunity(entry({ client_id: 'b', lat: 49.1951, lng: 16.6068 }));

    (submitPubCommunity as jest.Mock).mockImplementation(async (e: CommunityEntry) =>
      e.client_id === 'a' ? { cacheKey: 'k', hours: null, beers: [] } : null,
    );
    await flushCommunityQueue();

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_id).toBe('b');
  });

  it('does nothing on an empty queue', async () => {
    await flushCommunityQueue();
    expect(submitPubCommunity).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushCommunityQueue()).resolves.toBeUndefined();
    expect(submitPubCommunity).not.toHaveBeenCalled();
  });
});

describe('an edit made against what the editor showed', () => {
  const tiger = { externalId: null, name: 'U Zlatého tygra', lat: 50.0855, lng: 14.4186 };
  const pilsner = { name: 'Pilsner Urquell 12°' };
  const kozel65 = { name: 'Kozel 11°', priceCzk: 65 };
  const serverHas = (beers: { name: string; priceCzk?: number }[]) =>
    (fetchPubHours as jest.Mock).mockImplementation(async (pubs: { id: string }[]) =>
      new Map([[pubs[0].id, { beers, communityHours: null, openingHours: null }]]),
    );
  const offlinePriceFix = () =>
    buildCommunityEntry({ ...tiger, beers: [{ name: 'Kozel 11°', priceCzk: 70 }], beersBase: [kozel65] }, 'fix-1');

  it('keeps the beers the offline editor never showed once the signal is back', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(offlinePriceFix());
    expect(await readQueue()).toEqual([expect.objectContaining({ beers_base: [{ name: 'Kozel 11°', price_czk: 65 }] })]);

    serverHas([pilsner, kozel65]);
    (submitPubCommunity as jest.Mock).mockResolvedValue({ cacheKey: 'k', hours: null, beers: [] });
    await flushCommunityQueue();

    const sent = (submitPubCommunity as jest.Mock).mock.calls.at(-1)[0];
    expect(sent.beers).toEqual([{ name: 'Pilsner Urquell 12°' }, { name: 'Kozel 11°', price_czk: 70 }]);
    expect(sent).not.toHaveProperty('beers_base');
    expect(await readQueue()).toEqual([]);
  });

  it('waits instead of sending while the pub cannot be read', async () => {
    (fetchPubHours as jest.Mock).mockResolvedValue(new Map());
    await enqueuePubCommunity(offlinePriceFix());
    expect(submitPubCommunity).not.toHaveBeenCalled();
    expect(await readQueue()).toHaveLength(1);
  });

  it('sends the same result again when the server already has it', async () => {
    serverHas([pilsner, kozel65]);
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(offlinePriceFix());
    const first = (submitPubCommunity as jest.Mock).mock.calls.at(-1)[0];
    serverHas([pilsner, { name: 'Kozel 11°', priceCzk: 70 }]);
    await flushCommunityQueue();
    expect((submitPubCommunity as jest.Mock).mock.calls.at(-1)[0]).toEqual(first);
  });

  it('is never merged into an earlier pending edit of the same pub', async () => {
    (submitPubCommunity as jest.Mock).mockResolvedValue(null);
    await enqueuePubCommunity(entry({ client_id: 'released' }));
    await enqueuePubCommunity({ ...offlinePriceFix(), lat: entry().lat, lng: entry().lng });
    expect((await readQueue()).map((e) => e.client_id)).toEqual(['released', 'fix-1']);
  });

  it('flushes an entry stored by a released app as it is, without reading the pub', async () => {
    const released = entry({ client_id: 'old', hours: undefined, beers: [{ name: 'Kozel', price_czk: 49 }], beer_menu_rotates: false });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([released]));
    await flushCommunityQueue();
    expect(fetchPubHours).not.toHaveBeenCalled();
    expect(submitPubCommunity).toHaveBeenCalledWith(released);
  });

  it('drops a stored entry with a malformed base and still sends the rest', async () => {
    const good = entry({ client_id: 'good', lat: 49.1951, lng: 16.6068 });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([
      { ...entry({ client_id: 'bad', beers: [] }), beers_base: 'nope' },
      { ...entry({ client_id: 'bad-hours' }), hours_base: { mo: [] } },
      good,
    ]));
    await flushCommunityQueue();
    expect(submitPubCommunity).toHaveBeenCalledTimes(1);
    expect(submitPubCommunity).toHaveBeenCalledWith(good);
  });

  it('sends nothing more once the queue is cleared for an account change mid-flush', async () => {
    let release: (value: Map<string, unknown>) => void = () => {};
    (fetchPubHours as jest.Mock).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([offlinePriceFix()]));
    const flush = flushCommunityQueue();
    await new Promise((r) => setTimeout(r, 0));
    const cleared = clearCommunityQueue();
    release(new Map([['fix-1', { beers: [pilsner, kozel65], communityHours: null, openingHours: null }]]));
    await Promise.all([flush, cleared]);
    expect(submitPubCommunity).not.toHaveBeenCalled();
    expect(await readQueue()).toEqual([]);
  });
});
