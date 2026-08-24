import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  claimInviteCode,
  clearPendingInviteCode,
  inviteClaimRoute,
  isInviteClaimAccepted,
  parseInviteCodeFromUrl,
  peekPendingInviteCode,
  stashPendingInviteCode,
} from '../friendInviteLink';
import {
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const sendFriendRequest = jest.fn(
  async (): Promise<{ ok: boolean; status?: string; code?: string; detail?: string }> => ({
    ok: true,
  }),
);
jest.mock('../friendsClient', () => ({
  sendFriendRequest: (...a: unknown[]) => sendFriendRequest(...(a as [])),
}));

const enqueueFriendOp = jest.fn(async (): Promise<'queued' | 'storage-error'> => 'queued');
jest.mock('../friendsQueue', () => ({
  enqueueFriendOp: (...a: unknown[]) => enqueueFriendOp(...(a as [])),
  isRetriableFriendError: (result: { code?: string }) =>
    ['offline', 'account', 'network', 'auth', 'http_401', 'http_429', 'http_500', 'http_503'].includes(
      result.code ?? '',
    ),
}));

const requestRefresh = jest.fn();
jest.mock('@/stores/partaSignalStore', () => ({
  usePartaSignalStore: { getState: () => ({ requestRefresh }) },
}));

beforeEach(async () => {
  resetPrivateAccountBoundaryForTests();
  jest.clearAllMocks();
  sendFriendRequest.mockResolvedValue({ ok: true });
  enqueueFriendOp.mockResolvedValue('queued');
  await AsyncStorage.clear();
});

describe('parseInviteCodeFromUrl', () => {
  it('reads the ?code= param from the custom scheme link', () => {
    expect(parseInviteCodeFromUrl('napivo://parta/pozvanka?code=Ab3xK9_pQ2sT')).toBe('Ab3xK9_pQ2sT');
  });

  it('reads the /p/<code> path from the web landing link', () => {
    expect(parseInviteCodeFromUrl('https://na-pivo.cz/p/Ab3xK9_pQ2sT')).toBe('Ab3xK9_pQ2sT');
  });

  it.each([
    'https://na-pivo.cz/p/Ab3xK9_pQ2sT/',
    'https://na-pivo.cz/p/Ab3xK9_pQ2sT?utm_source=qr',
    'https://na-pivo.cz/p/Ab3xK9_pQ2sT/#invite',
  ])('accepts a complete friend path with URL suffixes: %s', (url) => {
    expect(parseInviteCodeFromUrl(url)).toBe('Ab3xK9_pQ2sT');
  });

  it('rejects nested content after a friend invite code', () => {
    expect(parseInviteCodeFromUrl('https://na-pivo.cz/p/Ab3xK9_pQ2sT/extra')).toBeNull();
  });

  it('url-decodes a query code and trims it', () => {
    expect(parseInviteCodeFromUrl('napivo://parta/pozvanka?code=a%2Db&x=1')).toBe('a-b');
  });

  it('returns null for a link with no code, and for junk input', () => {
    expect(parseInviteCodeFromUrl('napivo://parta')).toBeNull();
    expect(parseInviteCodeFromUrl('')).toBeNull();
    expect(parseInviteCodeFromUrl(null)).toBeNull();
    expect(parseInviteCodeFromUrl(undefined)).toBeNull();
  });

  it('does not steal a shared-table or unrelated link that also has a code', () => {
    expect(parseInviteCodeFromUrl('napivo://party-live?code=EFJ66G')).toBeNull();
    expect(parseInviteCodeFromUrl('https://example.com/p/Ab3xK9_pQ2sT')).toBeNull();
    expect(parseInviteCodeFromUrl('https://na-pivo.cz/privacy?code=Ab3xK9_pQ2sT')).toBeNull();
  });

  it('returns null instead of throwing on malformed percent encoding', () => {
    expect(() => parseInviteCodeFromUrl('napivo://parta/pozvanka?code=50%')).not.toThrow();
    expect(parseInviteCodeFromUrl('napivo://parta/pozvanka?code=50%')).toBeNull();
  });
});

describe('pending invite code stash', () => {
  it('stashes, peeks non-destructively, then an explicit clear removes it', async () => {
    await stashPendingInviteCode('code-1');
    expect(await peekPendingInviteCode()).toBe('code-1');
    expect(await peekPendingInviteCode()).toBe('code-1'); // peek does not clear
    await clearPendingInviteCode();
    expect(await peekPendingInviteCode()).toBeNull();
  });

  it('a process restart only peeks: the stash survives and no request is sent', async () => {
    await stashPendingInviteCode('code-restart');
    // The next launch reads what survived; before an explicit CTA nothing may
    // clear the stash or fire the social request on the user's behalf.
    expect(await peekPendingInviteCode()).toBe('code-restart');
    expect(await peekPendingInviteCode()).toBe('code-restart');
    expect(sendFriendRequest).not.toHaveBeenCalled();
  });
});

describe('pending stash write ordering (latest invocation wins)', () => {
  /**
   * Deferred AsyncStorage: a write only touches the backing store when its
   * gate is released, so tests control completion order independently of
   * invocation order. Because `runPrivateAccountMutation` reaches AsyncStorage
   * only after async setup, every gate must be awaited via its registration
   * promise BEFORE being released — an early release would be lost. Real mock
   * implementation is restored by `restore()`.
   */
  const deferPendingWrites = () => {
    // AsyncStorage methods are already jest.fn mocks: capturing the property
    // would save the same mock object and re-enter the deferred gate. Capture
    // the ORIGINAL implementation functions instead.
    const realSetItem = (
      AsyncStorage.setItem as unknown as jest.Mock
    ).getMockImplementation() as (key: string, value: string) => Promise<void>;
    const realRemoveItem = (
      AsyncStorage.removeItem as unknown as jest.Mock
    ).getMockImplementation() as (key: string) => Promise<void>;
    const writeGates: Record<string, () => void> = {};
    const writeRegisteredResolvers: Record<string, (() => void) | undefined> = {};
    const releasedWrites = new Set<string>();
    let removeGate: (() => void) | null = null;
    let removeRegisteredResolver: (() => void) | null = null;
    let removalReleased = false;

    const setItemSpy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockImplementation((key: string, value: string) =>
        new Promise<void>((resolveGate) => {
          if (releasedWrites.has(value)) {
            resolveGate();
          } else {
            writeGates[value] = resolveGate;
            writeRegisteredResolvers[value]?.();
          }
        }).then(() => realSetItem(key, value)),
      );
    const removeItemSpy = jest
      .spyOn(AsyncStorage, 'removeItem')
      .mockImplementation((key: string) =>
        new Promise<void>((resolveGate) => {
          if (removalReleased) {
            resolveGate();
          } else {
            removeGate = resolveGate;
            removeRegisteredResolver?.();
          }
        }).then(() => realRemoveItem(key)),
      );

    return {
      /** Resolves once the mocked write for `code` exists and can be gated. */
      waitWriteRegistered: (code: string): Promise<void> =>
        new Promise<void>((resolve) => {
          if (writeGates[code] || releasedWrites.has(code)) resolve();
          else writeRegisteredResolvers[code] = resolve;
        }),
      /** Resolves once the mocked removal exists and can be gated. */
      waitRemovalRegistered: (): Promise<void> =>
        new Promise<void>((resolve) => {
          if (removeGate || removalReleased) resolve();
          else removeRegisteredResolver = resolve;
        }),
      // Releases are permanent: a reconciliation write/remove of an already
      // released value must proceed immediately instead of deadlocking.
      releaseWrite: (code: string) => {
        releasedWrites.add(code);
        writeGates[code]?.();
      },
      releaseRemoval: () => {
        removalReleased = true;
        removeGate?.();
      },
      restore: () => {
        setItemSpy.mockRestore();
        removeItemSpy.mockRestore();
      },
    };
  };

  // Two macrotask ticks let every already-unblocked promise settle before the
  // next phase, without awaiting futures whose settlement order is exactly
  // what is under test.
  const flushWrites = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  it('two concurrent stashes leave the NEWER invocation persisted when the older write settles last', async () => {
    const deferred = deferPendingWrites();
    try {
      const first = stashPendingInviteCode('code-old');
      await deferred.waitWriteRegistered('code-old');
      const second = stashPendingInviteCode('code-new');
      await deferred.waitWriteRegistered('code-new');

      // The newer write completes first…
      deferred.releaseWrite('code-new');
      await flushWrites();
      // …then the older one lands afterwards and must not resurrect itself.
      deferred.releaseWrite('code-old');
      await Promise.all([first, second]);
      expect(await peekPendingInviteCode()).toBe('code-new');
    } finally {
      deferred.restore();
    }
  });

  it('a clear invoked after an older in-flight stash wins and leaves no code', async () => {
    const deferred = deferPendingWrites();
    try {
      const staleStash = stashPendingInviteCode('code-old');
      await deferred.waitWriteRegistered('code-old');
      const clearPromise = clearPendingInviteCode();
      await deferred.waitRemovalRegistered();

      // The clear finishes while the older stash write is still held…
      deferred.releaseRemoval();
      await flushWrites();
      // …then the stale stash lands and must not survive it.
      deferred.releaseWrite('code-old');
      await Promise.all([staleStash, clearPromise]);
      expect(await peekPendingInviteCode()).toBeNull();
    } finally {
      deferred.restore();
    }
  });
});

describe('claimInviteCode', () => {
  it('sends the request and raises the refresh signal on success', async () => {
    const result = await claimInviteCode('code-x');
    expect(sendFriendRequest).toHaveBeenCalledWith({ inviteCode: 'code-x' });
    expect(enqueueFriendOp).not.toHaveBeenCalled();
    expect(requestRefresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('queues a retriable failure and raises the refresh signal', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'network', detail: 'x' });
    const result = await claimInviteCode('code-x');
    expect(enqueueFriendOp).toHaveBeenCalledWith({
      op: 'request',
      key: 'invite:code-x',
      inviteCode: 'code-x',
    });
    expect(requestRefresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('does not claim success when a retriable request cannot reach storage', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'network', detail: 'x' });
    enqueueFriendOp.mockResolvedValueOnce('storage-error');

    const result = await claimInviteCode('code-x');

    expect(requestRefresh).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, code: 'storage', detail: 'x' });
  });

  it('does not queue or refresh on a permanent failure', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'invite_expired', detail: 'x' });
    const result = await claimInviteCode('code-x');
    expect(enqueueFriendOp).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, code: 'invite_expired', detail: 'x' });
  });

  it('does not refresh the replacement account after an old direct request resolves', async () => {
    let resolveRequest!: (result: { ok: true }) => void;
    sendFriendRequest.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const claiming = claimInviteCode('code-x');
    while (sendFriendRequest.mock.calls.length === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const transition = beginPrivateAccountTransition('test-account-swap', 'old-account');
    expect(transition).not.toBeNull();

    resolveRequest({ ok: true });
    await expect(claiming).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: 'account_transition',
    }));
    expect(requestRefresh).not.toHaveBeenCalled();
    transition?.release();
  });
});

