export const PUB_REMINDER_NEAR_RADIUS_M = 90;
export const PUB_REMINDER_RECHECK_AFTER_MS = 10 * 60 * 1000;
export const PUB_REMINDER_RECHECK_STALE_MS = 45 * 60 * 1000;
export const PUB_REMINDER_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export type PubReminderMode = 'hourly' | 'recheck';

export interface PubReminderCandidate {
  pubId: string;
  pubName: string;
  seenAtMs: number;
}

export interface PubReminderState {
  candidate?: PubReminderCandidate;
  lastNotificationAtMs?: number;
  lastNotificationPubId?: string;
}

export interface PubReminderNearestPub {
  id: string;
  name: string;
  distanceMeters: number;
}

export interface PubReminderDecisionInput {
  nowMs: number;
  isEveningWindow: boolean;
  hasActiveCounterSession: boolean;
  nearestPub: PubReminderNearestPub | null;
  previousState: PubReminderState;
}

export interface PubReminderDecision {
  nextState: PubReminderState;
  mode: PubReminderMode;
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

export function decidePubReminder(input: PubReminderDecisionInput): PubReminderDecision {
  const { nowMs, isEveningWindow, hasActiveCounterSession, nearestPub, previousState } = input;
  const baseState: PubReminderState = {
    lastNotificationAtMs: previousState.lastNotificationAtMs,
    lastNotificationPubId: previousState.lastNotificationPubId,
  };

  if (!isEveningWindow || hasActiveCounterSession || !nearestPub) {
    return { nextState: baseState, mode: 'hourly', shouldNotify: false };
  }

  if (nearestPub.distanceMeters > PUB_REMINDER_NEAR_RADIUS_M) {
    return { nextState: baseState, mode: 'hourly', shouldNotify: false };
  }

  const candidate = previousState.candidate;
  const isSameCandidate = candidate?.pubId === nearestPub.id;
  const candidateAgeMs = isSameCandidate ? nowMs - candidate.seenAtMs : 0;
  const candidateIsFresh =
    isSameCandidate &&
    candidateAgeMs >= PUB_REMINDER_RECHECK_AFTER_MS &&
    candidateAgeMs <= PUB_REMINDER_RECHECK_STALE_MS;

  if (candidateIsFresh && !recentlyNotified(previousState, nearestPub.id, nowMs)) {
    return {
      nextState: {
        lastNotificationAtMs: nowMs,
        lastNotificationPubId: nearestPub.id,
      },
      mode: 'hourly',
      shouldNotify: true,
      notificationPub: {
        id: nearestPub.id,
        name: nearestPub.name,
      },
    };
  }

  if (isSameCandidate && candidateAgeMs < PUB_REMINDER_RECHECK_STALE_MS) {
    return {
      nextState: {
        ...baseState,
        candidate,
      },
      mode: 'recheck',
      shouldNotify: false,
    };
  }

  return {
    nextState: {
      ...baseState,
      candidate: {
        pubId: nearestPub.id,
        pubName: nearestPub.name,
        seenAtMs: nowMs,
      },
    },
    mode: 'recheck',
    shouldNotify: false,
  };
}

export function isPubReminderEveningWindow(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 18;
}
