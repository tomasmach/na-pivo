export const PUB_REMINDER_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/**
 * Persisted, cross-launch reminder bookkeeping. With geofencing the OS already
 * debounces arrivals, so the only state we keep is the per-pub cooldown so a
 * place can't nudge the user twice in one evening.
 */
export interface PubReminderState {
  lastNotificationAtMs?: number;
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
  shouldNotify: boolean;
  notificationPub?: {
    id: string;
    name: string;
  };
}

function recentlyNotified(
  state: PubReminderState,
  pubId: string,
  nowMs: number,
): boolean {
  if (state.lastNotificationPubId !== pubId || !state.lastNotificationAtMs) return false;
  return nowMs - state.lastNotificationAtMs < PUB_REMINDER_COOLDOWN_MS;
}

/**
 * Pure decision for a geofence "Enter" event: should we nudge the user that
 * they're sitting in a pub? A reminder fires only in the evening window, when no
 * counter session is already running, and when this exact pub hasn't already
 * nudged within the cooldown. The arrival itself is trusted — the OS only
 * delivers Enter after the device actually crosses into the region.
 */
export function decidePubReminderOnEnter(input: PubReminderEnterInput): PubReminderDecision {
  const { nowMs, isEveningWindow, hasActiveCounterSession, pub, previousState } = input;
  const baseState: PubReminderState = {
    lastNotificationAtMs: previousState.lastNotificationAtMs,
    lastNotificationPubId: previousState.lastNotificationPubId,
  };

  if (!isEveningWindow || hasActiveCounterSession || !pub) {
    return { nextState: baseState, shouldNotify: false };
  }

  if (recentlyNotified(previousState, pub.id, nowMs)) {
    return { nextState: baseState, shouldNotify: false };
  }

  return {
    nextState: {
      lastNotificationAtMs: nowMs,
      lastNotificationPubId: pub.id,
    },
    shouldNotify: true,
    notificationPub: {
      id: pub.id,
      name: pub.name,
    },
  };
}

export function isPubReminderEveningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 18;
}
