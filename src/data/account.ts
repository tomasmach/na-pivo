/**
 * Anonymous device-account client — gives every install a stable identity and a
 * server-issued account/token, WITHOUT any registration or login yet.
 *
 * Design principle (identical to hoursClient): talking to the backend is a
 * NON-BLOCKING enrichment. If EXPO_PUBLIC_BACKEND_URL is unset/empty or the
 * request fails/times out, this module resolves gracefully and NEVER throws —
 * the app behaves exactly as it does without a backend.
 *
 * Identity model:
 *  - `deviceId` is a client-generated UUID persisted locally. It is the stable
 *    anchor that survives app updates (until reinstall / new phone). It is an
 *    identifier, not a secret.
 *  - `token` is the SERVER-issued secret returned by POST /v1/account. It is the
 *    credential future authenticated calls will use. Because it is a bearer
 *    secret it is persisted in the device secure store (Keychain on iOS,
 *    Keystore-backed EncryptedSharedPreferences on Android) — never in plaintext
 *    AsyncStorage — via expo-secure-store.
 *
 * Registration is once-per-install: once we have a secure cached account,
 * ensureAccount() returns it WITHOUT a network call and repairs a mismatched
 * non-secret deviceId anchor from that authoritative record.
 * Re-posting a known `deviceId` requires the existing bearer token server-side;
 * if the token cache is lost or rejected, the client creates a fresh anonymous
 * device account instead of recovering a token from the non-secret deviceId.
 *
 * Privacy note: registering sends an anonymous random `deviceId` to OUR backend.
 * It contains no personal information. Disclosed in cs privacy copy + PRIVACY_POLICY.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { getBackendEndpoint } from './backendConfig';
import {
  isPrivateAccountMutationScopeCurrent,
  privateAccountMergeBlocksAnonymousEviction,
  PrivateAccountMutationFrozenError,
  runPrivateAccountMutation,
} from './privateAccountBoundary';
import { setTelemetrySession, trackApiFailure } from './telemetryClient';

export interface AccountSession {
  /** Stable client-generated device identifier (UUID v4). */
  deviceId: string;
  /** Server-issued public account id (UUID). */
  accountId: string;
  /** Server-issued opaque bearer secret. */
  token: string;
  /**
   * True once a real credential (email/password or Google/Apple) is attached —
   * i.e. the user is SIGNED IN. A signed-in session is no longer device-bound,
   * so ensureAccount returns it regardless of the current deviceId and never
   * silently forks a new anonymous account on a 401.
   */
  authenticated?: boolean;
}

export interface AccountPreferences {
  mode?: 'nearest' | 'surprise';
  maxDistanceKm?: number | null;
  priceCurrency?: 'CZK' | 'EUR';
  hapticEnabled?: boolean;
  soundEnabled?: boolean;
  hideClosedPubs?: boolean;
  hidePubNames: boolean;
  marketingEmailsEnabled?: boolean;
}

// The non-secret device anchor lives in AsyncStorage; the account blob — which
// holds the SERVER-ISSUED BEARER TOKEN — lives in expo-secure-store (Keychain on
// iOS, Keystore-backed EncryptedSharedPreferences on Android) so the credential
// is never written to disk in cleartext.
const DEVICE_ID_KEY = 'na-pivo-device-id';
const ACCOUNT_KEY = 'na-pivo-account';
const REQUEST_TIMEOUT_MS = 8000;
const BOOTSTRAP_BACKOFF_BASE_MS = 30_000;
const BOOTSTRAP_BACKOFF_MAX_MS = 5 * 60_000;
let ensureAccountInFlight: Promise<AccountSession | null> | null = null;
let lastKnownAccount: CachedAccount | null = null;
let sessionCacheQueue: Promise<void> = Promise.resolve();
let bootstrapFailureCount = 0;
let bootstrapRetryAfter = 0;
let anonymousSessionEvictionListener: (() => void | Promise<void>) | null = null;

interface RegisterResponse {
  id?: string;
  device_id?: string;
  token?: string;
  created?: boolean;
  created_at?: string;
  hide_pub_names?: boolean;
}

interface AccountMeResponse {
  id?: string;
  device_id?: string;
  hide_pub_names?: boolean;
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
}

