jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import type { PhotoContestSnapshot } from '@/data/photoContestClient';

/**
 * `beforeEach` calls `jest.resetModules()`, so each fresh require binds to a
 * NEW AsyncStorage mock instance (mirrors releaseStore.test).
 */
function currentAsyncStorage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
}

async function seedLastSeenResults(contestId: string): Promise<void> {
  await currentAsyncStorage().setItem(
    'na-pivo-contest-results',
    JSON.stringify({ state: { lastSeenResultsContestId: contestId }, version: 0 }),
  );
}

function requireStore() {
  return require('../contestResultsStore').useContestResultsStore;
}

const ACCOUNT = {
  id: 'acc-1',
  nickname: 'tomas',
  displayName: 'Tomáš',
  avatarUrl: null,
  isPublic: true,
};

function snapshotWith({
  contestId = 'round-2',
  rank = null as number | null,
  votes = 0,
  entered = false,
  voted = false,
  xpAwarded = 0,
  winsCount = 0,
  withMyResult = true,
} = {}): PhotoContestSnapshot {
  return {
    contest: null,
    entries: [],
    myEntryId: null,
    myVoteEntryId: null,
    lastResults: {
      contest: { id: contestId, periodStart: '', periodEnd: '', status: 'closed' },
      winners:
        rank != null
          ? [{ rank, account: ACCOUNT, imageUrl: 'https://x/img.jpg', caption: '', votes }]
          : [],
      myResult: withMyResult ? { entered, voted, rank, votes, xpAwarded, winsCount } : null,
    },
  };
}

beforeEach(() => {
  jest.resetModules();
});

describe('contestResultsStore', () => {
  it('queues a celebration for an unseen podium rank', async () => {
    const useStore = requireStore();
    await useStore
      .getState()
      .ingestSnapshot(snapshotWith({ rank: 1, votes: 12, entered: true, xpAwarded: 100, winsCount: 2 }));
    const pending = useStore.getState().pendingResult;
    expect(pending).toEqual({
      contestId: 'round-2',
      rank: 1,
      votes: 12,
      xpAwarded: 100,
      winsCount: 2,
      imageUrl: 'https://x/img.jpg',
    });
  });

  it('queues nothing without a podium rank', async () => {
    const useStore = requireStore();
    await useStore.getState().ingestSnapshot(snapshotWith({ entered: true, votes: 3 }));
    expect(useStore.getState().pendingResult).toBeNull();
  });

  it('queues nothing for an already-seen round (persisted baseline)', async () => {
    await seedLastSeenResults('round-2');
    const useStore = requireStore();
    await useStore.getState().ingestSnapshot(snapshotWith({ rank: 1, entered: true }));
    expect(useStore.getState().pendingResult).toBeNull();
  });

  it('dismissResult advances the baseline so the round never re-queues', async () => {
    const useStore = requireStore();
    await useStore.getState().ingestSnapshot(snapshotWith({ rank: 2, entered: true }));
    expect(useStore.getState().pendingResult).not.toBeNull();

    useStore.getState().dismissResult();
    expect(useStore.getState().pendingResult).toBeNull();
    expect(useStore.getState().lastSeenResultsContestId).toBe('round-2');

    await useStore.getState().ingestSnapshot(snapshotWith({ rank: 2, entered: true }));
    expect(useStore.getState().pendingResult).toBeNull();
  });

  it('markResultsSeen defers to a queued celebration for the same round', async () => {
    const useStore = requireStore();
    await useStore.getState().ingestSnapshot(snapshotWith({ rank: 3, entered: true }));

    useStore.getState().markResultsSeen('round-2');
    // The celebration still owns the baseline: it stays queued and unseen.
    expect(useStore.getState().pendingResult?.rank).toBe(3);
    expect(useStore.getState().lastSeenResultsContestId).toBeNull();
  });

  it('markResultsSeen advances the baseline for non-podium viewers', () => {
    const useStore = requireStore();
    useStore.getState().markResultsSeen('round-2');
    expect(useStore.getState().lastSeenResultsContestId).toBe('round-2');
  });

  it('tolerates old backends without my_result', async () => {
    const useStore = requireStore();
    await useStore.getState().ingestSnapshot(snapshotWith({ withMyResult: false }));
    expect(useStore.getState().pendingResult).toBeNull();
  });
});
