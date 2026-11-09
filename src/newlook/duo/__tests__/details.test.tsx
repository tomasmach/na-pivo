import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccountStore } from '@/stores/accountStore';

import { DetailPageProvider, detailOf, useDetailStore, useNvRouter, type DetailPage } from '../details';
import { PaneProvider, type Pane } from '../paneContext';

const router = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false), dismissTo: jest.fn(), dismissAll: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => {
  const { createContext } = jest.requireActual('react');
  return {
    SafeAreaInsetsContext: createContext(null),
    useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const PUB = { pathname: '/nv/hospoda/[id]', params: { id: 'u2fkbkdb', name: 'U Zlatého tygra' } } as const;
const tabPane: Pane = { tab: 'kompas', side: 'left', width: 475 };

function wrapper(pane: Pane | null, page: DetailPage | null = null) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PaneProvider value={pane}>
        <DetailPageProvider value={page}>{children}</DetailPageProvider>
      </PaneProvider>
    );
  };
}

const openBook = () => jest.mocked(useWindowDimensions).mockReturnValue({ width: 951, height: 669, scale: 3, fontScale: 1 });

describe('detailOf', () => {
  it('opens pubs, beers, friends, invitations, the profile and its lists as pages', () => {
    expect(detailOf(PUB)).toEqual({ route: 'hospoda', params: { id: 'u2fkbkdb', name: 'U Zlatého tygra' } });
    expect(detailOf({ pathname: '/nv/kamos/[id]', params: { id: 'f1' } })?.route).toBe('kamos');
    expect(detailOf('/nv/profil')).toEqual({ route: 'profil', params: {} });
    expect(detailOf('/nv/nastaveni')).toEqual({ route: 'nastaveni', params: {} });
  });

  it('leaves every other screen to the router', () => {
    expect(detailOf('/nv/upravit-profil')).toBeNull();
    expect(detailOf({ pathname: '/nv/zapis' })).toBeNull();
  });
});

