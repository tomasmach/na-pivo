import { exportMyAccountData } from '../accountExport';

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
  exists: boolean;
  create: jest.Mock;
  write: jest.Mock;
  delete: jest.Mock;
}

jest.mock('expo-file-system', () => {
  const instances: TrackedFakeFile[] = [];
  class FakeFile {
    uri: string;
    exists = false;
    create = jest.fn(() => {
      this.exists = true;
    });
    write = jest.fn();
    delete = jest.fn(() => {
      this.exists = false;
    });
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
      instances.push(this);
    }
  }
  return {
    File: FakeFile,
    Paths: { cache: '/cache' },
    __fileInstances: instances,
  };
});

const {
  __fileInstances: fileInstances,
} = jest.requireMock('expo-file-system') as {
  __fileInstances: TrackedFakeFile[];
};

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
    runMutationImpl.mockImplementation(
      (task: (scope: { signal: AbortSignal }) => Promise<unknown>) =>
        task({ signal: new AbortController().signal }),
    );
    isAvailableMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ drinks: [] }), { status: 200 }),
    );
  });

  async function expectSuccess(sessionOverrides: object) {
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
      ...sessionOverrides,
    });

    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
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
    expect(fileInstances).toHaveLength(1);
    const file = fileInstances[0];
    expect(file.uri).toBe('/cache/na-pivo-export.json');
    expect(file.create).toHaveBeenCalledWith({ overwrite: true });
    expect(file.write).toHaveBeenCalledWith('{\n  "drinks": []\n}');
    expect(shareAsyncMock).toHaveBeenCalledWith(
      '/cache/na-pivo-export.json',
      expect.objectContaining({
        mimeType: 'application/json',
        UTI: 'public.json',
      }),
    );
    expect(file.delete).toHaveBeenCalled();
  }

  it('succeeds for an anonymous session', async () => {
    await expectSuccess({});
  });

  it('succeeds for a social-only session through the same direct path', async () => {
    await expectSuccess({ provider: 'google' });
  });

  it('succeeds for a verified email session through the same direct path', async () => {
    await expectSuccess({ provider: 'password', emailVerified: true });
  });

  it('returns network failure and creates nothing when fetch fails', async () => {
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
    });
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
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
    });
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

  it('returns share_failed and deletes the file when sharing rejects', async () => {
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
    });
    shareAsyncMock.mockRejectedValue(new Error('user cancelled'));

    const result = await exportMyAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'share_failed',
      detail: expect.any(String),
    });
    expect(fileInstances[0]?.delete).toHaveBeenCalled();
  });

  it('treats resolved dismissal as success and deletes the file', async () => {
    ensureAccountMock.mockResolvedValue({
      deviceId: 'device',
      accountId: 'acct-1',
      token: 'tok-1',
    });
    shareAsyncMock.mockResolvedValue(undefined);

    const result = await exportMyAccountData();

    expect(result).toEqual({ ok: true });
    expect(fileInstances[0]?.delete).toHaveBeenCalled();
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
