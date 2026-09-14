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
import type { AccountSession } from '@/data/account';
import type { StartupAccountDeletionRecoveryResult } from '@/data/auth';
import {
  ensureAccount,
  ensureCredentialBindingForSession,
  generateUuidV4,
  getSessionToken,
  revertToAnonymous,
  setSession,
} from '@/data/account';
import { getBackendEndpoint } from '@/data/backendConfig';
import {
  clearLocalPrivateAccountData,
  rehydratePrivateStoresAfterBoundary,
} from '@/data/privateAccountData';
import {
  flushBeerPhotoDeletionsForAccountMerge,
  flushBeerPhotoDeletionsBeforeSessionEnd,
} from '@/data/beerPhotoDeletionSync';
import {
  isBeerPhotoSessionFrozen,
  resetBeerPhotoSessionBoundaryForTests,
  subscribeBeerPhotoSessionBoundary,
} from '@/data/beerPhotoSessionBoundary';
import {
  archiveAccountDeletionReceipt,
  clearAccountDeletionReceipt,
  completeAccountDeletionReceipt,
  readAccountDeletionReceipt,
  retireAccountDeletionOrphan,
  retireQuarantinedAccountDeletionReceipt,
  writeAccountDeletionReceipt,
} from '@/data/accountDeletionReceipt';
import type { AccountDeletionIntent } from '@/data/accountDeletionReceipt';
import {
  setPrivateAccountDeletionRecoveryBlocked,
  setPrivateAccountRehydrationRecoveryBlocked,
} from '@/data/privateAccountBoundary';
import {
  disableCachedPushDeviceWithBearer,
  registerCachedPushDeviceWithBearer,
} from '@/data/pushDeviceClient';
import {
  cancelUncommittedPartyGameAccountMerge,
  finalizePartyGameQueuesForAccountMerge,
  preflightPartyGameQueuesForAccountMerge,
  promotePartyGameQueuesAccountMerge,
} from '@/data/partyGameStartsQueue';
import { rekeyAccountPreferencesQueueOwner } from '@/data/accountPreferencesQueue';
import { getAppleCredential, getGoogleIdToken, SocialAuthError } from '@/data/socialAuth';
import { refreshPartyGamesAfterAccountMerge } from '@/stores/partyGamesStore';
import { trackApiFailure } from '@/data/telemetryClient';
import {
  clearUgcConsentStateForTests,
  UGC_POLICY_HEADER,
  ugcPolicyHeaders,
} from '@/data/ugcConsent';
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
  setPrivateAccountDeletionRecoveryBlocked: jest.fn(),
  setPrivateAccountRehydrationRecoveryBlocked: jest.fn(),
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
    ensureCredentialBindingForSession: jest.fn(async (session: AccountSession) =>
      session.authenticated
        ? {
            ...session,
            credentialBindingId:
              session.credentialBindingId ?? '44444444-4444-4444-8444-444444444444',
          }
        : null,
    ),
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
  retireQuarantinedAccountDeletionReceipt: jest.fn(async () => ({ ok: true })),
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

jest.mock('@/data/accountPreferencesQueue', () => ({
  rekeyAccountPreferencesQueueOwner: jest.fn(async () => true),
}));

