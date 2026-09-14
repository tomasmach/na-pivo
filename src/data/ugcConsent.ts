export const UGC_POLICY_HEADER = 'X-Na-Pivo-UGC-Policy-Version';

export interface UgcConsentSnapshot {
  policyVersion: string;
  accepted: boolean;
  acceptedVersion: string;
  acceptedAt: string | null;
}

export function parseUgcConsentSnapshot(input: unknown): UgcConsentSnapshot | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;

  const wire = input as Record<string, unknown>;
  const { policy_version, accepted, accepted_version, accepted_at } = wire;

  if (typeof policy_version !== 'string' || policy_version.length === 0) return null;
  if (typeof accepted !== 'boolean') return null;
  if (typeof accepted_version !== 'string') return null;
  if (accepted_at !== null && typeof accepted_at !== 'string') return null;

  return {
    policyVersion: policy_version,
    accepted,
    acceptedVersion: accepted_version,
    acceptedAt: accepted_at,
  };
}

export const CURRENT_UGC_POLICY_VERSION = '2026-08-22';

const headersByAccountId = new Map<string, string>();

export function rememberUgcConsent(accountId: string, snapshot: UgcConsentSnapshot): void {
  headersByAccountId.set(accountId, snapshot.policyVersion);
}

export function ugcPolicyHeaders(accountId: string): Record<string, string> {
  const learned = headersByAccountId.get(accountId);
  const version =
    learned && learned > CURRENT_UGC_POLICY_VERSION ? learned : CURRENT_UGC_POLICY_VERSION;
  return { [UGC_POLICY_HEADER]: version };
}

export type UgcConsentRequiredCode = 'ugc_consent_required' | 'ugc_policy_update_required';

export type UgcConsentRequiredListener = (payload: { code: UgcConsentRequiredCode }) => void;

const listeners = new Set<UgcConsentRequiredListener>();

export function subscribeUgcConsentRequired(listener: UgcConsentRequiredListener): () => void {
  listeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
  };
}

export function notifyUgcConsentRequired(code: UgcConsentRequiredCode): void {
  if (code !== 'ugc_consent_required' && code !== 'ugc_policy_update_required') return;
  for (const listener of [...listeners]) {
    try {
      listener({ code });
    } catch {
      // A failing listener must not stop the others.
    }
  }
}

export function notifyUgcConsentRequiredFromResponse(
  status: number,
  payload: unknown,
): UgcConsentRequiredCode | null {
  if (status !== 428) return null;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  const code = (payload as Record<string, unknown>).code;
  if (code === 'ugc_consent_required' || code === 'ugc_policy_update_required') {
    notifyUgcConsentRequired(code);
    return code;
  }
  return null;
}

export function clearUgcConsentStateForTests(): void {
  headersByAccountId.clear();
  listeners.clear();
}
