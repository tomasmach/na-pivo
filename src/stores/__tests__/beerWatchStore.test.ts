import type { BeerWatch, BeerWatchSnapshot } from '@/data/beerWatchClient';
import { findBeerWatch, helpedCountFor, useBeerWatchStore } from '../beerWatchStore';

const mockFetch = jest.fn<Promise<BeerWatchSnapshot | null>, []>();
const mockAdd = jest.fn();
const mockRemove = jest.fn<Promise<boolean>, [string]>();
const mockSettings = jest.fn<Promise<BeerWatchSnapshot | null>, [unknown]>();

jest.mock('@/data/beerWatchClient', () => ({
  fetchBeerWatches: () => mockFetch(),
  addBeerWatch: (...args: unknown[]) => mockAdd(...args),
  removeBeerWatch: (key: string) => mockRemove(key),
  updateBeerWatchSettings: (body: unknown) => mockSettings(body),
}));

const unetice: BeerWatch = { productKey: 'unetice-12', name: 'Únětická 12°', aliases: ['Únětické 12'] };
const plzen: BeerWatch = { productKey: 'pilsner', name: 'Pilsner Urquell', aliases: ['Plzeň'] };

beforeEach(() => {
  jest.clearAllMocks();
  useBeerWatchStore.getState().reset();
});

describe('refresh', () => {
  it('loads watches, radius, location flag and helped counts', async () => {
    mockFetch.mockResolvedValue({
      radiusM: 5000,
      locationSet: true,
      watches: [unetice],
      helped: [{ cacheKey: 'u2fkb', productName: 'Únětická 12°', helpedCount: 3 }],
    });

    await expect(useBeerWatchStore.getState().refresh()).resolves.toBe(true);

    const state = useBeerWatchStore.getState();
    expect(state).toMatchObject({ radiusM: 5000, locationSet: true, loaded: true, watches: [unetice] });
    expect(state.helped).toHaveLength(1);
  });

  it('keeps the last known list when the pull fails', async () => {
    useBeerWatchStore.setState({ watches: [unetice], loaded: true });
    mockFetch.mockResolvedValue(null);

    await expect(useBeerWatchStore.getState().refresh()).resolves.toBe(false);

    expect(useBeerWatchStore.getState().watches).toEqual([unetice]);
  });

  it('drops an answer that arrives after logout', async () => {
    let finish!: (snapshot: BeerWatchSnapshot) => void;
    mockFetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = useBeerWatchStore.getState().refresh();
    useBeerWatchStore.getState().reset();
    finish({ radiusM: 3000, locationSet: true, watches: [unetice], helped: [] });

    await expect(pending).resolves.toBe(false);
    expect(useBeerWatchStore.getState().watches).toEqual([]);
  });

  it('does not undo a watch confirmed while the pull was on the way', async () => {
    let finish!: (snapshot: BeerWatchSnapshot) => void;
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = useBeerWatchStore.getState().refresh();
    mockAdd.mockResolvedValue({ ok: true, watch: unetice });
    await useBeerWatchStore.getState().watch('Únětická 12');

    mockFetch.mockResolvedValueOnce({ radiusM: 3000, locationSet: true, watches: [unetice], helped: [] });
    finish({ radiusM: 3000, locationSet: false, watches: [], helped: [] });

    await expect(pending).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(useBeerWatchStore.getState()).toMatchObject({ watches: [unetice], loaded: true });
  });
});

describe('watch', () => {
  it('adds the resolved catalog beer once', async () => {
    mockAdd.mockResolvedValue({ ok: true, watch: unetice });

    await useBeerWatchStore.getState().watch('únětická 12', 'Únětický pivovar');
    await useBeerWatchStore.getState().watch('Únětická 12°');

    expect(mockAdd).toHaveBeenCalledWith('únětická 12', 'Únětický pivovar');
    expect(useBeerWatchStore.getState().watches).toEqual([unetice]);
  });

  it('reports a failure and changes nothing', async () => {
    mockAdd.mockResolvedValue({ ok: false, reason: 'unknown_beer' });

    await expect(useBeerWatchStore.getState().watch('Domácí ležák')).resolves.toEqual({
      ok: false,
      reason: 'unknown_beer',
    });
    expect(useBeerWatchStore.getState().watches).toEqual([]);
  });
});