jest.mock('@/data/partyEveningIdentityCache', () => ({
  rekeyPartyEveningIdentityOwner: jest.fn(async () => true),
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
const mockEnsureCredentialBindingForSession =
  ensureCredentialBindingForSession as jest.MockedFunction<
    typeof ensureCredentialBindingForSession
  >;
const mockGetSessionToken = getSessionToken as jest.MockedFunction<typeof getSessionToken>;
const mockGenerateUuidV4 = generateUuidV4 as jest.MockedFunction<typeof generateUuidV4>;
const mockSetSession = setSession as jest.MockedFunction<typeof setSession>;
const mockRevertToAnonymous = revertToAnonymous as jest.MockedFunction<typeof revertToAnonymous>;
const mockClearLocalPrivateAccountData = clearLocalPrivateAccountData as jest.MockedFunction<
  typeof clearLocalPrivateAccountData
>;
const mockRehydratePrivateStoresAfterBoundary =
  rehydratePrivateStoresAfterBoundary as jest.MockedFunction<
    typeof rehydratePrivateStoresAfterBoundary
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
const mockRetireQuarantinedAccountDeletionReceipt =
  retireQuarantinedAccountDeletionReceipt as jest.MockedFunction<
    typeof retireQuarantinedAccountDeletionReceipt
  >;
const mockDisableCachedPushDeviceWithBearer =
  disableCachedPushDeviceWithBearer as jest.MockedFunction<
    typeof disableCachedPushDeviceWithBearer
  >;
const mockRegisterCachedPushDeviceWithBearer =
  registerCachedPushDeviceWithBearer as jest.MockedFunction<
    typeof registerCachedPushDeviceWithBearer
  >;
const mockRekeyAccountPreferencesQueueOwner =
  rekeyAccountPreferencesQueueOwner as jest.MockedFunction<
    typeof rekeyAccountPreferencesQueueOwner
  >;
const mockRekeyPartyEveningIdentityOwner = jest.requireMock(
  '@/data/partyEveningIdentityCache',
).rekeyPartyEveningIdentityOwner as jest.Mock;
const mockMergeMarkerRemoved = jest.fn();
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
const mockSetPrivateAccountDeletionRecoveryBlocked =
  setPrivateAccountDeletionRecoveryBlocked as jest.MockedFunction<
    typeof setPrivateAccountDeletionRecoveryBlocked
  >;
const mockSetPrivateAccountRehydrationRecoveryBlocked =
  setPrivateAccountRehydrationRecoveryBlocked as jest.MockedFunction<
    typeof setPrivateAccountRehydrationRecoveryBlocked
  >;
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
  // The beer-photo boundary is the real module; drop any retained transitions
  // or deletion-recovery blockers so they cannot leak between tests.
  resetBeerPhotoSessionBoundaryForTests();
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
  mockEnsureCredentialBindingForSession.mockImplementation(async session =>
    session.authenticated
      ? {
          ...session,
          credentialBindingId: session.credentialBindingId ?? '44444444-4444-4444-8444-444444444444',
        }
      : null,
  );
  mockSetSession.mockResolvedValue(undefined);
  mockRevertToAnonymous.mockImplementation(
    async (_signal, beforeSessionCleared) => {
      await beforeSessionCleared?.();
      return null;
    },
  );
  mockClearLocalPrivateAccountData.mockResolvedValue({ ok: true });
  mockRehydratePrivateStoresAfterBoundary.mockResolvedValue(true);
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
  mockRetireQuarantinedAccountDeletionReceipt.mockResolvedValue({ ok: true });
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
  mockFinalizePartyGameMerge.mockImplementation(async (...args: unknown[]) => {
    const finalizeLocalData = args[3] as
      | ((intent: {
          version: 1;
          operationId: string;
          fromAccountId: string;
          toAccountId: string;
          preparedAt: number;
        }) => Promise<boolean>)
      | undefined;
    if (!finalizeLocalData) return false;
    const finalized = await finalizeLocalData({
      version: 1,
      operationId: MERGE_OPERATION_ID,
      fromAccountId: String(args[0]),
      toAccountId: String(args[1]),
      preparedAt: 1,
    });
    if (finalized) mockMergeMarkerRemoved();
    return finalized;
  });
  mockPreflightPartyGameMerge.mockResolvedValue({
    operationId: MERGE_OPERATION_ID,
    cancelSafe: true,
  });
  mockPromotePartyGameMerge.mockResolvedValue(true);
  mockRekeyPartyEveningIdentityOwner.mockResolvedValue(true);
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
      detail: 'Server neposlal platné přihlášení. Zkus to znovu.',
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
      detail: 'Přihlášení se nepodařilo uložit. Odemkni telefon a zkus to znovu.',
    });
    expect(mockTrackApiFailure).toHaveBeenCalledWith(
      'auth_session_persist',
      expect.objectContaining({ reason: 'secure_store' }),
    );
  });

  it('reports failure but exposes durable B to the store when private rehydrate fails', async () => {
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        display_name: 'Účet B',
        is_anonymous: false,
      }),
    );
    mockRehydratePrivateStoresAfterBoundary.mockResolvedValue(false);

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: 'session_storage',
        committedProfile: expect.objectContaining({
          id: 'account-b',
          displayName: 'Účet B',
        }),
      }),
    );

    expect(mockSetSession).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-b', token: 'token-b' }),
    );
    expect(mockRekeyAccountPreferencesQueueOwner).toHaveBeenCalledWith(
      'a',
      'account-b',
      { allowDuringPrivateTransition: true },
    );
    expect(mockFinalizePartyGameMerge.mock.invocationCallOrder[0]).toBeLessThan(
      mockRekeyAccountPreferencesQueueOwner.mock.invocationCallOrder[0],
    );
    expect(mockRekeyAccountPreferencesQueueOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mockRekeyPartyEveningIdentityOwner.mock.invocationCallOrder[0],
    );
    expect(mockRekeyPartyEveningIdentityOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mockRehydratePrivateStoresAfterBoundary.mock.invocationCallOrder[0],
    );
    expect(mockRehydratePrivateStoresAfterBoundary).toHaveBeenCalledTimes(2);
    expect(mockMergeMarkerRemoved).not.toHaveBeenCalled();
    expect(mockSetPrivateAccountRehydrationRecoveryBlocked.mock.calls).toEqual([
      [true],
    ]);
  });

  it('keeps the recovery freeze when an aborted login cannot rehydrate A', async () => {
    installFetch(
      fetchResolving(401, {
        code: 'invalid_credentials',
        detail: 'Špatný e-mail nebo heslo.',
      }),
    );
    mockRehydratePrivateStoresAfterBoundary.mockResolvedValueOnce(false);

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'bad' }),
    ).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: 'session_storage',
    }));

    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSetPrivateAccountRehydrationRecoveryBlocked.mock.calls).toEqual([
      [true],
    ]);
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
      expect.any(Function),
    );
    expect(mockRekeyPartyEveningIdentityOwner).toHaveBeenCalledWith('a', 'acc-2');
    expect(mockFinalizePartyGameMerge.mock.invocationCallOrder[0]).toBeLessThan(
      mockRekeyAccountPreferencesQueueOwner.mock.invocationCallOrder[0],
    );
    expect(mockRekeyAccountPreferencesQueueOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mockRekeyPartyEveningIdentityOwner.mock.invocationCallOrder[0],
    );
    expect(mockRekeyPartyEveningIdentityOwner.mock.invocationCallOrder[0]).toBeLessThan(
      mockRehydratePrivateStoresAfterBoundary.mock.invocationCallOrder[0],
    );
    expect(mockRehydratePrivateStoresAfterBoundary.mock.invocationCallOrder[0]).toBeLessThan(
      mockMergeMarkerRemoved.mock.invocationCallOrder[0],
    );
    expect(mockMergeMarkerRemoved.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshPartyGamesAfterMerge.mock.invocationCallOrder[0],
    );
    expect(mockRehydratePrivateStoresAfterBoundary).toHaveBeenCalledTimes(1);
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
      expect.any(Function),
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
    ).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: 'session_storage',
      committedProfile: expect.objectContaining({ id: 'account-b' }),
    }));

    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockFinalizePartyGameMerge).toHaveBeenCalledTimes(1);
    expect(mockMergeMarkerRemoved).not.toHaveBeenCalled();
    expect(mockRefreshPartyGamesAfterMerge).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('auth_party_games_merge', {
      reason: 'post_session_finalize_deferred',
    });
  });

  it('keeps the promoted marker when the active table identity cannot be rekeyed', async () => {
    mockRekeyPartyEveningIdentityOwner.mockResolvedValueOnce(false);
    installFetch(
      fetchResolving(200, {
        id: 'account-b',
        token: 'token-b',
        is_anonymous: false,
      }),
    );

    await expect(
      auth.loginEmail({ email: 'b@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: 'session_storage',
      committedProfile: expect.objectContaining({ id: 'account-b' }),
    }));

    expect(mockSetSession).toHaveBeenCalledTimes(1);
    expect(mockFinalizePartyGameMerge).toHaveBeenCalledTimes(1);
    expect(mockMergeMarkerRemoved).not.toHaveBeenCalled();
    expect(mockRefreshPartyGamesAfterMerge).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith(
      'auth_party_evening_identity',
      { reason: 'anonymous_merge_rekey_failed' },
    );
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
      detail: expect.stringContaining('se nepodařilo uložit'),
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
      detail: expect.stringContaining('se nepodařilo přenést'),
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
    expect(result.detail).toBe('Tenhle způsob přihlášení na tvém telefonu nejde.');
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
      detail: expect.stringContaining('se nepodařilo dokončit'),
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
  const exactBinding = '11111111-1111-4111-8111-111111111111';
  const staleOriginalBinding = '22222222-2222-4222-8222-222222222222';
  const reboundBinding = '33333333-3333-4333-8333-333333333333';
  const outgoingSession = {
    deviceId: 'device-a',
    accountId: 'account-a',
    token: 'revoked-token-a',
    authenticated: true,
    credentialBindingId: exactBinding,
  };

  it('clears a crash-lost deleted account before its cached session can be published', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'pending',
        credentialBindingId: exactBinding,
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

  it('clears both blockers only after a successful rehydrate on the safe no-intent path', async () => {
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const snapshots: { frozen: boolean }[] = [];
    const unsubscribe = subscribeBeerPhotoSessionBoundary((snapshot) => {
      snapshots.push({ frozen: snapshot.frozen });
    });
    try {
      await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('none');
    } finally {
      unsubscribe();
    }

    // The private blocker is engaged up front and released only after the
    // rehydrate proved safe.
    expect(mockSetPrivateAccountDeletionRecoveryBlocked.mock.calls.map((call) => call[0]))
      .toEqual([true, false]);
    expect(
      mockRehydratePrivateStoresAfterBoundary.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockSetPrivateAccountDeletionRecoveryBlocked.mock.invocationCallOrder[1],
    );

    // Both transitions release: the photo boundary ends thawed with exactly one
    // final true→false publish.
    expect(isBeerPhotoSessionFrozen()).toBe(false);
    let unfreezes = 0;
    for (let index = 1; index < snapshots.length; index += 1) {
      if (snapshots[index - 1].frozen && !snapshots[index].frozen) unfreezes += 1;
    }
    expect(unfreezes).toBe(1);
  });

  it('keeps A intact while the deletion proof is unavailable', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('deferred');

    // An unavailable proof archives nothing and decides nothing.
    expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    // Unavailability is deferred: the blocker stays on.
    expect(isBeerPhotoSessionFrozen()).toBe(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
  });

  it('blocks publication when a proven deletion cannot clear private storage', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
        credentialBindingId: exactBinding,
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
    // A blocked outcome keeps both blockers active.
    expect(isBeerPhotoSessionFrozen()).toBe(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
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
    // No readable owner means the startup gate must stay closed.
    expect(isBeerPhotoSessionFrozen()).toBe(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
  });

  it('retries the original DELETE with the receipt operationId when the proof says the account still exists', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'pending',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    const spy = installFetch(
      jest.fn(async (url: string) =>
        url === 'https://api.test/v1/account/deletion-status'
          ? { ok: true, status: 200, text: async () => JSON.stringify({ complete: false }) }
          : { ok: true, status: 204, text: async () => '' },
      ),
    );

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('recovered');

    // The retry targets the account endpoint on the same durable session.
    const deleteCalls = spy.mock.calls.filter(
      ([url]) => url === 'https://api.test/v1/account/me',
    );
    expect(deleteCalls).toHaveLength(1);
    const [, deleteInit] = deleteCalls[0] as [string, RequestInit];
    expect(deleteInit.method).toBe('DELETE');
    expect(authHeader(deleteInit)).toBe(`Bearer ${outgoingSession.token}`);
    expect((deleteInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationId,
    );

    // A successful retry finishes the normal private boundary cleanup...
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({ outgoingSession });
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expect(isBeerPhotoSessionFrozen()).toBe(false);

    // ...without minting a replacement deletion operation or receipt.
    expect(mockGenerateUuidV4).not.toHaveBeenCalled();
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
  });

  it('stays gated without a DELETE or private rehydrate while the proof is unavailable', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'pending',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    const spy = installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    // Subscribe before recovery so any thaw during or after the temporary
    // transition is captured, not just the state sampled afterwards.
    const snapshots: { frozen: boolean }[] = [];
    const unsubscribe = subscribeBeerPhotoSessionBoundary((snapshot) => {
      snapshots.push({ frozen: snapshot.frozen });
    });
    try {
      await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('deferred');
    } finally {
      unsubscribe();
    }

    // Only the public status probe went out; no DELETE may ride an unknown proof.
    expect(spy.mock.calls.every(([url]) =>
      url === 'https://api.test/v1/account/deletion-status',
    )).toBe(true);

    // Local data stays untouched and the startup gate holds — critically, the
    // deferred path must not rehydrate (and thereby publish) private stores.
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockRehydratePrivateStoresAfterBoundary).not.toHaveBeenCalled();

    // Auth retains both blockers across retry: the boundary never publishes a
    // thawed snapshot even after the temporary transition releases, it is still
    // frozen now, and the private deletion blocker was set true but never false.
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.some((snapshot) => !snapshot.frozen)).toBe(false);
    expect(isBeerPhotoSessionFrozen()).toBe(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
  });

  it('archives an exact-binding complete receipt invalidated by reactivation instead of deleting again', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    const spy = installFetch(statusRoutingFetch(false));

    const result = await auth.recoverPendingAccountDeletionAtStartup();

    // The proof was completed once; public incompleteness now means the epoch
    // was invalidated by reactivation. ZERO further DELETE requests.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(
      spy.mock.calls.every(([url]) => url !== 'https://api.test/v1/account/me'),
    ).toBe(true);

    // The exact receipt is archived, never completed, cleared, or rewritten.
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockGenerateUuidV4).not.toHaveBeenCalled();

    // Reactivation means the current session survives untouched.
    expect(result).toBe('recovered');
    expectSafePublishedOutcome(result);
  });

  it('downgrades a safe none candidate to blocked when rehydration fails', async () => {
    mockRehydratePrivateStoresAfterBoundary.mockResolvedValue(false);
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');
    expect(mockReadAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    // A failed publish leaves both blockers engaged; no queue may thaw.
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
    expect(isBeerPhotoSessionFrozen()).toBe(true);
  });

  it('downgrades a safe same-owner recovered candidate to blocked when rehydration fails', async () => {
    mockRehydratePrivateStoresAfterBoundary.mockResolvedValue(false);
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');

    // The recovery itself ran to completion before the failed publish.
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({ outgoingSession });
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expect(mockClearAccountDeletionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      mockRehydratePrivateStoresAfterBoundary.mock.invocationCallOrder[0],
    );
  });

  it('retires the proven A receipt before failed rehydration and never clears B on an owner mismatch', async () => {
    mockRehydratePrivateStoresAfterBoundary.mockResolvedValue(false);
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'device-b',
      accountId: 'account-b',
      token: 'token-b',
      authenticated: true,
    });
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'complete',
      },
      orphans: [],
    });
    installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');

    // A's retired capability is cleared strictly before the (failed) publish…
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expect(
      mockClearAccountDeletionReceipt.mock.invocationCallOrder[0],
    ).toBeLessThan(mockRehydratePrivateStoresAfterBoundary.mock.invocationCallOrder[0]);

    // …and B's durable identity is never touched with A's receipt.
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
  });

  it('never rejects when rehydration itself throws on an otherwise-safe candidate', async () => {
    mockRehydratePrivateStoresAfterBoundary.mockRejectedValueOnce(
      new Error('rehydration exploded'),
    );
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');
    // Even a thrown rehydrate must not release either blocker.
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
    expect(isBeerPhotoSessionFrozen()).toBe(true);
  });

  // Receipt v4 carries the credential binding that produced it; fixtures use
  // real UUID v4 bindings so the exact-match vs stale-receipt split stays
  // realistic at the typed mock boundaries.
  interface SessionWithCredentialBinding extends AccountSession {
    credentialBindingId: string;
  }
  type DeletionIntentWithBinding = AccountDeletionIntent & { credentialBindingId: string };

  const sessionWithBinding = (
    base: typeof outgoingSession,
    credentialBindingId: string,
  ): SessionWithCredentialBinding => ({ ...base, credentialBindingId });

  const intentWithBinding = (
    intent: AccountDeletionIntent,
    credentialBindingId: string,
  ): DeletionIntentWithBinding => ({ ...intent, credentialBindingId });

  function statusRoutingFetch(complete: boolean): jest.Mock {
    return jest.fn(async (url: string) =>
      url === 'https://api.test/v1/account/deletion-status'
        ? { ok: true, status: 200, text: async () => JSON.stringify({ complete }) }
        : { ok: false, status: 500, text: async () => '' },
    );
  }

  function expectSafePublishedOutcome(result: StartupAccountDeletionRecoveryResult): void {
    // The exact stale receipt is archived — never silently dropped or retried.
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledTimes(1);

    // The current durable account is never cleared nor reverted to anonymous.
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();

    // Private stores are rehydrated and BOTH deletion blockers release.
    expect(mockRehydratePrivateStoresAfterBoundary).toHaveBeenCalledTimes(1);
    expect(
      mockSetPrivateAccountDeletionRecoveryBlocked.mock.calls.map((call) => call[0]),
    ).toEqual([true, false]);
    expect(isBeerPhotoSessionFrozen()).toBe(false);

    // A safe published result, never a held gate.
    expect(['none', 'recovered']).toContain(result);
  }

  it('archives a v4 receipt whose binding no longer matches and never auto-deletes the same account', async () => {
    const reboundSession = sessionWithBinding(outgoingSession, reboundBinding);
    mockEnsureAccount.mockResolvedValueOnce(reboundSession as unknown as AccountSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: intentWithBinding(
        { accountId: 'account-a', operationId, phase: 'pending' },
        staleOriginalBinding,
      ) as unknown as AccountDeletionIntent,
      orphans: [],
    });
    const spy = installFetch(statusRoutingFetch(false));

    const result = await auth.recoverPendingAccountDeletionAtStartup();

    // ZERO DELETE: an account-id match alone must not ride a stale binding.
    expect(
      spy.mock.calls.every(([url]) => url !== 'https://api.test/v1/account/me'),
    ).toBe(true);

    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expectSafePublishedOutcome(result);
  });

  it('holds the gate when archiving the stale receipt itself fails with a storage error', async () => {
    const reboundSession = sessionWithBinding(outgoingSession, reboundBinding);
    mockEnsureAccount.mockResolvedValueOnce(reboundSession as unknown as AccountSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: intentWithBinding(
        { accountId: 'account-a', operationId, phase: 'pending' },
        staleOriginalBinding,
      ) as unknown as AccountDeletionIntent,
      orphans: [],
    });
    mockArchiveAccountDeletionReceipt.mockResolvedValueOnce({ ok: false, storageError: true });
    const spy = installFetch(statusRoutingFetch(false));

    const result = await auth.recoverPendingAccountDeletionAtStartup();

    // No DELETE may ride the stale binding...
    expect(
      spy.mock.calls.every(([url]) => url !== 'https://api.test/v1/account/me'),
    ).toBe(true);

    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);

    // ...and a failed archive must not publish anything: the result is blocked,
    // private stores stay unrehydrated and BOTH blockers remain engaged.
    expect(result).toBe('blocked');
    expect(mockRehydratePrivateStoresAfterBoundary).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
    expect(isBeerPhotoSessionFrozen()).toBe(true);
  });

  it('archives a legacy same-account receipt without credentialBindingId instead of auto-deleting', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: { accountId: 'account-a', operationId, phase: 'pending' },
      orphans: [],
    });
    const spy = installFetch(statusRoutingFetch(false));

    const result = await auth.recoverPendingAccountDeletionAtStartup();

    // No verifiable binding means no automatic DELETE, ever.
    expect(
      spy.mock.calls.every(([url]) => url !== 'https://api.test/v1/account/me'),
    ).toBe(true);

    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expectSafePublishedOutcome(result);
  });

  // Canonical backend response proving the deletion epoch was invalidated by
  // reactivation: the retried exact DELETE must archive the receipt instead of
  // deferring forever (the cross-device deadlock).
  const canonicalReactivationResponses = [
    ['canonical 409 deletion_epoch_cancelled', 409, { code: 'deletion_epoch_cancelled' }],
  ] as const;

  function statusOkFalseThenDelete(deleteStatus: number, deleteBody: unknown): jest.Mock {
    return jest.fn(async (url: string) =>
      url === 'https://api.test/v1/account/deletion-status'
        ? { ok: true, status: 200, text: async () => JSON.stringify({ complete: false }) }
        : {
            ok: false,
            status: deleteStatus,
            text: async () => JSON.stringify(deleteBody),
          },
    );
  }

  it.each(canonicalReactivationResponses)(
    'archives the exact pending receipt when the retried DELETE reports the cancelled epoch (%s)',
    async (_label, deleteStatus, deleteBody) => {
      mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
      mockReadAccountDeletionReceipt.mockResolvedValueOnce({
        ok: true,
        intent: {
          accountId: 'account-a',
          operationId,
          phase: 'pending',
          credentialBindingId: exactBinding,
        },
        orphans: [],
      });
      const spy = installFetch(statusOkFalseThenDelete(deleteStatus, deleteBody));

      const result = await auth.recoverPendingAccountDeletionAtStartup();

      // The exact DELETE was attempted once with the receipt's operationId...
      const deleteCalls = spy.mock.calls.filter(
        ([url]) => url === 'https://api.test/v1/account/me',
      );
      expect(deleteCalls).toHaveLength(1);
      const [, deleteInit] = deleteCalls[0] as [string, RequestInit];
      expect(deleteInit.method).toBe('DELETE');
      expect(
        (deleteInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id'],
      ).toBe(operationId);

      // ...and its canonical reactivation answer archives the exact receipt.
      expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledTimes(1);
      expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
      expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockGenerateUuidV4).not.toHaveBeenCalled();

      // The current account survives; blockers release safely.
      expect(result).toBe('recovered');
      expectSafePublishedOutcome(result);
    },
  );

  // The REAL revoked-token contract from the backend: a bare 401 DRF detail
  // body with NO `code`. On the exact pending retry this is terminal — the
  // authorization was revoked because the account is gone — so the receipt
  // must archive and recovery must publish safely instead of deadlocking.
  it('archives the exact pending receipt when the retried DELETE answers the real revoked-token 401 contract', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'pending',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    const spy = installFetch(statusOkFalseThenDelete(401, { detail: 'Invalid account token.' }));

    const result = await auth.recoverPendingAccountDeletionAtStartup();

    // The exact DELETE was attempted once with the receipt's operationId...
    const deleteCalls = spy.mock.calls.filter(
      ([url]) => url === 'https://api.test/v1/account/me',
    );
    expect(deleteCalls).toHaveLength(1);
    const [, deleteInit] = deleteCalls[0] as [string, RequestInit];
    expect(deleteInit.method).toBe('DELETE');
    expect(
      (deleteInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id'],
    ).toBe(operationId);

    // ...and its real-world 401 (detail only, no `code`) archives the exact
    // receipt instead of deferring forever.
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationId);
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockGenerateUuidV4).not.toHaveBeenCalled();

    // The current account survives; blockers release safely.
    expect(result).toBe('recovered');
    expectSafePublishedOutcome(result);
  });

  it.each([
    ['opaque 403 forbidden', 403, { detail: 'Nelze smazat účet.', code: 'forbidden' }],
    ['opaque 500', 500, { detail: 'boom' }],
  ] as const)(
    'stays deferred and unarchived when the retried DELETE fails opaquely (%s)',
    async (_label, deleteStatus, deleteBody) => {
      mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
      mockReadAccountDeletionReceipt.mockResolvedValueOnce({
        ok: true,
        intent: {
          accountId: 'account-a',
          operationId,
          phase: 'pending',
          credentialBindingId: exactBinding,
        },
        orphans: [],
      });
      installFetch(statusOkFalseThenDelete(deleteStatus, deleteBody));

      await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('deferred');

      // An opaque failure proves nothing: nothing is archived or cleared and
      // both blockers hold for a later startup attempt.
      expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
      expect(mockRevertToAnonymous).not.toHaveBeenCalled();
      expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockRehydratePrivateStoresAfterBoundary).not.toHaveBeenCalled();
      expect(isBeerPhotoSessionFrozen()).toBe(true);
      expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
      expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
    },
  );

  it('stays deferred and unarchived when the retried DELETE fails with a network error', async () => {
    mockEnsureAccount.mockResolvedValueOnce(outgoingSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce({
      ok: true,
      intent: {
        accountId: 'account-a',
        operationId,
        phase: 'pending',
        credentialBindingId: exactBinding,
      },
      orphans: [],
    });
    installFetch(
      jest.fn(async (url: string) => {
        if (url === 'https://api.test/v1/account/deletion-status') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ complete: false }) };
        }
        throw new Error('offline mid-retry');
      }),
    );

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('deferred');

    expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockRehydratePrivateStoresAfterBoundary).not.toHaveBeenCalled();
    expect(isBeerPhotoSessionFrozen()).toBe(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
  });

  it.each([
    ['status reports incomplete', statusRoutingFetch(false)],
    ['status request throws', jest.fn().mockRejectedValue(new Error('status probe failed'))],
  ])(
    'archives a pending A receipt while B is durable (%s), publishes safely, and keeps B intact',
    async (_label, fetchMock) => {
      mockEnsureAccount.mockResolvedValueOnce({
        deviceId: 'device-b',
        accountId: 'account-b',
        token: 'token-b',
        authenticated: true,
      });
      mockReadAccountDeletionReceipt.mockResolvedValueOnce({
        ok: true,
        intent: { accountId: 'deleted-account-a', operationId, phase: 'pending' },
        orphans: [],
      });
      const spy = installFetch(fetchMock);

      const result = await auth.recoverPendingAccountDeletionAtStartup();

      // Only the public status probe may go out; no request touches B's identity.
      expect(
        spy.mock.calls.every(([url]) =>
          url === 'https://api.test/v1/account/deletion-status',
        ),
      ).toBe(true);

      expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith(
        'deleted-account-a',
        operationId,
      );
      expectSafePublishedOutcome(result);
    },
  );

  // A corrupt durable receipt is already quarantined by the receipt layer
  // (durability/readback verified there); startup recovery must finish the
  // deletion boundary locally using the quarantine id.
  const corruptReceipt = {
    ok: false,
    storageError: false,
    failureKind: 'corrupt',
    quarantineId: 'qd-corrupt',
  } as const;

  const anonymousDurableSession = {
    deviceId: 'd',
    accountId: 'a',
    token: 'anon-tok',
    authenticated: false,
  };

  function completionRecorder() {
    const events: string[] = [];
    return {
      events,
      completing:
        <T>(event: string, value: T) =>
        async (): Promise<T> => {
          events.push(event);
          return value;
        },
    };
  }

  it.each([
    ['authenticated', () => outgoingSession],
    ['anonymous', () => anonymousDurableSession],
  ])(
    'recovers fully offline from a corrupt quarantined receipt over a %s durable session',
    async (_label, session) => {
      // Persistent (not Once) stubs: the unfixed source may bail before
      // consuming a queued value, and an unconsumed Once would poison later
      // tests — the global beforeEach rewrites persistent impls every run.
      mockEnsureAccount.mockResolvedValue(session());
      mockReadAccountDeletionReceipt.mockResolvedValueOnce(corruptReceipt);
      const spy = installFetch(fetchResolving(200, {}));
      const { events, completing } = completionRecorder();

      mockClearLocalPrivateAccountData.mockImplementationOnce(
        completing('private-clear', { ok: true }),
      );
      mockRetireQuarantinedAccountDeletionReceipt.mockImplementationOnce(
        completing('quarantine-retired', { ok: true }),
      );
      mockRehydratePrivateStoresAfterBoundary.mockImplementationOnce(
        completing('rehydrated', true),
      );
      let clearCallbackRan = false;
      mockRevertToAnonymous.mockImplementationOnce(async (_signal, beforeSessionCleared) => {
        await beforeSessionCleared?.();
        clearCallbackRan = true;
        events.push('rotation-complete');
        return null;
      });
      mockSetPrivateAccountDeletionRecoveryBlocked.mockImplementationOnce(() => {
        events.push('blocker-engaged');
      });
      mockSetPrivateAccountDeletionRecoveryBlocked.mockImplementationOnce(() => {
        events.push('blocker-released');
      });

      await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('recovered');

      // Zero network while stranded on corrupt bytes.
      expect(spy).not.toHaveBeenCalled();

      // The exact outgoing durable session is what private data clears with.
      expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
      expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
        outgoingSession: session(),
      });

      // Rotation executes the clear callback, then completes.
      expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
      expect(clearCallbackRan).toBe(true);

      // Retirement happens exactly once with the quarantine id, only AFTER
      // the private clear AND rotation completed; rehydration only after
      // retirement; blockers release only after successful rehydrate.
      expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledTimes(1);
      expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledWith('qd-corrupt');
      const at = (event: string): number => {
        const index = events.indexOf(event);
        expect(index).toBeGreaterThanOrEqual(0);
        return index;
      };
      expect(events[0]).toBe('blocker-engaged');
      expect(at('private-clear')).toBeLessThan(at('rotation-complete'));
      expect(at('rotation-complete')).toBeLessThan(at('quarantine-retired'));
      expect(at('quarantine-retired')).toBeLessThan(at('rehydrated'));
      expect(at('rehydrated')).toBeLessThan(at('blocker-released'));

      // Both blockers released; beer-photo boundary ends thawed.
      expect(mockSetPrivateAccountDeletionRecoveryBlocked.mock.calls.map((call) => call[0]))
        .toEqual([true, false]);
      expect(isBeerPhotoSessionFrozen()).toBe(false);

      // No normal active/orphan receipt mutator rides the corrupt path.
      expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
    },
  );

  it('stays blocked when retiring the corrupt receipt fails after a successful clear and rotation', async () => {
    mockEnsureAccount.mockResolvedValue(anonymousDurableSession);
    mockReadAccountDeletionReceipt.mockResolvedValueOnce(corruptReceipt);
    const spy = installFetch(fetchResolving(200, {}));
    mockRetireQuarantinedAccountDeletionReceipt.mockResolvedValue({
      ok: false,
      storageError: true,
    });

    await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');

    // The boundary itself completed before the failed retirement...
    expect(spy).not.toHaveBeenCalled();
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);

    // ...but nothing may publish afterwards.
    expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledWith('qd-corrupt');
    expect(mockRehydratePrivateStoresAfterBoundary).not.toHaveBeenCalled();
    expect(isBeerPhotoSessionFrozen()).toBe(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
    expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);

    // No network and no normal active/orphan receipt mutation either.
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
  });

  it.each([
    ['io read failure', { ok: false, storageError: true, failureKind: 'io' }],
    [
      'unsupported storage failure',
      { ok: false, storageError: true, failureKind: 'unsupported' },
    ],
  ] as const)(
    'keeps every blocker engaged for an unreadable receipt (%s)',
    async (_label, readResult) => {
      mockEnsureAccount.mockResolvedValue(outgoingSession);
      mockReadAccountDeletionReceipt.mockResolvedValueOnce(readResult);
      const spy = installFetch(fetchResolving(200, {}));

      await expect(auth.recoverPendingAccountDeletionAtStartup()).resolves.toBe('blocked');

      expect(spy).not.toHaveBeenCalled();
      expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
      expect(mockRevertToAnonymous).not.toHaveBeenCalled();
      expect(mockRetireQuarantinedAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockRehydratePrivateStoresAfterBoundary).not.toHaveBeenCalled();
      expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
      expect(isBeerPhotoSessionFrozen()).toBe(true);
      expect(mockSetPrivateAccountDeletionRecoveryBlocked).toHaveBeenCalledWith(true);
      expect(mockSetPrivateAccountDeletionRecoveryBlocked).not.toHaveBeenCalledWith(false);
    },
  );
});

