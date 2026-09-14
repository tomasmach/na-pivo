import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearFriendsQueue,
  endFriendActivityDurably,
  enqueueFriendOp,
  flushFriendsQueue,
  isRetriableFriendError,
  type FriendQueueItem,
} from '../friendsQueue';
import {
  beginPrivateAccountTransition,
  PrivateAccountMutationFrozenError,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';
import type { FriendActionResult } from '../friendsClient';
import type { Pub } from '../pubs';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const respondToActivity = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const clearActivityResponse = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const reactToActivity = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const clearActivityReaction = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const shareFriendPubActivity = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const createFriendPlan = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const endFriendPubActivity = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));
const sendFriendRequest = jest.fn(async (): Promise<FriendActionResult> => ({ ok: true }));

jest.mock('../friendsClient', () => ({
  respondToActivity: (...a: unknown[]) => respondToActivity(...(a as [])),
  clearActivityResponse: (...a: unknown[]) => clearActivityResponse(...(a as [])),
  reactToActivity: (...a: unknown[]) => reactToActivity(...(a as [])),
  clearActivityReaction: (...a: unknown[]) => clearActivityReaction(...(a as [])),
  shareFriendPubActivity: (...a: unknown[]) => shareFriendPubActivity(...(a as [])),
  createFriendPlan: (...a: unknown[]) => createFriendPlan(...(a as [])),
  endFriendPubActivity: (...a: unknown[]) => endFriendPubActivity(...(a as [])),
  sendFriendRequest: (...a: unknown[]) => sendFriendRequest(...(a as [])),
}));

const STORAGE_KEY = 'na-pivo-friends-queue';

const PUB: Pub = { id: 'mapy:pub', name: 'U Testu', lat: 50.08, lng: 14.42, city: 'Praha' };

async function readQueue(): Promise<FriendQueueItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

const retry = () => ({ ok: false as const, code: 'network', detail: 'x' });
const permanent = () => ({ ok: false as const, code: 'http_400', detail: 'x' });

beforeEach(async () => {
  jest.clearAllMocks();
  respondToActivity.mockResolvedValue({ ok: true });
  clearActivityResponse.mockResolvedValue({ ok: true });
  reactToActivity.mockResolvedValue({ ok: true });
  clearActivityReaction.mockResolvedValue({ ok: true });
  shareFriendPubActivity.mockResolvedValue({ ok: true });
  createFriendPlan.mockResolvedValue({ ok: true });
  endFriendPubActivity.mockResolvedValue({ ok: true });
  sendFriendRequest.mockResolvedValue({ ok: true });
  await AsyncStorage.clear();
});

it('does not enqueue or resolve UI success after an A→B transition starts mid-delete', async () => {
  resetPrivateAccountBoundaryForTests();
  let resolveDelete!: (result: FriendActionResult) => void;
  endFriendPubActivity.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveDelete = resolve;
    }),
  );
  const ending = endFriendActivityDurably('activity-a');
  for (let i = 0; i < 20 && endFriendPubActivity.mock.calls.length === 0; i += 1) {
    await Promise.resolve();
  }

  const transition = beginPrivateAccountTransition('account-switch', 'A');
  expect(transition).not.toBeNull();
  resolveDelete(retry());
  await expect(ending).rejects.toBeInstanceOf(PrivateAccountMutationFrozenError);
  await transition!.drain();

  expect(await readQueue()).toEqual([]);
  expect(endFriendPubActivity).toHaveBeenCalledTimes(1);
  transition!.release();
  resetPrivateAccountBoundaryForTests();
});

