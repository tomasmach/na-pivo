/**
 * Tests for the auth client (src/data/auth.ts) — the data/logic layer only.
 *
 * The collaborators are mocked so each test is deterministic and never touches
 * the network or native modules:
 *  - backendConfig.getBackendEndpoint → 'https://api.test' + path (overridable to
 *    null to exercise the dormant/network sentinel path).
 *  - account.{ensureAccount,getSessionToken,setSession,revertToAnonymous} are
 *    stubbed so we can assert which bearer token was attached and whether the
 *    session was persisted / dropped.
 *  - socialAuth provides fake provider tokens and a real-ish SocialAuthError.
 *  - telemetryClient is a no-op.
 *  - global.fetch is stubbed per test.
 */

import * as auth from '@/data/auth';
import {
  ensureAccount,
  generateUuidV4,
  getSessionToken,
  revertToAnonymous,
  setSession,
} from '@/data/account';
import { getBackendEndpoint } from '@/data/backendConfig';
import { clearLocalPrivateAccountData } from '@/data/privateAccountData';
import {
  flushBeerPhotoDeletionsForAccountMerge,
  flushBeerPhotoDeletionsBeforeSessionEnd,
} from '@/data/beerPhotoDeletionSync';
import { isBeerPhotoSessionFrozen } from '@/data/beerPhotoSessionBoundary';
import {
  archiveAccountDeletionReceipt,
  clearAccountDeletionReceipt,
  completeAccountDeletionReceipt,
  readAccountDeletionReceipt,
  retireAccountDeletionOrphan,
  writeAccountDeletionReceipt,
} from '@/data/accountDeletionReceipt';
import { disableCachedPushDeviceWithBearer } from '@/data/pushDeviceClient';
import { registerCachedPushDeviceWithBearer } from '@/data/pushDeviceClient';
import {
  cancelUncommittedPartyGameAccountMerge,
  finalizePartyGameQueuesForAccountMerge,
  preflightPartyGameQueuesForAccountMerge,
  promotePartyGameQueuesAccountMerge,
} from '@/data/partyGameStartsQueue';
import { getAppleCredential, getGoogleIdToken, SocialAuthError } from '@/data/socialAuth';
import { refreshPartyGamesAfterAccountMerge } from '@/stores/partyGamesStore';
import { trackApiFailure } from '@/data/telemetryClient';
import * as efs from 'expo-file-system';

jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('@/data/privateAccountBoundary', () => ({
  beginPrivateAccountTransition: jest.fn((reason: string) => ({
    id: 1,
    reason,
    bindOwner: jest.fn(() => true),
    drain: jest.fn(async () => undefined),
    release: jest.fn(),
  })),
  readPrivateAccountMergeIntent: jest.fn(async () => ({ ok: true, intent: null })),
}));

jest.mock('@/data/account', () => {
  const ensureAccount = jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'anon-tok',
    authenticated: false,
  }));
  return {
    ensureAccount,
    readDurableAccountSession: jest.fn(async () => ({
      available: true,
      session: await ensureAccount(),
    })),
    getSessionToken: jest.fn(async () => 'cur-tok'),
    generateUuidV4: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
    setSession: jest.fn(async () => undefined),
    revertToAnonymous: jest.fn(
      async (_signal?: AbortSignal, beforeSessionCleared?: () => void | Promise<void>) => {
        await beforeSessionCleared?.();
        return null;
      },
    ),
  };
});

jest.mock('@/data/privateAccountData', () => ({
  clearLocalPrivateAccountData: jest.fn(async () => ({ ok: true })),
  rehydratePrivateStoresAfterBoundary: jest.fn(async () => true),
}));

jest.mock('@/data/accountDeletionReceipt', () => ({
  readAccountDeletionReceipt: jest.fn(async () => ({
    ok: true,
    intent: null,
    orphans: [],
  })),
  writeAccountDeletionReceipt: jest.fn(async () => ({ ok: true })),
  completeAccountDeletionReceipt: jest.fn(async () => ({ ok: true })),
  clearAccountDeletionReceipt: jest.fn(async () => ({ ok: true })),
  archiveAccountDeletionReceipt: jest.fn(async () => ({ ok: true })),
  retireAccountDeletionOrphan: jest.fn(async () => ({ ok: true })),
}));

jest.mock('@/data/beerPhotoDeletionSync', () => ({
  flushBeerPhotoDeletionsBeforeSessionEnd: jest.fn(async () => ({
    attempted: 0,
    delivered: 0,
    remaining: 0,
    timedOut: false,
  })),
  flushBeerPhotoDeletionsForAccountMerge: jest.fn(async () => ({
    attempted: 0,
    delivered: 0,
    remaining: 0,
    timedOut: false,
  })),
}));

jest.mock('@/data/partyGameStartsQueue', () => ({
  cancelUncommittedPartyGameAccountMerge: jest.fn(async () => true),
  finalizePartyGameQueuesForAccountMerge: jest.fn(async () => true),
  preflightPartyGameQueuesForAccountMerge: jest.fn(async () => ({
    operationId: '1420e4ef-104a-4ede-905b-3ec8bd98b0c7',
    cancelSafe: true,
  })),
  promotePartyGameQueuesAccountMerge: jest.fn(async () => true),
}));

jest.mock('@/stores/partyGamesStore', () => ({
  refreshPartyGamesAfterAccountMerge: jest.fn(),
}));

jest.mock('@/data/pushDeviceClient', () => ({
  disableCachedPushDeviceWithBearer: jest.fn(async () => true),
  registerCachedPushDeviceWithBearer: jest.fn(async () => true),
}));

jest.mock('@/data/socialAuth', () => {
  // A real-ish SocialAuthError so `err instanceof SocialAuthError` works inside
  // the module under test (it imports the class from the same mocked module).
  class SocialAuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = 'SocialAuthError';
      this.code = code;
    }
  }
  return {
    SocialAuthError,
    getGoogleIdToken: jest.fn(async () => 'gtok'),
    getAppleCredential: jest.fn(async () => ({
      identityToken: 'atok',
      authorizationCode: 'code',
      fullName: 'Jan Novák',
    })),
  };
});

jest.mock('@/data/telemetryClient', () => ({
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
}));

// expo-file-system: avatar upload uses the native multipart uploader (File.upload)
// rather than the global fetch, because Expo SDK 56's WinterCG fetch rejects the
// legacy RN {uri,name,type} FormData part. `__upload`/`__ctor` expose the spies.
jest.mock('expo-file-system', () => {
  const upload = jest.fn();
  const ctor = jest.fn();
  class File {
    upload = upload;
    constructor(...uris: string[]) {
      ctor(...uris);
    }
  }
  return { File, UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 }, __upload: upload, __ctor: ctor };
});

const mockGetBackendEndpoint = getBackendEndpoint as jest.MockedFunction<typeof getBackendEndpoint>;
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const mockGetSessionToken = getSessionToken as jest.MockedFunction<typeof getSessionToken>;
const mockGenerateUuidV4 = generateUuidV4 as jest.MockedFunction<typeof generateUuidV4>;
const mockSetSession = setSession as jest.MockedFunction<typeof setSession>;
const mockRevertToAnonymous = revertToAnonymous as jest.MockedFunction<typeof revertToAnonymous>;
const mockClearLocalPrivateAccountData = clearLocalPrivateAccountData as jest.MockedFunction<
  typeof clearLocalPrivateAccountData
>;
const mockFlushBeerPhotoDeletions =
  flushBeerPhotoDeletionsBeforeSessionEnd as jest.MockedFunction<
    typeof flushBeerPhotoDeletionsBeforeSessionEnd
  >;
const mockFlushMergedBeerPhotoDeletions =
  flushBeerPhotoDeletionsForAccountMerge as jest.MockedFunction<
    typeof flushBeerPhotoDeletionsForAccountMerge
  >;
const mockReadAccountDeletionReceipt =
  readAccountDeletionReceipt as jest.MockedFunction<typeof readAccountDeletionReceipt>;
const mockWriteAccountDeletionReceipt =
  writeAccountDeletionReceipt as jest.MockedFunction<typeof writeAccountDeletionReceipt>;