describe('deleteAccount', () => {
  const operationId = '00000000-0000-4000-8000-000000000001';
  const credentialBindingId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    mockEnsureAccount.mockResolvedValue({
      deviceId: 'd',
      accountId: 'a',
      token: 'cur-tok',
      authenticated: true,
      credentialBindingId,
    });
    mockEnsureCredentialBindingForSession.mockImplementation(async session => {
      if (!session.authenticated) return null;
      return session.credentialBindingId
        ? session
        : { ...session, credentialBindingId };
    });
  });

  const pendingIntent = {
    accountId: 'a',
    operationId,
    phase: 'pending' as const,
    credentialBindingId,
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
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId, credentialBindingId);
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
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId, credentialBindingId);
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
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId, credentialBindingId);
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

    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId, credentialBindingId);
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
      credentialBindingId,
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

  it('re-asks for confirmation over a stale lost-cleanup receipt, then deletes under a fresh binding', async () => {
    const freshBindingId = '66666666-6666-4666-8666-666666666666';
    const newOperationId = '00000000-0000-4000-8000-000000000002';
    const sessionA = {
      deviceId: 'device-a',
      accountId: 'a',
      token: 'old-token-a',
      authenticated: true,
      credentialBindingId,
    };
    const sessionA2 = {
      ...sessionA,
      token: 'fresh-token-a',
      credentialBindingId: freshBindingId,
    };
    mockEnsureAccount.mockResolvedValue(sessionA);
    mockGenerateUuidV4
      .mockReturnValueOnce(operationId)
      .mockReturnValueOnce(newOperationId);
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] })
      .mockResolvedValueOnce({ ok: true, intent: completeIntent, orphans: [] })
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] });
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

    // Confirmation 1: DELETE commits on the server, but the local private
    // cleanup fails closed — exactly like the dedicated lost-cleanup test.
    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'session_storage' }),
    );
    expect(spy.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(1);
    expect((spy.mock.calls[0][1].headers as Record<string, string>)[
      'X-Account-Deletion-Operation-Id'
    ]).toBe(operationId);

    // Re-login succeeds; the durable session now carries account A under a
    // fresh token AND a rotated binding, so the surviving receipt no longer
    // matches the live credential.
    mockEnsureAccount.mockResolvedValue(sessionA2);
    await expect(
      auth.loginEmail({ email: 'a@example.com', password: 'pw' }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: undefined,
      accountId: 'a',
      token: 'fresh-token-a',
      authenticated: true,
    });

    // Confirmation 2: the stale complete proof reads as publicly incomplete,
    // so it is archived — never deleted on, never cleared — and the tap ends
    // asking the user to confirm again. Zero DELETE rides the fresh token.
    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_recovered' }),
    );
    expect(spy.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(1);
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockArchiveAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();

    // Confirmation 3: no active intent remains, so a NEW operation is minted,
    // bound to the fresh credential, written durably, and only now DELETEd.
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/v1/account/me',
      'https://api.test/v1/auth/login',
      'https://api.test/v1/account/deletion-status',
      'https://api.test/v1/account/me',
    ]);
    const [firstDelete, login, statusProbe, finalDelete] = spy.mock.calls;
    expect(firstDelete[1].method).toBe('DELETE');
    expect(authHeader(firstDelete[1])).toBe('Bearer old-token-a');
    expect(authHeader(login[1])).toBeUndefined();
    expect(statusProbe[1].method).toBe('GET');
    expect(authHeader(statusProbe[1])).toBeUndefined();
    expect((statusProbe[1].headers as Record<string, string>)[
      'X-Account-Deletion-Operation-Id'
    ]).toBe(operationId);
    expect(finalDelete[1].method).toBe('DELETE');
    expect(authHeader(finalDelete[1])).toBe('Bearer fresh-token-a');
    expect((finalDelete[1].headers as Record<string, string>)[
      'X-Account-Deletion-Operation-Id'
    ]).toBe(newOperationId);

    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledTimes(2);
    expect(mockWriteAccountDeletionReceipt).toHaveBeenNthCalledWith(
      1,
      'a',
      operationId,
      credentialBindingId,
    );
    expect(mockWriteAccountDeletionReceipt).toHaveBeenNthCalledWith(
      2,
      'a',
      newOperationId,
      freshBindingId,
    );
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith('a', operationId);
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith('a', newOperationId);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('a', newOperationId);
  });

  it('requires a second confirmation over a stale complete A receipt on anonymous B', async () => {
    const bindingA = '55555555-5555-4555-8555-555555555555';
    const operationA = '00000000-0000-4000-8000-00000000000a';
    const bindingB = '66666666-6666-4666-8666-666666666666';
    const operationB = '00000000-0000-4000-8000-00000000000b';
    const sessionB = {
      deviceId: 'device-b',
      accountId: 'account-b',
      token: 'token-b',
      authenticated: false,
      credentialBindingId: bindingB,
    };
    mockEnsureAccount.mockResolvedValue(sessionB);
    mockEnsureCredentialBindingForSession.mockImplementation(async session =>
      session.accountId === 'account-b'
        ? { ...session, credentialBindingId: session.credentialBindingId ?? bindingB }
        : null,
    );
    mockGenerateUuidV4.mockReturnValueOnce(operationB);
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({
        ok: true,
        intent: {
          accountId: 'account-a',
          operationId: operationA,
          phase: 'complete' as const,
          credentialBindingId: bindingA,
        },
        orphans: [],
      })
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] });
    const spy = installFetch(
      jest.fn(async (url: string, init?: RequestInit) =>
        url.endsWith('/v1/account/deletion-status')
          ? {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ complete: true }),
            }
          : init?.method === 'DELETE'
            ? { ok: true, status: 204, text: async () => '' }
            : { ok: false, status: 405, text: async () => '' },
      ),
    );

    // Execute BOTH taps up front and snapshot everything observable about
    // tap 1 BEFORE any assertion, so an intentionally failing tap 1 cannot
    // leave the second receipt one-shot queued and poison later tests.
    const tap1 = await auth.deleteAccount();

    const fetchCallsAfterTap1 = spy.mock.calls.length;
    const writeCallsAfterTap1 = mockWriteAccountDeletionReceipt.mock.calls.length;
    const clearCallsAfterTap1 = mockClearAccountDeletionReceipt.mock.calls.length;
    const completeCallsAfterTap1 = mockCompleteAccountDeletionReceipt.mock.calls.length;
    const revertCallsAfterTap1 = mockRevertToAnonymous.mock.calls.length;
    const clearPrivateCallsAfterTap1 = mockClearLocalPrivateAccountData.mock.calls.length;
    const setSessionCallsAfterTap1 = mockSetSession.mock.calls.length;
    const ensureBindingCallsAfterTap1 = mockEnsureCredentialBindingForSession.mock.calls.length;
    const flushCallsAfterTap1 = mockFlushBeerPhotoDeletions.mock.calls.length;

    // Tap 2: clean receipt → bind B, mint a fresh B operation, write the B
    // receipt before the only DELETE, then succeed through the full boundary.
    const tap2 = await auth.deleteAccount();

    expect(tap1).toEqual({
      ok: false,
      code: 'account_deletion_recovered',
      detail:
        'Předchozí mazání jsem dokončil. Pokud chceš smazat i aktuální účet, potvrď to znovu.',
    });
    expect(fetchCallsAfterTap1).toBe(1);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(clearCallsAfterTap1).toBe(1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith('account-a', operationA);
    // Never DELETE/revert/clear B or its private data, never write/mint/flush.
    expect(
      spy.mock.calls
        .slice(0, fetchCallsAfterTap1)
        .filter(([, init]) => init?.method === 'DELETE'),
    ).toHaveLength(0);
    expect(revertCallsAfterTap1).toBe(0);
    expect(clearPrivateCallsAfterTap1).toBe(0);
    expect(writeCallsAfterTap1).toBe(0);
    expect(completeCallsAfterTap1).toBe(0);
    expect(setSessionCallsAfterTap1).toBe(0);
    expect(ensureBindingCallsAfterTap1).toBe(0);
    expect(flushCallsAfterTap1).toBe(0);

    expect(tap2).toEqual({ ok: true });
    expect(spy.mock.calls).toHaveLength(fetchCallsAfterTap1 + 1);
    const [deleteUrl, deleteInit] = spy.mock.calls[fetchCallsAfterTap1] as [string, RequestInit];
    expect(deleteUrl).toBe('https://api.test/v1/account/me');
    expect(deleteInit.method).toBe('DELETE');
    expect(authHeader(deleteInit)).toBe('Bearer token-b');
    expect((deleteInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationB,
    );
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledTimes(writeCallsAfterTap1 + 1);
    expect(mockWriteAccountDeletionReceipt).toHaveBeenLastCalledWith(
      'account-b',
      operationB,
      bindingB,
    );
    expect(mockWriteAccountDeletionReceipt.mock.invocationCallOrder[writeCallsAfterTap1]).toBeLessThan(
      spy.mock.invocationCallOrder[fetchCallsAfterTap1],
    );
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenLastCalledWith('account-b', operationB);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({ outgoingSession: sessionB });
    expect(mockClearLocalPrivateAccountData.mock.invocationCallOrder[0]).toBeGreaterThan(
      spy.mock.invocationCallOrder[fetchCallsAfterTap1],
    );
    expect(mockClearAccountDeletionReceipt.mock.calls).toHaveLength(clearCallsAfterTap1 + 1);
    expect(mockClearAccountDeletionReceipt).toHaveBeenLastCalledWith('account-b', operationB);
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

  it.each([
    ['io read failure', { ok: false, storageError: true, failureKind: 'io' }],
    [
      'unsupported storage failure',
      { ok: false, storageError: true, failureKind: 'unsupported' },
    ],
  ] as const)(
    'fails closed when the receipt cannot be read (%s)',
    async (_label, readResult) => {
      // Persistent stubs only — queued one-shots could leak unconsumed values
      // if the source bails before reading them again.
      mockReadAccountDeletionReceipt.mockResolvedValue(readResult);
      const spy = installFetch(fetchResolving(204, undefined));

      await expect(auth.deleteAccount()).resolves.toEqual({
        ok: false,
        code: 'account_deletion_storage',
        detail:
          'Smazání účtu nejde v telefonu dokončit. Uvolni místo, odemkni telefon a zkus to znovu.',
      });

      expect(spy).not.toHaveBeenCalled();
      expect(mockClearLocalPrivateAccountData).not.toHaveBeenCalled();
      expect(mockRevertToAnonymous).not.toHaveBeenCalled();
      expect(mockRetireQuarantinedAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
      expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
      expect(mockGenerateUuidV4).not.toHaveBeenCalled();
      expect(mockFlushBeerPhotoDeletions).not.toHaveBeenCalled();

      // The session never changed, so the outer boundary finally may rehydrate
      // exactly once — no more.
      expect(mockRehydratePrivateStoresAfterBoundary).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed when corrupt receipt retirement fails after manual rotation', async () => {
    const sessionA: AccountSession = {
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
      credentialBindingId,
    };
    const sessionB: AccountSession = {
      deviceId: 'device-b',
      accountId: 'anonymous-b',
      token: 'fresh-b-token',
      authenticated: false,
      credentialBindingId: '55555555-5555-4555-8555-555555555555',
    };

    let currentSession = sessionA;
    // Persistent deterministic mocks throughout — nothing queued to leak.
    mockEnsureAccount.mockImplementation(async () => currentSession);
    mockReadAccountDeletionReceipt.mockResolvedValue({
      ok: false,
      storageError: false,
      failureKind: 'corrupt',
      quarantineId: 'qd-corrupt',
    });

    const events: string[] = [];
    mockClearLocalPrivateAccountData.mockImplementation(async () => {
      events.push('private-clear');
      return { ok: true };
    });
    mockRevertToAnonymous.mockImplementation(
      async (
        _signal?: AbortSignal,
        beforeSessionCleared?: () => void | Promise<void>,
      ) => {
        await beforeSessionCleared?.();
        currentSession = sessionB;
        events.push('rotation-complete');
        return sessionB;
      },
    );
    mockRetireQuarantinedAccountDeletionReceipt.mockImplementation(async () => {
      events.push('quarantine-retire-failed');
      return { ok: false, storageError: true };
    });
    mockRehydratePrivateStoresAfterBoundary.mockImplementation(async () => {
      events.push('rehydrated');
      return true;
    });

    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual({
      ok: false,
      code: 'account_deletion_storage',
      detail:
        'Smazání účtu nejde v telefonu dokončit. Uvolni místo, odemkni telefon a zkus to znovu.',
    });

    // Zero network while stranded on corrupt bytes.
    expect(spy).not.toHaveBeenCalled();

    // Old A was cleared with its exact durable identity...
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(1);
    expect(mockClearLocalPrivateAccountData).toHaveBeenCalledWith({
      outgoingSession: sessionA,
    });
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);

    // ...and the failed quarantine retirement is recorded exactly once.
    expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledWith('qd-corrupt');

    // Strict lifecycle: clear < rotation complete < failed retirement <
    // outer rehydrate. The rehydrate runs after the completed rotation and
    // publishes only the fresh session B, once old A private data was
    // strictly cleared.
    const at = (event: string): number => {
      const index = events.indexOf(event);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };
    expect(at('private-clear')).toBeLessThan(at('rotation-complete'));
    expect(at('rotation-complete')).toBeLessThan(at('quarantine-retire-failed'));
    expect(at('quarantine-retire-failed')).toBeLessThan(at('rehydrated'));
    expect(events.filter((event) => event === 'rehydrated')).toHaveLength(1);

    // No normal receipt mutation, operation mint, or photo flush rides the
    // corrupt path.
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockCompleteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockClearAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockArchiveAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
    expect(mockGenerateUuidV4).not.toHaveBeenCalled();
    expect(mockFlushBeerPhotoDeletions).not.toHaveBeenCalled();
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

  it('fails closed before receipt or network when exact credential binding cannot be persisted', async () => {
    mockEnsureCredentialBindingForSession.mockResolvedValue(null);
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );

    expect(mockEnsureCredentialBindingForSession).toHaveBeenCalledTimes(1);
    expect(mockReadAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
    expect(mockFlushBeerPhotoDeletions).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('deletes a durable anonymous session, upgrading a legacy missing binding first', async () => {
    // Legacy durable record: anonymous, no binding persisted yet.
    mockEnsureAccount.mockResolvedValue({
      deviceId: 'device-anon',
      accountId: 'anon-account',
      token: 'anon-token',
      authenticated: false,
    });
    // The helper atomically persists a fresh binding and hands back the SAME
    // anonymous account/token, now carrying the valid binding.
    mockEnsureCredentialBindingForSession.mockImplementation(async session =>
      session.authenticated ? session : { ...session, credentialBindingId },
    );
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });

    // Receipt v4 is written with the binding BEFORE the DELETE goes out.
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith(
      'anon-account',
      operationId,
      credentialBindingId,
    );
    expect(mockWriteAccountDeletionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[0],
    );

    // The DELETE rides the exact anonymous token and operation id.
    const deleteCalls = spy.mock.calls.filter(([, init]) => init.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    const [url, init] = deleteCalls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/account/me');
    expect(authHeader(init)).toBe('Bearer anon-token');
    expect((init.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationId,
    );
  });

  it('sends no network when an anonymous binding cannot be ensured', async () => {
    mockEnsureAccount.mockResolvedValue({
      deviceId: 'device-anon',
      accountId: 'anon-account',
      token: 'anon-token',
      authenticated: false,
    });
    mockEnsureCredentialBindingForSession.mockResolvedValue(null);
    const spy = installFetch(fetchResolving(204, undefined));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_storage' }),
    );

    expect(spy).not.toHaveBeenCalled();
    expect(mockWriteAccountDeletionReceipt).not.toHaveBeenCalled();
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

  it('asks for a fresh confirmation over a stale pending A receipt on anonymous B, never deleting B on that tap', async () => {
    const bindingB = '55555555-5555-4555-8555-555555555555';
    const operationB = '00000000-0000-4000-8000-000000000002';
    mockEnsureAccount.mockResolvedValue({
      deviceId: 'device-b',
      accountId: 'anonymous-b',
      token: 'anonymous-token-b',
      authenticated: false,
      credentialBindingId: bindingB,
    });
    // Anonymous B still gets its binding ensured before any operation is minted.
    mockEnsureCredentialBindingForSession.mockImplementation(async session =>
      session.authenticated ? session : { ...session, credentialBindingId: bindingB },
    );
    mockGenerateUuidV4.mockReturnValueOnce(operationB);
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({
        ok: true,
        intent: { ...pendingIntent, accountId: 'deleted-account-a' },
        orphans: [],
      })
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] });
    const spy = installFetch(
      jest.fn(async (url: string) =>
        url.endsWith('/v1/account/deletion-status')
          ? {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ complete: true }),
            }
          : { ok: true, status: 204, text: async () => '' },
      ),
    );

    // Tap 1: run it, but defer its assertions until every queued mock below is
    // consumed — a RED source must not abort the test with one-shots pending.
    const firstResult = await auth.deleteAccount();
    const tap1CallCount = spy.mock.calls.length;
    const tap1WroteReceipt = mockWriteAccountDeletionReceipt.mock.calls.length > 0;
    const tap1Reverted = mockRevertToAnonymous.mock.calls.length > 0;

    // Tap 2: with no active A intent, a NEW operation is minted and bound to B.
    await expect(auth.deleteAccount()).resolves.toEqual({ ok: true });
    expect(mockGenerateUuidV4).toHaveBeenCalledTimes(1);

    // The receipt is written before any network traffic...
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledTimes(1);
    expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith(
      'anonymous-b',
      operationB,
      bindingB,
    );
    expect(mockWriteAccountDeletionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      spy.mock.invocationCallOrder[1],
    );

    // ...and exactly one DELETE goes out, riding B's token and operation id.
    const deleteCalls = spy.mock.calls.filter(([, init]) => init.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    const [url, init] = deleteCalls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/account/me');
    expect(authHeader(init)).toBe('Bearer anonymous-token-b');
    expect((init.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationB,
    );

    // All one-shots are consumed; now assert tap 1. The proven A receipt is
    // retired for A only and the tap ends asking the user to confirm again.
    // B is never DELETEd on that tap.
    expect(
      spy.mock.calls
        .slice(0, tap1CallCount)
        .every(([callUrl]) => callUrl === 'https://api.test/v1/account/deletion-status'),
    ).toBe(true);
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenCalledWith(
      'deleted-account-a',
      operationId,
    );
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledWith(
      'deleted-account-a',
      operationId,
    );
    expect(tap1WroteReceipt).toBe(false);
    expect(tap1Reverted).toBe(false);

    // At the very end: tap 1 must end asking for a fresh confirmation.
    expect(firstResult).toEqual({
      ok: false,
      code: 'account_deletion_recovered',
      detail:
        'Předchozí mazání jsem dokončil. Pokud chceš smazat i aktuální účet, potvrď to znovu.',
    });
  });

  it('archives a still-pending A operation, never deletes B on that tap, and frees B for a later confirmation', async () => {
    const accountB = {
      deviceId: 'device-b',
      accountId: 'account-b',
      token: 'token-b',
      authenticated: true,
      credentialBindingId: '55555555-5555-4555-8555-555555555555',
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
      '55555555-5555-4555-8555-555555555555',
    );
    expect(mockRetireAccountDeletionOrphan).not.toHaveBeenCalled();
  });

  it('retries receipt cleanup after the local boundary succeeded but cleanup failed', async () => {
    const bindingB = '55555555-5555-4555-8555-555555555555';
    const operationA = operationId;
    const operationB = '00000000-0000-4000-8000-000000000002';
    const sessionA: AccountSession = {
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
      credentialBindingId,
    };
    const sessionB: AccountSession = {
      deviceId: 'device-b',
      accountId: 'anonymous-b',
      token: 'anonymous-token-b',
      authenticated: false,
    };
    // Durable identity per tap: authenticated A performs the first DELETE,
    // then the strict local rotation leaves fresh anonymous B as the only
    // surviving session for taps 2 and 3.
    mockEnsureAccount
      .mockResolvedValueOnce(sessionA)
      .mockResolvedValueOnce(sessionB)
      .mockResolvedValueOnce(sessionB);
    mockEnsureCredentialBindingForSession.mockImplementation(async session =>
      session.authenticated
        ? { ...session, credentialBindingId }
        : { ...session, credentialBindingId: bindingB },
    );
    mockGenerateUuidV4.mockReturnValueOnce(operationA).mockReturnValueOnce(operationB);
    // Receipt ledger across the three taps: clean start, the surviving
    // complete A receipt, then clean again for B's own confirmation.
    mockReadAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] })
      .mockResolvedValueOnce({
        ok: true,
        intent: { ...completeIntent, accountId: 'account-a' },
        orphans: [],
      })
      .mockResolvedValueOnce({ ok: true, intent: null, orphans: [] });
    // Receipt cleanup fails exactly once (after tap 1's boundary); every later
    // clear succeeds.
    mockClearAccountDeletionReceipt
      .mockResolvedValueOnce({ ok: false, storageError: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const spy = installFetch(
      jest.fn(async (url: string, init?: RequestInit) =>
        (init?.method ?? '') === 'DELETE'
          ? { ok: true, status: 204, text: async () => '' }
          : {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ complete: true }),
            },
      ),
    );

    // Run all three taps first, snapshotting per-tap state along the way, so
    // the assertions below never run while a queued one-shot mock is still
    // pending — a RED source cannot strand them mid-tap.
    const tap1Result = await auth.deleteAccount();
    const tap1Calls = spy.mock.calls.length;
    const tap1Deletes = spy.mock.calls.filter(
      ([, init]) => (init?.method ?? '') === 'DELETE',
    ).length;
    const tap1Reverts = mockRevertToAnonymous.mock.calls.length;
    const tap1Writes = mockWriteAccountDeletionReceipt.mock.calls.length;
    const tap1PrivateClears = mockClearLocalPrivateAccountData.mock.calls.length;

    const tap2Result = await auth.deleteAccount();
    const tap2Calls = spy.mock.calls.length;
    const tap2Reverts = mockRevertToAnonymous.mock.calls.length;
    const tap2Writes = mockWriteAccountDeletionReceipt.mock.calls.length;
    const tap2Generates = mockGenerateUuidV4.mock.calls.length;
    const tap2PrivateClears = mockClearLocalPrivateAccountData.mock.calls.length;

    const tap3Result = await auth.deleteAccount();

    // Every queued one-shot is consumed by now; the rest is leak-free.
    expect(mockEnsureAccount).toHaveBeenCalledTimes(3);
    expect(mockReadAccountDeletionReceipt).toHaveBeenCalledTimes(3);
    expect(mockGenerateUuidV4).toHaveBeenCalledTimes(2);
    expect(mockClearAccountDeletionReceipt).toHaveBeenCalledTimes(3);

    // Exact network sequence: DELETE A -> public status proof for A -> DELETE B.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/v1/account/me',
      'https://api.test/v1/account/deletion-status',
      'https://api.test/v1/account/me',
    ]);
    const [deleteAInit, statusInit, deleteBInit] = spy.mock.calls.map(
      call => call[1],
    ) as [RequestInit, RequestInit, RequestInit];

    // Tap 1: A's DELETE succeeded and the strict rotation to B ran, but the
    // receipt cleanup failed — the canonical storage error defers the finish.
    expect(tap1Result).toEqual({
      ok: false,
      code: 'account_deletion_storage',
      detail:
        'Smazání účtu nejde v telefonu dokončit. Uvolni místo, odemkni telefon a zkus to znovu.',
    });
    expect(deleteAInit.method).toBe('DELETE');
    expect(authHeader(deleteAInit)).toBe('Bearer token-a');
    expect((deleteAInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationA,
    );
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenNthCalledWith(1, 'account-a', operationA);
    expect(tap1Deletes).toBe(1);
    expect(tap1Reverts).toBe(1);
    expect(tap1PrivateClears).toBe(1);
    expect(tap1Writes).toBe(1);
    expect(mockWriteAccountDeletionReceipt).toHaveBeenNthCalledWith(
      1,
      'account-a',
      operationA,
      credentialBindingId,
    );

    // Tap 2: the surviving complete A receipt is publicly re-proved over the
    // server status endpoint (no bearer, A's capability header) and cleared.
    // Anonymous B is never DELETEd, reverted, privately cleared, nor given a
    // minted operation or receipt — the tap only retires A's proven completion.
    expect(tap2Result).toEqual({
      ok: false,
      code: 'account_deletion_recovered',
      detail:
        'Předchozí mazání jsem dokončil. Pokud chceš smazat i aktuální účet, potvrď to znovu.',
    });
    expect(statusInit.method).toBe('GET');
    expect(authHeader(statusInit)).toBeUndefined();
    expect((statusInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationA,
    );
    expect(mockClearAccountDeletionReceipt).toHaveBeenNthCalledWith(2, 'account-a', operationA);
    expect(tap2Calls).toBe(tap1Calls + 1);
    expect(tap2Reverts).toBe(tap1Reverts);
    expect(tap2PrivateClears).toBe(tap1PrivateClears);
    expect(tap2Writes).toBe(tap1Writes);
    expect(tap2Generates).toBe(1);

    // Tap 3: with a clean receipt, the confirmed user deletes B for real — a
    // NEW operation is minted, bound to B, persisted before the DELETE, and
    // retired locally afterwards.
    expect(tap3Result).toEqual({ ok: true });
    expect(mockWriteAccountDeletionReceipt).toHaveBeenNthCalledWith(
      2,
      'anonymous-b',
      operationB,
      bindingB,
    );
    expect(mockWriteAccountDeletionReceipt.mock.invocationCallOrder[1]).toBeLessThan(
      spy.mock.invocationCallOrder[2],
    );
    expect(deleteBInit.method).toBe('DELETE');
    expect(authHeader(deleteBInit)).toBe('Bearer anonymous-token-b');
    expect((deleteBInit.headers as Record<string, string>)['X-Account-Deletion-Operation-Id']).toBe(
      operationB,
    );
    expect(mockCompleteAccountDeletionReceipt).toHaveBeenNthCalledWith(2, 'anonymous-b', operationB);
    expect(mockClearAccountDeletionReceipt).toHaveBeenNthCalledWith(3, 'anonymous-b', operationB);

    // Across the whole story, only taps 1 and 3 ever DELETE.
    expect(
      spy.mock.calls.filter(([, init]) => (init?.method ?? '') === 'DELETE'),
    ).toHaveLength(2);
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(2);
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
    const spy = installFetch(fetchResolving(200, { complete: true }));

    await expect(auth.deleteAccount()).resolves.toEqual(
      expect.objectContaining({ ok: false, code: 'account_deletion_recovered' }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('https://api.test/v1/account/deletion-status');
    expect(spy.mock.calls.every(([url]) => url !== 'https://api.test/v1/account/me')).toBe(true);
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
      credentialBindingId,
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

  it.each([
    ['authenticated A', true],
    ['anonymous A', false],
  ] as const)(
    'requires a second confirmation after corrupt receipt recovery (%s)',
    async (_label, authenticated) => {
      const newOperationId = '00000000-0000-4000-8000-000000000002';
      // Fresh anonymous B gets its own canonical binding, distinct from A's.
      const freshBindingB = '55555555-5555-4555-8555-555555555555';
      const sessionA: AccountSession = {
        deviceId: 'device-a',
        accountId: 'account-a',
        token: 'token-a',
        authenticated,
        credentialBindingId,
      };
      const sessionB: AccountSession = {
        deviceId: 'device-b',
        accountId: 'anonymous-b',
        token: 'fresh-b-token',
        authenticated: false,
        credentialBindingId: freshBindingB,
      };

      let currentSession = sessionA;
      mockEnsureAccount.mockImplementation(async () => currentSession);

      // Deterministic persistent implementation — never a queued one-shot chain.
      let receiptReads = 0;
      mockReadAccountDeletionReceipt.mockImplementation(async () => {
        receiptReads += 1;
        if (receiptReads === 1) {
          return {
            ok: false,
            storageError: false,
            failureKind: 'corrupt' as const,
            quarantineId: 'qd-corrupt',
          };
        }
        return { ok: true, intent: null, orphans: [] };
      });

      const boundaryEvents: string[] = [];
      mockClearLocalPrivateAccountData.mockImplementation(async () => {
        boundaryEvents.push('private-clear');
        return { ok: true };
      });
      mockRevertToAnonymous.mockImplementation(
        async (
          _signal?: AbortSignal,
          beforeSessionCleared?: () => void | Promise<void>,
        ) => {
          await beforeSessionCleared?.();
          currentSession = sessionB;
          boundaryEvents.push('rotation-complete');
          return sessionB;
        },
      );
      mockRetireQuarantinedAccountDeletionReceipt.mockImplementation(async () => {
        boundaryEvents.push('quarantine-retired');
        return { ok: true };
      });
      mockEnsureCredentialBindingForSession.mockImplementation(async session => ({
        ...session,
        credentialBindingId: session.credentialBindingId ?? credentialBindingId,
      }));
      mockGenerateUuidV4.mockReturnValue(newOperationId);

      const spy = installFetch(
        jest.fn(async (url: string, init?: RequestInit) => {
          if (url === 'https://api.test/v1/account/me' && init?.method === 'DELETE') {
            return { ok: true, status: 204, text: async () => '' };
          }
          throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`);
        }),
      );

      // Tap 1 runs to completion first; its evidence is snapshotted so an
      // unfixed source cannot strand unconsumed mocks before tap 2 executes.
      const firstResult = await auth.deleteAccount();
      const tap1FetchCalls = spy.mock.calls.length;
      const tap1WroteReceipt = mockWriteAccountDeletionReceipt.mock.calls.length;
      const tap1MutatedNormalReceipt =
        mockCompleteAccountDeletionReceipt.mock.calls.length +
        mockClearAccountDeletionReceipt.mock.calls.length +
        mockArchiveAccountDeletionReceipt.mock.calls.length +
        mockRetireAccountDeletionOrphan.mock.calls.length;
      const tap1MintedOperations = mockGenerateUuidV4.mock.calls.length;
      const tap1PhotoFlushes = mockFlushBeerPhotoDeletions.mock.calls.length;

      const secondResult = await auth.deleteAccount();

      // Tap 1: exact recovered outcome, identical to startup recovery.
      expect(firstResult).toEqual({
        ok: false,
        code: 'account_deletion_recovered',
        detail:
          'Předchozí mazání jsem dokončil. Pokud chceš smazat i aktuální účet, potvrď to znovu.',
      });
      // Corrupt bytes finish fully offline: zero network attributable to tap 1.
      expect(spy.mock.calls.slice(0, tap1FetchCalls)).toHaveLength(0);
      // Exactly outgoing A was cleared locally...
      expect(mockClearLocalPrivateAccountData).toHaveBeenCalledTimes(2);
      expect(mockClearLocalPrivateAccountData).toHaveBeenNthCalledWith(
        1,
        { outgoingSession: sessionA },
      );
      expect(boundaryEvents.indexOf('private-clear')).toBeLessThan(
        boundaryEvents.indexOf('rotation-complete'),
      );
      expect(boundaryEvents.indexOf('rotation-complete')).toBeLessThan(
        boundaryEvents.indexOf('quarantine-retired'),
      );
      expect(mockRetireQuarantinedAccountDeletionReceipt).toHaveBeenCalledWith('qd-corrupt');
      // No normal receipt mutation, operation mint, photo flush, or DELETE.
      expect(tap1WroteReceipt).toBe(0);
      expect(tap1MutatedNormalReceipt).toBe(0);
      expect(tap1MintedOperations).toBe(0);
      expect(tap1PhotoFlushes).toBe(0);

      // Tap 2 succeeds against fresh anonymous B and owns the only DELETE.
      expect(secondResult).toEqual({ ok: true });
      const deleteIndex = spy.mock.calls.findIndex(([, init]) => init?.method === 'DELETE');
      expect(deleteIndex).toBeGreaterThanOrEqual(0);
      const [deleteUrl, deleteInit] = spy.mock.calls[deleteIndex] as [string, RequestInit];
      expect(spy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
      expect(deleteUrl).toBe('https://api.test/v1/account/me');
      expect(authHeader(deleteInit)).toBe('Bearer fresh-b-token');
      expect((deleteInit.headers as Record<string, string>)[
        'X-Account-Deletion-Operation-Id'
      ]).toBe(newOperationId);
      // The receipt for fresh B uses its own fresh binding, durable before that DELETE.
      expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledTimes(1);
      expect(mockWriteAccountDeletionReceipt).toHaveBeenCalledWith(
        'anonymous-b',
        newOperationId,
        freshBindingB,
      );
      expect(mockWriteAccountDeletionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
        spy.mock.invocationCallOrder[deleteIndex],
      );
    },
  );
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

// ---------------------------------------------------------------------------
// UGC consent — profile snapshot + planned acceptUgcConsent
// ---------------------------------------------------------------------------
describe('UGC consent', () => {
  beforeEach(() => {
    clearUgcConsentStateForTests();
  });

  describe('fetchAccountProfile', () => {
    it('parses a valid ugc_consent snapshot into camelCase and primes the policy header cache', async () => {
      const spy = installFetch(
        fetchResolving(200, {
          id: 'acc-ugc',
          is_anonymous: false,
          ugc_consent: {
            policy_version: '2026-08-01',
            accepted: true,
            accepted_version: '2026-08-01',
            accepted_at: '2026-08-20T18:30:00Z',
          },
        }),
      );

      const profile = await auth.fetchAccountProfile();

      expect(profile?.id).toBe('acc-ugc');
      const consent = (profile as unknown as { ugcConsent?: unknown }).ugcConsent;
      expect(consent).toEqual({
        policyVersion: '2026-08-01',
        accepted: true,
        acceptedVersion: '2026-08-01',
        acceptedAt: '2026-08-20T18:30:00Z',
      });
      // The fresh snapshot feeds ugcPolicyHeaders for this exact account,
      // but an older learned version never downgrades the baked policy header.
      expect(ugcPolicyHeaders('acc-ugc')).toEqual({
        [UGC_POLICY_HEADER]: '2026-08-22',
      });

      const { url, init } = firstCall(spy);
      expect(url).toBe('https://api.test/v1/account/me');
      expect(init.method).toBe('GET');
      expect(authHeader(init)).toBe('Bearer cur-tok');
    });

    it('keeps an old response without ugc_consent usable and caches no header', async () => {
      installFetch(fetchResolving(200, { id: 'acc-old', is_anonymous: false }));

      const profile = await auth.fetchAccountProfile();

      expect(profile?.id).toBe('acc-old');
      expect((profile as unknown as { ugcConsent?: unknown }).ugcConsent).toBeUndefined();
      expect(ugcPolicyHeaders('acc-old')).toEqual({ [UGC_POLICY_HEADER]: '2026-08-22' });
    });

    it('ignores a malformed ugc_consent block and never crashes', async () => {
      installFetch(
        fetchResolving(200, {
          id: 'acc-bad',
          is_anonymous: false,
          ugc_consent: { policy_version: 123, accepted: 'yes' },
        }),
      );

      const profile = await auth.fetchAccountProfile();

      expect(profile?.id).toBe('acc-bad');
      expect((profile as unknown as { ugcConsent?: unknown }).ugcConsent).toBeFalsy();
      expect(ugcPolicyHeaders('acc-bad')).toEqual({ [UGC_POLICY_HEADER]: '2026-08-22' });
    });
  });

  describe('acceptUgcConsent', () => {
    type UgcConsentSnapshotShape = {
      policyVersion: string;
      accepted: boolean;
      acceptedVersion: string;
      acceptedAt: string | null;
    };
    type AcceptUgcConsentFn = (
      version: string,
    ) =>
      | Promise<{ ok: true; ugcConsent: UgcConsentSnapshotShape }>
      | Promise<{ ok: false; code: string; detail: string }>;

    function requireAcceptUgcConsent(): AcceptUgcConsentFn {
      const fn = (auth as unknown as { acceptUgcConsent?: AcceptUgcConsentFn }).acceptUgcConsent;
      if (typeof fn !== 'function') {
        throw new Error('auth.acceptUgcConsent is not implemented yet');
      }
      return fn;
    }

    it('PUTs {version} to /v1/account/me/ugc-consent with the current bearer and caches the returned snapshot', async () => {
      const spy = installFetch(
        fetchResolving(200, {
          ugc_consent: {
            policy_version: '2026-09-01',
            accepted: true,
            accepted_version: '2026-09-01',
            accepted_at: '2026-08-22T19:00:00Z',
          },
        }),
      );

      const result = await requireAcceptUgcConsent()('2026-09-01');

      expect(result).toEqual({
        ok: true,
        ugcConsent: {
          policyVersion: '2026-09-01',
          accepted: true,
          acceptedVersion: '2026-09-01',
          acceptedAt: '2026-08-22T19:00:00Z',
        },
      });

      const { url, init } = firstCall(spy);
      expect(url).toBe('https://api.test/v1/account/me/ugc-consent');
      expect(init.method).toBe('PUT');
      // bearer: 'ensure' — the implementation captures the durable account session.
      expect(authHeader(init)).toBe('Bearer anon-tok');
      expect(bodyOf(init)).toEqual({ version: '2026-09-01' });

      // The 200 snapshot updates the header cache for the durable account.
      expect(ugcPolicyHeaders('a')).toEqual({ [UGC_POLICY_HEADER]: '2026-09-01' });
    });

    it.each([
      ['409 conflict', 409, { detail: 'Nejnovější verzi už máš.', code: 'ugc_consent_conflict' }],
      ['428 precondition', 428, { detail: 'Potřebujeme souhlas.', code: 'ugc_consent_required' }],
    ] as const)(
      'returns the existing auth-style {ok:false, code, detail} on a coded %s',
      async (_label, status, body) => {
        installFetch(fetchResolving(status, body));

        const result = await requireAcceptUgcConsent()('2026-09-01');

        expect(result).toEqual({ ok: false, code: body.code, detail: body.detail });
      },
    );
  });
});
