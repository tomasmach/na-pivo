import type {
  WearableCommandEnvelope,
  WearableDrinkSpec,
  WearableEveningState,
  WearablePubRef,
  WearableTargetState,
} from './protocol';

const MAX_PROCESSED_MESSAGE_IDS = 512;
const MAX_CONFLICTS = 50;

export interface WearableTargetConflict {
  existing: WearableTargetState | null;
  incoming: WearableTargetState | null;
  messageId: string;
}

export interface WearableEveningConflict {
  activeEveningId: string;
  incomingEveningId: string;
  reason: 'different_pub' | 'late_add_after_close';
  messageId: string;
}

export interface WearableSyncState {
  accountEpoch: string;
  revision: number;
  target: WearableTargetState | null;
  evenings: Record<string, WearableEveningState>;
  activeEveningId: string | null;
  eveningAliases: Record<string, string>;
  removedDrinkIds: string[];
  processedMessageIds: string[];
  actorSequences: Record<string, number>;
  targetConflicts: WearableTargetConflict[];
  eveningConflicts: WearableEveningConflict[];
}

export type WearableApplyStatus =
  | 'applied'
  | 'duplicate'
  | 'conflict'
  | 'deferred'
  | 'rejected';

export interface WearableApplyResult {
  state: WearableSyncState;
  status: WearableApplyStatus;
  reason?: string;
}

export function createWearableSyncState(accountEpoch: string): WearableSyncState {
  return {
    accountEpoch,
    revision: 0,
    target: null,
    evenings: {},
    activeEveningId: null,
    eveningAliases: {},
    removedDrinkIds: [],
    processedMessageIds: [],
    actorSequences: {},
    targetConflicts: [],
    eveningConflicts: [],
  };
}

function pubMatches(a: WearablePubRef, b: WearablePubRef): boolean {
  return a.pubKey === b.pubKey;
}

function targetMatches(a: WearableTargetState | null, b: WearableTargetState | null): boolean {
  if (a === null || b === null) return a === b;
  return a.selection === b.selection && pubMatches(a.pub, b.pub);
}

function drinkMatches(a: WearableDrinkSpec, b: WearableDrinkSpec): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.drinkType === b.drinkType &&
    a.volumeMl === b.volumeMl &&
    a.priceCzk === b.priceCzk &&
    a.servingType === b.servingType &&
    a.recordedAt === b.recordedAt
  );
}

function resolveEveningId(state: WearableSyncState, eveningId: string): string {
  let resolved = eveningId;
  const visited = new Set<string>();
  while (state.eveningAliases[resolved] && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = state.eveningAliases[resolved];
  }
  return resolved;
}

function findDrink(
  state: WearableSyncState,
  drinkId: string,
): { eveningId: string; drink: WearableDrinkSpec } | null {
  for (const [eveningId, evening] of Object.entries(state.evenings)) {
    const drink = evening.drinks.find((candidate) => candidate.id === drinkId);
    if (drink) return { eveningId, drink };
  }
  return null;
}

function appendUnique<T>(items: T[], item: T, max = Number.POSITIVE_INFINITY): T[] {
  return [...items, item].slice(-max);
}

function withProcessedCommand(
  previous: WearableSyncState,
  next: WearableSyncState,
  envelope: WearableCommandEnvelope,
): WearableSyncState {
  return {
    ...next,
    processedMessageIds: appendUnique(
      previous.processedMessageIds,
      envelope.messageId,
      MAX_PROCESSED_MESSAGE_IDS,
    ),
    actorSequences: {
      ...previous.actorSequences,
      [envelope.actorId]: envelope.actorSequence,
    },
  };
}

function semanticResult(
  previous: WearableSyncState,
  next: WearableSyncState,
  envelope: WearableCommandEnvelope,
  status: WearableApplyStatus,
  reason?: string,
  changed = true,
): WearableApplyResult {
  const semantic = changed ? { ...next, revision: previous.revision + 1 } : next;
  return {
    state: withProcessedCommand(previous, semantic, envelope),
    status,
    ...(reason ? { reason } : {}),
  };
}