const mockCompleteAccountDeletionReceipt =
  completeAccountDeletionReceipt as jest.MockedFunction<
    typeof completeAccountDeletionReceipt
  >;
const mockClearAccountDeletionReceipt =
  clearAccountDeletionReceipt as jest.MockedFunction<typeof clearAccountDeletionReceipt>;
const mockArchiveAccountDeletionReceipt =
  archiveAccountDeletionReceipt as jest.MockedFunction<
    typeof archiveAccountDeletionReceipt
  >;
const mockRetireAccountDeletionOrphan =
  retireAccountDeletionOrphan as jest.MockedFunction<
    typeof retireAccountDeletionOrphan
  >;
const mockDisableCachedPushDeviceWithBearer =
  disableCachedPushDeviceWithBearer as jest.MockedFunction<
    typeof disableCachedPushDeviceWithBearer
  >;
const mockRegisterCachedPushDeviceWithBearer =
  registerCachedPushDeviceWithBearer as jest.MockedFunction<
    typeof registerCachedPushDeviceWithBearer
  >;
const mockCancelPartyGameMerge =
  cancelUncommittedPartyGameAccountMerge as jest.MockedFunction<
    typeof cancelUncommittedPartyGameAccountMerge
  >;
const mockFinalizePartyGameMerge =
  finalizePartyGameQueuesForAccountMerge as jest.MockedFunction<
    typeof finalizePartyGameQueuesForAccountMerge
  >;
const mockPreflightPartyGameMerge =
  preflightPartyGameQueuesForAccountMerge as jest.MockedFunction<
    typeof preflightPartyGameQueuesForAccountMerge
  >;
const mockPromotePartyGameMerge =
  promotePartyGameQueuesAccountMerge as jest.MockedFunction<
    typeof promotePartyGameQueuesAccountMerge
  >;
const mockRefreshPartyGamesAfterMerge =
  refreshPartyGamesAfterAccountMerge as jest.MockedFunction<
    typeof refreshPartyGamesAfterAccountMerge
  >;
const mockGetGoogleIdToken = getGoogleIdToken as jest.MockedFunction<typeof getGoogleIdToken>;
const mockGetAppleCredential = getAppleCredential as jest.MockedFunction<typeof getAppleCredential>;
const mockTrackApiFailure = trackApiFailure as jest.MockedFunction<typeof trackApiFailure>;
const mockFileUpload = (efs as unknown as { __upload: jest.Mock }).__upload;
const mockFileCtor = (efs as unknown as { __ctor: jest.Mock }).__ctor;

const ORIGINAL_FETCH = global.fetch;
const MERGE_OPERATION_ID = '10000000-0000-4000-8000-000000000001';

/** Build a fetch stub that resolves to a Response-like object. `body` is
 *  JSON-stringified by `text()` exactly the way the module reads responses. */
function fetchResolving(status: number, body: unknown): jest.Mock {
  const ok = status >= 200 && status < 300;
  return jest.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });
}

