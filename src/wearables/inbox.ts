import {
  parseWearableCommandEnvelope,
  type WearableCommandEnvelope,
} from './protocol';
import {
  applyWearableCommand,
  type WearableApplyResult,
  type WearableSyncState,
} from './stateReducer';

/**
 * Transport-independent persistence boundary. Native WCSession / Data Layer
 * adapters can implement it later without changing protocol semantics.
 */
export interface WearableInboxDriver {
  loadInbox: () => Promise<unknown[]>;
  /** Atomically replace the durable inbox. */
  saveInbox: (items: WearableCommandEnvelope[]) => Promise<void>;
  /** Persist the reduced domain state before any acknowledgement is emitted. */
  commitState: (
    state: WearableSyncState,
    envelope: WearableCommandEnvelope,
    result: WearableApplyResult,
  ) => Promise<void>;
  /** Send an acknowledgement. Throwing leaves the inbox entry for replay. */
  acknowledge: (messageId: string, revision: number) => Promise<void>;
}

export interface WearableInboxRun {
  state: WearableSyncState;
  outcomes: { messageId: string; status: WearableApplyResult['status']; reason?: string }[];
  invalidItems: number;
  pendingItems: number;
}

export async function enqueueWearableCommand(
  driver: Pick<WearableInboxDriver, 'loadInbox' | 'saveInbox'>,
  input: unknown,
): Promise<{ accepted: boolean; duplicate: boolean; errors?: string[] }> {
  const parsed = parseWearableCommandEnvelope(input);
  if (!parsed.ok) return { accepted: false, duplicate: false, errors: parsed.errors };

  const rawInbox = await driver.loadInbox();
  const validInbox = rawInbox
    .map((item) => parseWearableCommandEnvelope(item))
    .filter((item): item is { ok: true; value: WearableCommandEnvelope } => item.ok)
    .map((item) => item.value);
  if (validInbox.some((item) => item.messageId === parsed.value.messageId)) {
    return { accepted: true, duplicate: true };
  }
  await driver.saveInbox([...validInbox, parsed.value]);
  return { accepted: true, duplicate: false };
}

/**
 * Drain every command that can currently be reduced. Sequence gaps and missing
 * evening starts stay durable for a later pass. Each successful transition is
 * committed before ack, and its inbox row is removed only after ack succeeds.
 */
export async function processWearableInbox(
  driver: WearableInboxDriver,
  initialState: WearableSyncState,
): Promise<WearableInboxRun> {
  const rawInbox = await driver.loadInbox();
  const valid: WearableCommandEnvelope[] = [];
  let invalidItems = 0;
  for (const item of rawInbox) {
    const parsed = parseWearableCommandEnvelope(item);
    if (parsed.ok) valid.push(parsed.value);
    else invalidItems += 1;
  }

  let pending = valid;
  let state = initialState;
  const outcomes: WearableInboxRun['outcomes'] = [];
  let madeProgress = true;

  while (madeProgress && pending.length > 0) {
    madeProgress = false;
    for (const envelope of [...pending]) {
      // Arrival order is not guaranteed by either native transport. Never let a
      // higher command from one actor establish the baseline while a lower
      // sequence from that same actor is already durable in the inbox.
      if (
        pending.some(
          (candidate) =>
            candidate.actorId === envelope.actorId &&
            candidate.actorSequence < envelope.actorSequence,
        )
      ) {
        continue;
      }
      const result = applyWearableCommand(state, envelope);
      if (result.status === 'deferred') continue;

      await driver.commitState(result.state, envelope, result);
      await driver.acknowledge(envelope.messageId, result.state.revision);
      state = result.state;
      outcomes.push({
        messageId: envelope.messageId,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      pending = pending.filter((item) => item.messageId !== envelope.messageId);
      await driver.saveInbox(pending);
      madeProgress = true;
    }
  }

  // Invalid payloads are never applied or acknowledged. Replacing the inbox
  // here quarantines them from blocking valid commands forever.
  if (invalidItems > 0) await driver.saveInbox(pending);

  return {
    state,
    outcomes,
    invalidItems,
    pendingItems: pending.length,
  };
}
