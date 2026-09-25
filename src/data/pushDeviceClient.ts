import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { locale } from '@/i18n';

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
): Promise<boolean> {
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || signal?.aborted) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        client_revision: await nextRevision(),
        push_token: pushToken,
        platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
        permission_status: permissionStatus,
        enabled: permissionStatus === 'granted',
        app_version: getAppVersionLabel(),
        locale,
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
    return result.applied !== false;
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

export async function disablePushDevice(
  pushToken?: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || !pushToken || signal?.aborted) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ push_token: pushToken, client_revision: await nextRevision() }),
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await handleUnauthorized(session, 'push_device_disable');
      return false;
    }
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

export async function disableCachedPushDeviceWithBearer(
  bearerToken: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || !bearerToken || signal?.aborted) return false;

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
