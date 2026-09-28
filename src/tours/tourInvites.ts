import { Share } from 'react-native';
import { sendTourInvites, type TourInviteError, type TourInviteRow } from '@/data/tourInvitesClient';
import { enqueueTourInvite, flushTourInvitesQueue, setTourInvitePreparer } from '@/data/tourInvitesQueue';
import { tourContentSignature, useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { tourError } from './TourChrome';
import type { TourError, TourPlan } from './model';

/** Invitees open the tour through its link, so the link has to be valid and carry this exact plan. */
export function linkReady(plan: TourPlan, published: Record<string, string>, pending: Record<string, unknown>): boolean {
  return !!plan.share && Date.parse(plan.share.expiresAt) > Date.now()
    && published[plan.id] === tourContentSignature(plan) && !pending[plan.id];
}

// Worth another try later; everything else needs the owner (a conflict, a full list of links, a plan the server refused).
const RETRIABLE: TourError[] = ['network', 'throttled', 'auth', 'busy', 'account_changed'];

/** Put the plan and its link on the server when the phone has something newer. */
async function prepare(planId: string): Promise<{ outcome: 'ok' | 'retry' | 'drop'; error?: TourError }> {
  const hydrated = await useToursStore.getState().hydrate();
  if (!hydrated.ok) return { outcome: 'retry', error: hydrated.error };
  const { plans, published, pending } = useToursStore.getState();
  const plan = plans.find((p) => p.id === planId);
  if (!plan || plan.source) return { outcome: 'drop', error: 'not_found' };
  if (linkReady(plan, published, pending)) return { outcome: 'ok' };
  const result = await useToursStore.getState().publish(planId);
  if (result.ok) return { outcome: 'ok' };
  return { outcome: RETRIABLE.includes(result.error) ? 'retry' : 'drop', error: result.error };
}

setTourInvitePreparer(async (planId) => {
  const { outcome, error } = await prepare(planId);
  // A background retry that found no signal is not something to show on the tour screen.
  if (outcome === 'retry' && useToursStore.getState().error === error) useToursStore.getState().clearError();
  return outcome;
});

export { flushTourInvitesQueue };

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

export type InviteOutcome = { status: 'sent'; roster: TourInviteRow[]; invited: number } | { status: 'queued' } | { error: string };

/** Sends now when it can; without signal the invite waits in the queue and says so. */
export async function inviteFriends(planId: string, recipientIds: string[]): Promise<InviteOutcome> {
  const ready = await prepare(planId);
  if (ready.outcome === 'drop') return { error: ready.error === 'not_found' ? t.tourInvites.errors.gone : tourError(ready.error) ?? t.tourInvites.errors.network };
  if (ready.outcome === 'ok') {
    const result = await sendTourInvites(planId, recipientIds);
    if (result.ok) {
      // Something that waited for this tour before can go now too.
      void flushTourInvitesQueue();
      return { status: 'sent', roster: result.value.roster, invited: result.value.invited };
    }
    if (!result.retry) return { error: inviteError(result.error) };
  }
  return (await enqueueTourInvite(planId, recipientIds)) ? { status: 'queued' } : { error: t.tourInvites.errors.network };
}

/** One tap: make the link if there is none yet, then the system share sheet. Resolves to an error to show, or null. */
export async function shareTourLink(planId: string): Promise<string | null> {
  const ready = await prepare(planId);
  if (ready.outcome !== 'ok') return tourError(ready.error ?? 'network') ?? t.tours.errors.network;
  const url = useToursStore.getState().plans.find((p) => p.id === planId)?.share?.url;
  if (!url) return t.tours.errors.unavailable;
  try {
    await Share.share({ message: url });
    return null;
  } catch {
    return t.tours.errors.unavailable;
  }
}
