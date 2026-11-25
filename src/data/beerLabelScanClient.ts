/**
 * "Vyfoť etiketu": uploads one bottle or can photo to POST /v1/beer-label-scan
 * and maps the recognized beer. A pure extractor; the drink is logged by the
 * normal counter path after the user confirms it. Upload goes through the
 * native uploader for the same reason as menuScanClient. Never throws.
 */

import { File, UploadType } from 'expo-file-system';

import type { ServingType } from '@/drinks/drinkTypes';

import { ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

const UPLOAD_TIMEOUT_MS = 30_000;
const LABEL_SERVINGS: readonly ServingType[] = ['bottle', 'can', 'plastic_bottle'];

export interface ScannedLabel {
  name: string;
  brewery: string;
  /** The name matched a beer in the catalogue. */
  matched: boolean;
  servingType?: ServingType;
  volumeMl?: number;
}

export type LabelScanResult =
  | { status: 'ok'; beer: ScannedLabel }
  | { status: 'empty' }
  | { status: 'unavailable' }
  | { status: 'daily-cap' }
  | { status: 'rate-limited' }
  | { status: 'bad-image' }
  | { status: 'error' };

export function parseScannedLabel(data: unknown): ScannedLabel | null {
  const beer = (data as { beer?: unknown } | null)?.beer;
  if (!beer || typeof beer !== 'object') return null;
  const b = beer as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) return null;
  const serving = LABEL_SERVINGS.find((value) => value === b.serving_type);
  return {
    name: b.name.trim(),
    brewery: typeof b.brewery === 'string' ? b.brewery : '',
    matched: b.matched === true,
    ...(serving ? { servingType: serving } : {}),
    ...(typeof b.volume_ml === 'number' ? { volumeMl: b.volume_ml } : {}),
  };
}

export async function scanBeerLabel(localUri: string): Promise<LabelScanResult> {
  const endpoint = getBackendEndpoint('/v1/beer-label-scan');
  if (!endpoint) return { status: 'error' };
  const session = await ensureAccount();
  if (!session) return { status: 'error' };

  const abort = chainAbortSignal(undefined, UPLOAD_TIMEOUT_MS);
  try {
    const resp = await new File(localUri).upload(endpoint, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'image',
      mimeType: 'image/jpeg',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      data = resp.body ? (JSON.parse(resp.body) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (resp.status === 429) return { status: 'rate-limited' };
    if (resp.status === 503) return data.code === 'daily_cap' ? { status: 'daily-cap' } : { status: 'unavailable' };
    if (resp.status === 400) return { status: 'bad-image' };
    if (resp.status < 200 || resp.status >= 300) return { status: 'error' };
    const beer = parseScannedLabel(data);
    return beer ? { status: 'ok', beer } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  } finally {
    abort.cleanup();
  }
}
