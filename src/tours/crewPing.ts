import { generateUuidV4 } from '@/data/account';
import { fetchFriendsDashboard, shareFriendPubActivity } from '@/data/friendsClient';
import { dropQueuedTourPings, enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { t } from '@/i18n';
import { pubFromStop } from './counterLink';
import type { TourRun, TourStop } from './model';

/** Where friends should come: the last stop checked off, else the one the crew walks to. */
export function pingStop(run: Pick<TourRun, 'snapshot' | 'statuses'>): { stop: TourStop; heading: boolean } | null {
  const { stops } = run.snapshot;
  for (let index = stops.length - 1; index >= 0; index--)
    if (run.statuses[stops[index].id] === 'visited') return { stop: stops[index], heading: false };
  const next = stops.find((stop) => !run.statuses[stop.id]);
  return next ? { stop: next, heading: true } : null;
}

export type PingFriends = { ghost: boolean; ids: string[] };

/** The party as the phone last saw it; fetched once when Parta was never opened on this install. */
export async function loadPingFriends(): Promise<PingFriends | null> {
  const dashboard = (await loadFriendsDashboardSnapshot())?.dashboard ?? await fetchFriendsDashboard();
  return dashboard ? { ghost: dashboard.settings?.ghostMode === true, ids: dashboard.friends.map((friend) => friend.id) } : null;
}

/** Friends walking the tour already sit at the table; everyone else hears about it. Undefined keeps the plain "whole party". */
export function pingRecipients(friendIds: string[], crewIds: string[]): string[] | undefined {
  const away = friendIds.filter((id) => !crewIds.includes(id));
  return away.length < friendIds.length ? away : undefined;
}

export type PingResult = { status: 'sent' | 'queued'; clientId: string } | { error: string };

/** One ping per tour at a time: whatever still waits for signal gives way to where the crew is now. */
export async function sendPing(title: string, target: { stop: TourStop; heading: boolean }, recipientIds?: string[]): Promise<PingResult> {
  // An empty list would reach the whole party, the crew at the table included.
  if (recipientIds?.length === 0) return { error: t.tours.crewPingAllHere };
  const pub = pubFromStop(target.stop);
  // The server takes 200 characters of name and 128 of id; anything longer would be dropped for good.
  pub.name = pub.name.slice(0, 200);
  if (pub.id.length > 128) pub.id = '';
  const message = t.tours.crewPingMessage(title);
  const tour = { title, heading: target.heading };
  const clientId = generateUuidV4();
  const startedAt = new Date().toISOString();
  await dropQueuedTourPings();
  const result = await shareFriendPubActivity(pub, message, clientId, recipientIds, startedAt, tour);
  if (result.ok) return { status: 'sent', clientId };
  if (!isRetriableFriendError(result)) return { error: result.detail || t.friends.shareError };
  await enqueueFriendOp({ op: 'activity', clientId, payload: { pub, message, recipientIds, startedAt, tour } });
  return { status: 'queued', clientId };
}
