import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockPush = jest.fn();
let mockPath = '/nv/kompas';
const mockAccount = { needsNickname: false, profile: null as { id: string } | null };
const mockMe: { xp: { level: number } | null; isSignedIn: boolean } = { xp: null, isSignedIn: false };
const mockObserveLevel = jest.fn();

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
  observeLevel: (...args: unknown[]) => mockObserveLevel(...args),
  useMe: () => mockMe,
}));
jest.mock('../../../ui/store', () => ({ toast: jest.fn() }));

const SEEN_KEY = 'na-pivo-pub-reminder-onboarding-seen-version';
const PUBLIC_ASK_KEY = 'na-pivo-public-nights-ask-seen';

type Loaded = {
  useProfilWatchers: typeof import('../useProfilWatchers').useProfilWatchers;
  onboarding: typeof import('@/stores/onboardingStore').useOnboardingStore;
  settings: typeof import('@/stores/settingsStore').useSettingsStore;
  vycep: typeof import('@/stores/vycepStore').useVycepStore;
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
      onboarding: require('@/stores/onboardingStore').useOnboardingStore,
      settings: require('@/stores/settingsStore').useSettingsStore,
      vycep: require('@/stores/vycepStore').useVycepStore,
      storage: (({ default: d, ...m }) => d ?? m)(require('@react-native-async-storage/async-storage')),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
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
  mockAccount.profile = null;
  mockMe.xp = null;
  mockMe.isSignedIn = false;
  mockObserveLevel.mockReset();
});

/** The pub-reminder tests start after the one-time public-nights ask was answered. */
async function loadAsked(): Promise<Loaded> {
  const loaded = load();
  await loaded.storage.setItem(PUBLIC_ASK_KEY, '1');
  return loaded;
}

describe('one-time ask to post nights publicly', () => {
  it('opens first, once, and comes before the pub-reminder offer', async () => {
    const { useProfilWatchers, storage } = load();
    const view = await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush.mock.calls).toEqual([['/nv/verejne-noci']]);
    expect(await storage.getItem(PUBLIC_ASK_KEY)).toBe('1');

    mockPath = '/nv/verejne-noci';
    await view.rerender({});
    mockPath = '/nv/kompas';
    await view.rerender({});
    await flush();
    expect(mockPush.mock.calls).toEqual([['/nv/verejne-noci'], ['/nv/pripominky']]);
  });

  it('comes before the level-up sheet', async () => {
    mockAccount.profile = { id: 'acc-1' };
    mockMe.isSignedIn = true;
    mockMe.xp = { level: 3 };
    mockObserveLevel.mockResolvedValue({ since: 2 });
    const { useProfilWatchers } = load();
    const view = await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush.mock.calls).toEqual([['/nv/verejne-noci']]);

    mockPath = '/nv/verejne-noci';
    await view.rerender({});
    mockPath = '/nv/kompas';
    await view.rerender({});
    await flush();
    expect(mockPush.mock.calls[1]).toEqual([{ pathname: '/nv/novy-level', params: { since: 2 } }]);
  });

  it('stays away for someone who already posts everything to the world', async () => {
    const { useProfilWatchers, vycep, storage } = load();
    vycep.setState({ shareDefault: 'public', nightAutopublish: 'public' });
    await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalledWith('/nv/verejne-noci');
    expect(await storage.getItem(PUBLIC_ASK_KEY)).toBeNull();
  });

  it('waits out the welcome session', async () => {
    const { useProfilWatchers, onboarding } = load();
    onboarding.setState({ firstLaunchSession: true });
    await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('pub reminder offer in the new look', () => {
  it('opens once over a tab and remembers the version', async () => {
    const { useProfilWatchers, storage } = await loadAsked();
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
    const { useProfilWatchers, storage } = await loadAsked();
    await storage.setItem(SEEN_KEY, '3.0.0');
    await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stays away when reminders are already on', async () => {
    const { useProfilWatchers, settings } = await loadAsked();
    settings.setState({ pubReminderEnabled: true });
    await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('waits out the welcome session and non-tab screens', async () => {
    const { useProfilWatchers, onboarding } = await loadAsked();
    onboarding.setState({ firstLaunchSession: true });
    const view = await renderHook(() => useProfilWatchers());
    await flush();
    expect(mockPush).not.toHaveBeenCalled();

    mockPath = '/nv/hospoda/abc';
    await act(async () => onboarding.setState({ firstLaunchSession: false }));
    await flush();
    expect(mockPush).not.toHaveBeenCalled();

    mockPath = '/nv/kompas';
    await view.rerender({});
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/nv/pripominky');
  });

  it('never stacks with the nickname prompt; the prompt follows once the offer closes', async () => {
    mockAccount.needsNickname = true;
    const { useProfilWatchers } = await loadAsked();
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
