/**
 * Feedback client — lets users send a bug report, idea, or note from the app.
 *
 * Sending is best-effort and non-blocking. The UI shows a thank-you immediately;
 * this client only syncs the message to the backend. The payload is enriched
 * with app/platform metadata so we can triage without asking the user.
 */

import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';

import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getAppVersionLabel } from '@/utils/appVersion';

export type FeedbackCategory = 'bug' | 'idea' | 'other';
export type FeedbackContactType = 'instagram' | 'email';

/** What the UI hands to the queue — the stable bits the user typed. */
export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  contactType?: FeedbackContactType;
  contact?: string;
  /** Prepared JPEG in the picker cache; the queue copies it to durable storage. */
  attachmentUri?: string;
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
  /** Local-only durable URI; never serialized as a text field to the backend. */
  attachment_uri?: string;
}

const REQUEST_TIMEOUT_MS = 30000;

export type FeedbackSubmitResult = 'ok' | 'retry' | 'permanent-error';

/**
 * Builds the full, retry-stable payload from the user's input. The metadata
 * (app version, platform, OS version) is captured once at enqueue time so every
 * retry of the same client_id is byte-identical.
 */
export function buildFeedbackEntry(
  input: FeedbackInput,
  clientId: string,
  attachmentUri?: string,
): FeedbackEntry {
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
    ...(attachmentUri ? { attachment_uri: attachmentUri } : {}),
  };
}

/**
 * POSTs one feedback entry. Entries with a local attachment use Expo's native
 * multipart uploader; text-only/legacy queue entries keep the JSON wire shape.
 * The backend is idempotent on client_id, so resending is safe. Never throws.
 */
export async function submitFeedback(
  entry: FeedbackEntry,
  signal?: AbortSignal,
): Promise<FeedbackSubmitResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/feedback');
  if (!endpoint) return 'retry';

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return 'retry';

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    let status: number;
    const attachment = entry.attachment_uri ? new File(entry.attachment_uri) : null;
    if (attachment?.exists) {
      const resp = await attachment.upload(endpoint, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'attachment',
        mimeType: 'image/jpeg',
        headers: { Authorization: `Bearer ${session.token}` },
        parameters: {
          client_id: entry.client_id,
          category: entry.category,
          message: entry.message,
          contact_type: entry.contact_type ?? '',
          contact: entry.contact ?? '',
          app_version: entry.app_version,
          platform: entry.platform,
          os_version: entry.os_version,
        },
        signal: abort.signal,
      });
      status = resp.status;
    } else {
      const { attachment_uri: _localOnly, ...payload } = entry;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      status = resp.status;
    }

    if (status >= 200 && status < 300) return 'ok';
    return classifyQueueHttpFailure(status, session);
  } catch {
    return 'retry';
  } finally {
    abort.cleanup();
  }
}
