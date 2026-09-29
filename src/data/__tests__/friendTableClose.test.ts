import { closeFriendTable, openFriendTable } from '../friendsClient';
import { ensureAccount, getSessionToken } from '../account';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => true),
  generateUuidV4: jest.fn(() => 'uuid'),
  getSessionToken: jest.fn(),
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
  jest.mocked(getSessionToken).mockResolvedValue('t');
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

  it('sends every retry with the session it started with', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock;

    const done = closeFriendTable();
    await jest.advanceTimersByTimeAsync(0);
    // Another account signs in: the retry still hides the original one, never this one.
    jest.mocked(ensureAccount).mockResolvedValue({ token: 'other' } as never);
    jest.mocked(getSessionToken).mockResolvedValue('other');
    await jest.advanceTimersByTimeAsync(2_000);
    await done;

    const auth = fetchMock.mock.calls.map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>).Authorization,
    );
    expect(auth).toEqual(['Bearer t', 'Bearer t']);
  });

  it('hides a closed opt-in again only after its POST has finished', async () => {
    const ok = { ok: true, status: 200, text: async () => '{}' };
    let answer: (value: unknown) => void = () => {};
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue(ok);
    global.fetch = fetchMock;
    const closed = new AbortController();

    const opened = openFriendTable(closed.signal);
    await jest.advanceTimersByTimeAsync(0);
    closed.abort();
    await jest.advanceTimersByTimeAsync(0);
    // The POST keeps running: a hide sent now could reach the server before it.
    expect(methods(fetchMock)).toEqual(['POST']);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);

    answer({ ok: false, status: 502, text: async () => '' });
    expect(await opened).toBeNull();
    await jest.advanceTimersByTimeAsync(0);

    expect(methods(fetchMock)).toEqual(['POST', 'DELETE']);
  });

  it('hides a closed opt-in with the session that posted it', async () => {
    let answer: (value: unknown) => void = () => {};
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock;
    const closed = new AbortController();

    const opened = openFriendTable(closed.signal);
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(ensureAccount).mockResolvedValue({ token: 'other' } as never);
    jest.mocked(getSessionToken).mockResolvedValue('other');
    closed.abort();
    answer({ ok: true, status: 200, text: async () => '{}' });
    await opened;
    await jest.advanceTimersByTimeAsync(0);

    const auth = fetchMock.mock.calls.map(
      ([, init]) => ((init as RequestInit).headers as Record<string, string>).Authorization,
    );
    expect(methods(fetchMock)).toEqual(['POST', 'DELETE']);
    expect(auth).toEqual(['Bearer t', 'Bearer t']);
  });

  it('sends nothing when the account changes before the hide starts', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.mocked(ensureAccount).mockResolvedValue({ token: 'other' } as never);

    await closeFriendTable();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides an opt-in whose answer was lost while the sheet stays open', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock;

    expect(await openFriendTable(new AbortController().signal)).toBeNull();
    await jest.advanceTimersByTimeAsync(0);

    expect(methods(fetchMock)).toEqual(['POST', 'DELETE']);
  });
});