function addDrinkToEvening(
  state: WearableSyncState,
  eveningId: string,
  drink: WearableDrinkSpec,
): WearableSyncState {
  const evening = state.evenings[eveningId];
  return {
    ...state,
    evenings: {
      ...state.evenings,
      [eveningId]: {
        ...evening,
        drinks: [...evening.drinks, drink],
      },
    },
  };
}

function applySetTarget(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
  target: WearableTargetState,
): WearableApplyResult {
  if (targetMatches(state.target, target)) {
    return semanticResult(state, state, envelope, 'duplicate', 'target_already_selected', false);
  }

  const stale = envelope.baseRevision !== state.revision;
  if (stale && state.target) {
    if (state.target.selection === 'manual' && target.selection === 'nearest') {
      return semanticResult(state, state, envelope, 'duplicate', 'manual_target_wins', false);
    }
    if (state.target.selection === 'manual' && target.selection === 'manual') {
      const next = {
        ...state,
        targetConflicts: appendUnique(
          state.targetConflicts,
          { existing: state.target, incoming: target, messageId: envelope.messageId },
          MAX_CONFLICTS,
        ),
      };
      return semanticResult(state, next, envelope, 'conflict', 'concurrent_manual_targets');
    }
    if (state.target.selection === 'nearest' && target.selection === 'nearest') {
      return semanticResult(state, state, envelope, 'duplicate', 'stale_nearest_target', false);
    }
  }

  return semanticResult(state, { ...state, target }, envelope, 'applied');
}

function applyClearTarget(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
): WearableApplyResult {
  if (!state.target) {
    return semanticResult(state, state, envelope, 'duplicate', 'target_already_clear', false);
  }
  if (envelope.baseRevision !== state.revision) {
    const next = {
      ...state,
      targetConflicts: appendUnique(
        state.targetConflicts,
        { existing: state.target, incoming: null, messageId: envelope.messageId },
        MAX_CONFLICTS,
      ),
    };
    return semanticResult(state, next, envelope, 'conflict', 'stale_target_clear');
  }
  return semanticResult(state, { ...state, target: null }, envelope, 'applied');
}

function applyStartEvening(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
  command: Extract<
    WearableCommandEnvelope['payload']['command'],
    { type: 'start_evening_and_add_drink' }
  >,
): WearableApplyResult {
  if (state.removedDrinkIds.includes(command.drink.id)) {
    return semanticResult(state, state, envelope, 'duplicate', 'drink_was_removed', false);
  }
  const existingDrink = findDrink(state, command.drink.id);
  if (existingDrink) {
    return semanticResult(
      state,
      state,
      envelope,
      drinkMatches(existingDrink.drink, command.drink) ? 'duplicate' : 'conflict',
      drinkMatches(existingDrink.drink, command.drink)
        ? 'drink_already_exists'
        : 'drink_id_payload_mismatch',
      false,
    );
  }

  const existingById = state.evenings[resolveEveningId(state, command.eveningId)];
  if (existingById) {
    return semanticResult(
      state,
      addDrinkToEvening(state, existingById.eveningId, command.drink),
      envelope,
      'applied',
    );
  }

  const active = state.activeEveningId ? state.evenings[state.activeEveningId] : null;
  if (
    active &&
    pubMatches(active.pub, command.pub) &&
    active.drinkingDayKey === command.drinkingDayKey
  ) {
    const aliased = {
      ...state,
      eveningAliases: {
        ...state.eveningAliases,
        [command.eveningId]: active.eveningId,
      },
    };
    return semanticResult(
      state,
      addDrinkToEvening(aliased, active.eveningId, command.drink),
      envelope,
      'applied',
      'evening_aliased',
    );
  }

  const created: WearableEveningState = {
    eveningId: command.eveningId,
    pub: command.pub,
    drinkingDayKey: command.drinkingDayKey,
    startedAt: command.drink.recordedAt,
    status: active ? 'conflict' : 'active',
    drinks: [command.drink],
    removedDrinkIds: [],
  };
  const createdState: WearableSyncState = {
    ...state,
    evenings: { ...state.evenings, [created.eveningId]: created },
    activeEveningId: active ? state.activeEveningId : created.eveningId,
  };
  if (!active) return semanticResult(state, createdState, envelope, 'applied');

  return semanticResult(
    state,
    {
      ...createdState,
      eveningConflicts: appendUnique(
        state.eveningConflicts,
        {
          activeEveningId: active.eveningId,
          incomingEveningId: created.eveningId,
          reason: 'different_pub',
          messageId: envelope.messageId,
        },
        MAX_CONFLICTS,
      ),
    },
    envelope,
    'conflict',
    'concurrent_evenings_at_different_pubs',
  );
}