describe('enqueueFriendOp — composite dedup keys', () => {
  it('reports storage failure and never sends a non-durable action', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      enqueueFriendOp({ op: 'cheer', activityId: 'a1' }),
    ).resolves.toBe('storage-error');

    expect(reactToActivity).not.toHaveBeenCalled();
  });

  it('treats rsvp and cheer on the same activity as distinct keys', async () => {
    respondToActivity.mockResolvedValue(retry());
    reactToActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'rsvp', activityId: 'a1', response: 'going' });
    await enqueueFriendOp({ op: 'cheer', activityId: 'a1' });
    expect(await readQueue()).toHaveLength(2);
  });

  it('collapses rsvp then rsvp-clear on the same activity (last write wins)', async () => {
    respondToActivity.mockResolvedValue(retry());
    clearActivityResponse.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'rsvp', activityId: 'a1', response: 'going' });
    await enqueueFriendOp({ op: 'rsvp-clear', activityId: 'a1' });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('rsvp-clear');
  });

  it('lets an end supersede a not-yet-synced activity for the same clientId', async () => {
    shareFriendPubActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'activity', clientId: 'c1', payload: { pub: PUB } });
    expect(shareFriendPubActivity).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toHaveLength(1); // activity kept (retry)

    // end with no activityId supersedes the pending activity and drops it locally
    // (the broadcast never synced → nothing to delete).
    await enqueueFriendOp({ op: 'end', clientId: 'c1' });
    expect(endFriendPubActivity).not.toHaveBeenCalled();
    expect(shareFriendPubActivity).toHaveBeenCalledTimes(1); // NOT re-sent
    expect(await readQueue()).toEqual([]); // end dropped
  });
});

describe('flushFriendsQueue — delivery + keep/drop', () => {
  it('routes each op to its client function', async () => {
    respondToActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'rsvp', activityId: 'a1', response: 'maybe' });
    expect(respondToActivity).toHaveBeenCalledWith('a1', 'maybe');

    reactToActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'cheer', activityId: 'a2' });
    expect(reactToActivity).toHaveBeenCalledWith('a2', 'cheers');
  });

  it('sends a plan through createFriendPlan and a live broadcast through shareFriendPubActivity', async () => {
    createFriendPlan.mockResolvedValue(retry());
    await enqueueFriendOp({
      op: 'activity',
      clientId: 'plan1',
      payload: { pub: PUB, message: 'Držím stůl', scheduledFor: '2026-07-02T18:00:00.000Z' },
    });
    expect(createFriendPlan).toHaveBeenCalledWith(PUB, '2026-07-02T18:00:00.000Z', 'Držím stůl', 'plan1', undefined);
    expect(shareFriendPubActivity).not.toHaveBeenCalled();

    shareFriendPubActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'activity', clientId: 'live1', payload: { pub: PUB, recipientIds: ['friend-a'] } });
    expect(shareFriendPubActivity).toHaveBeenCalledWith(PUB, undefined, 'live1', ['friend-a']);
  });

  it('routes a request op through sendFriendRequest', async () => {
    sendFriendRequest.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'request', key: 'code-abc', inviteCode: 'code-abc' });
    expect(sendFriendRequest).toHaveBeenCalledWith({
      inviteCode: 'code-abc',
      accountId: undefined,
      nickname: undefined,
    });
  });

  it('drops an op left behind by a retired feature instead of replaying it', async () => {
    // A queue written before the manual shared-evening was removed can still be
    // sitting on disk. Its ops no longer have a delivery path, so load must skip
    // them rather than hand `deliver` an op it cannot route.
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { op: 'party-drink', code: 'STUL24', clientId: 'drink-1', beerName: 'Plzeň', quantity: 1, sharedAt: '2026-07-19T18:10:00.000Z' },
        { op: 'rsvp', activityId: 'a1', response: 'going' },
      ]),
    );
    respondToActivity.mockResolvedValue(retry());

    await flushFriendsQueue();

    expect(await readQueue()).toEqual([{ op: 'rsvp', activityId: 'a1', response: 'going' }]);
    expect(respondToActivity).toHaveBeenCalledWith('a1', 'going');
  });

  it('drops a permanently-rejected op (4xx) but keeps a transient one', async () => {
    reactToActivity.mockResolvedValue(permanent());
    await enqueueFriendOp({ op: 'cheer', activityId: 'gone' });
    expect(await readQueue()).toEqual([]); // 400 → dropped

    respondToActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'rsvp', activityId: 'a1', response: 'going' });
    expect(await readQueue()).toHaveLength(1); // network → kept
  });

  it.each(['http_408', 'http_409', 'http_425'])('keeps transient %s responses queued', async (code) => {
    reactToActivity.mockResolvedValue({ ok: false, code, detail: 'zkus znovu' });

    await enqueueFriendOp({ op: 'cheer', activityId: 'slow-gateway' });

    expect(await readQueue()).toEqual([{ op: 'cheer', activityId: 'slow-gateway' }]);
  });

  it('clears the queue once delivery succeeds after a recovery', async () => {
    respondToActivity.mockResolvedValue(retry());
    await enqueueFriendOp({ op: 'rsvp', activityId: 'a1', response: 'going' });
    expect(await readQueue()).toHaveLength(1);

    respondToActivity.mockResolvedValue({ ok: true });
    await flushFriendsQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('does nothing on an empty queue and survives corrupted storage', async () => {
    await flushFriendsQueue();
    expect(respondToActivity).not.toHaveBeenCalled();
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushFriendsQueue()).resolves.toBeUndefined();
  });

  it('does not deliver remaining items after clear runs during an in-flight flush', async () => {
    let resolveFirst!: (value: FriendActionResult) => void;
    respondToActivity.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { op: 'rsvp', activityId: 'a1', response: 'going' },
        { op: 'rsvp', activityId: 'a2', response: 'going' },
      ]),
    );

    const flushing = flushFriendsQueue();
    // Wait for the first delivery to be in flight.
    for (let i = 0; i < 20 && respondToActivity.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    await clearFriendsQueue();
    resolveFirst({ ok: true });
    await flushing;

    expect(respondToActivity).toHaveBeenCalledTimes(1);
    expect(await readQueue()).toEqual([]);
  });
});

