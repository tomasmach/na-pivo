/**
 * One answer to "may this account publish an amenity vote right now?", shared by
 * the two places a vote can be cast (the pub detail's inline rows and the
 * "Zmapuj hospodu" sheet).
 *
 * Returns the code the consent sheet needs, so a user who accepted an older
 * policy is told the rules changed instead of being asked from scratch.
 *
 * Two sources, because either one alone has a blind spot: `ugcConsent` knows
 * about a 428 the server has already answered — the only signal available before
 * the profile lands — and the loaded profile covers an account `ugcConsent` has
 * never seen. The remembered state wins whenever it knows the account, because
 * it is the one that survives a late `/account/me` overwriting an acceptance.
 */

import { ugcConsentStatus, type UgcConsentRequiredCode } from '@/data/ugcConsent';
import { useAccountStore } from '@/stores/accountStore';

export function amenityVoteUgcConsentCode(): UgcConsentRequiredCode | null {
  const { profile, session } = useAccountStore.getState();

  const accountId = session?.accountId ?? null;
  if (accountId != null) {
    const status = ugcConsentStatus(accountId);
    if (status.known) return status.requiredCode;
  }

  const consent = profile?.ugcConsent;
  if (!consent || consent.accepted) return null;
  return consent.acceptedVersion ? 'ugc_policy_update_required' : 'ugc_consent_required';
}
