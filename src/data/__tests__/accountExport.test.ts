import { exportMyAccountData } from '../accountExport';
import { Platform } from 'react-native';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn(
    () => 'https://backend.test/v1/account/export',
  ),
}));

const ensureAccountMock = jest.fn();
jest.mock('../account', () => ({
  ensureAccount: (...args: unknown[]) => ensureAccountMock(...args),
}));

const chainAbortSignalMock = jest.fn(
  (_signal: AbortSignal | undefined, _timeoutMs: number) => ({
    signal: new AbortController().signal,
    cleanup: jest.fn(),
  }),
);
jest.mock('../apiFetch', () => ({
  chainAbortSignal: (
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ) => chainAbortSignalMock(signal, timeoutMs),
}));

const runMutationImpl = jest.fn(
  (task: (scope: { signal: AbortSignal }) => Promise<unknown>) =>
    task({ signal: new AbortController().signal }),
);
jest.mock('../privateAccountBoundary', () => {
  class PrivateAccountMutationFrozenError extends Error {}
  return {
    PrivateAccountMutationFrozenError,
    runPrivateAccountMutation: (
      task: (scope: { signal: AbortSignal }) => Promise<unknown>,
    ) => runMutationImpl(task),
  };
});

interface TrackedFakeFile {
  uri: string;
  create: jest.Mock;
  write: jest.Mock;
  delete: jest.Mock;
}

// Fake filesystem models existence per absolute path so that separate File
// instances pointing at the same uri observe the same on-"disk" state.
jest.mock('expo-file-system', () => {
  const pathState = new Map<string, boolean>();
  const instances: TrackedFakeFile[] = [];
  class FakeFile {
    uri: string;
    create = jest.fn(() => {
      pathState.set(this.uri, true);
    });
    write = jest.fn();
    delete = jest.fn(() => {
      pathState.set(this.uri, false);
    });
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
      Object.defineProperty(this, 'exists', {
        get: () => pathState.get(this.uri) ?? false,
      });
      instances.push(this);
    }
  }
  return {
    File: FakeFile,
    Paths: { cache: '/cache' },
    __fileInstances: instances,
    __pathState: pathState,
  };
});

const {
  __fileInstances: fileInstances,
  __pathState: pathState,
} = jest.requireMock('expo-file-system') as {
  __fileInstances: TrackedFakeFile[];
  __pathState: Map<string, boolean>;
};

const EXPORT_URI = '/cache/na-pivo-export.json';
const RATE_LIMIT_DETAIL =
  'Dnešní limit exportů je pryč. Zkus to zítra.';

function existsAt(uri: string): boolean {
  return pathState.get(uri) ?? false;
}

function setPlatform(os: 'ios' | 'android'): void {
  (Platform as unknown as { OS: string }).OS = os;
}

const isAvailableMock = jest.fn(() => Promise.resolve(true));
const shareAsyncMock = jest.fn(
  (_url: string, _options?: unknown) => Promise.resolve(),
);
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => isAvailableMock(),
  shareAsync: (url: string, options?: unknown) =>
    shareAsyncMock(url, options),
}));

const fetchMock = jest.fn();

