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
import { ensureAccount, getSessionToken, revertToAnonymous, setSession } from '@/data/account';
import { getBackendEndpoint } from '@/data/backendConfig';
import { getAppleCredential, getGoogleIdToken, SocialAuthError } from '@/data/socialAuth';
import { trackApiFailure } from '@/data/telemetryClient';
import * as efs from 'expo-file-system';

jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'anon-tok',
    authenticated: false,
  })),
  getSessionToken: jest.fn(async () => 'cur-tok'),
  setSession: jest.fn(async () => undefined),
  revertToAnonymous: jest.fn(async () => null),
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
const mockSetSession = setSession as jest.MockedFunction<typeof setSession>;
const mockRevertToAnonymous = revertToAnonymous as jest.MockedFunction<typeof revertToAnonymous>;
const mockGetGoogleIdToken = getGoogleIdToken as jest.MockedFunction<typeof getGoogleIdToken>;
const mockGetAppleCredential = getAppleCredential as jest.MockedFunction<typeof getAppleCredential>;
const mockTrackApiFailure = trackApiFailure as jest.MockedFunction<typeof trackApiFailure>;
const mockFileUpload = (efs as unknown as { __upload: jest.Mock }).__upload;
const mockFileCtor = (efs as unknown as { __ctor: jest.Mock }).__ctor;

const ORIGINAL_FETCH = global.fetch;

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
  mockRevertToAnonymous.mockResolvedValue(null);
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
        distinctPubs: 4,
        ratingsCount: 3,
        totalSpentCzk: 720,
        maxVisitsToOnePub: 5,
      },
      achievements: {
        firstTen: true,
        regular: true,
        reviewer: false,
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
  it('logs in without a bearer header and stores the session on success', async () => {
    const spy = installFetch(
      fetchResolving(200, { id: 'acc-2', token: 'login-tok', is_anonymous: false, providers: ['email'] }),
    );

    const result = await auth.loginEmail({ email: 'jan@example.com', password: 'pw' });

    expect(result.ok).toBe(true);
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/login');
    expect(init.method).toBe('POST');
    // bearer: 'none' → no Authorization header, no ensure/getSessionToken.
    expect(authHeader(init)).toBeUndefined();
    expect(mockEnsureAccount).not.toHaveBeenCalled();
    expect(mockGetSessionToken).not.toHaveBeenCalled();
    expect(bodyOf(init)).toEqual({ email: 'jan@example.com', password: 'pw' });

    expect(mockSetSession).toHaveBeenCalledWith({
      deviceId: undefined,
      accountId: 'acc-2',
      token: 'login-tok',
      authenticated: true,
    });
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
    expect(bodyOf(init)).toEqual({ id_token: 'gtok' });
    expect(mockSetSession).toHaveBeenCalledTimes(1);
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
  it('calls /v1/auth/logout then reverts to anonymous, returning ok', async () => {
    const spy = installFetch(fetchResolving(200, {}));

    const result = await auth.logout();

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/auth/logout');
    expect(authHeader(init)).toBe('Bearer cur-tok');
    expect(bodyOf(init)).toEqual({ all: false });
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
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------
describe('deleteAccount', () => {
  it('DELETEs /v1/account/me and reverts to anonymous on 204', async () => {
    const spy = installFetch(fetchResolving(204, undefined));

    const result = await auth.deleteAccount();

    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(spy);
    expect(url).toBe('https://api.test/v1/account/me');
    expect(init.method).toBe('DELETE');
    expect(authHeader(init)).toBe('Bearer cur-tok');
    expect(mockRevertToAnonymous).toHaveBeenCalledTimes(1);
  });

  it('returns the error and does NOT revert on a non-204 failure', async () => {
    installFetch(fetchResolving(403, { detail: 'Nelze smazat účet.', code: 'forbidden' }));

    const result = await auth.deleteAccount();

    expect(result).toEqual({ ok: false, code: 'forbidden', detail: 'Nelze smazat účet.' });
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });

  it('returns the network sentinel and does NOT revert when fetch rejects', async () => {
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const result = await auth.deleteAccount();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('network');
    expect(mockRevertToAnonymous).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------
describe('resetPassword', () => {
  it('exchanges the token for a fresh session (applyAuthSuccess) on success', async () => {
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
  });

  it('returns the error on an invalid/expired token (400)', async () => {
    installFetch(fetchResolving(400, { detail: 'Odkaz vypršel.', code: 'invalid_token' }));

    const result = await auth.resetPassword({ token: 'expired', password: 'newpw' });

    expect(result).toEqual({ ok: false, code: 'invalid_token', detail: 'Odkaz vypršel.' });
    expect(mockSetSession).not.toHaveBeenCalled();
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
