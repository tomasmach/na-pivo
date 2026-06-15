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

import { File, UploadType } from 'expo-file-system';

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

export interface AccountSettings {
  mode?: 'nearest' | 'surprise';
  maxDistanceKm?: number | null;
  priceCurrency?: 'CZK' | 'EUR';
  hapticEnabled?: boolean;
  soundEnabled?: boolean;
  hideClosedPubs?: boolean;
  hidePubNames?: boolean;
  marketingEmailsEnabled?: boolean;
}

export interface AccountSubscription {
  tier: 'free' | 'plus';
  status: 'inactive' | 'pending_verification' | 'active' | 'grace_period' | 'expired';
  platform: string;
  productId: string;
  originalTransactionId: string;
  expiresAt: string | null;
  updatedAt: string | null;
}

export interface AccountStats {
  totalBeers: number;
  distinctPubs: number;
  ratingsCount: number;
  totalSpentCzk: number;
  maxVisitsToOnePub: number;
}

export interface AccountAchievements {
  firstTen: boolean;
  regular: boolean;
  reviewer: boolean;
}

export interface AccountProfile {
  id: string;
  deviceId: string;
  /** Unique public handle (without the leading @). Null until the user picks one. */
  nickname: string | null;
  /** Optional real/display name. */
  displayName: string;
  /** Absolute, loadable avatar URL minted by the backend, or null. */
  avatarUrl: string | null;
  /** Public-by-default visibility. */
  isPublic: boolean;
  email: string;
  emailVerified: boolean;
  providers: AuthProvider[];
  isAnonymous: boolean;
  status: string;
  settings?: AccountSettings;
  subscription?: AccountSubscription;
  stats?: AccountStats;
  achievements?: AccountAchievements;
  usage?: { walkedDistanceM: number };
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
  nickname?: string | null;
  display_name?: string;
  is_public?: boolean;
  avatar_url?: string | null;
  /** Defensive alias some providers/responses use instead of avatar_url. */
  picture?: string | null;
  has_avatar?: boolean;
  settings?: {
    mode?: string;
    max_distance_km?: number | null;
    price_currency?: string;
    haptic_enabled?: boolean;
    sound_enabled?: boolean;
    hide_closed_pubs?: boolean;
    hide_pub_names?: boolean;
    marketing_emails_enabled?: boolean;
  };
  subscription?: {
    tier?: string;
    status?: string;
    platform?: string;
    product_id?: string;
    original_transaction_id?: string;
    expires_at?: string | null;
    updated_at?: string | null;
  };
  stats?: {
    total_beers?: number;
    distinct_pubs?: number;
    ratings_count?: number;
    total_spent_czk?: number;
    max_visits_to_one_pub?: number;
  };
  achievements?: {
    first_ten?: boolean;
    regular?: boolean;
    reviewer?: boolean;
  };
  usage?: { walked_distance_m?: number };
  email?: string;
  email_verified?: boolean;
  providers?: string[];
  is_anonymous?: boolean;
  status?: string;
  token?: string;
}

const CANCELLED: AuthResult = { ok: false, code: 'cancelled', detail: '' };

function parseSettings(data: RawAccount): AccountSettings | undefined {
  const raw = data.settings;
  if (!raw) return undefined;
  return {
    mode: raw.mode === 'nearest' || raw.mode === 'surprise' ? raw.mode : undefined,
    maxDistanceKm:
      typeof raw.max_distance_km === 'number' || raw.max_distance_km === null
        ? raw.max_distance_km
        : undefined,
    priceCurrency:
      raw.price_currency === 'CZK' || raw.price_currency === 'EUR'
        ? raw.price_currency
        : undefined,
    hapticEnabled: typeof raw.haptic_enabled === 'boolean' ? raw.haptic_enabled : undefined,
    soundEnabled: typeof raw.sound_enabled === 'boolean' ? raw.sound_enabled : undefined,
    hideClosedPubs:
      typeof raw.hide_closed_pubs === 'boolean' ? raw.hide_closed_pubs : undefined,
    hidePubNames: typeof raw.hide_pub_names === 'boolean' ? raw.hide_pub_names : undefined,
    marketingEmailsEnabled:
      typeof raw.marketing_emails_enabled === 'boolean'
        ? raw.marketing_emails_enabled
        : undefined,
  };
}