describe('unwatch', () => {
  it('removes the beer; the last one also forgets the server location', async () => {
    useBeerWatchStore.setState({ watches: [unetice, plzen], locationSet: true });
    mockRemove.mockResolvedValue(true);

    await useBeerWatchStore.getState().unwatch('pilsner');
    expect(useBeerWatchStore.getState()).toMatchObject({ watches: [unetice], locationSet: true });

    await useBeerWatchStore.getState().unwatch('unetice-12');
    expect(useBeerWatchStore.getState()).toMatchObject({ watches: [], locationSet: false });
  });

  it('keeps the beer when the server did not answer', async () => {
    useBeerWatchStore.setState({ watches: [unetice] });
    mockRemove.mockResolvedValue(false);

    await expect(useBeerWatchStore.getState().unwatch('unetice-12')).resolves.toBe(false);
    expect(useBeerWatchStore.getState().watches).toEqual([unetice]);
  });
});

describe('setRadius', () => {
  it('shows the new radius at once and keeps it after the server confirms', async () => {
    mockSettings.mockResolvedValue({ radiusM: 10000, locationSet: true, watches: null, helped: null });
    const pending = useBeerWatchStore.getState().setRadius(10000);
    expect(useBeerWatchStore.getState().radiusM).toBe(10000);
    await expect(pending).resolves.toBe(true);
    expect(mockSettings).toHaveBeenCalledWith({ radiusM: 10000 });
    expect(useBeerWatchStore.getState().radiusM).toBe(10000);
  });

  it('goes back to the previous radius on failure', async () => {
    mockSettings.mockResolvedValue(null);
    await expect(useBeerWatchStore.getState().setRadius(1000)).resolves.toBe(false);
    expect(useBeerWatchStore.getState().radiusM).toBe(3000);
  });
});

describe('findBeerWatch', () => {
  it('matches the lístek name against catalog name and aliases, ignoring case', () => {
    expect(findBeerWatch([unetice, plzen], '  plzeň ')).toBe(plzen);
    expect(findBeerWatch([unetice, plzen], 'ÚNĚTICKÁ 12°')).toBe(unetice);
    expect(findBeerWatch([unetice, plzen], 'Kozel')).toBeNull();
    expect(findBeerWatch([unetice], '')).toBeNull();
  });

  it('also tries "{brewery} {beer}" like the server does when adding the watch', () => {
    const kozel: BeerWatch = {
      productKey: 'velkopopovicky-kozel-11',
      name: 'Velkopopovický Kozel 11°',
      aliases: ['Kozel 11'],
    };
    expect(findBeerWatch([kozel], '11', 'Kozel')).toBe(kozel);
    expect(findBeerWatch([kozel], '11')).toBeNull();
    expect(findBeerWatch([kozel], '', 'Kozel')).toBeNull();
  });

  it('ignores accents and the degree sign like the server catalog matcher', () => {
    const bernard: BeerWatch = { productKey: 'bernard-12', name: 'Bernard 12°', aliases: [] };
    expect(findBeerWatch([bernard], '12', 'Bernard')).toBe(bernard);
    expect(findBeerWatch([bernard], 'bernard 12.')).toBe(bernard);
    expect(findBeerWatch([bernard], 'Bernard 11°')).toBeNull();
  });
});

describe('helpedCountFor', () => {
  it('counts only this pub and this beer', () => {
    const helped = [
      { cacheKey: 'u2fkb', productName: 'Únětická 12°', helpedCount: 2 },
      { cacheKey: 'other', productName: 'Únětická 12°', helpedCount: 5 },
    ];
    expect(helpedCountFor(helped, 'u2fkb', 'únětická 12°')).toBe(2);
    expect(helpedCountFor(helped, 'u2fkb', 'Kozel')).toBe(0);
    expect(helpedCountFor(helped, undefined, 'Únětická 12°')).toBe(0);
  });
});
