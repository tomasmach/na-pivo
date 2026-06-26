import {
  PUB_REMINDER_COOLDOWN_MS,
  PUB_REMINDER_RECHECK_AFTER_MS,
  decidePubReminder,
  isPubReminderEveningWindow,
  type PubReminderState,
} from '../pubReminderDecision';

const PUB = {
  id: 'pub-1',
  name: 'U Tygra',
  distanceMeters: 42,
};

describe('decidePubReminder', () => {
  it('stores a first nearby pub candidate and switches to recheck mode', () => {
    const decision = decidePubReminder({
      nowMs: 1_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      nearestPub: PUB,
      previousState: {},
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.mode).toBe('recheck');
    expect(decision.nextState.candidate).toEqual({
      pubId: PUB.id,
      pubName: PUB.name,
      seenAtMs: 1_000,
    });
  });

  it('notifies after the same nearby pub is confirmed on a later sample', () => {
    const previousState: PubReminderState = {
      candidate: {
        pubId: PUB.id,
        pubName: PUB.name,
        seenAtMs: 1_000,
      },
    };

    const decision = decidePubReminder({
      nowMs: 1_000 + PUB_REMINDER_RECHECK_AFTER_MS,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      nearestPub: PUB,
      previousState,
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.mode).toBe('hourly');
    expect(decision.notificationPub).toEqual({ id: PUB.id, name: PUB.name });
    expect(decision.nextState.candidate).toBeUndefined();
    expect(decision.nextState.lastNotificationPubId).toBe(PUB.id);
  });

  it('does not notify when the counter already has an active session', () => {
    const decision = decidePubReminder({
      nowMs: 1_000 + PUB_REMINDER_RECHECK_AFTER_MS,
      isEveningWindow: true,
      hasActiveCounterSession: true,
      nearestPub: PUB,
      previousState: {
        candidate: {
          pubId: PUB.id,
          pubName: PUB.name,
          seenAtMs: 1_000,
        },
      },
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.mode).toBe('hourly');
    expect(decision.nextState.candidate).toBeUndefined();
  });

  it('respects a per-pub cooldown after a notification', () => {
    const previousState: PubReminderState = {
      candidate: {
        pubId: PUB.id,
        pubName: PUB.name,
        seenAtMs: 1_000,
      },
      lastNotificationAtMs: 1_500,
      lastNotificationPubId: PUB.id,
    };

    const decision = decidePubReminder({
      nowMs: 1_500 + PUB_REMINDER_COOLDOWN_MS - 1,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      nearestPub: PUB,
      previousState,
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.mode).toBe('recheck');
  });
});

describe('isPubReminderEveningWindow', () => {
  it('runs from 18:00 until the end of the day', () => {
    expect(isPubReminderEveningWindow(new Date(2026, 5, 26, 17, 59))).toBe(false);
    expect(isPubReminderEveningWindow(new Date(2026, 5, 26, 18, 0))).toBe(true);
    expect(isPubReminderEveningWindow(new Date(2026, 5, 26, 23, 59))).toBe(true);
    expect(isPubReminderEveningWindow(new Date(2026, 5, 27, 0, 0))).toBe(false);
  });
});