function installFetch(fn: jest.Mock): jest.Mock {
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Convenience accessor for the [url, init] of the first fetch call. */
function firstCall(spy: jest.Mock): { url: string; init: RequestInit } {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function authHeader(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default mock implementations cleared by clearAllMocks (it only
  // clears call data, but mockResolvedValueOnce etc. could have been queued).
  mockGetBackendEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'anon-tok',
    authenticated: false,
  });
  mockGetSessionToken.mockResolvedValue('cur-tok');
  mockSetSession.mockResolvedValue(undefined);
  mockRevertToAnonymous.mockImplementation(
    async (_signal, beforeSessionCleared) => {
      await beforeSessionCleared?.();
      return null;
    },
  );
  mockClearLocalPrivateAccountData.mockResolvedValue({ ok: true });
  mockGenerateUuidV4.mockReturnValue('00000000-0000-4000-8000-000000000001');
  mockReadAccountDeletionReceipt.mockResolvedValue({
    ok: true,
    intent: null,
    orphans: [],
  });
  mockWriteAccountDeletionReceipt.mockResolvedValue({ ok: true });
  mockCompleteAccountDeletionReceipt.mockResolvedValue({ ok: true });
  mockClearAccountDeletionReceipt.mockResolvedValue({ ok: true });
  mockArchiveAccountDeletionReceipt.mockResolvedValue({ ok: true });
  mockRetireAccountDeletionOrphan.mockResolvedValue({ ok: true });
  mockFlushBeerPhotoDeletions.mockResolvedValue({
    attempted: 0,
    delivered: 0,
    remaining: 0,
    timedOut: false,
  });
  mockFlushMergedBeerPhotoDeletions.mockResolvedValue({
    attempted: 0,
    delivered: 0,
    remaining: 0,
    timedOut: false,
  });
  mockCancelPartyGameMerge.mockResolvedValue(true);
  mockFinalizePartyGameMerge.mockResolvedValue(true);
  mockPreflightPartyGameMerge.mockResolvedValue({
    operationId: MERGE_OPERATION_ID,
    cancelSafe: true,
  });
  mockPromotePartyGameMerge.mockResolvedValue(true);
  mockGetGoogleIdToken.mockResolvedValue('gtok');
  mockGetAppleCredential.mockResolvedValue({
    identityToken: 'atok',
    authorizationCode: 'code',
    fullName: 'Jan Novák',
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

// ---------------------------------------------------------------------------
// registerEmail
// ---------------------------------------------------------------------------
describe('registerEmail', () => {
  it('claims the anonymous account, POSTs the registration, and persists the session on 201', async () => {
    const spy = installFetch(
      fetchResolving(201, {
        id: 'acc-1',
        token: 'new-tok',
        device_id: 'dev-1',
        display_name: 'Jan',
        email: 'jan@example.com',
        email_verified: true,
        providers: ['email'],
        is_anonymous: false,
        status: 'active',
        created: true,
        settings: {
          mode: 'surprise',
          max_distance_km: 5,
          price_currency: 'EUR',
          haptic_enabled: false,
          sound_enabled: true,
          hide_closed_pubs: false,
          hide_pub_names: true,
        },
        stats: {
          total_beers: 12,
          first_beer_at: '2026-07-01T18:00:00Z',
          distinct_pubs: 4,
          ratings_count: 3,
          total_spent_czk: 720,
          max_visits_to_one_pub: 5,
        },
        achievements: {
          first_ten: true,
          regular: true,
          reviewer: false,
        },
        usage: { walked_distance_m: 1234 },
      }),
    );

    const result = await auth.registerEmail({
      email: 'jan@example.com',
      password: 'pw123456',
      displayName: 'Jan',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile).toEqual({
      id: 'acc-1',
      deviceId: 'dev-1',
      nickname: null,
      displayName: 'Jan',
      avatarUrl: null,
      isPublic: true,
      email: 'jan@example.com',
      emailVerified: true,
      providers: ['email'],
      isAnonymous: false,
      status: 'active',
      created: true,
      settings: {
        mode: 'surprise',
        maxDistanceKm: 5,
        priceCurrency: 'EUR',
        hapticEnabled: false,
        soundEnabled: true,
        hideClosedPubs: false,
        hidePubNames: true,
      },
      stats: {
        totalBeers: 12,
        firstBeerAt: '2026-07-01T18:00:00Z',
        distinctPubs: 4,
        ratingsCount: 3,
        totalSpentCzk: 720,
        maxVisitsToOnePub: 5,
      },
      achievements: {
        firstTen: true,
        regular: true,
        reviewer: false,
        firstMap: false,
        explorer: false,
        cartographer: false,
        completionist: false,
        factMachine: false,
        fotoPivar: false,
        chatar: false,
        podSirakem: false,
        lahvacovyFilozof: false,
        plechovkac: false,
        firstBeer: false,
        century: false,
        pilgrim: false,
        stamgast: false,
        nightOwl: false,
        taster: false,
        partyAnimal: false,
      },
      usage: { walkedDistanceM: 1234 },
    });

    // 'ensure' bearer claims the current anonymous account first.
    expect(mockEnsureAccount).toHaveBeenCalledTimes(1);

    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(authHeader(init)).toBe('Bearer anon-tok');
    expect(bodyOf(init)).toEqual({
      email: 'jan@example.com',
      password: 'pw123456',
      display_name: 'Jan',
      merge_operation_id: MERGE_OPERATION_ID,
    });

    // The fresh credential session is persisted as authenticated.
    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'new-tok',
      authenticated: true,
    });
  });

  it('sends display_name="" when displayName is omitted', async () => {
    const spy = installFetch(fetchResolving(201, { id: 'x', token: 't', is_anonymous: false }));
    await auth.registerEmail({ email: 'a@b.cz', password: 'pw' });
    expect(bodyOf(firstCall(spy).init).display_name).toBe('');
  });

  it('returns the {code, detail} on a 409 and does NOT persist a session', async () => {
    installFetch(fetchResolving(409, { detail: 'Tento e-mail je už použitý.', code: 'email_taken' }));

    const result = await auth.registerEmail({ email: 'taken@example.com', password: 'pw' });

    expect(result).toEqual({
      ok: false,
      code: 'email_taken',
      detail: 'Tento e-mail je už použitý.',
    });
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('extracts the first DRF field error message on a 400', async () => {
    installFetch(fetchResolving(400, { email: ['Enter a valid email address.'] }));

    const result = await auth.registerEmail({ email: 'nope', password: 'pw' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.detail).toBe('Enter a valid email address.');
    expect(result.code).toBe('http_400');
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loginEmail
// ---------------------------------------------------------------------------
describe('loginEmail', () => {
  it('rejects a 2xx response that does not contain a complete session', async () => {
    installFetch(fetchResolving(200, { id: 'acc-2', is_anonymous: false }));

    await expect(auth.loginEmail({ email: 'jan@example.com', password: 'pw' })).resolves.toEqual({
      ok: false,
      code: 'protocol',
      detail: 'Server neposlal platné přihlášení. Zkus to prosím znovu.',
    });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_session', {
      reason: 'auth_success_missing_session',
    });
  });

  it('does not report a durable login when secure session persistence fails', async () => {
    installFetch(
      fetchResolving(200, { id: 'acc-2', token: 'login-tok', is_anonymous: false }),
    );
    mockSetSession.mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(auth.loginEmail({ email: 'jan@example.com', password: 'pw' })).resolves.toEqual({
      ok: false,
      code: 'session_storage',
      detail: 'Přihlášení se nepodařilo bezpečně uložit. Odemkni telefon a zkus to znovu.',
    });
    expect(mockTrackApiFailure).toHaveBeenCalledWith(
      'auth_session_persist',
      expect.objectContaining({ reason: 'secure_store' }),
    );
  });

  it('logs in with the anonymous bearer claim and stores the session without clearing local progress', async () => {
    const spy = installFetch(
      fetchResolving(200, { id: 'acc-2', token: 'login-tok', is_anonymous: false, providers: ['email'] }),
    );

    const result = await auth.loginEmail({ email: 'jan@example.com', password: 'pw' });

    expect(result.ok).toBe(true);
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/login');
    expect(init.method).toBe('POST');
    // bearer: 'claim' → best-effort anonymous claim for merging local progress.
    expect(authHeader(init)).toBe('Bearer anon-tok');
    expect(mockEnsureAccount).toHaveBeenCalledTimes(1);
    expect(mockGetSessionToken).not.toHaveBeenCalled();
    expect(bodyOf(init)).toEqual({
      email: 'jan@example.com',
      password: 'pw',
      merge_operation_id: MERGE_OPERATION_ID,
    });

    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: undefined,
      accountId: 'acc-2',
      token: 'login-tok',
      authenticated: true,
    });
    expect(mockPreflightPartyGameMerge).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ reason: 'credential-auth' }),
    );
    expect(mockPreflightPartyGameMerge.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[0],
    );
    expect(mockPromotePartyGameMerge).toHaveBeenCalledWith(
      'a',
      'acc-2',
      MERGE_OPERATION_ID,
    );
    expect(mockPromotePartyGameMerge.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
    expect(mockFinalizePartyGameMerge).toHaveBeenCalledWith(
      'a',
      'acc-2',
      MERGE_OPERATION_ID,
    );
    expect(mockFinalizePartyGameMerge.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
    expect(mockRefreshPartyGamesAfterMerge).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });

  it('blocks the merge-capable request when the phase-0 game intent is not durable', async () => {
    mockPreflightPartyGameMerge.mockResolvedValueOnce(null);
    const spy = installFetch(
      fetchResolving(200, { id: 'account-b', token: 'token-b', is_anonymous: false }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, code: 'session_storage' }));

    expect(spy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('resolves fail-closed and releases photo mutations when credential preflight throws', async () => {
    mockEnsureAccount.mockRejectedValueOnce(new Error('SecureStore unavailable'));
    const spy = installFetch(
      fetchResolving(200, { id: 'account-b', token: 'token-b', is_anonymous: false }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, code: 'session_storage' }));

    expect(spy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });

  it('binds and finalizes a successful anonymous A → A credential claim', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'anonymous-a',
      authenticated: false,
    });
    installFetch(
      fetchResolving(200, {
        id: 'account-a',
        device_id: 'device-a',
        token: 'credential-a',
        is_anonymous: false,
      }),
    );

    await expect(
      auth.loginEmail({ email: 'a@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(mockPromotePartyGameMerge).toHaveBeenCalledWith(
      'account-a',
      'account-a',
      MERGE_OPERATION_ID,
    );
    expect(mockFinalizePartyGameMerge).toHaveBeenCalledWith(
      'account-a',
      'account-a',
      MERGE_OPERATION_ID,
    );
    expect(mockCancelPartyGameMerge).not.toHaveBeenCalled();
  });

  it('keeps a promoted intent for cold recovery when post-session finalization fails', async () => {
    mockFinalizePartyGameMerge.mockResolvedValueOnce(false);
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockFinalizePartyGameMerge).toHaveBeenCalledTimes(1);
    expect(mockRefreshPartyGamesAfterMerge).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_party_games_merge', {
      reason: 'post_session_finalize_deferred',
    });
  });

  it('does not claim with authenticated A and durably clears A before storing B', async () => {
    const outgoingSession = {
      deviceId: 'd',
      accountId: 'signed-in',
      token: 'stale-signed-in-token',
      authenticated: true,
    };
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    const spy = installFetch(
      fetchResolving(200, { id: 'acc-2', token: 'login-tok', is_anonymous: false, providers: ['email'] }),
    );

    const result = await auth.loginEmail({ email: 'jan@example.com', password: 'pw' });

    expect(result.ok).toBe(true);
    expect(authHeader(firstCall(spy).init)).toBeUndefined();
    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: undefined,
      accountId: 'acc-2',
      token: 'login-tok',
      authenticated: true,
    });
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
      outgoingSession,
    });
    expect(mockClearLocalPrivateAccountData.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
    expect(mockDisableCachedPushDeviceWithBearer).toHaveBeenCalledWith(
      'stale-signed-in-token',
    );
    expect(mockDisableCachedPushDeviceWithBearer.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearLocalPrivateAccountData.mock.invocationCallOrder[0],
    );
    expect(mockRegisterCachedPushDeviceWithBearer).toHaveBeenCalledWith('login-tok');
    expect(mockSetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockRegisterCachedPushDeviceWithBearer.mock.invocationCallOrder[0],
    );
  });

  it('keeps authenticated A when its push binding cannot be disabled', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockDisableCachedPushDeviceWithBearer.mockResolvedValueOnce(false);
    installFetch(fetchResolving(200, {
      id: 'account-b',
      token: 'token-b',
      is_anonymous: false,
    }));

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, code: 'session_storage' }));

    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockRegisterCachedPushDeviceWithBearer).not.toHaveBeenCalled();
  });

  it('keeps A credential when its durable private clear is incomplete', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockClearLocalPrivateAccountData.mockResolvedValueOnce({
      ok: false,
      code: 'storage',
      failedOperations: ['remove:na-pivo-tally'],
    });
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, code: 'session_storage' }));

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockTrackApiFailure).toHaveBeenCalledWith(
      'auth_private_data_clear',
      expect.objectContaining({ reason: 'local_clear_incomplete' }),
    );
  });

  it('leaves authenticated A credential with empty caches when storing B fails', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockSetSession.mockRejectedValueOnce(new Error('Keychain unavailable'));
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual({
      ok: false,
      code: 'session_storage',
      detail: expect.stringContaining('bezpečně uložit'),
    });

    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
    expect(mockRegisterCachedPushDeviceWithBearer).not.toHaveBeenCalled();
  });

  it('keeps durable B when its push registration is deferred', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockRegisterCachedPushDeviceWithBearer.mockResolvedValueOnce(false);
    installFetch(fetchResolving(200, {
      id: 'account-b',
      token: 'token-b',
      is_anonymous: false,
    }));

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    expect(mockSetSession).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-b',
      token: 'token-b',
    }));
    expect(mockSetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockRegisterCachedPushDeviceWithBearer.mock.invocationCallOrder[0],
    );
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_push_rebind', {
      reason: 'incoming_register_deferred',
    });
  });

  it('blocks authenticated A → B while A still has an undelivered photo deletion', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'expired-a',
      authenticated: true,
    });
    mockFlushBeerPhotoDeletions
      .mockResolvedValueOnce({ attempted: 1, delivered: 0, remaining: 1, timedOut: true })
      .mockResolvedValueOnce({ attempted: 1, delivered: 0, remaining: 1, timedOut: true });
    const spy = installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual({
      ok: false,
      code: 'photo_deletions_pending',
      detail: expect.stringContaining('dosmazat fotky'),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });

  it('preserves local data on same-account reauth and retries deletes with the fresh bearer', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'expired-a',
      authenticated: true,
    });
    mockFlushBeerPhotoDeletions
      .mockResolvedValueOnce({ attempted: 1, delivered: 0, remaining: 1, timedOut: false })
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, remaining: 0, timedOut: false });
    installFetch(
      fetchResolving(200, {
        id: 'account-a',
        device_id: 'device-a',
        token: 'fresh-a',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    const result = await auth.loginEmail({ email: 'a@example.com', password: 'pw' });

    expect(result.ok).toBe(true);
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'fresh-a',
      authenticated: true,
    });
    expect(mockFlushBeerPhotoDeletions).toHaveBeenNthCalledWith(2, {
      session: expect.objectContaining({ accountId: 'account-a', token: 'fresh-a' }),
      preferProvidedSession: true,
    });
  });

  it('sends a late anonymous A deletion with incoming B before installing B', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'anon-device',
      accountId: 'anonymous-a',
      token: 'anonymous-token',
      authenticated: false,
    });
    mockFlushMergedBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 1,
      delivered: 1,
      remaining: 0,
      timedOut: false,
    });
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        device_id: 'device-b',
        token: 'token-b',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    const result = await auth.loginEmail({ email: 'b@example.com', password: 'pw' });

    expect(result.ok).toBe(true);
    expect(mockFlushMergedBeerPhotoDeletions).toHaveBeenCalledWith(
      'anonymous-a',
      'account-b',
      expect.objectContaining({ accountId: 'account-b', token: 'token-b' }),
      { strictPreflightClean: true },
    );
    expect(mockPromotePartyGameMerge.mock.invocationCallOrder[0]).toBeLessThan(
      mockFlushMergedBeerPhotoDeletions.mock.invocationCallOrder[0],
    );
    expect(mockFlushMergedBeerPhotoDeletions.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockFlushBeerPhotoDeletions).toHaveBeenNthCalledWith(2, {
      session: expect.objectContaining({ accountId: 'account-b', token: 'token-b' }),
      preferProvidedSession: true,
    });
  });

  it('does not install B when merge tombstone storage becomes unreadable after the response', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'anon-device',
      accountId: 'anonymous-a',
      token: 'anonymous-token',
      authenticated: false,
    });
    mockFlushMergedBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 0,
      delivered: 0,
      remaining: 0,
      timedOut: false,
      storageError: true,
    });
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'photo_deletions_storage' }),
    );
    expect(mockPromotePartyGameMerge).toHaveBeenCalledTimes(1);
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockFinalizePartyGameMerge).not.toHaveBeenCalled();
  });

  it('blocks an anonymous merge before fetch when strict preflight is unknown', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'anon-device',
      accountId: 'anonymous-a',
      token: 'anonymous-token',
      authenticated: false,
    });
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 0,
      delivered: 0,
      remaining: 0,
      timedOut: false,
      storageError: true,
    });
    const spy = installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual({
      ok: false,
      code: 'photo_deletions_storage',
      detail: expect.stringContaining('bezpečně převést'),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockFlushMergedBeerPhotoDeletions).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });

  it('blocks login when no owner session exists and deletion storage is unknown', async () => {
    mockEnsureAccount.mockResolvedValueOnce(null);
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 0,
      delivered: 0,
      remaining: 0,
      timedOut: false,
      storageError: true,
    });
    const spy = installFetch(
      fetchResolving(200, { id: 'account-b', token: 'token-b', is_anonymous: false }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'photo_deletions_storage' }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });

  it('establishes B deletion before a failed SecureStore write', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'anon-device',
      accountId: 'anonymous-a',
      token: 'anonymous-token',
      authenticated: false,
    });
    mockFlushMergedBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 1,
      delivered: 1,
      remaining: 0,
      timedOut: false,
    });
    mockSetSession.mockRejectedValueOnce(new Error('Keychain unavailable'));
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        device_id: 'device-b',
        token: 'token-b',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, code: 'session_storage' }));
    expect(mockFlushMergedBeerPhotoDeletions).toHaveBeenCalledTimes(1);
    expect(mockFlushMergedBeerPhotoDeletions.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockFinalizePartyGameMerge).not.toHaveBeenCalled();
    expect(mockCancelPartyGameMerge).not.toHaveBeenCalled();
  });

  it('returns invalid_credentials on a 401', async () => {
    installFetch(fetchResolving(401, { detail: 'Špatný e-mail nebo heslo.', code: 'invalid_credentials' }));

    const result = await auth.loginEmail({ email: 'jan@example.com', password: 'bad' });

    expect(result).toEqual({
      ok: false,
      code: 'invalid_credentials',
      detail: 'Špatný e-mail nebo heslo.',
    });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_login', {
      endpoint: '/v1/auth/login',
      status: 401,
      reason: 'login_invalid_credentials',
    });
    expect(mockCancelPartyGameMerge).toHaveBeenCalledWith('a', MERGE_OPERATION_ID);
  });

  it('reports a server-side login failure without retrying the claim', async () => {
    const spy = installFetch(fetchResolving(503, { detail: 'Zkus to později.' }));

    await expect(auth.loginEmail({ email: 'jan@example.com', password: 'pw' })).resolves.toEqual({
      ok: false,
      code: 'http_503',
      detail: 'Zkus to později.',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_login', {
      endpoint: '/v1/auth/login',
      status: 503,
      reason: 'login_server_error',
    });
    expect(mockCancelPartyGameMerge).not.toHaveBeenCalled();
  });

  it('never cancels a recovered merge operation after a target-conflict 4xx', async () => {
    mockPreflightPartyGameMerge.mockResolvedValueOnce({
      operationId: MERGE_OPERATION_ID,
      cancelSafe: false,
    });
    installFetch(
      fetchResolving(409, {
        detail: 'Přihlášení patří k jinému dokončenému sloučení.',
        code: 'merge_operation_target_mismatch',
      }),
    );

    await expect(
      auth.loginEmail({ email: 'other@example.com', password: 'pw' }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'merge_operation_target_mismatch',
      }),
    );
    expect(mockCancelPartyGameMerge).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signInWithGoogle
// ---------------------------------------------------------------------------
describe('signInWithGoogle', () => {
  it('sends the Google id_token to /v1/auth/google (claim) and stores the session', async () => {
    const spy = installFetch(
      fetchResolving(200, { id: 'g-acc', token: 'g-tok', is_anonymous: false, providers: ['google'] }),
    );

    const result = await auth.signInWithGoogle();

    expect(result.ok).toBe(true);
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/google');
    expect(authHeader(init)).toBe('Bearer anon-tok'); // bearer: 'ensure'
    expect(bodyOf(init)).toEqual({
      id_token: 'gtok',
      merge_operation_id: MERGE_OPERATION_ID,
    });
    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockFlushBeerPhotoDeletions.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[0],
    );
  });

  it('returns {cancelled} and never calls fetch when the user dismisses the picker', async () => {
    mockGetGoogleIdToken.mockRejectedValueOnce(new SocialAuthError('cancelled'));
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.signInWithGoogle();

    expect(result).toEqual({ ok: false, code: 'cancelled', detail: '' });
    expect(spy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('maps an unsupported SocialAuthError to a friendly message', async () => {
    mockGetGoogleIdToken.mockRejectedValueOnce(new SocialAuthError('unsupported'));
    installFetch(fetchResolving(200, {}));

    const result = await auth.signInWithGoogle();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('unsupported');
    expect(result.detail).toBe('Tato možnost není na tomto zařízení dostupná.');
  });

  it('surfaces and records a release OAuth configuration error', async () => {
    mockGetGoogleIdToken.mockRejectedValueOnce(new SocialAuthError('misconfigured'));
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.signInWithGoogle();

    expect(result).toEqual({
      ok: false,
      code: 'misconfigured',
      detail: 'Google přihlášení teď není správně nastavené. Zkus zatím přihlášení e-mailem.',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('social_auth', {
      reason: 'google_misconfigured',
      error: expect.any(SocialAuthError),
    });
  });
});

// ---------------------------------------------------------------------------
// signInWithApple
// ---------------------------------------------------------------------------
describe('signInWithApple', () => {
  it('sends identity_token / authorization_code / full_name to /v1/auth/apple', async () => {
    const spy = installFetch(
      fetchResolving(200, { id: 'a-acc', token: 'a-tok', is_anonymous: false, providers: ['apple'] }),
    );

    const result = await auth.signInWithApple();

    expect(result.ok).toBe(true);
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/apple');
    expect(authHeader(init)).toBe('Bearer anon-tok');
    expect(bodyOf(init)).toEqual({
      identity_token: 'atok',
      authorization_code: 'code',
      full_name: 'Jan Novák',
      merge_operation_id: MERGE_OPERATION_ID,
    });
    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });

  it('returns {cancelled} without calling fetch when Apple is dismissed', async () => {
    mockGetAppleCredential.mockRejectedValueOnce(new SocialAuthError('cancelled'));
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.signInWithApple();

    expect(result).toEqual({ ok: false, code: 'cancelled', detail: '' });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Network / dormant-endpoint handling
// ---------------------------------------------------------------------------
describe('network handling', () => {
  it('returns the network sentinel when fetch rejects', async () => {
    installFetch(jest.fn().mockRejectedValue(new Error('connection refused')));

    const result = await auth.loginEmail({ email: 'a@b.cz', password: 'pw' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('returns the network sentinel when no backend endpoint is configured', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.loginEmail({ email: 'a@b.cz', password: 'pw' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// unlinkProvider
// ---------------------------------------------------------------------------
describe('unlinkProvider', () => {
  it('returns the updated profile on success (authenticated call, session unchanged)', async () => {
    const spy = installFetch(
      fetchResolving(200, { id: 'acc', is_anonymous: false, providers: ['google'] }),
    );

    const result = await auth.unlinkProvider('apple');

    expect(result.ok).toBe(true);
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/unlink');
    expect(authHeader(init)).toBe('Bearer cur-tok'); // bearer: 'current'
    expect(bodyOf(init)).toEqual({ provider: 'apple' });
    // Unlink never rotates the session token.
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('surfaces last_credential when unlinking the only credential is blocked', async () => {
    installFetch(
      fetchResolving(400, { detail: 'Nelze odebrat poslední přihlašovací metodu.', code: 'last_credential' }),
    );

    const result = await auth.unlinkProvider('email');

    expect(result).toEqual({
      ok: false,
      code: 'last_credential',
      detail: 'Nelze odebrat poslední přihlašovací metodu.',
    });
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------
describe('logout', () => {
  it('keeps A when its device push binding cannot be disabled', async () => {
    mockDisableCachedPushDeviceWithBearer.mockResolvedValueOnce(false);
    const spy = installFetch(fetchResolving(200, {}));

    await expect(auth.logout()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'session_storage' }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });

  it('calls /v1/auth/logout then reverts to anonymous, returning ok', async () => {
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.logout();

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/logout');
    expect(authHeader(init)).toBe('Bearer cur-tok');
    expect(bodyOf(init)).toEqual({ all: false });
    expect(mockDisableCachedPushDeviceWithBearer).toHaveBeenCalledWith('anon-tok');
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockFlushBeerPhotoDeletions).toHaveBeenCalledTimes(1);
    expect(mockFlushBeerPhotoDeletions.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[0],
    );
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });

  it('passes all:true through', async () => {
    const spy = installFetch(fetchResolving(200, {}));
    await auth.logout({ all: true });
    expect(bodyOf(firstCall(spy).init)).toEqual({ all: true });
  });

  it('still reverts to anonymous (and returns ok) when the request fails', async () => {
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const result = await auth.logout();

    expect(result).toEqual({ ok: true });
    expect(mockDisableCachedPushDeviceWithBearer).toHaveBeenCalledWith('anon-tok');
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockFlushBeerPhotoDeletions).toHaveBeenCalledTimes(1);
    expect(mockFlushBeerPhotoDeletions.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearLocalPrivateAccountData.mock.invocationCallOrder[0],
    );
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });

  it('clears A caches but keeps its credential when offline logout cannot remove it, then retries', async () => {
    const outgoingSession = {
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    };
    mockEnsureAccount.mockResolvedValue(outgoingSession);
    mockRevertToAnonymous.mockImplementationOnce(async (_signal, beforeSessionCleared) => {
      await beforeSessionCleared?.();
      throw new Error('Keychain unavailable');
    });
    const spy = installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    await expect(auth.logout()).resolves.toEqual({
      ok: false,
      code: 'session_storage',
      detail: expect.stringContaining('bezpečně'),
    });
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
      outgoingSession,
    });
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_session_clear', {
      reason: 'secure_store',
      errorName: 'Error',
    });

    await expect(auth.logout()).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(2);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
      outgoingSession,
    });
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(2);
  });

  it('does not let logout remove A credential after an incomplete durable clear', async () => {
    mockClearLocalPrivateAccountData.mockResolvedValueOnce({
      ok: false,
      code: 'storage',
      failedOperations: ['remove:na-pivo-tally'],
    });
    installFetch(fetchResolving(200, {}));

    await expect(auth.logout()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'session_storage' }),
    );
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
  });

  it('keeps the current session and private data when photo deletions remain', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 1,
      delivered: 0,
      remaining: 1,
      timedOut: true,
    });
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.logout();

    expect(result).toEqual({
      ok: false,
      code: 'photo_deletions_pending',
      detail: expect.stringContaining('Připoj se k internetu'),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(mockDisableCachedPushDeviceWithBearer).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('fails closed when tombstone storage is unreadable during logout', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 0,
      delivered: 0,
      remaining: 0,
      timedOut: false,
      storageError: true,
    });
    const spy = installFetch(fetchResolving(200, {}));

    await expect(auth.logout()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'photo_deletions_storage' }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('never rejects when session preflight throws during logout', async () => {
    mockEnsureAccount.mockRejectedValueOnce(new Error('SecureStore unavailable'));

    await expect(auth.logout()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'session_storage' }),
    );
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------
describe('recoverPendingAccountDeletionAtStartup', () => {
  const operationId = '00000000-0000-4000-8000-000000000001';
  const outgoingSession = {
    deviceId: 'device-a',
    accountId: 'account-a',
    token: 'revoked-token-a',
    authenticated: true,
  };

  it('clears a crash-lost deleted account before its cached session can be published', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'pending',
      },
      orphans: [],
    });
    const spy = installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('recovered');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith(
      'account-a',
      operationId,
    );
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
      outgoingSession,
    });
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith(
      'account-a',
      operationId,
    );
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });

  it.each([
    ['incomplete', fetchResolving(200, { complete: false })],
    ['unavailable', jest.fn().mockRejectedValue(new Error('offline'))],
  ])('keeps A intact while the deletion proof is %s', async (_label, fetchMock) => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
      },
      orphans: [],
    });
    installFetch(fetchMock);

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('deferred');

    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });

  it('blocks publication when a proven deletion cannot clear private storage', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
      },
      orphans: [],
    });
    mockClearLocalPrivateAccountData.mockResolvedValueOnce({
      ok: false,
      code: 'storage',
      failedOperations: ['remove:na-pivo-tally'],
    });
    installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');

    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });

  it('blocks publication when status is unavailable and SecureStore has no readable owner', async () => {
    mockEnsureAccount.mockResolvedValueOnce(null);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
      },
      orphans: [],
    });
    installFetch(jest.fn().mockRejectedValueOnce(new Error('offline and keychain locked')));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');

    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });
});

