/** Durable shared-table pub stops.
 *
 * Selecting a pub is an event even when nobody orders a beer there. These
 * helpers project the local crawl stop into the existing PubVisit queue; the
 * first later drink reuses the same client id, so the explicit move and the
 * diary session collapse into one server row.
 */

import { decodeGeohash8 } from '@/data/geohash';
import type { VisitEntry } from '@/data/visitsClient';
import {
  enqueueVisitOp,
  flushVisitsQueue,
  resolveQueuedVisitPartyAssociation,
} from '@/data/visitsQueue';
import type { PartyPubTransition, PartyPubVisit } from '@/mocks/livePartyStore';
import {
  selectConfirmedPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';

async function settleIfCreateAlreadyFinished(partyCode?: string | null): Promise<void> {
  const pending = partyCode?.trim().toUpperCase();
  if (!pending) return;
  const state = usePartyEveningStore.getState();
  if (state.pendingJoinCode?.toUpperCase() === pending) return;
  await resolveQueuedVisitPartyAssociation(
    pending,
    selectConfirmedPartyJoinCode(state),
  );
}

export function buildPartyPubVisitEntry(
  visit: PartyPubVisit,
  partyCode?: string | null,
): VisitEntry {
  const { lat, lng } = decodeGeohash8(visit.pubKey);
  const updatedAt = visit.endedAt ?? visit.startedAt;
  return {
    client_id: visit.clientId,
    name: visit.pubName,
    lat,
    lng,
    ...(visit.pubCity ? { city: visit.pubCity } : {}),
    ...(visit.pubExternalId ? { external_id: visit.pubExternalId } : {}),
    ...(partyCode ? { party_code: partyCode.toUpperCase() } : {}),
    started_at: visit.startedAt,
    ended_at: visit.endedAt ?? null,
    updated_at: updatedAt,
  };
}

export async function enqueuePartyPubVisit(
  visit: PartyPubVisit,
  partyCode?: string | null,
  options?: { deferDelivery?: boolean },
): Promise<void> {
  try {
    await enqueueVisitOp(
      {
        op: 'upsert',
        clientId: visit.clientId,
        entry: buildPartyPubVisitEntry(visit, partyCode),
      },
      { deliver: false },
    );
    if (!options?.deferDelivery) await flushVisitsQueue();
    else await settleIfCreateAlreadyFinished(partyCode);
  } catch {
    // The store still owns the stop. A later selection/beer or foreground sync
    // retries the durable projection without breaking the local night.
  }
}

export async function enqueuePartyPubTransition(
  transition: PartyPubTransition | null,
  partyCode?: string | null,
  options?: { deferDelivery?: boolean },
): Promise<void> {
  if (!transition) return;
  try {
    if (transition.previous) {
      await enqueueVisitOp(
        {
          op: 'upsert',
          clientId: transition.previous.clientId,
          entry: buildPartyPubVisitEntry(transition.previous, partyCode),
        },
        { deliver: false },
      );
    }
    await enqueueVisitOp(
      {
        op: 'upsert',
        clientId: transition.current.clientId,
        entry: buildPartyPubVisitEntry(transition.current, partyCode),
      },
      { deliver: false },
    );
    if (!options?.deferDelivery) await flushVisitsQueue();
    else await settleIfCreateAlreadyFinished(partyCode);
  } catch {
    // See enqueuePartyPubVisit: local state stays authoritative while offline.
  }
}
