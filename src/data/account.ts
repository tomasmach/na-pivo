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
 *    credential future authenticated calls will use.
 *
 * Registration is once-per-install: once we have a cached account whose deviceId
 * matches this device, ensureAccount() returns it WITHOUT a network call.
 * Registration is idempotent on `deviceId` server-side, so a lost response simply
 * retries and recovers the same account on the next launch. If a future
 * authenticated call ever gets a 401 (server-side token revoked / DB reset), the
 * caller should clearCachedAccount() and re-run ensureAccount() to re-register.
 *
 * Privacy note: registering sends an anonymous random `deviceId` to OUR backend.
 * It contains no personal information. Disclosed in cs privacy copy + PRIVACY_POLICY.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AccountSession {
  /** Stable client-generated device identifier (UUID v4). */
  deviceId: string;
  /** Server-issued public account id (UUID). */
  accountId: string;
  /** Server-issued opaque bearer secret. */
  token: string;
}

const DEVICE_ID_KEY = 'na-pivo-device-id';
const ACCOUNT_KEY = 'na-pivo-account';
const REQUEST_TIMEOUT_MS = 8000;

interface RegisterResponse {
  id?: string;
  device_id?: string;
  token?: string;
  created?: boolean;
  created_at?: string;
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
}

/** Read the backend base URL at call time (Expo inlines EXPO_PUBLIC_* at build). */
function getBackendUrl(): string {
  return (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
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
  const id = generateUuidV4();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // Persist failed; still return the id for this session.
  }
  return id;
}

async function readCachedAccount(): Promise<CachedAccount | null> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAccount>;
    if (parsed?.deviceId && parsed?.accountId && parsed?.token) {
      return {
        deviceId: parsed.deviceId,
        accountId: parsed.accountId,
        token: parsed.token,
      };
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

async function writeCachedAccount(account: CachedAccount): Promise<void> {
  try {
    await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // best effort
  }
}

/** Drop the cached account (NOT the deviceId). Use to force re-registration,
 *  e.g. after a future authenticated call returns 401. */
export async function clearCachedAccount(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACCOUNT_KEY);
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
  const deviceId = await getOrCreateDeviceId();
  const cached = await readCachedAccount();

  // Already established for THIS device — no network call needed. A cached blob
  // minted for a different deviceId is ignored (re-register below), so a token
  // is never paired with a mismatched deviceId.
  if (cached && cached.deviceId === deviceId) {
    return { deviceId, accountId: cached.accountId, token: cached.token };
  }

  const baseUrl = getBackendUrl();
  if (!baseUrl || signal?.aborted) {
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
    const resp = await fetch(`${trimTrailingSlash(baseUrl)}/v1/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
      signal: timeoutController.signal,
    });

    if (!resp.ok) {
      return null;
    }

    const data = (await resp.json()) as RegisterResponse;
    if (data?.id && data?.token) {
      const account: CachedAccount = { deviceId, accountId: data.id, token: data.token };
      await writeCachedAccount(account);
      return { deviceId, accountId: account.accountId, token: account.token };
    }
    return null;
  } catch {
    // network / timeout / abort / malformed JSON — never throw.
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
