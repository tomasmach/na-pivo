import { sendFriendRequest } from '../friendsClient';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'me', token: 'token' })),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
  generateUuidV4: jest.fn(() => 'uuid'),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

function mockHttpResponse(status: number, body: unknown): void {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as jest.Mock;
}

describe('sendFriendRequest accepted-outcome parsing', () => {
  it('parses a mocked HTTP 201 Friendship payload into an accepted outcome', async () => {
    mockHttpResponse(201, { id: 'fr1', status: 'accepted' });

    const result = await sendFriendRequest({ inviteCode: 'code-x' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/v1/friends/requests',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ ok: true, status: 'accepted' });
  });

  it('keeps a pending Friendship payload as plain success', async () => {
    mockHttpResponse(201, { id: 'fr2', status: 'pending' });

    await expect(sendFriendRequest({ inviteCode: 'code-y' })).resolves.toEqual({ ok: true });
  });

  it('keeps a legacy empty body as plain success', async () => {
    mockHttpResponse(200, {});

    await expect(sendFriendRequest({ nickname: 'kamos' })).resolves.toEqual({ ok: true });
  });
});
