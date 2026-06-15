/**
 * Auth client — email/password + Google + Apple sign-in, account linking, and
 * account deletion against the na-pivo backend (/v1/auth/*, /v1/account/me).
 *
 * Layered on the session plumbing in src/data/account.ts: the anonymous device
 * account is the bootstrap, and signing in CLAIMS it (the backend re-parents the
 * device account's data onto the credential) so the user's drinks/ratings/visits
 * follow them. On success we persist the new bearer token via setSession(); on
 * sign-out / deletion we revertToAnonymous().
 *
 * Every call resolves to a discriminated AuthResult — never throws — so screens
 * can render an error message without try/catch. Provider tokens come from the
 * native SDK wrappers in src/data/socialAuth.ts.
 */

import {
  ensureAccount,
  getSessionToken,
  revertToAnonymous,
  setSession,
} from './account';
import { getBackendEndpoint } from './backendConfig';
import { getAppleCredential, getGoogleIdToken, SocialAuthError } from './socialAuth';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 12000;

export type AuthProvider = 'email' | 'google' | 'apple';

export interface AccountProfile {
  id: string;
  deviceId: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  providers: AuthProvider[];
  isAnonymous: boolean;
  status: string;
}

/** Success carries the fresh account state; failure carries a code + message. */
export type AuthResult =
  | { ok: true; profile: AccountProfile }
  | { ok: false; code: string; detail: string };

/** Lightweight ok/err result for calls that don't return a profile. */
export type AuthActionResult = { ok: true } | { ok: false; code: string; detail: string };

interface RawAccount {
  id?: string;
  device_id?: string;
  display_name?: string;
  email?: string;
  email_verified?: boolean;
  providers?: string[];
  is_anonymous?: boolean;
  status?: string;
  token?: string;
}

const CANCELLED: AuthResult = { ok: false, code: 'cancelled', detail: '' };

function parseProfile(data: RawAccount): AccountProfile {
  return {
    id: data.id ?? '',
    deviceId: data.device_id ?? '',
    displayName: data.display_name ?? '',
    email: data.email ?? '',
    emailVerified: data.email_verified === true,
    providers: (data.providers ?? []) as AuthProvider[],
    // Treat a missing flag as anonymous; only an explicit false means signed in.
    isAnonymous: data.is_anonymous !== false,
    status: data.status ?? 'active',
  };
}

/** Turn a backend error body into a stable {code, detail}. Handles both our
 *  {detail, code} shape and DRF's field-error dict ({field: [msg, ...]}). */
function extractError(data: unknown, status: number): { code: string; detail: string } {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === 'string') {
      return { code: typeof obj.code === 'string' ? obj.code : `http_${status}`, detail: obj.detail };
    }
    // DRF field errors: take the first message.
    for (const value of Object.values(obj)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return { code: `http_${status}`, detail: value[0] };
      }
      if (typeof value === 'string') {
        return { code: `http_${status}`, detail: value };
      }
    }
  }
  return { code: `http_${status}`, detail: 'Něco se pokazilo. Zkus to prosím znovu.' };
}

interface FetchOutcome {
  status: number;
  ok: boolean;
  data: RawAccount & Record<string, unknown>;
}

/**
 * POST/DELETE a JSON body to an auth endpoint. `bearer`:
 *  - 'current'  → attach the current session token (authenticated calls);
 *  - 'ensure'   → ensure an anonymous account first, attach its token (claim);
 *  - 'none'     → no Authorization header.
 * Returns a network-error sentinel instead of throwing.
 */
