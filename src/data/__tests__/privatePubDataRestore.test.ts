import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';
import { installPrivatePubDataRestores } from '../privatePubDataRestore';

type MockAccountState = {
  startupBoundaryReady: boolean;
  session: { accountId: string; token: string } | null;
};

let mockAccountState: MockAccountState;
const mockAccountListeners = new Set<
  (state: MockAccountState, previous: MockAccountState) => void
>();
let mockRatingsHydrated: boolean;
let mockAmenitiesHydrated: boolean;
const mockRatingsHydrationListeners = new Set<() => void>();
const mockAmenitiesHydrationListeners = new Set<() => void>();

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: {
    getState: () => mockAccountState,
    subscribe: (listener: (state: MockAccountState, previous: MockAccountState) => void) => {
      mockAccountListeners.add(listener);
      return () => mockAccountListeners.delete(listener);
    },
  },
}));

jest.mock('@/stores/pubRatingsStore', () => ({
  usePubRatingsStore: {
    persist: {
      hasHydrated: () => mockRatingsHydrated,
      onFinishHydration: (listener: () => void) => {
        mockRatingsHydrationListeners.add(listener);
        return () => mockRatingsHydrationListeners.delete(listener);
      },
    },
  },
}));

jest.mock('@/stores/pubAmenitiesStore', () => ({
  usePubAmenitiesStore: {
    persist: {
      hasHydrated: () => mockAmenitiesHydrated,
      onFinishHydration: (listener: () => void) => {
        mockAmenitiesHydrationListeners.add(listener);
        return () => mockAmenitiesHydrationListeners.delete(listener);
      },
    },
  },
}));

const mockRatingAccounts: string[] = [];
const mockAmenityAccounts: string[] = [];

function mockAccountAwareRestore(target: string[]): Promise<void> {
  target.push(mockAccountState.session?.accountId ?? 'none');
  return Promise.resolve();
}

jest.mock('../pubRatingsSync', () => ({
  restorePubRatings: () => mockAccountAwareRestore(mockRatingAccounts),
}));

jest.mock('../pubAmenitiesSync', () => ({
  restorePubAmenities: () => mockAccountAwareRestore(mockAmenityAccounts),
}));

function setAccountState(next: MockAccountState): void {
  const previous = mockAccountState;
  mockAccountState = next;
  for (const listener of mockAccountListeners) listener(next, previous);
}

function finishRatingsHydration(): void {
  mockRatingsHydrated = true;
  for (const listener of [...mockRatingsHydrationListeners]) listener();
}

function finishAmenitiesHydration(): void {
  mockAmenitiesHydrated = true;
  for (const listener of [...mockAmenitiesHydrationListeners]) listener();
}

beforeEach(() => {
  resetPrivateAccountBoundaryForTests();
  mockAccountState = {
    startupBoundaryReady: true,
    session: { accountId: 'account-a', token: 'token-a-1' },
  };
  mockAccountListeners.clear();
  mockRatingsHydrated = true;
  mockAmenitiesHydrated = true;
  mockRatingsHydrationListeners.clear();
  mockAmenitiesHydrationListeners.clear();
  mockRatingAccounts.length = 0;
  mockAmenityAccounts.length = 0;
});

it('waits for auth to publish the rehydrated account after thaw before restoring', async () => {
  const uninstall = installPrivatePubDataRestores();
  await Promise.resolve();
  expect(mockRatingAccounts).toEqual(['account-a']);
  expect(mockAmenityAccounts).toEqual(['account-a']);

  const transition = beginPrivateAccountTransition('test-login', 'account-a');
  expect(transition).not.toBeNull();
  await transition!.drain();

  transition!.release();
  await Promise.resolve();
  // applyAuthSuccess rehydrates private stores here, before accountStore gets B.
  expect(mockRatingAccounts).toEqual(['account-a']);
  expect(mockAmenityAccounts).toEqual(['account-a']);

  setAccountState({
    startupBoundaryReady: true,
    session: { accountId: 'account-b', token: 'token-b' },
  });
  await Promise.resolve();
  expect(mockRatingAccounts).toEqual(['account-a', 'account-b']);
  expect(mockAmenityAccounts).toEqual(['account-a', 'account-b']);

  uninstall();
});

it('waits for both persisted pub stores when launch publishes the session first', async () => {
  mockAccountState = { startupBoundaryReady: false, session: null };
  mockRatingsHydrated = false;
  mockAmenitiesHydrated = false;
  const uninstall = installPrivatePubDataRestores();

  setAccountState({
    startupBoundaryReady: true,
    session: { accountId: 'account-a', token: 'token-a' },
  });
  await Promise.resolve();
  expect(mockRatingAccounts).toEqual([]);
  expect(mockAmenityAccounts).toEqual([]);

  finishRatingsHydration();
  await Promise.resolve();
  expect(mockRatingAccounts).toEqual([]);
  expect(mockAmenityAccounts).toEqual([]);

  finishAmenitiesHydration();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockRatingAccounts).toEqual(['account-a']);
  expect(mockAmenityAccounts).toEqual(['account-a']);

  uninstall();
});

it('restores again when the bearer rotates for the same account', async () => {
  const uninstall = installPrivatePubDataRestores();
  await Promise.resolve();

  setAccountState({
    startupBoundaryReady: true,
    session: { accountId: 'account-a', token: 'token-a-2' },
  });
  await Promise.resolve();

  expect(mockRatingAccounts).toEqual(['account-a', 'account-a']);
  expect(mockAmenityAccounts).toEqual(['account-a', 'account-a']);

  uninstall();
});

it('drops a delayed restore for the superseded bearer of the same account', async () => {
  mockRatingsHydrated = false;
  mockAmenitiesHydrated = false;
  const uninstall = installPrivatePubDataRestores();

  setAccountState({
    startupBoundaryReady: true,
    session: { accountId: 'account-a', token: 'token-a-2' },
  });
  finishRatingsHydration();
  finishAmenitiesHydration();
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(mockRatingAccounts).toEqual(['account-a']);
  expect(mockAmenityAccounts).toEqual(['account-a']);

  uninstall();
});
