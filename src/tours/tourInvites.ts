import { Share } from 'react-native';
import { sendTourInvites, type TourInviteError, type TourInviteRow } from '@/data/tourInvitesClient';
import { tourContentSignature, useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { tourError } from './TourChrome';
import type { TourError, TourPlan } from './model';

/** Invitees open the tour through its link, so the link has to be valid and carry this exact plan. */
export function linkReady(plan: TourPlan, published: Record<string, string>, pending: Record<string, unknown>): boolean {
  return !!plan.share && Date.parse(plan.share.expiresAt) > Date.now()
    && published[plan.id] === tourContentSignature(plan) && !pending[plan.id];
}

/** Put the plan and its link on the server when the phone has something newer. Resolves to what failed, or null. */
async function prepare(planId: string): Promise<TourError | null> {
  const hydrated = await useToursStore.getState().hydrate();
  if (!hydrated.ok) return hydrated.error;
  // A publish left from an earlier try finishes first with that older plan, so a second pass puts up the one saved since.
  for (let pass = 0; ; pass++) {
    const { plans, published, pending } = useToursStore.getState();
    const plan = plans.find((p) => p.id === planId);
    if (!plan || plan.source) return 'not_found';
    if (linkReady(plan, published, pending)) return null;
    if (pass === 2) return 'network';
    const result = await useToursStore.getState().publish(planId);
    if (!result.ok) return result.error;
  }
}

function inviteError(error: TourInviteError): string {
  const e = t.tourInvites.errors;
  switch (error) {
    case 'ghost': return t.tourInvites.ghost;
    case 'not_friends': return e.notFriends;
    case 'limit': return e.limit;
    case 'unsupported': return e.unsupported;
    case 'not_found': return e.gone;
    case 'account_changed': return t.tours.errors.session;
    default: return e.network;
  }
}

export type InviteOutcome = { status: 'sent'; roster: TourInviteRow[]; invited: number } | { error: string };

/** Invites go out only with a signal: nothing waits in the background to reach friends later with an older tour or link. */
export async function inviteFriends(planId: string, recipientIds: string[]): Promise<InviteOutcome> {
  const failed = await prepare(planId);
  if (failed) return { error: failed === 'not_found' ? t.tourInvites.errors.gone : tourError(failed) ?? t.tourInvites.errors.network };
  const result = await sendTourInvites(planId, recipientIds);
  if (!result.ok) return { error: inviteError(result.error) };
  return { status: 'sent', roster: result.value.roster, invited: result.value.invited };
}

/** One tap: make the link if there is none yet, then the system share sheet. Resolves to an error to show, or null. */
export async function shareTourLink(planId: string): Promise<string | null> {
  const failed = await prepare(planId);
  if (failed) return tourError(failed) ?? t.tours.errors.network;
  const url = useToursStore.getState().plans.find((p) => p.id === planId)?.share?.url;
  if (!url) return t.tours.errors.unavailable;
  try {
    await Share.share({ message: url });
    return null;
  } catch {
    return t.tours.errors.unavailable;
  }
}
