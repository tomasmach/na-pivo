import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { clearCachedAnonymousAccount, ensureAccount, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { locale } from '@/i18n';
import { chainAbortSignal } from './apiFetch';
import {
  PrivateAccountMutationFrozenError,
  runPrivateAccountMutation,
  type PrivateAccountMutationScope,
} from './privateAccountBoundary';
import { trackApiFailure } from './telemetryClient';
import { getAppVersionLabel } from '@/utils/appVersion';
import { useSettingsStore } from '@/stores/settingsStore';

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';

const REQUEST_TIMEOUT_MS = 8000;
export const PUSH_TOKEN_KEY = 'na-pivo-expo-push-token';

async function currentPushBindingPolicy(): Promise<{
  permissionStatus: PushPermissionStatus;
  enabled: boolean;
}> {
  let permissionStatus: PushPermissionStatus = 'undetermined';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const permission = await Notifications.getPermissionsAsync();
    permissionStatus =
      permission.status === 'granted'
        ? 'granted'
        : permission.status === 'denied'
          ? 'denied'
          : 'undetermined';
  } catch {
    permissionStatus = 'undetermined';
  }
  const settings = useSettingsStore.getState();
  const hasEnabledFeature =
    settings.pubReminderEnabled ||
    (settings.friendPushEnabled && !settings.friendPushOptedOut);
  return {
    permissionStatus,
    enabled: permissionStatus === 'granted' && hasEnabledFeature,
  };
}

async function handleUnauthorized(session: AccountSession, source: string): Promise<void> {
  await clearCachedAnonymousAccount(session, { source, endpoint: '/v1/push-device' });
}

function boundarySignal(
  scope: PrivateAccountMutationScope,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!callerSignal) return { signal: scope.signal, cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (scope.signal.aborted || callerSignal.aborted) controller.abort();
  else {
    scope.signal.addEventListener('abort', abort);
    callerSignal.addEventListener('abort', abort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      scope.signal.removeEventListener('abort', abort);
      callerSignal.removeEventListener('abort', abort);
    },
  };
}

export async function registerPushDevice(
  pushToken: string,
  permissionStatus: PushPermissionStatus,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return await runPrivateAccountMutation(async (scope) => {
      const endpoint = getBackendEndpoint('/v1/push-device');
      if (!endpoint || signal?.aborted) return false;
      const combined = boundarySignal(scope, signal);
      const session = await ensureAccount(combined.signal);
      if (!session || combined.signal.aborted) {
        combined.cleanup();
        return false;
      }

      const abort = chainAbortSignal(combined.signal, REQUEST_TIMEOUT_MS);
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
        return true;
      } finally {
        abort.cleanup();
        combined.cleanup();
      }
    });
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (
      !signal?.aborted &&
      !isAbortError &&
      !(err instanceof PrivateAccountMutationFrozenError)
    ) {
      trackApiFailure('push_device_register', {
        endpoint: '/v1/push-device',
        reason: 'exception',
        error: err,
      });
    }
    return false;
  }
}

export async function disablePushDevice(
  pushToken?: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    return await runPrivateAccountMutation(async (scope) => {
      const endpoint = getBackendEndpoint('/v1/push-device');
      if (!endpoint || !pushToken || signal?.aborted) return false;
      const combined = boundarySignal(scope, signal);
      const session = await ensureAccount(combined.signal);
      if (!session || combined.signal.aborted) {
        combined.cleanup();
        return false;
      }

      const abort = chainAbortSignal(combined.signal, REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(endpoint, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ push_token: pushToken }),
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
      } finally {
        abort.cleanup();
        combined.cleanup();
      }
    });
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (
      !signal?.aborted &&
      !isAbortError &&
      !(err instanceof PrivateAccountMutationFrozenError)
    ) {
      trackApiFailure('push_device_disable', {
        endpoint: '/v1/push-device',
        reason: 'exception',
        error: err,
      });
    }
    return false;
  }
}

export async function disableCachedPushDeviceWithBearer(
  bearerToken: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  let pushToken: string | null = null;
  try {
    pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return false;
  }
  if (!pushToken) return true;
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || !bearerToken || signal?.aborted) return false;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ push_token: pushToken }),
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

/** Bind this installation's existing token only after B is durably installed. */
export async function registerCachedPushDeviceWithBearer(
  bearerToken: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  let pushToken: string | null = null;
  try {
    pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return false;
  }
  if (!pushToken) return true;
  const endpoint = getBackendEndpoint('/v1/push-device');
  if (!endpoint || !bearerToken || signal?.aborted) return false;

  const policy = await currentPushBindingPolicy();
  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        push_token: pushToken,
        platform: Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'unknown',
        permission_status: policy.permissionStatus,
        enabled: policy.enabled,
        app_version: getAppVersionLabel(),
      }),
      signal: abort.signal,
    });
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
