import {
  PUB_REMINDER_COOLDOWN_MS,
  decidePubReminderOnEnter,
  isPubReminderEveningWindow,
  type PubReminderState,
} from '../pubReminderDecision';

const PUB = { id: 'pub-1', name: 'U Tygra' };
const OTHER_PUB = { id: 'pub-2', name: 'U Vejvodů' };

describe('decidePubReminderOnEnter', () => {
  it('notifies when entering a pub in the evening with no cooldown', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: 1_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: PUB,
      previousState: {},
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.notificationPub).toEqual(PUB);
    expect(decision.nextState).toEqual({
      lastNotificationAtMs: 1_000,
      lastNotificationPubId: PUB.id,
    });
  });

  it('does not notify outside the evening window', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: 1_000,
      isEveningWindow: false,
      hasActiveCounterSession: false,
      pub: PUB,
      previousState: {},
    });

    expect(decision.shouldNotify).toBe(false);
  });

  it('does not notify when the counter already has an active session', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: 1_000,
      isEveningWindow: true,
      hasActiveCounterSession: true,
      pub: PUB,
      previousState: {},
    });

    expect(decision.shouldNotify).toBe(false);
  });

  it('does not notify when the entered pub is unknown', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: 1_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: null,
      previousState: {},
    });

    expect(decision.shouldNotify).toBe(false);
  });

  it('respects a per-pub cooldown after a notification', () => {
    const previousState: PubReminderState = {
      lastNotificationAtMs: 1_500,
      lastNotificationPubId: PUB.id,
    };

    const decision = decidePubReminderOnEnter({
      nowMs: 1_500 + PUB_REMINDER_COOLDOWN_MS - 1,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: PUB,
      previousState,
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.nextState).toEqual(previousState);
  });

  it('notifies a different pub even while the first pub is still cooling down', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: 1_500 + 1_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: OTHER_PUB,
      previousState: { lastNotificationAtMs: 1_500, lastNotificationPubId: PUB.id },
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.notificationPub).toEqual(OTHER_PUB);
  });

  it('notifies the same pub again once the cooldown has elapsed', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: 1_500 + PUB_REMINDER_COOLDOWN_MS,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: PUB,
      previousState: { lastNotificationAtMs: 1_500, lastNotificationPubId: PUB.id },
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.notificationPub).toEqual(PUB);
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