describe('useNvRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDetailStore.getState().clear();
  });
  afterEach(() => jest.mocked(useWindowDimensions).mockReset());

  it('pushes a pub as before on a phone', async () => {
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(tabPane) });
    result.current.push(PUB);
    expect(router.push.mock.calls[0]?.[0]).toEqual(PUB);
    expect(useDetailStore.getState().pages).toEqual({});
  });

  it('opens a pub from a tab into its right half on the open Duo', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(tabPane) });
    result.current.push(PUB);
    expect(router.push).not.toHaveBeenCalled();
    expect(useDetailStore.getState().pages.kompas?.map((p) => p.route)).toEqual(['hospoda']);
  });

  it('opens a pub from a tab as a page of the tab on the folded Duo, so unfolding keeps it', async () => {
    jest.mocked(useWindowDimensions).mockReturnValue({ width: 466, height: 678, scale: 3, fontScale: 1 });
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, right: 84, bottom: 34, left: 0 });
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper({ tab: 'kompas', side: 'single', width: 382 }) });
    result.current.push(PUB);
    expect(router.push).not.toHaveBeenCalled();
    expect(useDetailStore.getState().pages.kompas?.map((p) => p.route)).toEqual(['hospoda']);
    jest.mocked(useSafeAreaInsets).mockReturnValue({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('replaces the right half when the book selects another place from the tab, like a split view', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(tabPane) });
    result.current.push(PUB);
    result.current.push({ pathname: '/nv/pivo/[id]', params: { id: 'b1' } });
    const [beer] = useDetailStore.getState().pages.kompas ?? [];
    expect(beer).toMatchObject({ route: 'pivo', beneath: true });
    // The pub fades out over the beer, so the tab's own right half never shows in between.
    expect(useDetailStore.getState().leaving.kompas).toEqual([expect.objectContaining({ route: 'hospoda', fadeOut: true })]);
  });

  it('goes back to the selected page when its row is selected again under a page pushed from it', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(tabPane) });
    result.current.push(PUB);
    const pub = useDetailStore.getState().pages.kompas![0];
    useDetailStore.getState().push('kompas', { route: 'pivo', params: { id: 'b1' } });
    result.current.push(PUB);
    expect(useDetailStore.getState().pages.kompas).toEqual([pub]);
    expect(useDetailStore.getState().leaving.kompas?.map((p) => p.route)).toEqual(['pivo']);
  });

  it('pushes what the right half opens on top, like a navigation stack inside the second column', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper({ tab: 'stamgast', side: 'right', width: 392 }) });
    result.current.push({ pathname: '/nv/vecer/[id]', params: { id: '2026-11-01' } });
    const [evening] = useDetailStore.getState().pages.stamgast ?? [];
    expect(evening?.route).toBe('vecer');
    expect(evening?.shown).toBeUndefined();
  });

  it('leaves the open page as it is when the same place is selected again', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(tabPane) });
    result.current.push(PUB);
    const first = useDetailStore.getState().pages.kompas![0];
    result.current.push(PUB);
    expect(useDetailStore.getState().pages.kompas).toEqual([first]);
  });

  it('slides a page out after going back and forgets it when it has left', async () => {
    useDetailStore.getState().push('parta', { route: 'kamos', params: { id: 'f1' } });
    useDetailStore.getState().pop('parta');
    expect(useDetailStore.getState().pages.parta).toEqual([]);
    const [leaving] = useDetailStore.getState().leaving.parta ?? [];
    expect(leaving?.route).toBe('kamos');
    useDetailStore.getState().forget('parta', leaving!.key);
    expect(useDetailStore.getState().leaving.parta).toEqual([]);
  });

  it('closes the pages of a tab when a page goes back to that tab, as showing a pub on the map does', async () => {
    openBook();
    useDetailStore.getState().show('kompas', { route: 'hospoda', params: { id: 'u2fkbkdb' } });
    const [pub] = useDetailStore.getState().pages.kompas ?? [];
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper({ tab: 'kompas', side: 'right', width: 392 }, pub) });
    result.current.dismissTo('/nv/kompas');
    expect(useDetailStore.getState().pages.kompas).toEqual([]);
    expect(router.dismissTo).toHaveBeenCalledWith('/nv/kompas', undefined);
  });

  it('closes the panels and sheets over a place that is a page instead of opening it again', async () => {
    openBook();
    useDetailStore.getState().show('vycep', { route: 'tour', params: {} });
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(null) });
    result.current.dismissTo('/nv/tour');
    expect(router.dismissAll).toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('still covers the window with screens that are not details', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper(tabPane) });
    result.current.push('/nv/upravit-profil');
    expect(router.push.mock.calls[0]?.[0]).toBe('/nv/upravit-profil');
  });

  it('pushes over the window from a screen that is not a tab', async () => {
    openBook();
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper({ tab: null, side: 'single', width: 600 }) });
    result.current.push(PUB);
    expect(router.push.mock.calls[0]?.[0]).toEqual(PUB);
  });

  it('replaces a page with a task by closing the page and opening the task over the tabs', async () => {
    openBook();
    await act(async () => useDetailStore.getState().push('parta', { route: 'moje-setkani', params: {} }));
    const page = useDetailStore.getState().pages.parta![0];
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper({ tab: 'parta', side: 'right', width: 392 }, page) });
    result.current.replace('/nv/zalozit-setkani');
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push.mock.calls[0]?.[0]).toBe('/nv/zalozit-setkani');
    expect(useDetailStore.getState().pages.parta).toEqual([]);
  });

  it('goes back inside the half from a page there', async () => {
    openBook();
    await act(async () => useDetailStore.getState().push('kompas', { route: 'hospoda', params: {} }));
    const page = useDetailStore.getState().pages.kompas![0];
    const { result } = await renderHook(() => useNvRouter(), { wrapper: wrapper({ tab: 'kompas', side: 'right', width: 392 }, page) });
    expect(result.current.canGoBack()).toBe(true);
    result.current.back();
    expect(router.back).not.toHaveBeenCalled();
    expect(useDetailStore.getState().pages.kompas).toEqual([]);
  });

  it('forgets the pages when the account changes', async () => {
    useDetailStore.getState().push('parta', { route: 'kamos', params: { id: 'f1' } });
    await act(async () => useAccountStore.setState({ session: { accountId: 'someone-else' } as never }));
    expect(useDetailStore.getState().pages).toEqual({});
  });
});
