import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const sendFriendRequest = jest.fn(
  async (): Promise<{ ok: boolean; code?: string; detail?: string }> => ({ ok: true }),
);
jest.mock('../friendsClient', () => ({
  sendFriendRequest: (...a: unknown[]) => sendFriendRequest(...(a as [])),
}));

const requestRefresh = jest.fn();
jest.mock('@/stores/partaSignalStore', () => ({
  usePartaSignalStore: { getState: () => ({ requestRefresh }) },
}));

import {
  claimInviteCode,
  consumeAndClaimPendingInviteCode,
  consumePendingInviteCode,
  parseInviteCodeFromUrl,
  peekPendingInviteCode,
  stashPendingInviteCode,
} from '../friendInviteLink';

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
    expect(parseInviteCodeFromUrl('https://napivo.app/p/Ab3xK9_pQ2sT')).toBe('Ab3xK9_pQ2sT');
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
    expect(requestRefresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('does not raise the refresh signal on failure', async () => {
    sendFriendRequest.mockResolvedValue({ ok: false, code: 'network', detail: 'x' });
    await claimInviteCode('code-x');
    expect(requestRefresh).not.toHaveBeenCalled();
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
});
