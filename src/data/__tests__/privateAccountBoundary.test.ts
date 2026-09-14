import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
  PrivateAccountMutationFrozenError,
  beginPrivateAccountTransition,
  isPrivateAccountMutationFrozen,
  preflightPrivateAccountMerge,
  privateAccountMergeBlocksAnonymousEviction,
  promotePrivateAccountMerge,
  recoverPrivateAccountMerge,
  registerPrivateAccountThawListener,
  resetPrivateAccountBoundaryForTests,
  runPrivateAccountMutation,
  setPrivateAccountDeletionRecoveryBlocked,
  setPrivateAccountRehydrationRecoveryBlocked,
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
    setPrivateAccountDeletionRecoveryBlocked(false);
    setPrivateAccountRehydrationRecoveryBlocked(false);
    resetPrivateAccountBoundaryForTests();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    setPrivateAccountDeletionRecoveryBlocked(false);
    setPrivateAccountRehydrationRecoveryBlocked(false);
    resetPrivateAccountBoundaryForTests();
  });

  it('keeps private writes frozen until rehydration recovery is explicitly complete', async () => {
    setPrivateAccountRehydrationRecoveryBlocked(true);

    await expect(
      runPrivateAccountMutation(async () => 'unsafe'),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);

    const transition = beginPrivateAccountTransition('rehydration-retry', 'B');
    expect(transition).not.toBeNull();
    transition!.release();
    expect(isPrivateAccountMutationFrozen()).toBe(true);

    setPrivateAccountRehydrationRecoveryBlocked(false);
    await expect(runPrivateAccountMutation(async () => 'B')).resolves.toBe('B');
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

  it('keeps the cold A to B marker frozen until every local finalizer succeeds', async () => {
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
      recoverPrivateAccountMerge('B', async () => false),
    ).resolves.toBe(false);
    expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).not.toBeNull();
    expect(isPrivateAccountMutationFrozen()).toBe(true);

    await expect(
      recoverPrivateAccountMerge('B', async () => true),
    ).resolves.toBe(true);
    expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).toBeNull();
    expect(isPrivateAccountMutationFrozen()).toBe(false);
  });

  it('drains a delayed private hydration read and refuses its stale A value', async () => {
    await runPrivateAccountMutation(async () => undefined);
    const started = deferred();
    const releaseRead = deferred();
    const originalGetItem = jest.mocked(AsyncStorage.getItem).getMockImplementation();
    jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
      if (key !== 'private-hydration') {
        const value = await originalGetItem?.call(AsyncStorage, key);
        return value ?? null;
      }
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
    if (originalGetItem) {
      jest.mocked(AsyncStorage.getItem).mockImplementation(originalGetItem);
    } else {
      jest.mocked(AsyncStorage.getItem).mockReset();
    }
  });

  it('treats an unreadable durable marker as a freeze, never as empty', async () => {
    await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, '{torn');
    resetPrivateAccountBoundaryForTests();

    expect(await privateAccountMergeBlocksAnonymousEviction('A')).toBe(true);
    await expect(
      runPrivateAccountMutation(async () => undefined),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
  });

  it('holds the boundary frozen through a normal transition while deletion recovery blocks, and thaws only when it clears', async () => {
    let thawCount = 0;
    const unsubscribe = registerPrivateAccountThawListener(() => {
      thawCount += 1;
    });

    setPrivateAccountDeletionRecoveryBlocked(true);
    expect(isPrivateAccountMutationFrozen()).toBe(true);
    await expect(
      runPrivateAccountMutation(async () => undefined),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);

    // A startup retry's normal transition must not open the boundary while
    // account-deletion recovery is still pending.
    const transition = beginPrivateAccountTransition('logout', 'A');
    expect(transition).not.toBeNull();
    transition!.release();
    expect(isPrivateAccountMutationFrozen()).toBe(true);
    expect(thawCount).toBe(0);
    await expect(
      runPrivateAccountMutation(async () => 'still-frozen'),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);

    setPrivateAccountDeletionRecoveryBlocked(false);
    expect(isPrivateAccountMutationFrozen()).toBe(false);
    expect(thawCount).toBe(1);
    await expect(runPrivateAccountMutation(async () => 'thawed')).resolves.toBe('thawed');
    unsubscribe();
  });

  it('never lets clearing the deletion recovery block override a persisted merge-marker block', async () => {
    let thawCount = 0;
    const unsubscribe = registerPrivateAccountThawListener(() => {
      thawCount += 1;
    });

    // Persist an interrupted anonymous merge marker (A -> B), like a lost
    // response would, then layer the deletion-recovery block on top.
    const setup = beginPrivateAccountTransition('auth', 'A')!;
    const preflight = await preflightPrivateAccountMerge(setup, 'A', async () => true);
    expect(preflight).not.toBeNull();
    expect(await promotePrivateAccountMerge(
      'A',
      'B',
      preflight!.operationId,
      async () => true,
    )).toBe(true);
    setup.release();

    setPrivateAccountDeletionRecoveryBlocked(true);
    expect(isPrivateAccountMutationFrozen()).toBe(true);

    const transition = beginPrivateAccountTransition('logout', 'A')!;
    transition.release();
    expect(isPrivateAccountMutationFrozen()).toBe(true);
    expect(thawCount).toBe(0);

    // OR semantics: removing one blocker must not clear the other.
    setPrivateAccountDeletionRecoveryBlocked(false);
    expect(isPrivateAccountMutationFrozen()).toBe(true);
    expect(thawCount).toBe(0);
    await expect(
      runPrivateAccountMutation(async () => undefined),
    ).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);

    // Only once every blocker is resolved does the boundary thaw.
    expect(await recoverPrivateAccountMerge('B', async () => true)).toBe(true);
    expect(isPrivateAccountMutationFrozen()).toBe(false);
    expect(thawCount).toBe(1);
    unsubscribe();
  });
});