function applyAddDrink(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
  eveningId: string,
  drink: WearableDrinkSpec,
): WearableApplyResult {
  if (state.removedDrinkIds.includes(drink.id)) {
    return semanticResult(state, state, envelope, 'duplicate', 'drink_was_removed', false);
  }
  const existingDrink = findDrink(state, drink.id);
  if (existingDrink) {
    return semanticResult(
      state,
      state,
      envelope,
      drinkMatches(existingDrink.drink, drink) ? 'duplicate' : 'conflict',
      drinkMatches(existingDrink.drink, drink)
        ? 'drink_already_exists'
        : 'drink_id_payload_mismatch',
      false,
    );
  }

  const resolvedId = resolveEveningId(state, eveningId);
  const evening = state.evenings[resolvedId];
  if (!evening) return { state, status: 'deferred', reason: 'evening_not_received_yet' };

  const next = addDrinkToEvening(state, resolvedId, drink);
  if (evening.status !== 'closed') {
    return semanticResult(state, next, envelope, 'applied');
  }
  return semanticResult(
    state,
    {
      ...next,
      eveningConflicts: appendUnique(
        next.eveningConflicts,
        {
          activeEveningId: resolvedId,
          incomingEveningId: resolvedId,
          reason: 'late_add_after_close',
          messageId: envelope.messageId,
        },
        MAX_CONFLICTS,
      ),
    },
    envelope,
    'conflict',
    'late_add_preserved_without_reopening',
  );
}

function applyRemoveDrink(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
  eveningId: string,
  drinkId: string,
): WearableApplyResult {
  const alreadyRemoved = state.removedDrinkIds.includes(drinkId);
  let changed = !alreadyRemoved;
  const resolvedEveningId = resolveEveningId(state, eveningId);
  const evenings: Record<string, WearableEveningState> = {};
  for (const [candidateEveningId, evening] of Object.entries(state.evenings)) {
    const drinks = evening.drinks.filter((drink) => drink.id !== drinkId);
    const removedHere = drinks.length !== evening.drinks.length;
    const belongsToCommand = candidateEveningId === resolvedEveningId;
    changed ||= removedHere || (belongsToCommand && !evening.removedDrinkIds.includes(drinkId));
    evenings[candidateEveningId] =
      removedHere || (belongsToCommand && !evening.removedDrinkIds.includes(drinkId))
        ? {
            ...evening,
            drinks,
            removedDrinkIds: evening.removedDrinkIds.includes(drinkId)
              ? evening.removedDrinkIds
              : [...evening.removedDrinkIds, drinkId],
          }
        : evening;
  }
  const next: WearableSyncState = {
    ...state,
    evenings,
    removedDrinkIds: alreadyRemoved ? state.removedDrinkIds : [...state.removedDrinkIds, drinkId],
  };
  return semanticResult(
    state,
    next,
    envelope,
    alreadyRemoved ? 'duplicate' : 'applied',
    alreadyRemoved ? 'drink_already_removed' : undefined,
    changed,
  );
}

function applyCloseEvening(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
  eveningId: string,
  closedAt: string,
): WearableApplyResult {
  const resolvedId = resolveEveningId(state, eveningId);
  const evening = state.evenings[resolvedId];
  if (!evening) return { state, status: 'deferred', reason: 'evening_not_received_yet' };
  if (evening.status === 'closed') {
    return semanticResult(state, state, envelope, 'duplicate', 'evening_already_closed', false);
  }
  return semanticResult(
    state,
    {
      ...state,
      evenings: {
        ...state.evenings,
        [resolvedId]: { ...evening, status: 'closed', closedAt },
      },
      activeEveningId: state.activeEveningId === resolvedId ? null : state.activeEveningId,
    },
    envelope,
    'applied',
  );
}

