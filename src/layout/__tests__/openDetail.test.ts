import { Dimensions } from 'react-native';

import {
  hrefFor,
  noteTopPathname,
  openDetail,
  openEvening,
  openFriendProfile,
  pagePathname,
} from '@/layout/openDetail';
import { openPubPage } from '@/pubPage/openPubPage';
import { useBookStore, type PageEntry } from '@/stores/bookStore';
import type { Pub } from '@/data/pubs';
import { geohash8 } from '@/data/geohash';
import { pubPageRef } from '@/stores/pubPageStore';

const dimensions = Dimensions.get as jest.Mock;

function setWindow(width: number, height: number) {
  dimensions.mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

function makeRouter() {
  return { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
}

const pub: Pub = { id: 'osm:1', name: 'U Zlatého tygra', lat: 50.0868, lng: 14.4196 };
const pubEntry: PageEntry = {
  kind: 'pub',
  params: { key: 'u2fkbnpq', name: 'U Zlatého tygra', lat: '50.0868', lng: '14.4196' },
};

/** JSON keeps key order, so equal strings mean the router gets the very same href. */
const bytes = (value: unknown) => JSON.stringify(value);

describe('openDetail on a phone', () => {
  beforeEach(() => {
    setWindow(402, 874);
    noteTopPathname('/');
    useBookStore.setState(useBookStore.getInitialState(), true);
  });

  it('pushes the pub page with the params openPubPage always sent', () => {
    const router = makeRouter();
    openPubPage(router as never, pub);
    // The href openPubPage built before it went through openDetail.
    const key = geohash8(pub.lat, pub.lng);
    expect(bytes(router.push.mock.calls[0][0])).toBe(
      bytes({
        pathname: '/pub',
        params: { key, ref: pubPageRef(pub), name: pub.name, lat: String(pub.lat), lng: String(pub.lng) },
      }),
    );
  });

  it('replaces instead of pushing when asked to', () => {
    const router = makeRouter();
    openPubPage(router as never, pub, { replace: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it('pushes the beer-on-tap pub page without a hand-off ref, as the push handler did', () => {
    const router = makeRouter();
    openDetail(router, pubEntry);
    expect(bytes(router.push.mock.calls[0][0])).toBe(
      bytes({ pathname: '/pub', params: { key: 'u2fkbnpq', name: 'U Zlatého tygra', lat: '50.0868', lng: '14.4196' } }),
    );
  });

  it('pushes the evening and the friend profile hrefs the screens used', () => {
    const router = makeRouter();
    openEvening(router, '2026-10-22T19:40:00.000Z');
    openFriendProfile(router, 'acc-1');
    expect(bytes(router.push.mock.calls[0][0])).toBe(
      bytes({ pathname: '/evening', params: { startedAt: '2026-10-22T19:40:00.000Z' } }),
    );
    expect(router.push.mock.calls[1][0]).toBe('/parta/acc-1');
  });

  it('never touches the right halves', () => {
    openDetail(makeRouter(), pubEntry);
    expect(useBookStore.getState().pages.kompas).toEqual([]);
  });
});

describe.each([
  ['book', 951, 669],
  ['tabletop', 669, 951],
] as const)('openDetail on a wide window (%s)', (_mode, width, height) => {
  beforeEach(() => {
    setWindow(width, height);
    useBookStore.setState(useBookStore.getInitialState(), true);
  });

  it.each([
    ['/', 'kompas'],
    ['/beer', 'stamgast'],
    ['/friends', 'parta'],
    ['/profile', 'profil'],
  ] as const)('opens into the right half of the tab on screen (%s)', (pathname, tab) => {
    noteTopPathname(pathname);
    const router = makeRouter();
    openDetail(router, pubEntry);
    expect(router.push).not.toHaveBeenCalled();
    expect(useBookStore.getState().pages[tab]).toEqual([pubEntry]);
  });

  it('a new page from the tab replaces what the half showed; replace swaps only the top', () => {
    noteTopPathname('/beer');
    const router = makeRouter();
    const evening: PageEntry = { kind: 'evening', startedAt: 'a' };
    openDetail(router, evening);
    useBookStore.getState().push('stamgast', { kind: 'friend', id: 'x' });
    openDetail(router, pubEntry, { replace: true });
    expect(useBookStore.getState().pages.stamgast).toEqual([evening, pubEntry]);
    openDetail(router, { kind: 'friend', id: 'y' });
    expect(useBookStore.getState().pages.stamgast).toEqual([{ kind: 'friend', id: 'y' }]);
  });

  it('closes search and opens the result beside the tab it came from', () => {
    noteTopPathname('/friends');
    noteTopPathname('/pub-search');
    const router = makeRouter();
    openDetail(router, pubEntry);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(useBookStore.getState().pages.parta).toEqual([pubEntry]);
  });

  it('pushes the result over search opened from a full-window page, as on a phone', () => {
    // Leaderboards, a pub on the whole window, its map, then search.
    noteTopPathname('/');
    noteTopPathname('/leaderboards');
    noteTopPathname('/pub');
    noteTopPathname('/pub-search');
    const router = makeRouter();
    openDetail(router, pubEntry);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(useBookStore.getState().pages).toEqual(useBookStore.getInitialState().pages);
  });

  it.each(['/leaderboards', '/tours/abc', '/profile/parta', '/pub'])(
    'pushes over a full-window screen (%s) exactly as on a phone',
    (pathname) => {
      noteTopPathname(pathname);
      const router = makeRouter();
      openFriendProfile(router, 'acc-1');
      expect(router.push).toHaveBeenCalledWith('/parta/acc-1');
      expect(useBookStore.getState().pages).toEqual(useBookStore.getInitialState().pages);
    },
  );
});

describe('hrefFor and pagePathname', () => {
  it('builds every page kind', () => {
    expect(hrefFor({ kind: 'friend', id: 'acc-2' })).toBe('/parta/acc-2');
    expect(hrefFor({ kind: 'evening', startedAt: 's' })).toEqual({ pathname: '/evening', params: { startedAt: 's' } });
    expect(hrefFor(pubEntry)).toEqual({ pathname: '/pub', params: pubEntry.kind === 'pub' ? pubEntry.params : {} });
  });

  it('names a page by the route it stands for', () => {
    expect(pagePathname({ kind: 'friend', id: 'acc-2' })).toBe('/parta/acc-2');
    expect(pagePathname({ kind: 'evening', startedAt: 's' })).toBe('/evening');
    expect(pagePathname(pubEntry)).toBe('/pub');
  });
});