describe('exportMyAccountData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileInstances.length = 0;
    pathState.clear();
    setPlatform('ios');
    runMutationImpl.mockImplementation(
      (task: (scope: { signal: AbortSignal }) => Promise<unknown>) =>
        task({ signal: new AbortController().signal }),
    );
    isAvailableMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ drinks: [] }), { status: 200 }),
    );
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
    });
  });

  afterEach(() => {
    setPlatform('ios');
  });

  function expectSharedThroughExactPath(): void {
    expect(fetchMock).toHaveBeenCalledWith(
      'https://backend.test/v1/account/export',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-1',
          Accept: 'application/json',
        }),
      }),
    );
    const file = fileInstances.at(-1);
    expect(file?.uri).toBe(EXPORT_URI);
    expect(file?.create).toHaveBeenCalledWith({ overwrite: true });
    expect(file?.write).toHaveBeenCalledWith('{\n  "drinks": []\n}');
    expect(shareAsyncMock).toHaveBeenCalledWith(
      EXPORT_URI,
      expect.objectContaining({
        mimeType: 'application/json',
        UTI: 'public.json',
      }),
    );
  }

  it('iOS: successful share resolves and deletes the file immediately', async () => {
    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
    expectSharedThroughExactPath();
    expect(fileInstances.at(-1)?.delete).toHaveBeenCalled();
    expect(existsAt(EXPORT_URI)).toBe(false);
  });

  it('Android: successful share resolves and retains the export file', async () => {
    setPlatform('android');

    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
    expectSharedThroughExactPath();
    expect(fileInstances.at(-1)?.delete).not.toHaveBeenCalled();
    expect(existsAt(EXPORT_URI)).toBe(true);
  });

  it('Android: second export cleans the previous exact export path before recreating and keeps the new file', async () => {
    setPlatform('android');
    await exportMyAccountData();
    expect(existsAt(EXPORT_URI)).toBe(true);
    expect(fileInstances).toHaveLength(2);

    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
    expect(fileInstances).toHaveLength(4);
    const [, firstFile, secondStaleCheck, secondFile] = fileInstances;
    expect(firstFile?.uri).toBe(EXPORT_URI);
    expect(secondStaleCheck?.uri).toBe(EXPORT_URI);
    expect(secondStaleCheck?.create).not.toHaveBeenCalled();
    expect(secondStaleCheck?.delete).toHaveBeenCalledTimes(1);
    // Stale cleanup targets only the exact export path and happens before
    // the new file is recreated.
    expect(
      secondStaleCheck.delete.mock.invocationCallOrder[0],
    ).toBeLessThan(secondFile.create.mock.invocationCallOrder[0]);
    expect(secondFile?.uri).toBe(EXPORT_URI);
    expect(secondFile?.delete).not.toHaveBeenCalled();
    expect(existsAt(EXPORT_URI)).toBe(true);
  });

  it('never constructs or deletes any foreign cache filename', async () => {
    await exportMyAccountData();

    setPlatform('android');
    await exportMyAccountData();
    await exportMyAccountData();

    setPlatform('ios');
    shareAsyncMock.mockRejectedValue(new Error('cancelled'));
    await exportMyAccountData();

    expect(new Set(fileInstances.map((f) => f.uri))).toEqual(
      new Set([EXPORT_URI]),
    );
  });

  it.each(['ios', 'android'] as const)(
    '%s: write failure cleans up the file and returns share_failed',
    async (os) => {
      setPlatform(os);
      fileInstances.length = 0;
      let leaked: TrackedFakeFile | undefined;
      const { File } = jest.requireMock('expo-file-system') as {
        File: new (...parts: string[]) => TrackedFakeFile;
      };
      const original = File;
      // Capture the instance the source creates so write can reject.
      class SpyingFile extends original {
        constructor(...parts: string[]) {
          super(...parts);
          leaked = this;
          this.write.mockImplementation(() => {
            throw new Error('disk full');
          });
        }
      }
      (jest.requireMock('expo-file-system') as { File: unknown }).File =
        SpyingFile;

      const result = await exportMyAccountData();

      (jest.requireMock('expo-file-system') as { File: unknown }).File =
        original;

      expect(result).toEqual({
        ok: false,
        code: 'share_failed',
        detail: expect.any(String),
      });
      expect(leaked?.delete).toHaveBeenCalled();
      expect(existsAt(EXPORT_URI)).toBe(false);
      expect(shareAsyncMock).not.toHaveBeenCalled();
    },
  );

  it.each(['ios', 'android'] as const)(
    '%s: share rejection deletes the file because no recipient needs it',
    async (os) => {
      setPlatform(os);
      shareAsyncMock.mockRejectedValue(new Error('user cancelled'));

      const result = await exportMyAccountData();

      expect(result).toEqual({
        ok: false,
        code: 'share_failed',
        detail: expect.any(String),
      });
      expect(fileInstances.at(-1)?.delete).toHaveBeenCalled();
      expect(existsAt(EXPORT_URI)).toBe(false);
    },
  );

  it.each(['ios', 'android'] as const)(
    '%s: cleanup delete failure never turns a successful export into failure',
    async (os) => {
      setPlatform(os);
      const { File } = jest.requireMock('expo-file-system') as {
        File: new (...parts: string[]) => TrackedFakeFile;
      };
      class ThrowingDeleteFile extends File {
        constructor(...parts: string[]) {
          super(...parts);
          this.delete.mockImplementation(() => {
            throw new Error('delete failed');
          });
        }
      }
      const saved = (
        jest.requireMock('expo-file-system') as { File: unknown }
      ).File;
      (jest.requireMock('expo-file-system') as { File: unknown }).File =
        ThrowingDeleteFile;
      try {
        const result = await exportMyAccountData();
        expect(result).toEqual({ ok: true });
        expect(shareAsyncMock).toHaveBeenCalled();
      } finally {
        (jest.requireMock('expo-file-system') as { File: unknown }).File =
          saved;
      }
    },
  );

  it('passes a 45s timeout to chainAbortSignal and its signal to fetch; abort yields network error and creates no file', async () => {
    const scopedSignal = new AbortController().signal;
    chainAbortSignalMock.mockReturnValueOnce({
      signal: scopedSignal,
      cleanup: jest.fn(),
    });

    await exportMyAccountData();

    expect(chainAbortSignalMock).toHaveBeenCalledWith(
      expect.anything(),
      45_000,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(scopedSignal);

    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const failed = await exportMyAccountData();

    expect(failed).toEqual({
      ok: false,
      code: 'network',
      detail: expect.any(String),
    });
    expect(fileInstances).toHaveLength(1);
    expect(shareAsyncMock).not.toHaveBeenCalledTimes(2);
  });

  it('returns network failure and creates nothing when fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const result = await exportMyAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'network',
      detail: expect.any(String),
    });
    expect(fileInstances).toHaveLength(0);
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('returns sharing_unavailable and creates nothing', async () => {
    isAvailableMock.mockResolvedValue(false);

    const result = await exportMyAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'sharing_unavailable',
      detail: expect.any(String),
    });
    expect(fileInstances).toHaveLength(0);
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('maps HTTP 429 to the exact rate-limit copy even when the server sends an English default detail', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: 'Request was throttled.' }),
        { status: 429 },
      ),
    );

    const result = await exportMyAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'http_429',
      detail: RATE_LIMIT_DETAIL,
    });
    expect(fileInstances).toHaveLength(0);
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('preserves parsed server detail for other non-2xx responses', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: 'Server má momentálně problém.',
          code: 'server_rozbity',
        }),
        { status: 500 },
      ),
    );

    const result = await exportMyAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'server_rozbity',
      detail: 'Server má momentálně problém.',
    });
  });

  it('succeeds for an anonymous session', async () => {
    const result = await exportMyAccountData();
    expect(result).toEqual({ ok: true });
    expectSharedThroughExactPath();
  });

  it('succeeds for a social-only session through the same direct path', async () => {
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
      provider: 'google',
    });

    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
    expectSharedThroughExactPath();
  });

  it('succeeds for a verified email session through the same direct path', async () => {
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
      provider: 'password',
      emailVerified: true,
    });

    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
    expectSharedThroughExactPath();
  });

  it('maps boundary rejection to account_transition before any IO', async () => {
    const { PrivateAccountMutationFrozenError } = jest.requireMock(
      '../privateAccountBoundary',
    ) as { PrivateAccountMutationFrozenError: new () => Error };
    runMutationImpl.mockImplementation(() =>
      Promise.reject(new PrivateAccountMutationFrozenError()),
    );

    const result = await exportMyAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'account_transition',
      detail: expect.any(String),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fileInstances).toHaveLength(0);
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('uses ensureAccount for every variant via one unauthenticated-safe path', async () => {
    ensureAccountMock.mockResolvedValue(null);

    const result = await exportMyAccountData();

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
