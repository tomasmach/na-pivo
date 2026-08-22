import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  claimInviteCode,
  consumeAndClaimPendingInviteCode,
  consumePendingInviteCode,
  parseInviteCodeFromUrl,
  peekPendingInviteCode,
  stashPendingInviteCode,
} from '../friendInviteLink';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const sendFriendRequest = jest.fn(
  async (): Promise<{ ok: boolean; code?: string; detail?: string }> => ({ ok: true }),
);
jest.mock('../friendsClient', () => ({
  sendFriendRequest: (...a: unknown[]) => sendFriendRequest(...(a as [])),
}));

const enqueueFriendOp = jest.fn(async (): Promise<void> => undefined);
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
  jest.clearAllMocks();
  sendFriendRequest.mockResolvedValue({ ok: true });
  await AsyncStorage.clear();
});

describe('parseInviteCodeFromUrl', () => {
  it('reads the ?code= param from the custom scheme link', () => {
    expect(parseInviteCodeFromUrl('napivo://parta/pozvanka?code=Ab3xK9_pQ2sT')).toBe('Ab3xK9_pQ2sT');
  });

  it('reads the /p/<code> path from the web landing link', () => {
    expect(parseInviteCodeFromUrl('https://na-pivo.cz/p/Ab3xK9_pQ2sT')).toBe('Ab3xK9_pQ2sT');
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
  it('stashes, peeks (non-destructive), then consumes (one-shot)', async () => {
    await stashPendingInviteCode('code-1');
    expect(await peekPendingInviteCode()).toBe('code-1');
    expect(await peekPendingInviteCode()).toBe('code-1'); // peek does not clear
    expect(await consumePendingInviteCode()).toBe('code-1');
    expect(await consumePendingInviteCode()).toBeNull(); // consumed
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

  it('does not queue or refresh on a permanent failure', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'invite_expired', detail: 'x' });
    const result = await claimInviteCode('code-x');
    expect(enqueueFriendOp).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, code: 'invite_expired', detail: 'x' });
  });
});

describe('consumeAndClaimPendingInviteCode', () => {
  it('returns null when nothing is stashed', async () => {
    expect(await consumeAndClaimPendingInviteCode()).toBeNull();
    expect(sendFriendRequest).not.toHaveBeenCalled();
  });

  it('claims and clears a stashed code', async () => {
    await stashPendingInviteCode('code-2');
    const result = await consumeAndClaimPendingInviteCode();
    expect(result).toEqual({ ok: true });
    expect(sendFriendRequest).toHaveBeenCalledWith({ inviteCode: 'code-2' });
    expect(await peekPendingInviteCode()).toBeNull();
  });

  it('queues and clears a stashed code on a retriable failure', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'network', detail: 'x' });
    await stashPendingInviteCode('code-3');
    const result = await consumeAndClaimPendingInviteCode();
    expect(result).toEqual({ ok: true });
    expect(enqueueFriendOp).toHaveBeenCalledWith({
      op: 'request',
      key: 'invite:code-3',
      inviteCode: 'code-3',
    });
    expect(await peekPendingInviteCode()).toBeNull();
  });

  it('clears a stashed code after a permanent claim failure', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'invite_expired', detail: 'x' });
    await stashPendingInviteCode('code-4');
    const result = await consumeAndClaimPendingInviteCode();
    expect(result).toEqual({ ok: false, code: 'invite_expired', detail: 'x' });
    expect(enqueueFriendOp).not.toHaveBeenCalled();
    expect(await peekPendingInviteCode()).toBeNull();
  });
});
