/**
 * One answer to "may this account publish an amenity vote right now?", shared by
 * the two places a vote can be cast (the pub detail's inline rows and the
 * "Zmapuj hospodu" sheet).
 *
 * Two sources, because either one alone has a blind spot: the loaded profile
 * knows the policy was never accepted, and `ugcConsent` remembers a 428 the
 * server has already answered — which is the only signal available before the
 * profile lands.
 */

import { isUgcConsentPending } from '@/data/ugcConsent';
import { useAccountStore } from '@/stores/accountStore';

export function amenityVoteNeedsUgcConsent(): boolean {
  const { profile, session } = useAccountStore.getState();
  if (profile?.ugcConsent?.accepted === false) return true;
  const accountId = session?.accountId ?? null;
  return accountId != null && isUgcConsentPending(accountId);
}
