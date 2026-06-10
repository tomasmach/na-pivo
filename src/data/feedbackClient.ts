/**
 * Feedback client — lets users send a bug report, idea, or note from the app.
 *
 * Sending is best-effort and non-blocking. The UI shows a thank-you immediately;
 * this client only syncs the message to the backend. The payload is enriched
 * with app/platform metadata so we can triage without asking the user.
 */

import { Platform } from 'react-native';

import { ensureAccount } from './account';
import { getAppVersionLabel } from '@/utils/appVersion';

export type FeedbackCategory = 'bug' | 'idea' | 'other';
export type FeedbackContactType = 'instagram' | 'email';

/** What the UI hands to the queue — the stable bits the user typed. */
export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  contactType?: FeedbackContactType;
  contact?: string;
}

/** The byte-identical payload persisted in the queue and POSTed on every retry. */
export interface FeedbackEntry {
  client_id: string;
  category: FeedbackCategory;
  message: string;
  contact_type?: FeedbackContactType;
  contact?: string;
  app_version: string;
  platform: string;
  os_version: string;
}

const REQUEST_TIMEOUT_MS = 8000;

function getBackendUrl(): string {
  return (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
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

/**
 * Builds the full, retry-stable payload from the user's input. The metadata
 * (app version, platform, OS version) is captured once at enqueue time so every
 * retry of the same client_id is byte-identical.
 */
export function buildFeedbackEntry(input: FeedbackInput, clientId: string): FeedbackEntry {
  const contact = input.contact?.trim();
  return {
    client_id: clientId,
    category: input.category,
    message: input.message.trim(),
    ...(contact && input.contactType
      ? { contact_type: input.contactType, contact }
      : {}),
    app_version: getAppVersionLabel(),
    platform: Platform.OS,
    os_version: String(Platform.Version),
  };
}

/**
 * POSTs one feedback entry. The backend is idempotent on client_id, so resending
 * a queued entry is safe. Returns true on any 2xx, false otherwise. Never throws.
 */
export async function submitFeedback(
  entry: FeedbackEntry,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;

  const baseUrl = getBackendUrl();
  if (!baseUrl) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  const abort = chainAbortSignal(signal);
  try {
    const resp = await fetch(`${trimTrailingSlash(baseUrl)}/v1/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(entry),
      signal: abort.signal,
    });

    return resp.ok;
  } catch {
    return false;
  } finally {
    abort.cleanup();
  }
}