/**
 * The cached account blob. deviceId is stored alongside accountId/token so a
 * cached session keeps its original deviceId next to the bearer token. The
 * secure, token-bearing record is authoritative if AsyncStorage temporarily
 * loses or races its non-secret device anchor.
 */
interface CachedAccount {
  deviceId: string;
  accountId: string;
  token: string;
  /** True when this session is credential-backed (signed in), not anonymous. */
  authenticated?: boolean;
}

/**
 * Read only the durable sign-in state needed by launch-time UI gates.
 *
 * This deliberately does not create an anonymous account, perform a network
 * request, or expose the cached bearer token. `null` means SecureStore was
 * temporarily unavailable, so callers must not mistake that for a signed-out
 * user.
 */
export async function getCachedAuthenticationState(): Promise<boolean | null> {
  const cachedRead = await readCachedAccount();
  if (!cachedRead.available) return null;
  return cachedRead.account?.authenticated === true;
}

function chainAbortSignal(signal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

function preferencesFromResponse(data: AccountMeResponse): AccountPreferences {
  const settings = data.settings ?? {};
  const mode = settings.mode === 'surprise' || settings.mode === 'nearest' ? settings.mode : undefined;
  const priceCurrency =
    settings.price_currency === 'EUR' || settings.price_currency === 'CZK'
      ? settings.price_currency
      : undefined;

  const preferences: AccountPreferences = {
    hidePubNames: (settings.hide_pub_names ?? data.hide_pub_names) === true,
  };
  if (mode) preferences.mode = mode;
  if (typeof settings.max_distance_km === 'number' || settings.max_distance_km === null) {
    preferences.maxDistanceKm = settings.max_distance_km;
  }
  if (priceCurrency) preferences.priceCurrency = priceCurrency;
  if (typeof settings.haptic_enabled === 'boolean') {
    preferences.hapticEnabled = settings.haptic_enabled;
  }
  if (typeof settings.sound_enabled === 'boolean') {
    preferences.soundEnabled = settings.sound_enabled;
  }
  if (typeof settings.hide_closed_pubs === 'boolean') {
    preferences.hideClosedPubs = settings.hide_closed_pubs;
  }
  if (typeof settings.marketing_emails_enabled === 'boolean') {
    preferences.marketingEmailsEnabled = settings.marketing_emails_enabled;
  }
  return preferences;
}

// Precomputed 00..ff byte→hex table for the getRandomValues UUID path.
const BYTE_TO_HEX: string[] = [];
for (let i = 0; i < 256; i++) {
  BYTE_TO_HEX.push((i + 0x100).toString(16).slice(1));
}

/**
 * RFC-4122 v4 UUID. Prefers crypto.randomUUID, then a CSPRNG (Web Crypto
 * getRandomValues), then a Math.random fallback. A device id only needs to be
 * unique, not secret — the auth secret is the server-issued token — but using a
 * CSPRNG when available keeps the id unguessable too.
 */
export function generateUuidV4(): string {
  const g = globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
    };
  };

  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }

  if (typeof g.crypto?.getRandomValues === 'function') {
    const b = g.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => BYTE_TO_HEX[x]).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function replaceDeviceId(): Promise<string> {
  const id = generateUuidV4();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // Persist failed; still return the id for this session.
  }
  return id;
}

/** Return the persisted device id, generating & persisting one on first call. */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }
  } catch {
    // AsyncStorage read failed — fall through and mint a fresh id (best effort).
  }
  return replaceDeviceId();
}

type CachedAccountRead =
  | { available: true; account: CachedAccount | null }
  | { available: false; account: CachedAccount | null };

function serializeSessionCache<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionCacheQueue.then(operation, operation);
  sessionCacheQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function resetBootstrapBackoff(): void {
  bootstrapFailureCount = 0;
  bootstrapRetryAfter = 0;
}

function applyBootstrapBackoff(): void {
  bootstrapFailureCount += 1;
  const exponentialDelay = Math.min(
    BOOTSTRAP_BACKOFF_MAX_MS,
    BOOTSTRAP_BACKOFF_BASE_MS * 2 ** (bootstrapFailureCount - 1),
  );
  const jitteredDelay = Math.min(
    BOOTSTRAP_BACKOFF_MAX_MS,
    exponentialDelay * (0.8 + Math.random() * 0.4),
  );
  bootstrapRetryAfter = Date.now() + Math.round(jitteredDelay);
}