describe('accepted invite outcome', () => {
  const ACCEPTED_ROUTE = '/friends/parta/people?focus=friends';
  const OUTGOING_ROUTE = '/friends/parta/people?focus=outgoing';

  it('propagates an immediate accepted response through claimInviteCode', async () => {
    sendFriendRequest.mockResolvedValue({ ok: true, status: 'accepted' });
    const result = await claimInviteCode('code-x');
    expect(result).toEqual({ ok: true, status: 'accepted' });
    expect(enqueueFriendOp).not.toHaveBeenCalled();
    expect(requestRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a generic non-invite success pending', async () => {
    sendFriendRequest.mockResolvedValue({ ok: true });
    expect(await claimInviteCode('code-x')).toEqual({ ok: true });
  });

  it('a queued retriable claim cannot claim accepted yet', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'network', detail: 'x' });
    const result = await claimInviteCode('code-x');
    expect(enqueueFriendOp).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('routes accepted to friends and pending/queued/failure to outgoing', () => {
    expect(inviteClaimRoute({ ok: true, status: 'accepted' })).toBe(ACCEPTED_ROUTE);
    expect(inviteClaimRoute({ ok: true })).toBe(OUTGOING_ROUTE);
    expect(inviteClaimRoute({ ok: false, code: 'network', detail: 'x' })).toBe(OUTGOING_ROUTE);
    expect(inviteClaimRoute({ ok: false, code: 'invite_expired', detail: 'x' })).toBe(OUTGOING_ROUTE);
  });

  it('predicate matches only an immediate accepted success', () => {
    expect(isInviteClaimAccepted({ ok: true, status: 'accepted' })).toBe(true);
    expect(isInviteClaimAccepted({ ok: true })).toBe(false);
    expect(isInviteClaimAccepted({ ok: false, code: 'network', detail: 'x' })).toBe(false);
  });
});