describe('isRetriableFriendError', () => {
  it('treats transient failures (offline/network/account/auth/5xx/429/401) as retriable', () => {
    for (const code of ['offline', 'network', 'account', 'auth', 'http_500', 'http_503', 'http_429', 'http_401']) {
      expect(isRetriableFriendError({ ok: false, code, detail: 'x' })).toBe(true);
    }
  });

  it('treats hard 4xx rejects and server machine-codes as non-retriable', () => {
    for (const code of ['http_400', 'http_422', 'not_friends', 'blocked', 'self_reaction', 'invite_expired']) {
      expect(isRetriableFriendError({ ok: false, code, detail: 'x' })).toBe(false);
    }
  });

  it('keeps non-terminal HTTP failures retriable', () => {
    for (const code of ['http_403', 'http_404', 'http_408', 'http_409', 'http_425']) {
      expect(isRetriableFriendError({ ok: false, code, detail: 'x' })).toBe(true);
    }
  });

  it('treats semantic UGC consent codes as retriable so a queued activity survives', () => {
    for (const code of ['ugc_consent_required', 'ugc_policy_update_required']) {
      expect(isRetriableFriendError({ ok: false, code, detail: 'x' })).toBe(true);
    }
  });

  it('treats a bare http_428 as retriable', () => {
    expect(isRetriableFriendError({ ok: false, code: 'http_428', detail: 'x' })).toBe(true);
  });

  it('keeps http_400 and http_422 permanent for an activity op', () => {
    for (const code of ['http_400', 'http_422'] as const) {
      expect(isRetriableFriendError({ ok: false, code, detail: 'x' })).toBe(false);
    }
  });

  it.each([
    ['semantic ugc_consent_required', { ok: false as const, code: 'ugc_consent_required', detail: 'x' }],
    ['bare http_428', { ok: false as const, code: 'http_428', detail: 'x' }],
  ])('a background flush retains a queued activity on %s', async (_name, failure) => {
    shareFriendPubActivity.mockResolvedValue(failure);
    await enqueueFriendOp({ op: 'activity', clientId: 'live-ugc', payload: { pub: PUB } });
    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ op: 'activity', clientId: 'live-ugc' });
  });

  it.each([
    ['http_400', 'http_400'],
    ['http_422', 'http_422'],
  ] as const)('a poisoned activity op (%s) is dropped instead of looping forever', async (_name, code) => {
    shareFriendPubActivity.mockResolvedValue({ ok: false, code, detail: 'x' });
    await enqueueFriendOp({ op: 'activity', clientId: 'poison', payload: { pub: PUB } });
    expect(await readQueue()).toEqual([]);
  });
});