async function readCachedAccountUnlocked(): Promise<CachedAccountRead> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(ACCOUNT_KEY);
  } catch {
    trackApiFailure('session_cache_read', { reason: 'session_cache_read_unavailable' });
    // Keychain can be temporarily unavailable while iOS is locked or resuming.
    // Never interpret that as a missing credential: doing so could replace a
    // signed-in session with a freshly minted anonymous account.
    return { available: false, account: lastKnownAccount };
  }

  if (!raw) {
    lastKnownAccount = null;
    return { available: true, account: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedAccount>;
    if (parsed?.deviceId && parsed?.accountId && parsed?.token) {
      const account = {
        deviceId: parsed.deviceId,
        accountId: parsed.accountId,
        token: parsed.token,
        authenticated: parsed.authenticated === true,
      };
      lastKnownAccount = account;
      return { available: true, account };
    }
    lastKnownAccount = null;
    trackApiFailure('session_cache_read', { reason: 'session_cache_malformed' });
    return { available: true, account: null };
  } catch {
    lastKnownAccount = null;
    trackApiFailure('session_cache_read', { reason: 'session_cache_malformed' });
    return { available: true, account: null };
  }
}

async function readCachedAccount(): Promise<CachedAccountRead> {
  return serializeSessionCache(readCachedAccountUnlocked);
}

async function writeCachedAccountUnlocked(account: CachedAccount): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    lastKnownAccount = account;
    resetBootstrapBackoff();
    return true;
  } catch {
    trackApiFailure('session_cache_write', { reason: 'session_cache_write_failed' });
    return false;
  }
}

async function writeCachedAccount(account: CachedAccount): Promise<boolean> {
  return serializeSessionCache(() => writeCachedAccountUnlocked(account));
}

async function deleteCachedAccountUnlocked(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(ACCOUNT_KEY);
    lastKnownAccount = null;
    return true;
  } catch {
    trackApiFailure('session_cache_delete', { reason: 'session_cache_delete_failed' });
    return false;
  }
}

/** Drop the cached account. If the old deviceId is already claimed server-side,
 *  the next ensureAccount() will mint a fresh anonymous device account. */
export async function clearCachedAccount(
  options: { resetBootstrapBackoff?: boolean } = {},
): Promise<void> {
  await serializeSessionCache(deleteCachedAccountUnlocked);
  if (options.resetBootstrapBackoff !== false) resetBootstrapBackoff();
  setTelemetrySession(null);
}

/**
 * Remove the current credential as one serialized account boundary. Private
 * storage is cleared by revertToAnonymous BEFORE this runs, so an app kill after
 * a successful delete can never boot a replacement identity over stale A data.
 */
async function clearCachedAccountAtBoundary(): Promise<boolean> {
  const cleared = await serializeSessionCache(async () => {
    const deleted = await deleteCachedAccountUnlocked();
    if (!deleted) return false;

    // Never let a previously memoized read hand the just-removed credential
    // back to the logout caller. Existing waiters may still finish, but every
    // post-boundary ensure starts from the now-empty secure cache.
    ensureAccountInFlight = null;

    return true;
  });
  if (cleared) {
    resetBootstrapBackoff();
    setTelemetrySession(null);
  }
  return cleared;
}

export function setAnonymousSessionEvictionListener(
  listener: (() => void | Promise<void>) | null,
): void {
  anonymousSessionEvictionListener = listener;
}

/**
 * Recover from a 401 only for anonymous/device sessions. A credential-backed
 * session must not silently fall forward into a fresh anonymous account because
 * private retry queues could then upload the signed-in user's data elsewhere.
 */