async function authFetch(
  path: string,
  opts: { method?: string; body?: unknown; bearer?: 'current' | 'ensure' | 'none' },
): Promise<FetchOutcome | { networkError: true }> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return { networkError: true };

  let token: string | null = null;
  if (opts.bearer === 'ensure') {
    const session = await ensureAccount();
    token = session?.token ?? null;
  } else if (opts.bearer === 'current') {
    token = await getSessionToken();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resp = await fetch(endpoint, {
      method: opts.method ?? 'POST',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      // 204 / empty bodies parse to {}.
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    return { status: resp.status, ok: resp.ok, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) {
      trackApiFailure('auth_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { networkError: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

const NETWORK_ERROR = {
  ok: false as const,
  code: 'network',
  detail: 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.',
};

/** Apply a successful auth response: persist the new session, return the profile. */
async function applyAuthSuccess(data: RawAccount): Promise<AuthResult> {
  const profile = parseProfile(data);
  if (data.token && profile.id) {
    await setSession({
      deviceId: profile.deviceId || undefined,
      accountId: profile.id,
      token: data.token,
      authenticated: true,
    });
  }
  return { ok: true, profile };
}

// ---------------------------------------------------------------------------
// Email + password
// ---------------------------------------------------------------------------
export async function registerEmail(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/register', {
    bearer: 'ensure', // claim the current anonymous account
    body: {
      email: params.email,
      password: params.password,
      display_name: params.displayName ?? '',
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

export async function loginEmail(params: { email: string; password: string }): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/login', {
    bearer: 'none',
    body: { email: params.email, password: params.password },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

// ---------------------------------------------------------------------------
// Social sign-in / claim
// ---------------------------------------------------------------------------
function mapSocialError(err: unknown): AuthResult {
  if (err instanceof SocialAuthError) {
    if (err.code === 'cancelled') return CANCELLED;
    if (err.code === 'unsupported') {
      return { ok: false, code: 'unsupported', detail: 'Tato možnost není na tomto zařízení dostupná.' };
    }
    return {
      ok: false,
      code: err.code,
      detail: 'Přihlášení přes poskytovatele se nezdařilo. Zkus to prosím znovu.',
    };
  }
  return { ok: false, code: 'failed', detail: 'Přihlášení se nezdařilo.' };
}

export async function signInWithGoogle(): Promise<AuthResult> {
  let idToken: string;
  try {
    idToken = await getGoogleIdToken();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/google', { bearer: 'ensure', body: { id_token: idToken } });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

export async function signInWithApple(): Promise<AuthResult> {
  let credential;
  try {
    credential = await getAppleCredential();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/apple', {
    bearer: 'ensure',
    body: {
      identity_token: credential.identityToken,
      authorization_code: credential.authorizationCode,
      full_name: credential.fullName,
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

// ---------------------------------------------------------------------------
// Linking / unlinking (authenticated; session token is unchanged)
// ---------------------------------------------------------------------------
export async function linkGoogle(): Promise<AuthResult> {
  let idToken: string;
  try {
    idToken = await getGoogleIdToken();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/link', {
    bearer: 'current',
    body: { provider: 'google', id_token: idToken },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

export async function linkApple(): Promise<AuthResult> {
  let credential;
  try {
    credential = await getAppleCredential();
  } catch (err) {
    return mapSocialError(err);
  }
  const res = await authFetch('/v1/auth/link', {
    bearer: 'current',
    body: {
      provider: 'apple',
      identity_token: credential.identityToken,
      authorization_code: credential.authorizationCode,
      full_name: credential.fullName,
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

export async function unlinkProvider(provider: AuthProvider): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/unlink', { bearer: 'current', body: { provider } });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

export async function setPassword(params: { password: string; email?: string }): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/set-password', {
    bearer: 'current',
    body: { password: params.password, email: params.email ?? '' },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

// ---------------------------------------------------------------------------
// Session / lifecycle
// ---------------------------------------------------------------------------
export async function logout(options?: { all?: boolean }): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/logout', {
    bearer: 'current',
    body: { all: options?.all === true },
  });
  // Even if the network call fails, drop the local session so the UI signs out.
  await revertToAnonymous();
  if ('networkError' in res) return { ok: true };
  return { ok: true };
}

export async function deleteAccount(): Promise<AuthActionResult> {
  const res = await authFetch('/v1/account/me', { method: 'DELETE', bearer: 'current' });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok && res.status !== 204) {
    return { ok: false, ...extractError(res.data, res.status) };
  }
  await revertToAnonymous();
  return { ok: true };
}

export async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/request-password-reset', {
    bearer: 'none',
    body: { email },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  // The backend always 202s (no account enumeration); treat any 2xx as success.
  return { ok: true };
}

export async function resetPassword(params: { token: string; password: string }): Promise<AuthResult> {
  const res = await authFetch('/v1/auth/reset-password', {
    bearer: 'none',
    body: { token: params.token, password: params.password },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return applyAuthSuccess(res.data);
}

export async function requestEmailVerification(): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/request-email-verify', { bearer: 'current', body: {} });
  if ('networkError' in res) return NETWORK_ERROR;
  return { ok: true };
}

export async function verifyEmail(token: string): Promise<AuthActionResult> {
  const res = await authFetch('/v1/auth/verify-email', { bearer: 'none', body: { token } });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true };
}

/** Fetch the current account state (GET /v1/account/me). Null when unavailable. */
export async function fetchAccountProfile(): Promise<AccountProfile | null> {
  const res = await authFetch('/v1/account/me', { method: 'GET', bearer: 'current' });
  if ('networkError' in res || !res.ok) return null;
  return parseProfile(res.data);
}