describe('deleteAccount', () => {
  const operationId = '00000000-0000-4000-8000-000000000001';
  const pendingIntent = {
    accountId: 'a',
    operationId,
    phase: 'pending' as const,
  };
  const completeIntent = { ...pendingIntent, phase: 'complete' as const };

  it('probes and retires every orphan beyond the first concurrency window', async () => {
    const orphans = Array.from({ length: 6 }, (_, index) => ({
      accountId: `deleted-account-${index + 1}`,
      operationId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      phase: 'pending' as const,
      archivedAt: index + 1,
    }));
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: null,
      orphans,
    });
    const spy = installFetch(jest.fn(async (url: string) =>
      url.endsWith('/v1/account/deletion-status')
        ? {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ complete: true }),
          }
        : { ok: true, status: 204, text: async () => '' },
    ));

    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy.mock.calls.filter(([url]) =>
      url === 'https://api.test/v1/account/deletion-status'
    )).toHaveLength(6);
    expect(mockRetireAccountDeletionOrphan).toHaveBeenCalledTimes(6);
    expect(mockRetireAccountDeletionOrphan).toHaveBeenCalledWith(
      'deleted-account-6',
      orphans[5].operationId,
    );
  });

  it('persists an operation before DELETE, sends it only in a header, and completes the local boundary on 204', async () => {
    const spy = installFetch(fetchResolving(204, undefined));

    const result = await auth.deleteAccount();

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/account/me');
    expect(url).not.toContain(operationId);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(authHeader(init)).toBe('Bearer cur-tok');
    expect((init.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationId,
    );
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockWriteAccountDeletionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[0],
    );
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
  });

  it('keeps a pending intent and does not rotate the credential on a non-204 failure', async () => {
    installFetch(fetchResolving(403, { detail: 'Nelze smazat účet.', code: 'forbidden' }));

    const result = await auth.deleteAccount();

    expect(result).toEqual({ ok: false, code: 'forbidden', detail: 'Nelze smazat účet.' });
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('keeps a pending intent and does not rotate the credential when the DELETE response is lost', async () => {
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const result = await auth.deleteAccount();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('does not send account DELETE while a photo tombstone is pending', async () => {
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 1,
      delivered: 0,
      remaining: 1,
      timedOut: true,
    });
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'photo_deletions_pending' }),
    );

    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(spy).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('does not send account DELETE when photo tombstone storage is unreadable', async () => {
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 0,
      delivered: 0,
      remaining: 0,
      timedOut: false,
      storageError: true,
    });
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'photo_deletions_storage' }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('recovers a lost 204 from the public status proof without repeating DELETE', async () => {
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] })
      .mockResolvedValueOnce({ ok: true, intent: pendingIntent, orphans: [] });
    const spy = installFetch(
      jest
        .fn()
        .mockRejectedValueOnce(new Error('connection reset after commit'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: true }),
        }),
    );

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'network' }),
    );
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/me');
    expect(spy.mock.calls[1][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(spy.mock.calls[1][0]).not.toContain(operationId);
    expect((spy.mock.calls[1][1].headers as Record<string, string>)[
      'X-Account-Deletion-Operation-Id'
    ]).toBe(operationId);
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });

  it('recovers when 204 arrived but upgrading the pending intent failed locally', async () => {
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] })
      .mockResolvedValueOnce({ ok: true, intent: pendingIntent, orphans: [] });
    mockCompleteAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: false, storageError: true })
      .mockResolvedValueOnce({ ok: true });
    const spy = installFetch(
      jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: true }),
        }),
    );

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.filter(([url]) => url === 'https://api.test/v1/account/me')).toHaveLength(1);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });

  it('finishes the local boundary only after re-proving a matching complete intent', async () => {
    const outgoingSession = {
      deviceId: 'device-a',
      accountId: 'a',
      token: 'revoked-token-a',
      authenticated: true,
    };
    mockEnsureAccount.mockResolvedValue(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: completeIntent,
      orphans: [],
    });
    const spy = installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
      outgoingSession,
    });
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
  });

  it('repeats DELETE when credential reactivation invalidated a stale complete proof', async () => {
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: completeIntent,
      orphans: [],
    });
    const spy = installFetch(
      jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: false }),
        })
        .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' }),
    );

    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(spy.mock.calls[1][0]).toBe('https://api.test/v1/account/me');
    expect((spy.mock.calls[1][1].headers as Record<string, string>)[
      'X-Account-Deletion-Operation-Id'
    ]).toBe(operationId);
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });

  it('deletes on the server again after lost local cleanup, reauthentication, and proof invalidation', async () => {
    const sessionA = {
      deviceId: 'device-a',
      accountId: 'a',
      token: 'old-token-a',
      authenticated: true,
    };
    mockEnsureAccount.mockResolvedValue(sessionA);
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] })
      .mockResolvedValueOnce({ ok: true, intent: completeIntent, orphans: [] });
    mockClearLocalPrivateAccountData.mockResolvedValueOnce({
      ok: false,
      code: 'storage',
      failedOperations: ['remove:na-pivo-tally'],
    });
    const spy = installFetch(
      jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: 'a',
            token: 'fresh-token-a',
            is_anonymous: false,
            providers: ['email'],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: false }),
        })
        .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' }),
    );

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'session_storage' }),
    );
    await expect(
      auth.loginEmail({ email: 'a@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/v1/account/me',
      'https://api.test/v1/auth/login',
      'https://api.test/v1/account/deletion-status',
      'https://api.test/v1/account/me',
    ]);
    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: undefined,
      accountId: 'a',
      token: 'fresh-token-a',
      authenticated: true,
    });
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledTimes(2);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
  });

  it('never treats a generic 401 as proof after status says the pending operation is incomplete', async () => {
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: pendingIntent,
      orphans: [],
    });
    const spy = installFetch(
      jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: false }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({
            detail: 'Přihlášení vypršelo.',
            code: 'auth',
          }),
        }),
    );

    await expect(auth.deleteAccount()).resolves.toEqual({
      ok: false,
      code: 'auth',
      detail: 'Přihlášení vypršelo.',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('fails closed when the receipt cannot be read', async () => {
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: false,
      storageError: true,
    });
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('never rejects when durable deletion storage unexpectedly throws', async () => {
    mockReadAccountDeletionReceipt.mockRejectedValueOnce(
      new Error('AsyncStorage unavailable'),
    );

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );
    expect(isBeerPhotoSessionFrozen()).toBe(false);
  });

  it('does not send DELETE when the pending intent cannot be written and verified', async () => {
    mockWriteAccountDeletionReceipt.mockResolvedValueOnce({ ok: false, storageError: true });
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('does not change local state when status proof is unavailable', async () => {
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: pendingIntent,
      orphans: [],
    });
    const spy = installFetch(jest.fn().mockRejectedValueOnce(new Error('offline')));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'network' }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('recovers an orphaned pending A intent after the durable session moved to anonymous B', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-b',
      accountId: 'anonymous-b',
      token: 'anonymous-token-b',
      authenticated: false,
    });
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: { ...pendingIntent, accountId: 'deleted-account-a' },
      orphans: [],
    });
    const spy = installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith(
      'deleted-account-a',
      operationId,
    );
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith(
      'deleted-account-a',
      operationId,
    );
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('archives a still-pending A operation, never deletes B on that tap, and frees B for a later confirmation', async () => {
    const accountB = {
      deviceId: 'device-b',
      accountId: 'account-b',
      token: 'token-b',
      authenticated: true,
    };
    const operationB = '00000000-0000-4000-8000-000000000002';
    mockEnsureAccount.mockResolvedValue(accountB);
    mockGenerateUuidV4.mockReturnValueOnce(operationB);
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({
        ok: true,
        intent: { ...pendingIntent, accountId: 'deleted-account-a' },
        orphans: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        intent: null,
        orphans: [
          {
            ...pendingIntent,
            accountId: 'deleted-account-a',
            archivedAt: 1,
          },
        ],
      });
    const spy = installFetch(
      jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ complete: false }),
        })
        .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' }),
    );

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_recovered' }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith(
      'deleted-account-a',
      operationId,
    );
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();

    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2][0]).toBe('https://api.test/v1/account/me');
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith(
      'account-b',
      operationB,
    );
    expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
  });

  it('retries receipt cleanup after the local boundary succeeded but cleanup failed', async () => {
    mockEnsureAccount
      .mockResolvedValueOnce({
        deviceId: 'device-a',
        accountId: 'account-a',
        token: 'token-a',
        authenticated: true,
      })
      .mockResolvedValueOnce({
        deviceId: 'device-b',
        accountId: 'anonymous-b',
        token: 'anonymous-token-b',
        authenticated: false,
      });
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] })
      .mockResolvedValueOnce({
        ok: true,
        intent: { ...completeIntent, accountId: 'account-a' },
        orphans: [],
      });
    mockClearAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: false, storageError: true })
      .mockResolvedValueOnce({ ok: true });
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledTimes(2);
  });

  it('cleans an orphaned complete A intent but requires a second confirmation before deleting authenticated B', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-b',
      accountId: 'account-b',
      token: 'token-b',
      authenticated: true,
    });
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: { ...completeIntent, accountId: 'deleted-account-a' },
      orphans: [],
    });
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_recovered' }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith(
      'deleted-account-a',
      operationId,
    );
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('retains the complete intent when private clearing fails and re-proves it on retry', async () => {
    const outgoingSession = {
      deviceId: 'device-a',
      accountId: 'a',
      token: 'token-a',
      authenticated: true,
    };
    mockEnsureAccount.mockResolvedValue(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValue({
      ok: true,
      intent: completeIntent,
      orphans: [],
    });
    mockClearLocalPrivateAccountData
      .mockResolvedValueOnce({
        ok: false,
        code: 'storage',
        failedOperations: ['remove:na-pivo-tally'],
      })
      .mockResolvedValueOnce({ ok: true });
    const spy = installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'session_storage' }),
    );
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.every(([url]) =>
      url === 'https://api.test/v1/account/deletion-status'
    )).toBe(true);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// requestPasswordReset