function parseSubscription(data: RawAccount): AccountSubscription | undefined {
  const raw = data.subscription;
  if (!raw) return undefined;
  const tier = raw.tier === 'plus' ? 'plus' : 'free';
  const allowedStatus: AccountSubscription['status'][] = [
    'inactive',
    'pending_verification',
    'active',
    'grace_period',
    'expired',
  ];
  const status = allowedStatus.includes(raw.status as AccountSubscription['status'])
    ? (raw.status as AccountSubscription['status'])
    : 'inactive';
  return {
    tier,
    status,
    platform: typeof raw.platform === 'string' ? raw.platform : '',
    productId: typeof raw.product_id === 'string' ? raw.product_id : '',
    originalTransactionId:
      typeof raw.original_transaction_id === 'string' ? raw.original_transaction_id : '',
    expiresAt: typeof raw.expires_at === 'string' ? raw.expires_at : null,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null,
  };
}

function parseStats(data: RawAccount): AccountStats | undefined {
  const raw = data.stats;
  if (!raw) return undefined;
  return {
    totalBeers: typeof raw.total_beers === 'number' ? raw.total_beers : 0,
    distinctPubs: typeof raw.distinct_pubs === 'number' ? raw.distinct_pubs : 0,
    ratingsCount: typeof raw.ratings_count === 'number' ? raw.ratings_count : 0,
    totalSpentCzk: typeof raw.total_spent_czk === 'number' ? raw.total_spent_czk : 0,
    maxVisitsToOnePub:
      typeof raw.max_visits_to_one_pub === 'number' ? raw.max_visits_to_one_pub : 0,
  };
}

function parseAchievements(data: RawAccount): AccountAchievements | undefined {
  const raw = data.achievements;
  if (!raw) return undefined;
  return {
    firstTen: raw.first_ten === true,
    regular: raw.regular === true,
    reviewer: raw.reviewer === true,
  };
}

function parseUsage(data: RawAccount): AccountProfile['usage'] | undefined {
  const walked = data.usage?.walked_distance_m;
  if (typeof walked !== 'number' || !Number.isFinite(walked)) return undefined;
  return { walkedDistanceM: walked };
}

function parseProfile(data: RawAccount): AccountProfile {
  const profile: AccountProfile = {
    id: data.id ?? '',
    deviceId: data.device_id ?? '',
    // An empty/missing nickname means the user hasn't picked a handle yet.
    nickname: typeof data.nickname === 'string' && data.nickname.length > 0 ? data.nickname : null,
    displayName: data.display_name ?? '',
    // Public-by-default: only an explicit false makes the profile private.
    isPublic: data.is_public !== false,
    // Backend guarantees an absolute, loadable URL; `picture` is a defensive alias.
    avatarUrl: (data.avatar_url ?? data.picture) || null,
    email: data.email ?? '',
    emailVerified: data.email_verified === true,
    providers: (data.providers ?? []) as AuthProvider[],
    // Treat a missing flag as anonymous; only an explicit false means signed in.
    isAnonymous: data.is_anonymous !== false,
    status: data.status ?? 'active',
  };
  const settings = parseSettings(data);
  const subscription = parseSubscription(data);
  const stats = parseStats(data);
  const achievements = parseAchievements(data);
  const usage = parseUsage(data);
  if (settings) profile.settings = settings;
  if (subscription) profile.subscription = subscription;
  if (stats) profile.stats = stats;
  if (achievements) profile.achievements = achievements;
  if (usage) profile.usage = usage;
  return profile;
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

/**
 * Server-only walked-distance counter (metres), read off the raw GET
 * /v1/account/me `usage` block for the profile stats tile. Returns `null` when
 * the field is absent so the UI can distinguish "not reported yet" (→ "—") from
 * a real 0. Never throws.
 */
export async function fetchWalkedDistanceM(): Promise<number | null> {
  const res = await authFetch('/v1/account/me', { method: 'GET', bearer: 'current' });
  if ('networkError' in res || !res.ok) return null;
  const walked = res.data.usage?.walked_distance_m;
  return typeof walked === 'number' && Number.isFinite(walked) ? walked : null;
}

export type AccountExportActionResult = AuthActionResult;

export async function exportAccountData(): Promise<AccountExportActionResult> {
  const res = await authFetch('/v1/account/export', { method: 'POST', bearer: 'current', body: {} });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true };
}

