import { act, renderHook } from '@testing-library/react-native';

import { clearScreenCache } from '@/data/screenCache';

import { useLoad } from '../states';

jest.mock('../../../components/ui', () => ({ Spinner: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useLoad with a screen cache', () => {
  beforeEach(() => clearScreenCache());

  it('shows the last answer at once on reopen, then the fresh one', async () => {
    const first = await renderHook(() => useLoad('beer-1', () => Promise.resolve({ rating: 4 }), true, 'beer'));
    await act(async () => {});
    expect(first.result.current.state).toEqual({ status: 'ready', data: { rating: 4 } });
    await first.unmount();

    const fresh = deferred<{ rating: number } | null>();
    const again = await renderHook(() => useLoad('beer-1', () => fresh.promise, true, 'beer'));
    expect(again.result.current.state).toEqual({ status: 'ready', data: { rating: 4 } });
    await act(async () => fresh.resolve({ rating: 5 }));
    expect(again.result.current.state).toEqual({ status: 'ready', data: { rating: 5 } });
  });

  it('keeps showing the last answer when the refresh fails', async () => {
    const first = await renderHook(() => useLoad('beer-2', () => Promise.resolve('page'), true, 'beer'));
    await act(async () => {});
    await first.unmount();
    const again = await renderHook(() => useLoad('beer-2', () => Promise.resolve(null), true, 'beer'));
    await act(async () => {});
    expect(again.result.current.state).toEqual({ status: 'ready', data: 'page' });
  });

  it('forgets answers when private account data is cleared, also those still loading', async () => {
    const late = deferred<string | null>();
    const loading = await renderHook(() => useLoad('beer-3', () => late.promise, true, 'beer'));
    clearScreenCache();
    await act(async () => late.resolve('old account'));
    await loading.unmount();

    const again = await renderHook(() => useLoad('beer-3', () => new Promise<string | null>(() => {}), true, 'beer'));
    expect(again.result.current.state).toEqual({ status: 'loading' });
  });

  it('loads without a cache when no cache is named', async () => {
    const first = await renderHook(() => useLoad('beer-4', () => Promise.resolve('page')));
    await act(async () => {});
    await first.unmount();
    const again = await renderHook(() => useLoad('beer-4', () => new Promise<string | null>(() => {})));
    expect(again.result.current.state).toEqual({ status: 'loading' });
  });
});