// ---------------------------------------------------------------------------
describe('requestPasswordReset', () => {
  it('returns ok for the backend 202 no-enumeration response', async () => {
    const spy = installFetch(fetchResolving(202, {}));

    const result = await auth.requestPasswordReset('jan@example.com');

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/request-password-reset');
    expect(authHeader(init)).toBeUndefined();
    expect(bodyOf(init)).toEqual({ email: 'jan@example.com' });
  });

  it('returns the backend error when the reset email cannot be requested', async () => {
    installFetch(fetchResolving(500, { detail: 'Pošta teď nefunguje.', code: 'mail_failed' }));

    const result = await auth.requestPasswordReset('jan@example.com');

    expect(result).toEqual({ ok: false, code: 'mail_failed', detail: 'Pošta teď nefunguje.' });
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------
describe('resetPassword', () => {
  it('exchanges the token for a fresh session after clearing local private data on success', async () => {
    const spy = installFetch(
      fetchResolving(200, { id: 'acc-r', token: 'reset-tok', is_anonymous: false, providers: ['email'] }),
    );

    const result = await auth.resetPassword({ token: 'reset-link-token', password: 'newpw' });

    expect(result.ok).toBe(true);
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/reset-password');
    expect(authHeader(init)).toBeUndefined(); // bearer: 'none'
    expect(bodyOf(init)).toEqual({ token: 'reset-link-token', password: 'newpw' });
    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: undefined,
      accountId: 'acc-r',
      token: 'reset-tok',
      authenticated: true,
    });
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockFlushBeerPhotoDeletions).toHaveBeenCalledTimes(3);
    expect(mockFlushBeerPhotoDeletions.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearLocalPrivateAccountData.mock.invocationCallOrder[0],
    );
    expect(mockClearLocalPrivateAccountData.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSession.mock.invocationCallOrder[0],
    );
  });

  it('does not install the reset account when unrelated private storage cannot clear', async () => {
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    });
    mockClearLocalPrivateAccountData.mockResolvedValueOnce({
      ok: false,
      code: 'storage',
      failedOperations: ['verify_settings_home_point'],
    });
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'reset-b',
        is_anonymous: false,
        providers: ['email'],
      }),
    );

    await expect(
      auth.resetPassword({ token: 'reset-link-token', password: 'newpw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, code: 'session_storage' }));
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('blocks reset before fetch when no owner session exists and deletion storage is unknown', async () => {
    mockEnsureAccount.mockResolvedValueOnce(null);
    mockFlushBeerPhotoDeletions.mockResolvedValueOnce({
      attempted: 0,
      delivered: 0,
      remaining: 0,
      timedOut: false,
      storageError: true,
    });
    const spy = installFetch(
      fetchResolving(200, { id: 'account-b', token: 'reset-b', is_anonymous: false }),
    );

    await expect(
      auth.resetPassword({ token: 'reset-link-token', password: 'newpw' }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'photo_deletions_storage' }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });

  it('returns the error on an invalid/expired token (400)', async () => {
    installFetch(fetchResolving(400, { detail: 'Odkaz vypršel.', code: 'invalid_token' }));

    const result = await auth.resetPassword({ token: 'expired', password: 'newpw' });

    expect(result).toEqual({ ok: false, code: 'invalid_token', detail: 'Odkaz vypršel.' });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// verifyEmail
// ---------------------------------------------------------------------------
describe('verifyEmail', () => {
  it('returns ok on success', async () => {
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.verifyEmail('verify-token');

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/verify-email');
    expect(authHeader(init)).toBeUndefined(); // bearer: 'none'
    expect(bodyOf(init)).toEqual({ token: 'verify-token' });
  });

  it('returns the error on a bad token (400)', async () => {
    installFetch(fetchResolving(400, { detail: 'Neplatný odkaz.', code: 'invalid_token' }));

    const result = await auth.verifyEmail('bad');

    expect(result).toEqual({ ok: false, code: 'invalid_token', detail: 'Neplatný odkaz.' });
  });
});

// ---------------------------------------------------------------------------
// requestEmailVerification
// ---------------------------------------------------------------------------
describe('requestEmailVerification', () => {
  it('requests a verification email with the current bearer token', async () => {
    const spy = installFetch(fetchResolving(202, {}));

    const result = await auth.requestEmailVerification();

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/request-email-verify');
    expect(authHeader(init)).toBe('Bearer cur-tok');
    expect(bodyOf(init)).toEqual({});
  });

  it('returns the backend error when verification email cannot be requested', async () => {
    installFetch(fetchResolving(429, { detail: 'Zkus to za chvíli.', code: 'rate_limited' }));

    const result = await auth.requestEmailVerification();

    expect(result).toEqual({ ok: false, code: 'rate_limited', detail: 'Zkus to za chvíli.' });
  });
});

// ---------------------------------------------------------------------------
// exportAccountData
// ---------------------------------------------------------------------------
describe('exportAccountData', () => {
  it('requests the backend email export with the current bearer token', async () => {
    const spy = installFetch(fetchResolving(202, {}));

    const result = await auth.exportAccountData();

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/account/export');
    expect(init.method).toBe('POST');
    expect(authHeader(init)).toBe('Bearer cur-tok');
    expect(bodyOf(init)).toEqual({});
  });

  it('returns the backend error when export email cannot be requested', async () => {
    installFetch(fetchResolving(400, { detail: 'K účtu nemáme e-mail.', code: 'missing_email' }));

    const result = await auth.exportAccountData();

    expect(result).toEqual({
      ok: false,
      code: 'missing_email',
      detail: 'K účtu nemáme e-mail.',
    });
  });
});

// ---------------------------------------------------------------------------
// validateAccountSession — foreground credential check
// ---------------------------------------------------------------------------
describe('validateAccountSession', () => {
  const session = {
    deviceId: 'dev-1',
    accountId: 'acc-1',
    token: 'session-token',
    authenticated: true,
  };

  it('returns the refreshed profile for a valid credential', async () => {
    const spy = installFetch(
      fetchResolving(200, {
        id: 'acc-1',
        device_id: 'dev-1',
        nickname: 'jan',
        display_name: 'Jan',
        is_anonymous: false,
        status: 'active',
      }),
    );

    const result = await auth.validateAccountSession(session);

    expect(result).toMatchObject({
      status: 'valid',
      profile: { id: 'acc-1', nickname: 'jan', displayName: 'Jan', isAnonymous: false },
    });
    expect(authHeader(firstCall(spy).init)).toBe('Bearer session-token');
    expect(mockGetSessionToken).not.toHaveBeenCalled();
  });

  it('reports only an explicit 401 as an invalid credential', async () => {
    installFetch(fetchResolving(401, { detail: 'Account token has expired.' }));

    await expect(auth.validateAccountSession(session)).resolves.toEqual({ status: 'invalid' });
    expect(mockTrackApiFailure).not.toHaveBeenCalled();
  });

  it.each([500, 503])('keeps HTTP %s separate from invalid credentials', async (status) => {
    installFetch(fetchResolving(status, { detail: 'Server unavailable.' }));

    await expect(auth.validateAccountSession(session)).resolves.toEqual({
      status: 'unavailable',
    });
  });
});

// ---------------------------------------------------------------------------
// fetchAccountProfile — parseMapper + extended parseAchievements (spec §5)
// ---------------------------------------------------------------------------
describe('fetchAccountProfile — Mapér block + new badges', () => {
  it('parses the mapper block (xp key, levels, xp_rules) and the 5 new badges', async () => {
    installFetch(
      fetchResolving(200, {
        id: 'acc',
        is_anonymous: false,
        achievements: {
          first_ten: true,
          regular: false,
          reviewer: false,
          first_map: true,
          explorer: true,
          cartographer: false,
          completionist: true,
          fact_machine: false,
          first_beer: true,
          century: false,
          pilgrim: false,
          stamgast: true,
          night_owl: true,
          taster: false,
          party_animal: false,
        },
        mapper: {
          xp: 285,
          level: 3,
          title: 'Štamgast',
          xp_into_level: 135,
          xp_for_next_level: 250,
          amenity_votes_count: 41,
          distinct_mapped_pubs: 9,
          first_mapper_count: 3,
          completed_pubs_count: 1,
          levels: [
            { level: 1, title: 'Nováček', xp: 0 },
            { level: 2, title: 'Všímálek', xp: 300 },
            { level: 3, title: 'Štamgast', xp: 900 },
            { level: 4, title: 'Znalec', xp: 2500 },
            { level: 5, title: 'Hospodský mudrc', xp: 6000 },
          ],
          xp_rules: { first_fact: 15, first_mapper_bonus: 25, confirm: 5, pub_complete_bonus: 30 },
        },
      }),
    );

    const profile = await auth.fetchAccountProfile();
    expect(profile).not.toBeNull();
    expect(profile?.achievements).toEqual({
      firstTen: true,
      regular: false,
      reviewer: false,
      firstMap: true,
      explorer: true,
      cartographer: false,
      completionist: true,
      factMachine: false,
      fotoPivar: false,
      chatar: false,
      podSirakem: false,
      lahvacovyFilozof: false,
      plechovkac: false,
      firstBeer: true,
      century: false,
      pilgrim: false,
      stamgast: true,
      nightOwl: true,
      taster: false,
      partyAnimal: false,
    });
    expect(profile?.mapper).toEqual({
      xp: 285,
      level: 3,
      title: 'Štamgast',
      xpIntoLevel: 135,
      xpForNextLevel: 250,
      amenityVotesCount: 41,
      distinctMappedPubs: 9,
      firstMapperCount: 3,
      completedPubsCount: 1,
      levels: [
        { level: 1, title: 'Nováček', xp: 0 },
        { level: 2, title: 'Všímálek', xp: 300 },
        { level: 3, title: 'Štamgast', xp: 900 },
        { level: 4, title: 'Znalec', xp: 2500 },
        { level: 5, title: 'Hospodský mudrc', xp: 6000 },
      ],
      xpRules: { firstFact: 15, firstMapperBonus: 25, confirm: 5, pubCompleteBonus: 30 },
    });
  });

  it('tolerates an absent mapper block and missing new-badge fields', async () => {
    installFetch(
      fetchResolving(200, {
        id: 'acc',
        is_anonymous: false,
        achievements: { first_ten: true },
      }),
    );

    const profile = await auth.fetchAccountProfile();
    // The old badges keep working; the new ones default to false; mapper is absent.
    expect(profile?.achievements).toEqual({
      firstTen: true,
      regular: false,
      reviewer: false,
      firstMap: false,
      explorer: false,
      cartographer: false,
      completionist: false,
      factMachine: false,
      fotoPivar: false,
      chatar: false,
      podSirakem: false,
      lahvacovyFilozof: false,
      plechovkac: false,
      firstBeer: false,
      century: false,
      pilgrim: false,
      stamgast: false,
      nightOwl: false,
      taster: false,
      partyAnimal: false,
    });
    expect(profile?.mapper).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// uploadAvatar
// ---------------------------------------------------------------------------
describe('uploadAvatar', () => {
  /** Resolve File.upload to a {status, body, headers} result like the native module. */
  function uploadResolving(status: number, body: unknown): void {
    mockFileUpload.mockResolvedValue({
      status,
      body: body === undefined ? '' : JSON.stringify(body),
      headers: {},
    });
  }

  it('uploads via the native multipart uploader (NOT fetch) and returns the parsed profile', async () => {
    uploadResolving(200, { id: 'acc', is_anonymous: false, avatar_url: 'https://cdn/x.webp' });
    const fetchSpy = installFetch(jest.fn());

    const result = await auth.uploadAvatar('file:///tmp/avatar.jpg');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.avatarUrl).toBe('https://cdn/x.webp');

    // The legacy fetch+FormData path must never be taken (it throws under SDK 56).
    expect(fetchSpy).not.toHaveBeenCalled();

    // File constructed from the local URI; upload targets the avatar endpoint as
    // a multipart POST with field `avatar` and the current bearer token.
    expect(mockFileCtor).toHaveBeenCalledWith('file:///tmp/avatar.jpg');
    const [url, opts] = mockFileUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.test/v1/account/me/avatar');
    expect(opts.httpMethod).toBe('POST');
    expect(opts.uploadType).toBe(efs.UploadType.MULTIPART);
    expect(opts.fieldName).toBe('avatar');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer cur-tok');
  });

  it('returns unauthenticated and never uploads when there is no session token', async () => {
    mockGetSessionToken.mockResolvedValueOnce(null);

    const result = await auth.uploadAvatar('file:///tmp/avatar.jpg');

    expect(result).toEqual({ ok: false, code: 'unauthenticated', detail: '' });
    expect(mockFileUpload).not.toHaveBeenCalled();
  });

  it('maps a non-2xx upload response to the error payload', async () => {
    uploadResolving(413, { detail: 'Obrázek je příliš velký.', code: 'too_large' });

    const result = await auth.uploadAvatar('file:///tmp/avatar.jpg');

    expect(result).toEqual({ ok: false, code: 'too_large', detail: 'Obrázek je příliš velký.' });
  });

  it('returns the network sentinel and tracks the failure when the upload throws', async () => {
    mockFileUpload.mockRejectedValue(new Error('Unsupported FormDataPart implementation'));

    const result = await auth.uploadAvatar('file:///tmp/avatar.jpg');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(mockTrackApiFailure).toHaveBeenCalledWith(
      'auth_request',
      expect.objectContaining({ endpoint: '/v1/account/me/avatar', reason: 'exception' }),
    );
  });

  it('returns the network sentinel when no backend endpoint is configured', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);

    const result = await auth.uploadAvatar('file:///tmp/avatar.jpg');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(mockFileUpload).not.toHaveBeenCalled();
  });
});