export async function restorePurchases(params: {
  platform: 'apple' | 'google';
  productId?: string;
  originalTransactionId?: string;
  transactionId?: string;
  expiresAt?: string | null;
}): Promise<AuthResult> {
  const res = await authFetch('/v1/account/me/purchases/restore', {
    method: 'POST',
    bearer: 'current',
    body: {
      platform: params.platform,
      product_id: params.productId ?? '',
      original_transaction_id: params.originalTransactionId ?? '',
      transaction_id: params.transactionId ?? '',
      expires_at: params.expiresAt ?? null,
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

export type ContentReportReason =
  | 'inappropriate_nickname'
  | 'inappropriate_avatar'
  | 'impersonation'
  | 'spam'
  | 'other';

export async function reportProfileContent(params: {
  targetAccountId: string;
  reason: ContentReportReason;
  comment?: string;
}): Promise<AuthActionResult> {
  const res = await authFetch('/v1/content-reports', {
    method: 'POST',
    bearer: 'current',
    body: {
      target_account_id: params.targetAccountId,
      reason: params.reason,
      comment: params.comment ?? '',
    },
  });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Profile (nickname / display name / visibility / avatar)
// ---------------------------------------------------------------------------

/**
 * Narrow result for the (debounced, advisory) nickname availability check. The
 * authoritative check is `updateProfile` itself — a 409 there is the source of
 * truth, this just powers the inline UX hint.
 */
export type NicknameAvailability =
  | { ok: true; available: boolean; reason?: string }
  | { ok: false; code: string; detail: string };

/**
 * Write profile fields (PATCH /v1/account/me). Only the keys actually passed are
 * sent; `displayName` maps to `display_name`. Never throws — a taken nickname
 * (409) or invalid value (400) surfaces via `extractError` as {code, detail}.
 */
export async function updateProfile(params: {
  nickname?: string;
  displayName?: string;
  isPublic?: boolean;
}): Promise<AuthResult> {
  const body: Record<string, unknown> = {};
  if (params.nickname !== undefined) body.nickname = params.nickname;
  if (params.displayName !== undefined) body.display_name = params.displayName;
  if (params.isPublic !== undefined) body.is_public = params.isPublic;

  const res = await authFetch('/v1/account/me', { method: 'PATCH', bearer: 'current', body });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}

interface RawNicknameAvailability {
  available?: boolean;
  reason?: string;
}

/**
 * Advisory availability check (GET /v1/account/nickname-available?nickname=). Used
 * for the debounced inline hint while typing; `updateProfile` is authoritative.
 */
export async function checkNicknameAvailable(nickname: string): Promise<NicknameAvailability> {
  const res = await authFetch(
    `/v1/account/nickname-available?nickname=${encodeURIComponent(nickname)}`,
    { method: 'GET', bearer: 'current' },
  );
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  const data = res.data as RawNicknameAvailability;
  return { ok: true, available: data.available === true, reason: data.reason };
}

/**
 * Upload an avatar image (POST /v1/account/me/avatar, multipart field `avatar`).
 *
 * MUST bypass `authFetch` — that helper hardcodes `Content-Type: application/json`,
 * which would corrupt a multipart body. We also CANNOT use the global `fetch` with
 * a FormData file part: Expo SDK 56 swaps in a WinterCG `fetch` whose
 * `convertFormDataAsync` rejects the legacy RN `{uri,name,type}` file object with
 * "Unsupported FormDataPart implementation" (it only accepts string/Blob/File).
 * Instead we hand the local file to expo-file-system's native multipart uploader,
 * which reads the file and builds the body in native code. Its own AbortSignal gives
 * a 30s budget (uploads are slower than the shared 12s API budget).
 */
export async function uploadAvatar(localUri: string): Promise<AuthResult> {
  const endpoint = getBackendEndpoint('/v1/account/me/avatar');
  if (!endpoint) return NETWORK_ERROR;

  const token = await getSessionToken();
  if (!token) return { ok: false, code: 'unauthenticated', detail: '' };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await new File(localUri).upload(endpoint, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'avatar',
      mimeType: 'image/jpeg',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      data = resp.body ? (JSON.parse(resp.body) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (resp.status < 200 || resp.status >= 300) {
      return { ok: false, ...extractError(data, resp.status) };
    }
    return { ok: true, profile: parseProfile(data) };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) {
      trackApiFailure('auth_request', {
        endpoint: '/v1/account/me/avatar',
        reason: 'exception',
        error: err,
      });
    }
    return NETWORK_ERROR;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Remove the current avatar (DELETE /v1/account/me/avatar). */
export async function removeAvatar(): Promise<AuthResult> {
  const res = await authFetch('/v1/account/me/avatar', { method: 'DELETE', bearer: 'current' });
  if ('networkError' in res) return NETWORK_ERROR;
  if (!res.ok) return { ok: false, ...extractError(res.data, res.status) };
  return { ok: true, profile: parseProfile(res.data) };
}
