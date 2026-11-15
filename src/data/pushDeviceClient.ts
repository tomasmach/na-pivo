import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { locale } from '@/i18n';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';

import { clearCachedAnonymousAccount, ensureAccount, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { trackApiFailure } from './telemetryClient';
import { getAppVersionLabel } from '@/utils/appVersion';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

const REQUEST_TIMEOUT_MS = 8000;
export const PUSH_TOKEN_KEY = 'na-pivo-expo-push-token';

// Installation-wide (not account data): a later opt-out must survive a timed-out
// PUT that is still running on the server, including across an app restart.
const REVISION_KEY = 'na-pivo-push-device-revision';
const REGISTERED_KEY = 'na-pivo-push-device-registered';
const REREGISTER_AFTER_MS = 12 * 60 * 60 * 1000;

function registrationSignature(pushToken: string, accountId: string, friendPush: boolean): string {
  return JSON.stringify([pushToken, accountId, friendPush, getAppVersionLabel(), locale]);
}

/** True when this device told the server exactly this, under this account, in the last hours. */
export async function pushDeviceRegisteredRecently(friendPush?: boolean): Promise<boolean> {
  try {
    const [pushToken, saved, session] = await Promise.all([
      AsyncStorage.getItem(PUSH_TOKEN_KEY),
      AsyncStorage.getItem(REGISTERED_KEY),
      ensureAccount(),
    ]);
    if (!pushToken || !saved || !session) return false;
    await waitForSettingsHydration();
    const partaPush = friendPush ?? !useSettingsStore.getState().friendPushOptedOut;
    const stamp = JSON.parse(saved) as { signature?: unknown; at?: unknown };
    const age = Date.now() - Number(stamp.at);
    return (
      stamp.signature === registrationSignature(pushToken, session.accountId, partaPush) &&
      age >= 0 &&
      age < REREGISTER_AFTER_MS
    );
  } catch {
    return false;
  }
}
let revisionWrite: Promise<unknown> = Promise.resolve();

function nextRevision(): Promise<number> {
  const result = revisionWrite.then(async () => {
    const saved = Number(await AsyncStorage.getItem(REVISION_KEY));
    const previous = Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;
    const revision = Math.max(Date.now(), previous + 1);
    if (!Number.isSafeInteger(revision)) throw new Error('Invalid push device revision');
    await AsyncStorage.setItem(REVISION_KEY, String(revision));
    return revision;
  });
  revisionWrite = result.catch(() => undefined);
  return result;
}

async function handleUnauthorized(session: AccountSession, source: string): Promise<void> {
  await clearCachedAnonymousAccount(session, { source, endpoint: '/v1/push-device' });
}

export async function registerPushDevice(
  pushToken: string,
  permissionStatus: PushPermissionStatus,
  signal?: AbortSignal,
  /** Parta pushes; defaults to the persisted Parta choice. */
  friendPush?: boolean,
): Promise<boolean> {
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || signal?.aborted) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  await waitForSettingsHydration();
  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const clientRevision = await nextRevision();
    // Read after the revision is taken: a Parta opt-out made later sends a newer revision.
    const partaPush = friendPush ?? !useSettingsStore.getState().friendPushOptedOut;
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        client_revision: clientRevision,
        push_token: pushToken,
        platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
        permission_status: permissionStatus,
        enabled: permissionStatus === 'granted',
        app_version: getAppVersionLabel(),
        locale,
        friend_push: partaPush,
      }),
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await handleUnauthorized(session, 'push_device_register');
      return false;
    }
    if (!resp.ok) {
      trackApiFailure('push_device_register', {
        endpoint: '/v1/push-device',
        status: resp.status,
      });
      return false;
    }
    const result = await resp.json();
    const applied = result.applied !== false;
    if (applied) {
      await AsyncStorage.setItem(
        REGISTERED_KEY,
        JSON.stringify({ signature: registrationSignature(pushToken, session.accountId, partaPush), at: Date.now() }),
      ).catch(() => undefined);
    }
    return applied;
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('push_device_register', {
        endpoint: '/v1/push-device',
        reason: 'exception',
        error: err,
      });
    }
    return false;
  } finally {
    abort.cleanup();
  }
}

export async function disableCachedPushDeviceWithBearer(
  bearerToken: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || !bearerToken || signal?.aborted) return false;
  await AsyncStorage.removeItem(REGISTERED_KEY).catch(() => undefined);

  let pushToken: string | null = null;
  try {
    pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return false;
  }
  if (!pushToken || signal?.aborted) return false;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ push_token: pushToken, client_revision: await nextRevision() }),
      signal: abort.signal,
    });

    if (!resp.ok) {
      trackApiFailure('push_device_disable', {
        endpoint: '/v1/push-device',
        status: resp.status,
      });
      return false;
    }
    return true;
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('push_device_disable', {
        endpoint: '/v1/push-device',
        reason: 'exception',
        error: err,
      });
    }
    return false;
  } finally {
    abort.cleanup();
  }
}
