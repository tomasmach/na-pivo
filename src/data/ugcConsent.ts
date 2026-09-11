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

const snapshotsByAccountId = new Map<string, UgcConsentSnapshot>();

/**
 * Accounts the server has already answered 428 for. A profile snapshot can be
 * missing or stale (the queue flushes before the profile loads), so the refusal
 * itself is remembered as the authoritative "this account still owes consent".
 */
const consentOwedAccountIds = new Set<string>();

export function rememberUgcConsent(accountId: string, snapshot: UgcConsentSnapshot): void {
  snapshotsByAccountId.set(accountId, snapshot);
  // Acceptance (this device or another one) lifts the hold, so the queues that
  // were waiting on it may publish again.
  if (snapshot.accepted) consentOwedAccountIds.delete(accountId);
}

export function ugcPolicyHeaders(accountId: string): Record<string, string> {
  const learned = snapshotsByAccountId.get(accountId)?.policyVersion;
  const version =
    learned && learned > CURRENT_UGC_POLICY_VERSION ? learned : CURRENT_UGC_POLICY_VERSION;
  return { [UGC_POLICY_HEADER]: version };
}

/** Remember that the server refused this account's public writes with a 428. */
export function holdUgcPublishing(accountId: string): void {
  consentOwedAccountIds.add(accountId);
}

/**
 * True when a public contribution from this account would be refused: the server
 * already answered 428, or the last profile snapshot says the policy is not
 * accepted. Callers use it to ask BEFORE publishing — a queued write that keeps
 * re-sending into a 428 never lands and only burns requests and telemetry.
 */
export function isUgcConsentPending(accountId: string): boolean {
  if (consentOwedAccountIds.has(accountId)) return true;
  const snapshot = snapshotsByAccountId.get(accountId);
  return snapshot ? !snapshot.accepted : false;
}

export type UgcConsentRequiredCode = 'ugc_consent_required' | 'ugc_policy_update_required';

export interface UgcConsentRequiredEvent {
  code: UgcConsentRequiredCode;
  /**
   * True when the user just tried to publish something. The sheet keeps its
   * "not now" quiet period against background retries, but an explicit tap has
   * to be answered — otherwise the tap does nothing at all.
   */
  userInitiated: boolean;
}

export type UgcConsentRequiredListener = (payload: UgcConsentRequiredEvent) => void;

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

export function notifyUgcConsentRequired(
  code: UgcConsentRequiredCode,
  options?: { userInitiated?: boolean },
): void {
  if (code !== 'ugc_consent_required' && code !== 'ugc_policy_update_required') return;
  const userInitiated = options?.userInitiated === true;
  for (const listener of [...listeners]) {
    try {
      listener({ code, userInitiated });
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
  snapshotsByAccountId.clear();
  consentOwedAccountIds.clear();
  listeners.clear();
}