function applyResolveConflict(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
  activeEveningId: string,
): WearableApplyResult {
  const resolvedId = resolveEveningId(state, activeEveningId);
  const evening = state.evenings[resolvedId];
  if (!evening) return { state, status: 'deferred', reason: 'evening_not_received_yet' };
  if (evening.status === 'closed') {
    return semanticResult(state, state, envelope, 'rejected', 'closed_evening_cannot_be_active', false);
  }
  const conflictEveningIds = new Set([resolvedId]);
  let foundConnectedConflict = true;
  while (foundConnectedConflict) {
    foundConnectedConflict = false;
    for (const conflict of state.eveningConflicts) {
      const activeId = resolveEveningId(state, conflict.activeEveningId);
      const incomingId = resolveEveningId(state, conflict.incomingEveningId);
      if (
        !conflictEveningIds.has(activeId) &&
        !conflictEveningIds.has(incomingId)
      ) {
        continue;
      }
      const sizeBefore = conflictEveningIds.size;
      conflictEveningIds.add(activeId);
      conflictEveningIds.add(incomingId);
      foundConnectedConflict ||= conflictEveningIds.size !== sizeBefore;
    }
  }
  const displacedIds = new Set(
    [...conflictEveningIds].filter((eveningId) => eveningId !== resolvedId),
  );
  if (state.activeEveningId) {
    displacedIds.add(resolveEveningId(state, state.activeEveningId));
  }
  for (const candidate of Object.values(state.evenings)) {
    if (candidate.status === 'active') {
      displacedIds.add(resolveEveningId(state, candidate.eveningId));
    }
  }
  displacedIds.delete(resolvedId);
  const evenings = {
    ...state.evenings,
    [resolvedId]: { ...evening, status: 'active' as const, closedAt: undefined },
  };
  for (const displacedId of displacedIds) {
    const displaced = evenings[displacedId];
    if (displaced && displaced.status !== 'closed') {
      evenings[displacedId] = {
        ...displaced,
        status: 'closed',
        closedAt: displaced.closedAt ?? envelope.sentAt,
      };
    }
  }
  return semanticResult(
    state,
    {
      ...state,
      activeEveningId: resolvedId,
      evenings,
      eveningConflicts: state.eveningConflicts.filter(
        (conflict) => {
          const activeId = resolveEveningId(state, conflict.activeEveningId);
          const incomingId = resolveEveningId(state, conflict.incomingEveningId);
          return (
            !conflictEveningIds.has(activeId) &&
            !conflictEveningIds.has(incomingId)
          );
        },
      ),
    },
    envelope,
    'applied',
  );
}

export function applyWearableCommand(
  state: WearableSyncState,
  envelope: WearableCommandEnvelope,
): WearableApplyResult {
  if (state.accountEpoch !== envelope.accountEpoch) {
    return { state, status: 'rejected', reason: 'account_epoch_mismatch' };
  }
  if (state.processedMessageIds.includes(envelope.messageId)) {
    return { state, status: 'duplicate', reason: 'message_already_processed' };
  }

  const lastSequence = state.actorSequences[envelope.actorId] ?? 0;
  if (envelope.actorSequence > lastSequence + 1) {
    return { state, status: 'deferred', reason: 'actor_sequence_gap' };
  }
  if (envelope.actorSequence <= lastSequence) {
    return { state, status: 'rejected', reason: 'stale_actor_sequence' };
  }

  const command = envelope.payload.command;
  switch (command.type) {
    case 'set_target':
      return applySetTarget(state, envelope, command.target);
    case 'clear_target':
      return applyClearTarget(state, envelope);
    case 'start_evening_and_add_drink':
      return applyStartEvening(state, envelope, command);
    case 'add_drink':
      return applyAddDrink(state, envelope, command.eveningId, command.drink);
    case 'remove_drink':
      return applyRemoveDrink(state, envelope, command.eveningId, command.drinkId);
    case 'close_evening':
      return applyCloseEvening(state, envelope, command.eveningId, command.closedAt);
    case 'resolve_evening_conflict':
      return applyResolveConflict(state, envelope, command.activeEveningId);
  }
}