export async function clearCachedAnonymousAccount(
  session: AccountSession | null,
  context: { source: string; endpoint: string },
): Promise<boolean> {
  if (!session || session.authenticated) return false;

  let evicted = false;
  try {
    evicted = await runPrivateAccountMutation(async (scope) => {
      if (await privateAccountMergeBlocksAnonymousEviction(session.accountId)) {
        trackApiFailure('anonymous_session_eviction', {
          endpoint: context.endpoint,
          source: context.source,
          status: 401,
          reason: 'anonymous_401_merge_unresolved',
        });
        return false;
      }

      return serializeSessionCache(async () => {
        const cachedRead = await readCachedAccountUnlocked();
        const cached = cachedRead.available ? cachedRead.account : null;
        if (!cached || cached.authenticated || cached.token !== session.token) {
          trackApiFailure('anonymous_session_eviction', {
            endpoint: context.endpoint,
            source: context.source,
            status: 401,
            reason: 'anonymous_401_stale_session_ignored',
          });
          return false;
        }

        // This is the eviction linearization point. A credential transition
        // freezes the process generation synchronously and then drains this
        // lease before persisting its merge marker. If it won the race, A's
        // only retry bearer must stay in SecureStore.
        if (!isPrivateAccountMutationScopeCurrent(scope)) return false;

        const deleted = await deleteCachedAccountUnlocked();
        if (!deleted) return false;

        setTelemetrySession(null);
        trackApiFailure('anonymous_session_eviction', {
          endpoint: context.endpoint,
          source: context.source,
          status: 401,
          reason: 'anonymous_401_current_session_evicted',
        });
        return true;
      });
    });
  } catch (error) {
    if (
      error instanceof PrivateAccountMutationFrozenError &&
      await privateAccountMergeBlocksAnonymousEviction(session.accountId)
    ) {
      trackApiFailure('anonymous_session_eviction', {
        endpoint: context.endpoint,
        source: context.source,
        status: 401,
        reason: 'anonymous_401_merge_unresolved',
      });
    } else if (!(error instanceof PrivateAccountMutationFrozenError)) {
      trackApiFailure('anonymous_session_eviction', {
        endpoint: context.endpoint,
        source: context.source,
        status: 401,
        reason: 'anonymous_401_eviction_failed',
      });
    }
    return false;
  }

  if (evicted && anonymousSessionEvictionListener) {
    try {
      void Promise.resolve(anonymousSessionEvictionListener()).catch(() => undefined);
    } catch {
      // Store synchronization is best effort and must not undo a safe eviction.
    }
  }
  return evicted;
}

/**
 * Ensure an anonymous account exists for this device.
 *
 * Always resolves; never throws.
 *  - If a secure cached account exists → returns it WITHOUT a network call and
 *    repairs the non-secret deviceId anchor when needed.
 *  - Otherwise, if a backend is configured → registers and caches the result.
 *  - Returns null when there is no cached account and the backend is
 *    absent/unreachable.
 *
 */
