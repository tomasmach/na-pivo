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
 * Registration is once-per-install: once we have a cached account whose deviceId
 * matches this device, ensureAccount() returns it WITHOUT a network call.
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
import { trackApiFailure } from './telemetryClient';

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
 * cached session is only ever surfaced for the device it was minted for — this
 * prevents pairing a stale token with a freshly-generated deviceId if the
 * DEVICE_ID_KEY read ever transiently fails.
 */
interface CachedAccount {
  deviceId: string;
  accountId: string;
  token: string;
  /** True when this session is credential-backed (signed in), not anonymous. */
  authenticated?: boolean;
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

async function readCachedAccount(): Promise<CachedAccount | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAccount>;
    if (parsed?.deviceId && parsed?.accountId && parsed?.token) {
      return {
        deviceId: parsed.deviceId,
        accountId: parsed.accountId,
        token: parsed.token,
        authenticated: parsed.authenticated === true,
      };
    }
  } catch {
    // Corrupt cache, or the secure store being unavailable (e.g. web): the
    // caller simply re-registers and idempotently recovers the same account.
  }
  return null;
}

async function writeCachedAccount(account: CachedAccount): Promise<void> {
  try {
    await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // best effort — never throw if the secure store is unavailable.
  }
}

/** Drop the cached account. If the old deviceId is already claimed server-side,
 *  the next ensureAccount() will mint a fresh anonymous device account. */
export async function clearCachedAccount(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCOUNT_KEY);
  } catch {
    // best effort
  }
}

/**
 * Ensure an anonymous account exists for this device.
 *
 * Always resolves; never throws.
 *  - If a cached account already matches this device → returns it WITHOUT a
 *    network call (registration is once-per-install).
 *  - Otherwise, if a backend is configured → registers and caches the result.
 *  - Returns null when there is no matching cached account and the backend is
 *    absent/unreachable.
 *
 * @param signal Optional caller AbortSignal, layered with an internal 8s timeout.
 */
export async function ensureAccount(signal?: AbortSignal): Promise<AccountSession | null> {
  let deviceId = await getOrCreateDeviceId();
  const cached = await readCachedAccount();

  // A SIGNED-IN session is credential-backed, not device-bound: return it as-is
  // (it may have been minted on another device / after a deviceId change), and
  // never re-register or fork it. Sign-out is explicit (revertToAnonymous).
  if (cached && cached.authenticated) {
    return {
      deviceId: cached.deviceId,
      accountId: cached.accountId,
      token: cached.token,
      authenticated: true,
    };
  }

  // Anonymous: already established for THIS device — no network call needed. A
  // cached blob minted for a different deviceId is ignored (re-register below),
  // so a token is never paired with a mismatched deviceId.
  if (cached && cached.deviceId === deviceId) {
    return { deviceId, accountId: cached.accountId, token: cached.token, authenticated: false };
  }

  const endpoint = getBackendEndpoint('/v1/account');
  if (!endpoint || signal?.aborted) {
    // Dormant (no backend) or cancelled, and no matching cached account.
    return null;
  }

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

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
        signal: timeoutController.signal,
      });

      if (resp.status === 401 && attempt === 0) {
        await clearCachedAccount();
        deviceId = await replaceDeviceId();
        continue;
      }

      if (!resp.ok) {
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
        await writeCachedAccount(account);
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
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('account_register', {
        endpoint: '/v1/account',
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
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
      await clearCachedAccount();
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
): Promise<AccountPreferences | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/account/me');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

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
      await clearCachedAccount();
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
  return cached?.token ?? null;
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
  await writeCachedAccount({
    deviceId,
    accountId: session.accountId,
    token: session.token,
    authenticated: session.authenticated,
  });
}

/**
 * Sign out: drop the cached session, mint a FRESH device identity (the old one
 * is now tied to a claimed account that needs a token we no longer hold), then
 * re-establish a clean anonymous device account so the app keeps working.
 * Always resolves; never throws.
 */
export async function revertToAnonymous(signal?: AbortSignal): Promise<AccountSession | null> {
  await clearCachedAccount();
  await replaceDeviceId();
  return ensureAccount(signal);
}
