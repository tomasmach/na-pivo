import type { PublishedNight } from '@/data/nightsClient';
import { removeAccountFromNightFeedCaches } from '@/feed/feedCache';

export interface NightFeedSafetyChange {
  viewerAccountId: string | null;
  targetAccountId: string;
  blocked: boolean;
}

type NightFeedSafetyListener = (change: NightFeedSafetyChange) => void;

const listeners = new Set<NightFeedSafetyListener>();
const blockedAccountsByViewer = new Map<string, Set<string>>();

function updateBlockedAccounts(change: NightFeedSafetyChange): void {
  if (!change.viewerAccountId) return;
  const current = blockedAccountsByViewer.get(change.viewerAccountId) ?? new Set<string>();
  if (change.blocked) {
    current.add(change.targetAccountId);
    blockedAccountsByViewer.set(change.viewerAccountId, current);
    return;
  }
  current.delete(change.targetAccountId);
  if (current.size === 0) blockedAccountsByViewer.delete(change.viewerAccountId);
}

export function isNightFeedAccountBlocked(
  viewerAccountId: string,
  targetAccountId: string,
): boolean {
  return blockedAccountsByViewer.get(viewerAccountId)?.has(targetAccountId) === true;
}

/** Filter both cached and network pages while a block refresh is in flight. */
export function filterNightFeedForSafety(
  viewerAccountId: string,
  nights: readonly PublishedNight[],
): PublishedNight[] {
  const blockedAccounts = blockedAccountsByViewer.get(viewerAccountId);
  if (!blockedAccounts || blockedAccounts.size === 0) return [...nights];
  return nights.flatMap((night) => {
    if (blockedAccounts.has(night.author.id)) return [];
    const participants = night.participants.filter(
      (person) => !blockedAccounts.has(person.id),
    );
    return participants.length === night.participants.length
      ? [night]
      : [{ ...night, participants }];
  });
}

export function subscribeNightFeedSafety(
  listener: NightFeedSafetyListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify retained feed screens synchronously, then durably prune all feed
 * scopes before the profile action is considered settled.
 */
export async function notifyNightFeedSafetyChange(
  change: NightFeedSafetyChange,
): Promise<void> {
  if (!change.targetAccountId) return;
  updateBlockedAccounts(change);
  for (const listener of [...listeners]) listener(change);
  if (change.blocked && change.viewerAccountId) {
    await removeAccountFromNightFeedCaches(change.viewerAccountId, change.targetAccountId);
  }
}
