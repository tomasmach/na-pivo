import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccountStore } from '@/stores/accountStore';

import { DetailPageProvider, detailOf, useDetailStore, useNvRouter, type DetailPage } from '../details';
import { PaneProvider, type Pane } from '../paneContext';

const router = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
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
