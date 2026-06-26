import { Platform } from 'react-native';

import { clearCachedAnonymousAccount, ensureAccount, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';
import { getAppVersionLabel } from '@/utils/appVersion';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

const REQUEST_TIMEOUT_MS = 8000;

function abortWithTimeout(signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function handleUnauthorized(session: AccountSession): Promise<void> {
  await clearCachedAnonymousAccount(session);
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

  const abort = abortWithTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        push_token: pushToken,
        platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
        permission_status: permissionStatus,
        enabled: permissionStatus === 'granted',
        app_version: getAppVersionLabel(),
      }),
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await handleUnauthorized(session);
      return false;
    }
    if (!resp.ok) {
      trackApiFailure('push_device_register', {
        endpoint: '/v1/push-device',
        status: resp.status,
      });
      return false;
    }
    return true;
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
  if (!endpoint || signal?.aborted) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  const abort = abortWithTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ push_token: pushToken ?? '' }),
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await handleUnauthorized(session);
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