async function ensureAccountOnce(): Promise<AccountSession | null> {
  let deviceId = await getOrCreateDeviceId();
  const cachedRead = await readCachedAccount();
  const cached = cachedRead.account;

  // A SIGNED-IN session is credential-backed, not device-bound: return it as-is
  // (it may have been minted on another device / after a deviceId change), and
  // never re-register or fork it. Sign-out is explicit (revertToAnonymous).
  if (cached && cached.authenticated) {
    resetBootstrapBackoff();
    return {
      deviceId: cached.deviceId,
      accountId: cached.accountId,
      token: cached.token,
      authenticated: true,
    };
  }

  // Anonymous: the secure record contains the bearer credential and is the
  // authoritative identity. Heal a raced/lost AsyncStorage anchor from it
  // instead of forking another server account.
  if (cached) {
    resetBootstrapBackoff();
    if (cached.deviceId !== deviceId) {
      deviceId = cached.deviceId;
      try {
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      } catch {
        // Best effort. The secure record will heal it again on the next call.
      }
    }
    return { deviceId, accountId: cached.accountId, token: cached.token, authenticated: false };
  }

  // A failed Keychain read is not proof that the account is absent. Wait for a
  // later retry instead of registering and overwriting a possibly signed-in user.
  if (!cachedRead.available) return null;

  // A response-lost anonymous merge may have revoked A server-side while its
  // exact operation marker is the only route to B. Never mint unrelated C over
  // A's private queues; the auth retry must replay that same operation instead.
  if (await privateAccountMergeBlocksAnonymousEviction()) {
    trackApiFailure('account_bootstrap', {
      endpoint: '/v1/account',
      reason: 'bootstrap_merge_unresolved',
    });
    return null;
  }

  if (Date.now() < bootstrapRetryAfter) {
    trackApiFailure('account_bootstrap', {
      endpoint: '/v1/account',
      reason: 'bootstrap_retry_suppressed',
    });
    return null;
  }

  const endpoint = getBackendEndpoint('/v1/account');
  if (!endpoint) {
    // Dormant (no backend), and no matching cached account.
    return null;
  }

  const abort = chainAbortSignal();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
        signal: abort.signal,
      });

      if (resp.status === 401 && attempt === 0) {
        await clearCachedAccount({ resetBootstrapBackoff: false });
        trackApiFailure('account_bootstrap', {
          endpoint: '/v1/account',
          status: resp.status,
          reason: 'bootstrap_claimed_device_rotated',
        });
        deviceId = await replaceDeviceId();
        continue;
      }

      if (!resp.ok) {
        if (resp.status === 401) {
          applyBootstrapBackoff();
          trackApiFailure('account_bootstrap', {
            endpoint: '/v1/account',
            status: resp.status,
            reason: 'bootstrap_replacement_rejected',
          });
          return null;
        }
        trackApiFailure('account_register', {
          endpoint: '/v1/account',
          status: resp.status,
        });
        return null;
      }

      const data = (await resp.json()) as RegisterResponse;
      if (data?.id && data?.token) {
        const account: CachedAccount = {
          deviceId,
          accountId: data.id,
          token: data.token,
          authenticated: false,
        };
        const persisted = await writeCachedAccount(account);
        if (!persisted) return null;
        return {
          deviceId,
          accountId: account.accountId,
          token: account.token,
          authenticated: false,
        };
      }
      return null;
    }
    return null;
  } catch (err) {
    // network / timeout / abort / malformed JSON — never throw.
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!isAbortError) {
      trackApiFailure('account_register', {
        endpoint: '/v1/account',
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

/**
 * Return the shared account session/recovery operation. An optional caller
 * signal cancels only that caller's wait; identity mutation continues under its
 * own timeout so another startup queue cannot begin a competing recovery.
 */
export async function ensureAccount(signal?: AbortSignal): Promise<AccountSession | null> {
  // A cancelled queue request must not start identity recovery, but once shared
  // recovery has begun it owns its internal timeout and continues for the app.
  // Cancelling one caller only stops that caller waiting for the shared result.
  if (signal?.aborted) return null;

  if (!ensureAccountInFlight) {
    const operation = ensureAccountOnce();
    const tracked = operation.finally(() => {
      // A session boundary may deliberately replace this shared operation while
      // it is finishing. Do not let the old promise erase the newer one.
      if (ensureAccountInFlight === tracked) ensureAccountInFlight = null;
    });
    ensureAccountInFlight = tracked;
  }
  const shared = ensureAccountInFlight;
  if (!signal) return shared;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AccountSession | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish(null);

    signal.addEventListener('abort', onAbort, { once: true });
    // The shared operation is designed not to reject, but keep this boundary
    // non-throwing even if a future implementation accidentally does.
    void shared.then(finish, () => finish(null));
  });
}

export async function fetchAccountPreferences(
  signal?: AbortSignal,
): Promise<AccountPreferences | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/account/me');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'account_preferences_fetch',
        endpoint: '/v1/account/me',
      });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('account_preferences_fetch', {
        endpoint: '/v1/account/me',
        status: resp.status,
      });
      return null;
    }

    const data = (await resp.json()) as AccountMeResponse;
    return preferencesFromResponse(data);
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('account_preferences_fetch', {
        endpoint: '/v1/account/me',
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

export async function updateAccountPreferences(
  preferences: Partial<AccountPreferences>,
  signal?: AbortSignal,
  expectedAccountId?: string,
): Promise<AccountPreferences | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/account/me');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;
  // Queued preferences are private account data. Refuse to reuse a request
  // after a credential transition installed a different account.
  if (expectedAccountId && session.accountId !== expectedAccountId) return null;

  const body: Record<string, unknown> = {};
  if (preferences.mode === 'nearest' || preferences.mode === 'surprise') {
    body.compass_mode = preferences.mode;
  }
  if (
    typeof preferences.maxDistanceKm === 'number' ||
    preferences.maxDistanceKm === null
  ) {
    body.max_distance_km = preferences.maxDistanceKm;
  }
  if (preferences.priceCurrency === 'CZK' || preferences.priceCurrency === 'EUR') {
    body.price_currency = preferences.priceCurrency;
  }
  if (typeof preferences.hapticEnabled === 'boolean') {
    body.haptic_enabled = preferences.hapticEnabled;
  }
  if (typeof preferences.soundEnabled === 'boolean') {
    body.sound_enabled = preferences.soundEnabled;
  }
  if (typeof preferences.hideClosedPubs === 'boolean') {
    body.hide_closed_pubs = preferences.hideClosedPubs;
  }
  if (typeof preferences.hidePubNames === 'boolean') {
    body.hide_pub_names = preferences.hidePubNames;
  }
  if (typeof preferences.marketingEmailsEnabled === 'boolean') {
    body.marketing_emails_enabled = preferences.marketingEmailsEnabled;
  }

  const abort = chainAbortSignal(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'account_preferences_update',
        endpoint: '/v1/account/me',
      });
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('account_preferences_update', {
        endpoint: '/v1/account/me',
        status: resp.status,
      });
      return null;
    }

    const data = (await resp.json()) as AccountMeResponse;
    return preferencesFromResponse(data);
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('account_preferences_update', {
        endpoint: '/v1/account/me',
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Session helpers (used by the auth layer in src/data/auth.ts)
// ---------------------------------------------------------------------------

/** Current bearer token, or null when there is no cached session. */
export async function getSessionToken(): Promise<string | null> {
  const cached = await readCachedAccount();
  return cached.account?.token ?? null;
}

export type DurableAccountSessionRead =
  | { available: true; session: AccountSession | null }
  | { available: false; session: AccountSession | null };

/**
 * Read SecureStore without registration, identity repair, or network I/O.
 * `available:false` means a locked/unavailable Keychain, never "no account".
 */
export async function readDurableAccountSession(): Promise<DurableAccountSessionRead> {
  const cached = await readCachedAccount();
  return { available: cached.available, session: cached.account };
}

/**
 * Persist a signed-in session: the server-issued token + account id, flagged
 * ``authenticated`` so ensureAccount() stops treating it as a device-bound
 * anonymous account (it survives deviceId changes and never silently forks).
 */
export async function setSession(session: {
  deviceId?: string;
  accountId: string;
  token: string;
  authenticated: boolean;
}): Promise<void> {
  const deviceId = session.deviceId ?? (await getOrCreateDeviceId());
  const nextSession: AccountSession = {
    deviceId,
    accountId: session.accountId,
    token: session.token,
    authenticated: session.authenticated,
  };
  const persisted = await writeCachedAccount(nextSession);
  if (!persisted) {
    throw new Error('Secure session persistence failed.');
  }
  setTelemetrySession(nextSession);
}

/**
 * Sign out: drop the cached session, mint a FRESH device identity (the old one
 * is now tied to a claimed account that needs a token we no longer hold), then
 * re-establish a clean anonymous device account so the app keeps working.
 * The private-data callback runs first. This is deliberately clear-first: a kill
 * after SecureStore deletion must not let a replacement account hydrate A's
 * persisted queues. If credential removal fails, A remains the active session,
 * its local caches stay empty/privacy-safe, and server data can be restored.
 */
export async function revertToAnonymous(
  signal?: AbortSignal,
  beforeSessionCleared: () => void | Promise<void> = () => undefined,
): Promise<AccountSession | null> {
  // A durable anonymous merge marker is the only local proof that A may have
  // been claimed server-side while its response was lost. Clearing A's bearer
  // here would make the operation impossible to retry and tempt bootstrap to
  // mint unrelated C over A's private data. The owning auth flow must resolve
  // the exact operation first.
  if (await privateAccountMergeBlocksAnonymousEviction()) {
    throw new Error('Anonymous account merge is unresolved.');
  }
  await beforeSessionCleared();
  const cleared = await clearCachedAccountAtBoundary();
  if (!cleared) {
    throw new Error('Secure session removal failed.');
  }
  await replaceDeviceId();
  const session = await ensureAccount(signal);
  setTelemetrySession(session);
  return session;
}
