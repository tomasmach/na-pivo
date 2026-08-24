import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { cs } from '@/i18n/cs';

import { getBackendEndpoint } from './backendConfig';
import { ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import {
  PrivateAccountMutationFrozenError,
  runPrivateAccountMutation,
} from './privateAccountBoundary';

export type AccountExportResult =
  | { ok: true }
  | { ok: false; code: string; detail: string };

const EXPORT_ENDPOINT = '/v1/account/export';
const REQUEST_TIMEOUT_MS = 45_000;
const EXPORT_FILE_NAME = 'na-pivo-export.json';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export async function exportMyAccountData(): Promise<AccountExportResult> {
  try {
    return await runPrivateAccountMutation(async (scope) => {
      const endpoint = getBackendEndpoint(EXPORT_ENDPOINT);
      if (!endpoint) {
        return { ok: false, code: 'network', detail: cs.account.exportNetworkError };
      }

      let session: Awaited<ReturnType<typeof ensureAccount>> = null;
      try {
        session = await ensureAccount(scope.signal);
      } catch {
        return { ok: false, code: 'network', detail: cs.account.exportNetworkError };
      }
      if (!session) {
        return { ok: false, code: 'unauthenticated', detail: cs.account.exportNetworkError };
      }

      const { signal, cleanup } = chainAbortSignal(
        scope.signal,
        REQUEST_TIMEOUT_MS,
      );
      let response: Response;
      let text: string;
      try {
        response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: 'application/json',
          },
          signal,
        });
        text = await response.text();
      } catch {
        return { ok: false, code: 'network', detail: cs.account.exportNetworkError };
      } finally {
        cleanup();
      }

      if (!response.ok) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = null;
        }
        const record =
          parsed !== null && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
        const code = record && isNonEmptyString(record.code)
          ? record.code
          : `http_${response.status}`;
        if (response.status === 429) {
          return { ok: false, code, detail: cs.account.exportRateLimited };
        }
        const detail = record && isNonEmptyString(record.detail)
          ? record.detail
          : cs.account.exportServerError;
        return { ok: false, code, detail };
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, code: 'network', detail: cs.account.exportNetworkError };
      }

      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!sharingAvailable) {
        return { ok: false, code: 'sharing_unavailable', detail: cs.account.exportServerError };
      }

      // On Android a resolved share chooser does not guarantee the receiving
      // app finished reading the FileProvider stream, so the previous export
      // file is only cleaned here, right before writing the new one.
      if (Platform.OS === 'android') {
        try {
          const stale = new File(Paths.cache, EXPORT_FILE_NAME);
          if (stale.exists) {
            stale.delete();
          }
        } catch {
          // Ignore cleanup failures.
        }
      }

      const file = new File(Paths.cache, EXPORT_FILE_NAME);
      let shared = false;
      try {
        file.create({ overwrite: true });
        file.write(JSON.stringify(parsedData, null, 2));
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: cs.account.exportDialogTitle,
          UTI: 'public.json',
        });
        shared = true;
      } catch {
        if (!shared) {
          try {
            if (file.exists) {
              file.delete();
            }
          } catch {
            // Ignore delete failures.
          }
          return { ok: false, code: 'share_failed', detail: cs.account.exportServerError };
        }
      } finally {
        if (Platform.OS !== 'android' && shared) {
          try {
            if (file.exists) {
              file.delete();
            }
          } catch {
            // Ignore delete failures.
          }
        }
      }

      return { ok: true };
    });
  } catch (error) {
    if (error instanceof PrivateAccountMutationFrozenError) {
      return {
        ok: false,
        code: 'account_transition',
        detail:
          cs.account.exportAccountTransitionError,
      };
    }
    return { ok: false, code: 'network', detail: cs.account.exportNetworkError };
  }
}
