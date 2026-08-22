import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
  PrivateAccountMutationFrozenError,
  beginPrivateAccountTransition,
  preflightPrivateAccountMerge,
  privateAccountMergeBlocksAnonymousEviction,
  promotePrivateAccountMerge,
  recoverPrivateAccountMerge,
  resetPrivateAccountBoundaryForTests,
  runPrivateAccountMutation,
} from '@/data/privateAccountBoundary';
import { createQueueLock } from '@/data/createQueue';
import privateAccountStorage from '@/data/privateAccountStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('private account mutation boundary', () => {
  beforeEach(async () => {
    resetPrivateAccountBoundaryForTests();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    resetPrivateAccountBoundaryForTests();
  });

  it('drains A tasks delayed behind a queue mutex before clear and refuses new writes', async () => {
    const queue = createQueueLock();
    const gate = deferred();
    const started = deferred();
    const first = queue(async () => {
      started.resolve();
      await gate.promise;
    });
    await started.promise;
    const delayed = queue(async () => {
      await AsyncStorage.setItem('private-row', 'A');
    });
    await Promise.resolve();

    const transition = beginPrivateAccountTransition('logout', 'A');
    expect(transition).not.toBeNull();
    await expect(
      queue(async () => AsyncStorage.setItem('private-row', 'late-A')),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);

    let drained = false;
    const drain = transition!.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    gate.resolve();
    const results = await Promise.allSettled([first, delayed, drain]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
    await AsyncStorage.removeItem('private-row');
    transition!.release();
    await Promise.resolve();
    expect(await AsyncStorage.getItem('private-row')).toBeNull();
  });

  it('keeps a lost-response anonymous merge frozen across a cold boot', async () => {
    const transition = beginPrivateAccountTransition('auth', 'A')!;
    const preflight = await preflightPrivateAccountMerge(
      transition,
      'A',
      async () => true,
    );
    expect(preflight).not.toBeNull();
    expect(await promotePrivateAccountMerge(
      'A',
      'B',
      preflight!.operationId,
      async () => true,
    )).toBe(true);
    transition.release();

    resetPrivateAccountBoundaryForTests();
    await expect(
      runPrivateAccountMutation(async () => undefined),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
    expect(await privateAccountMergeBlocksAnonymousEviction('A')).toBe(true);
    expect(await recoverPrivateAccountMerge('C', async () => true)).toBe(false);
    expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).not.toBeNull();

    expect(await recoverPrivateAccountMerge('B', async (intent) => {
      expect(intent.fromAccountId).toBe('A');
      expect(intent.toAccountId).toBe('B');
      return true;
    })).toBe(true);
    expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).toBeNull();
    await expect(runPrivateAccountMutation(async () => 'B')).resolves.toBe('B');
  });

  it('drains a delayed private hydration read and refuses its stale A value', async () => {
    await runPrivateAccountMutation(async () => undefined);
    const started = deferred();
    const releaseRead = deferred();
    const nativeGetItem = AsyncStorage.getItem.bind(AsyncStorage);
    jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
      if (key !== 'private-hydration') return nativeGetItem(key);
      started.resolve();
      await releaseRead.promise;
      return 'A';
    });

    const hydration = privateAccountStorage.getItem('private-hydration');
    await started.promise;
    const transition = beginPrivateAccountTransition('account-switch', 'A')!;
    let drained = false;
    const drain = transition.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseRead.resolve();
    await expect(hydration).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
    await drain;
    transition.release();
    jest.mocked(AsyncStorage.getItem).mockImplementation(nativeGetItem);
  });

  it('treats an unreadable durable marker as a freeze, never as empty', async () => {
    await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, '{torn');
    resetPrivateAccountBoundaryForTests();

    expect(await privateAccountMergeBlocksAnonymousEviction('A')).toBe(true);
    await expect(
      runPrivateAccountMutation(async () => undefined),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
  });
});
