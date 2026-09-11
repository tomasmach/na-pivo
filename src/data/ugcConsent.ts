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

export type UgcConsentRequiredCode = 'ugc_consent_required' | 'ugc_policy_update_required';

/**
 * What this client knows about one account's UGC consent.
 *
 * Everything here is a HIGH-WATER mark, never a plain overwrite: a `/account/me`
 * that was already in flight when the user accepted comes back saying
 * `accepted: false`, and letting that answer win would lock the gated queues out
 * again with no request and no sheet to unlock them.
 */
interface AccountConsentState {
  /** The most recent snapshot, kept for deriving which code the sheet needs. */
  snapshot?: UgcConsentSnapshot;
  /**
   * The version the server last said it wants. Follows the server in BOTH
   * directions — a reverted bump has to take the header back down, or every
   * gated write keeps asking for a version the server no longer accepts and
   * "Souhlasím" fails until the app restarts.
   */
  learnedVersion?: string;
  /** Highest policy version we have first-hand proof this account accepted. */
  acceptedVersion?: string;
  /** The unanswered 428 code, if the server has refused a public write. */
  owedCode?: UgcConsentRequiredCode;
}

const stateByAccountId = new Map<string, AccountConsentState>();

function stateFor(accountId: string): AccountConsentState {
  const existing = stateByAccountId.get(accountId);
  if (existing) return existing;
  const created: AccountConsentState = {};
  stateByAccountId.set(accountId, created);
  return created;
}

/** The policy version this client sends for the account. */
function wantedVersion(accountId: string): string {
  const learned = stateByAccountId.get(accountId)?.learnedVersion;
  return learned && learned > CURRENT_UGC_POLICY_VERSION ? learned : CURRENT_UGC_POLICY_VERSION;
}

export function rememberUgcConsent(accountId: string, snapshot: UgcConsentSnapshot): void {
  const state = stateFor(accountId);
  state.snapshot = snapshot;
  state.learnedVersion = snapshot.policyVersion;
  if (!snapshot.accepted) return;

  // Acceptance (this device or another one) lifts the hold, so the queues that
  // were waiting on it may publish again.
  const accepted = snapshot.acceptedVersion || snapshot.policyVersion;
  if (!state.acceptedVersion || accepted > state.acceptedVersion) {
    state.acceptedVersion = accepted;
  }
  state.owedCode = undefined;
}

export function ugcPolicyHeaders(accountId: string): Record<string, string> {
  return { [UGC_POLICY_HEADER]: wantedVersion(accountId) };
}

/**
 * Remember that the server refused this account's public writes with a 428.
 *
 * Returns whether the hold was recorded. A `ugc_consent_required` that lands
 * after we have proof of acceptance for the version we send is a refusal of a
 * request that left before the user accepted — it says nothing about now, so it
 * gets no hold, no sheet and no failure event. A policy bump
 * (`ugc_policy_update_required`) always holds: it asks for a version this
 * account has not accepted.
 */
export function holdUgcPublishing(
  accountId: string,
  code: UgcConsentRequiredCode = 'ugc_consent_required',
): boolean {
  const state = stateFor(accountId);
  const accepted = state.acceptedVersion;
  if (code === 'ugc_consent_required' && accepted && accepted >= wantedVersion(accountId)) {
    return false;
  }
  state.owedCode = code;
  return true;
}

/**
 * What this client knows about publishing for the account right now.
 *
 * `known` is false only when nothing has been learned about the account yet, so
 * a caller with a second source (the loaded profile) can fall back to it instead
 * of reading "nothing owed" as "consent given".
 */
export function ugcConsentStatus(accountId: string): {
  known: boolean;
  requiredCode: UgcConsentRequiredCode | null;
} {
  const state = stateByAccountId.get(accountId);
  if (!state) return { known: false, requiredCode: null };

  // A policy bump outranks any acceptance we can prove: the server is refusing
  // the very version this client sends, so a stored acceptance of it is moot.
  if (state.owedCode === 'ugc_policy_update_required') {
    return { known: true, requiredCode: state.owedCode };
  }
  if (state.acceptedVersion && state.acceptedVersion >= wantedVersion(accountId)) {
    return { known: true, requiredCode: null };
  }
  if (state.owedCode) return { known: true, requiredCode: state.owedCode };

  const snapshot = state.snapshot;
  if (!snapshot) return { known: false, requiredCode: null };
  if (snapshot.accepted) return { known: true, requiredCode: null };
  return {
    known: true,
    // An account that accepted an older version needs the "rules changed" copy.
    requiredCode: snapshot.acceptedVersion ? 'ugc_policy_update_required' : 'ugc_consent_required',
  };
}

/**
 * True when a public contribution from this account would be refused. Callers use
 * it to ask BEFORE publishing — a queued write that keeps re-sending into a 428
 * never lands and only burns requests and telemetry.
 */
export function isUgcConsentPending(accountId: string): boolean {
  return ugcConsentStatus(accountId).requiredCode !== null;
}

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

/** The consent code a non-2xx response carries, without telling anyone about it. */
export function ugcConsentRequiredCode(
  status: number,
  payload: unknown,
): UgcConsentRequiredCode | null {
  if (status !== 428) return null;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  const code = (payload as Record<string, unknown>).code;
  return code === 'ugc_consent_required' || code === 'ugc_policy_update_required' ? code : null;
}

export function notifyUgcConsentRequiredFromResponse(
  status: number,
  payload: unknown,
  options?: { userInitiated?: boolean },
): UgcConsentRequiredCode | null {
  const code = ugcConsentRequiredCode(status, payload);
  if (code) notifyUgcConsentRequired(code, options);
  return code;
}

export function clearUgcConsentStateForTests(): void {
  stateByAccountId.clear();
  listeners.clear();
}
