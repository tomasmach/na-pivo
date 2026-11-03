import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockPush = jest.fn();
let mockPath = '/nv/kompas';
const mockAccount = { needsNickname: false };

jest.mock('expo-router', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/data/releaseNotesClient', () => ({ getCurrentAppVersion: () => '3.0.0' }));
jest.mock('@/profile/useAccountBadges', () => ({ useAccountBadges: () => null }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (select: (s: unknown) => unknown) => select(mockAccount),
  selectNeedsNickname: (s: typeof mockAccount) => s.needsNickname,
}));
jest.mock('../profilModel', () => ({
  badgeIcon: () => 'medal',
  observeLevel: jest.fn(),
  useMe: () => ({ xp: null, isSignedIn: false }),
}));
jest.mock('../../../ui/store', () => ({ toast: jest.fn() }));

const SEEN_KEY = 'na-pivo-pub-reminder-onboarding-seen-version';

type Loaded = {
  useProfilWatchers: typeof import('../useProfilWatchers').useProfilWatchers;
  release: typeof import('@/stores/releaseStore').useReleaseStore;
  onboarding: typeof import('@/stores/onboardingStore').useOnboardingStore;
  settings: typeof import('@/stores/settingsStore').useSettingsStore;
  storage: typeof import('@react-native-async-storage/async-storage').default;
};

function load(): Loaded {
  let loaded!: Loaded;
  // A fresh module registry resets the hook's once-per-launch flags; React must stay the same instance.
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    /* eslint-disable @typescript-eslint/no-require-imports */
    loaded = {
      useProfilWatchers: require('../useProfilWatchers').useProfilWatchers,
      release: require('@/stores/releaseStore').useReleaseStore,
      onboarding: require('@/stores/onboardingStore').useOnboardingStore,
      settings: require('@/stores/settingsStore').useSettingsStore,
      storage: (({ default: d, ...m }) => d ?? m)(require('@react-native-async-storage/async-storage')),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  loaded.release.setState({ checkSettled: true, pendingNote: null });
  return loaded;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockPath = '/nv/kompas';
  mockAccount.needsNickname = false;
});

describe('pub reminder offer in the new look', () => {
  it('opens once over a tab and remembers the version', async () => {
    const { useProfilWatchers, storage } = load();
    const view = await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/nv/pripominky');
    expect(await storage.getItem(SEEN_KEY)).toBe('3.0.0');

    mockPath = '/nv/pripominky';
    await view.rerender({});
    mockPath = '/nv/kompas';
    await view.rerender({});
    await flush();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('stays away for someone who already saw it in this version', async () => {
    const { useProfilWatchers, storage } = load();
    await storage.setItem(SEEN_KEY, '3.0.0');
    await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stays away when reminders are already on', async () => {
    const { useProfilWatchers, settings } = load();
    settings.setState({ pubReminderEnabled: true });
    await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('waits out the welcome session, a pending what-s-new note and non-tab screens', async () => {
    const { useProfilWatchers, onboarding, release } = load();
    onboarding.setState({ firstLaunchSession: true });
    const view = await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      onboarding.setState({ firstLaunchSession: false });
      release.setState({ pendingNote: { version: '3.0.0', title: 'x', body: 'x' } as never });
    });
    mockPath = '/nv/hospoda/abc';
    await view.rerender({});
    await flush();
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => release.setState({ pendingNote: null }));
    await flush();
    expect(mockPush).not.toHaveBeenCalled();

    mockPath = '/nv/kompas';
    await view.rerender({});
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/nv/pripominky');
  });

  it('never stacks with the nickname prompt; the prompt follows once the offer closes', async () => {
    mockAccount.needsNickname = true;
    const { useProfilWatchers } = load();
    const view = await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush.mock.calls).toEqual([['/nv/pripominky']]);

    mockPath = '/nv/pripominky';
    await view.rerender({});
    await flush();
    mockPath = '/nv/kompas';
    await view.rerender({});
    await flush();
    expect(mockPush.mock.calls).toEqual([['/nv/pripominky'], ['/nv/dokoncit-ucet']]);
  });
});
