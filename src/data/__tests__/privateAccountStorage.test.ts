import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  PrivateAccountMutationFrozenError,
  beginPrivateAccountTransition,
  guardPrivateAccountStateCreator,
  readPrivateAccountMergeIntent,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';
import privateAccountStorage from '@/data/privateAccountStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const rawSetItem = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const KEY = 'private-persist-test';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function persistedStore() {
  // Observe the ignored Promise without changing the real Zustand persistence
  // path. Attaching the rejection handler here lets Jest report a failed
  // assertion instead of crashing on the original unhandled rejection.
  const writes: Promise<{ ok: true } | { ok: false; error: unknown }>[] = [];
  const storage = {
    ...privateAccountStorage,
    setItem: (name: string, value: string) => {
      const pending = privateAccountStorage.setItem(name, value);
      writes.push(pending.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error })));
      return pending;
    },
  };
  const store = createStore<{ owner: string; change: (owner: string) => void }>()(
    persist(
      guardPrivateAccountStateCreator((set) => ({
        owner: 'A',
        change: (owner) => { set({ owner }); },
      })),
      { name: KEY, storage: createJSONStorage(() => storage), skipHydration: true },
    ),
  );
  return { store, writes };
}

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  jest.mocked(AsyncStorage.setItem).mockImplementation(rawSetItem);
  await AsyncStorage.clear();
  await readPrivateAccountMergeIntent();
});

afterEach(() => {
  resetPrivateAccountBoundaryForTests();
  jest.mocked(AsyncStorage.setItem).mockImplementation(rawSetItem);
});

it('settles a cancelled Zustand write before cleanup without leaking A into B', async () => {
  const started = deferred();
  const finish = deferred();
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (name, value) => {
    started.resolve();
    await finish.promise;
    await rawSetItem(name, value);
  });
  const { store, writes } = persistedStore();
  store.getState().change('A-pending');
  await started.promise;

  const transition = beginPrivateAccountTransition('account-switch', 'A')!;
  let drained = false;
  const drain = transition.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  // New A actions remain blocked in memory and never enqueue another write.
  store.getState().change('A-late');
  expect(store.getState().owner).toBe('A-pending');
  expect(writes).toHaveLength(1);

  finish.resolve();
  expect(await writes[0]).toEqual({ ok: true });
  await drain;
  await AsyncStorage.removeItem(KEY);
  transition.release();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();

  store.getState().change('B');
  expect(await writes[1]).toEqual({ ok: true });
  expect(JSON.parse((await AsyncStorage.getItem(KEY))!).state.owner).toBe('B');
});

it('still rejects a persistence request that starts during the freeze without writing', async () => {
  const transition = beginPrivateAccountTransition('account-switch', 'A')!;
  await expect(privateAccountStorage.setItem(KEY, 'A-late'))
    .rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  transition.release();
});

it.each([false, true])('preserves a real storage error even when frozen=%s', async (freeze) => {
  const started = deferred();
  const finish = deferred();
  const error = new Error('storage unavailable');
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
    throw error;
  });
  const { store, writes } = persistedStore();
  store.getState().change('A-pending');
  await started.promise;
  const transition = freeze ? beginPrivateAccountTransition('account-switch', 'A') : null;
  finish.resolve();
  expect(await writes[0]).toEqual({ ok: false, error });
  transition?.release();
});
