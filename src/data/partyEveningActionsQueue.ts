/** Durable end/leave actions so a cellar cannot trap a finished local night. */

import {
  endPartyEvening,
  isRetriablePartyError,
  leavePartyEvening,
  type PartyError,
  type PartyEvening,
} from './partyClient';
import { createCoalescingFlush, createQueueLock, createQueueStorage } from './createQueue';
import { preserveDurableQueue } from './durableQueuePolicy';
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from './joinCode';
import { clearPartyEveningIdentityForCode } from './partyEveningIdentityCache';

export const PARTY_EVENING_ACTIONS_STORAGE_KEY = 'na-pivo-party-evening-actions-queue';
const MAX_QUEUE_LENGTH = 10;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PartyEveningAction = 'end' | 'leave';

interface QueueItem {
  action: PartyEveningAction;
  code: string;
  queuedAt: number;
}

export type PartyEveningActionAcceptance =
  | { accepted: true; completed: boolean; evening?: PartyEvening }
  | { accepted: false; error: PartyError };

function isQueueItem(value: unknown): value is QueueItem {
  const item = value as QueueItem;
  return (
    !!item &&
    (item.action === 'end' || item.action === 'leave') &&
    typeof item.code === 'string' &&
    item.code.length === JOIN_CODE_LENGTH &&
    [...item.code].every((character) => JOIN_CODE_ALPHABET.includes(character)) &&
    typeof item.queuedAt === 'number' &&
    Number.isFinite(item.queuedAt)
  );
}

const { load, save } = createQueueStorage<QueueItem>(
  PARTY_EVENING_ACTIONS_STORAGE_KEY,
  isQueueItem,
);
const mutate = createQueueLock();
let boundaryGeneration = 0;

function identity(item: QueueItem): string {
  return `${item.action}:${item.code}`;
}

async function remove(item: QueueItem, generation: number): Promise<void> {
  await mutate(async () => {
    if (generation !== boundaryGeneration) return;
    const items = await load();
    if (generation !== boundaryGeneration) return;
    await save(items.filter((candidate) => identity(candidate) !== identity(item)));
  });
}

async function deliver(
  item: QueueItem,
  generation: number,
  signal?: AbortSignal,
): Promise<PartyEveningActionAcceptance> {
  if (generation !== boundaryGeneration || signal?.aborted) {
    return { accepted: true, completed: false };
  }
  const result = item.action === 'end'
    ? await endPartyEvening(item.code, signal)
    : await leavePartyEvening(item.code, signal);
  if (generation !== boundaryGeneration || signal?.aborted) {
    return { accepted: true, completed: false };
  }
  if (result.ok) {
    await remove(item, generation);
    await clearPartyEveningIdentityForCode(item.code);
    const evening = item.action === 'end'
      ? (result as { ok: true; evening: PartyEvening }).evening
      : undefined;
    return {
      accepted: true,
      completed: true,
      ...(evening ? { evening } : {}),
    };
  }
  // An idempotent retry may find that another phone already ended/left it.
  if (result.code === 'party_not_found' || result.code === 'party_not_active') {
    await remove(item, generation);
    await clearPartyEveningIdentityForCode(item.code);
    return { accepted: true, completed: true };
  }
  if (isRetriablePartyError(result)) {
    return { accepted: true, completed: false };
  }
  await remove(item, generation);
  return { accepted: false, error: result };
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const generation = boundaryGeneration;
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const item of await mutate(load)) {
    if (generation !== boundaryGeneration || signal.aborted) return;
    if (item.queuedAt < cutoff) {
      await remove(item, generation);
      continue;
    }
    await deliver(item, generation, signal);
  }
}

const { flush: flushPartyEveningActionsQueue, abortInFlight } =
  createCoalescingFlush(flushUnlocked);

export async function enqueuePartyEveningAction(
  action: PartyEveningAction,
  code: string,
): Promise<PartyEveningActionAcceptance> {
  const generation = boundaryGeneration;
  const item: QueueItem = { action, code: code.toUpperCase(), queuedAt: Date.now() };
  const persisted = await mutate(async () => {
    const items = await load();
    if (generation !== boundaryGeneration) return false;
    const next = preserveDurableQueue([
      ...items.filter((candidate) => identity(candidate) !== identity(item)),
      item,
    ], MAX_QUEUE_LENGTH);
    return save(next);
  });
  if (!persisted) {
    return {
      accepted: false,
      error: {
        ok: false,
        code: 'storage',
        detail: 'Večer se mi nepovedlo uložit k dokončení.',
      },
    };
  }
  return deliver(item, generation);
}

export { flushPartyEveningActionsQueue };

/**
 * A locally finished table must not spring back to life while its durable
 * end/leave request is still waiting for the network.
 */
export async function hasQueuedPartyEveningAction(code: string): Promise<boolean> {
  const normalized = code.toUpperCase();
  return (await mutate(load)).some((item) => item.code === normalized);
}

export function clearPartyEveningActionsQueue(): Promise<void> {
  boundaryGeneration += 1;
  abortInFlight();
  return mutate(async () => {
    await save([]);
  }, { allowDuringPrivateTransition: true });
}
