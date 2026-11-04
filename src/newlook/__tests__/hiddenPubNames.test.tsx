import { act, renderHook } from '@testing-library/react-native';

import { useSettingsStore } from '@/stores/settingsStore';

import { usePubNameReveal } from '../hiddenPubNames';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('usePubNameReveal', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    useSettingsStore.setState({ hidePubNames: false });
  });

  it('shows names when the setting is off', async () => {
    useSettingsStore.setState({ hidePubNames: false });
    const { result } = await renderHook(() => usePubNameReveal('pub-a'));
    expect(result.current.secret).toBe(false);
    expect(result.current.secondsLeft).toBeNull();
  });

  it('reveals a hidden name for five seconds, then hides it again', async () => {
    useSettingsStore.setState({ hidePubNames: true });
    const { result } = await renderHook(() => usePubNameReveal('pub-a'));
    expect(result.current.secret).toBe(true);

    await act(async () => result.current.reveal());
    expect(result.current.secret).toBe(false);
    expect(result.current.secondsLeft).toBe(5);

    await act(async () => jest.advanceTimersByTime(4000));
    expect(result.current.secondsLeft).toBe(1);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.secret).toBe(true);
    expect(result.current.secondsLeft).toBeNull();
  });

  it('keeps a new target secret after revealing the previous one', async () => {
    useSettingsStore.setState({ hidePubNames: true });
    const { result, rerender } = await renderHook(({ key }: { key: string }) => usePubNameReveal(key), { initialProps: { key: 'pub-a' } });
    await act(async () => result.current.reveal());
    expect(result.current.secret).toBe(false);

    await rerender({ key: 'pub-b' });
    expect(result.current.secret).toBe(true);
  });
});
