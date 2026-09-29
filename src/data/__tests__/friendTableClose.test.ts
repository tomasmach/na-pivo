import { closeFriendTable, openFriendTable } from '../friendsClient';
import { ensureAccount } from '../account';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => true),
  generateUuidV4: jest.fn(() => 'uuid'),
}));

jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function methods(fetchMock: jest.Mock): string[] {
  return fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method ?? 'GET');
}

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_BACKEND_URL = 'http://127.0.0.1:8012';
  jest.mocked(ensureAccount).mockResolvedValue({ token: 't' } as never);
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = ORIGINAL_FETCH;
  process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  jest.clearAllMocks();
});

describe('closeFriendTable', () => {
  it('repeats a hide request lost to the network', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock;

    const done = closeFriendTable();
    await jest.advanceTimersByTimeAsync(2_000);
    await done;

    expect(methods(fetchMock)).toEqual(['DELETE', 'DELETE']);
  });

  it('stops retrying once the table was opened again', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock;

    const done = closeFriendTable();
    await jest.advanceTimersByTimeAsync(0);
    await openFriendTable();
    await jest.advanceTimersByTimeAsync(60_000);
    await done;

    expect(methods(fetchMock)).toEqual(['DELETE', 'POST']);
  });
});
