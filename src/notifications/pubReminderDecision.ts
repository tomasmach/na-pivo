export const PUB_REMINDER_GLOBAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const PUB_REMINDER_DWELL_MS = 45 * 60 * 1000;

export interface PendingPubReminder {
  pubId: string;
  pubName: string;
  enteredAtMs: number;
  scheduledAtMs: number;
  fireAtMs: number;
  notificationId?: string;
}

/**
 * Persisted, cross-launch reminder bookkeeping. Older builds stored
 * lastNotification* only; keep those fields optional so migrated state never
 * crashes and can still seed the new global cooldown.
 */
export interface PubReminderState {
  lastReminderFireAtMs?: number;
  lastReminderDayKey?: string;
  pendingReminder?: PendingPubReminder;
  /** Deprecated: pre-dwell state from older builds. */
  lastNotificationAtMs?: number;
  /** Deprecated: pre-dwell state from older builds. */
  lastNotificationPubId?: string;
}

export interface PubReminderEnterInput {
  nowMs: number;
  isEveningWindow: boolean;
  hasActiveCounterSession: boolean;
  /** The pub whose geofence the device just entered, or null when unknown. */
  pub: { id: string; name: string } | null;
  previousState: PubReminderState;
}

export interface PubReminderDecision {
  nextState: PubReminderState;
  /** True means schedule a delayed local notification, not fire immediately. */
  shouldNotify: boolean;
  notificationPub?: {
    id: string;
    name: string;
  };
  cancelPendingNotificationId?: string;
}

function localDayKey(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function lastReminderFireAtMs(state: PubReminderState): number | undefined {
  if (validNumber(state.lastReminderFireAtMs)) return state.lastReminderFireAtMs;
  if (validNumber(state.lastNotificationAtMs)) return state.lastNotificationAtMs;
  return undefined;
}

function pendingReminder(state: PubReminderState): PendingPubReminder | undefined {
  const pending = state.pendingReminder;
  if (!pending || typeof pending.pubId !== 'string' || typeof pending.pubName !== 'string') {
    return undefined;
  }
  if (
    !validNumber(pending.enteredAtMs) ||
    !validNumber(pending.scheduledAtMs) ||
    !validNumber(pending.fireAtMs)
  ) {
    return undefined;
  }
  return {
    pubId: pending.pubId,
    pubName: pending.pubName,
    enteredAtMs: pending.enteredAtMs,
    scheduledAtMs: pending.scheduledAtMs,
    fireAtMs: pending.fireAtMs,
    notificationId: typeof pending.notificationId === 'string' ? pending.notificationId : undefined,
  };
}

export function normalizePubReminderState(state: PubReminderState, nowMs: number): PubReminderState {
  const lastFireAtMs = lastReminderFireAtMs(state);
  const pending = pendingReminder(state);
  const firedPending =
    pending && validNumber(pending.fireAtMs) && pending.fireAtMs <= nowMs ? pending : undefined;
  const reminderFireAtMs =
    firedPending && (!lastFireAtMs || firedPending.fireAtMs > lastFireAtMs)
      ? firedPending.fireAtMs
      : lastFireAtMs;

  const normalized: PubReminderState = {};
  if (reminderFireAtMs) {
    normalized.lastReminderFireAtMs = reminderFireAtMs;
    normalized.lastReminderDayKey = state.lastReminderDayKey ?? localDayKey(reminderFireAtMs);
    if (firedPending) {
      normalized.lastReminderDayKey = localDayKey(reminderFireAtMs);
    }
  }
  if (pending && !firedPending) {
    normalized.pendingReminder = pending;
  }
  return normalized;
}

export function clearPendingPubReminder(state: PubReminderState, nowMs: number): PubReminderState {
  const normalized = normalizePubReminderState(state, nowMs);
  if (!normalized.pendingReminder) return normalized;
  const { pendingReminder: _pendingReminder, ...withoutPending } = normalized;
  return withoutPending;
}

function recentlyNotifiedGlobally(state: PubReminderState, nowMs: number): boolean {
  if (!state.lastReminderFireAtMs) return false;
  return nowMs - state.lastReminderFireAtMs < PUB_REMINDER_GLOBAL_COOLDOWN_MS;
}

function alreadyNotifiedToday(state: PubReminderState, nowMs: number): boolean {
  const lastDayKey =
    state.lastReminderDayKey ??
    (state.lastReminderFireAtMs ? localDayKey(state.lastReminderFireAtMs) : undefined);
  return Boolean(lastDayKey && lastDayKey === localDayKey(nowMs));
}

/**
 * Pure decision for a geofence "Enter" event: should we schedule a delayed
 * nudge that the user is sitting in a pub? The delay is the dwell gate; a later
 * Exit can cancel the notification before it fires.
 */
export function decidePubReminderOnEnter(input: PubReminderEnterInput): PubReminderDecision {
  const { nowMs, isEveningWindow, hasActiveCounterSession, pub, previousState } = input;
  const baseState = normalizePubReminderState(previousState, nowMs);

  if (!isEveningWindow || hasActiveCounterSession || !pub) {
    return { nextState: baseState, shouldNotify: false };
  }

  if (baseState.pendingReminder?.pubId === pub.id) {
    return { nextState: baseState, shouldNotify: false };
  }

  if (recentlyNotifiedGlobally(baseState, nowMs) || alreadyNotifiedToday(baseState, nowMs)) {
    return { nextState: baseState, shouldNotify: false };
  }

  const pending: PendingPubReminder = {
    pubId: pub.id,
    pubName: pub.name,
    enteredAtMs: nowMs,
    scheduledAtMs: nowMs,
    fireAtMs: nowMs + PUB_REMINDER_DWELL_MS,
  };

  return {
    nextState: {
      lastReminderFireAtMs: baseState.lastReminderFireAtMs,
      lastReminderDayKey: baseState.lastReminderDayKey,
      pendingReminder: pending,
    },
    shouldNotify: true,
    notificationPub: {
      id: pub.id,
      name: pub.name,
    },
    cancelPendingNotificationId: baseState.pendingReminder?.notificationId,
  };
}

export function isPubReminderEveningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 18;
}
