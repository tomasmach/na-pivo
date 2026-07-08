import {
  PUB_REMINDER_DWELL_MS,
  PUB_REMINDER_GLOBAL_COOLDOWN_MS,
  clearPendingPubReminder,
  decidePubReminderOnEnter,
  isPubReminderEveningWindow,
  normalizePubReminderState,
  type PubReminderState,
} from '../pubReminderDecision';

const PUB = { id: 'pub-1', name: 'U Tygra' };
const OTHER_PUB = { id: 'pub-2', name: 'U Vejvodů' };
const EVENING_MS = new Date(2026, 5, 26, 19, 0).getTime();

describe('decidePubReminderOnEnter', () => {
  it('schedules a dwell-gated reminder when entering a pub in the evening', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: EVENING_MS,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: PUB,
      previousState: {},
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.notificationPub).toEqual(PUB);
    expect(decision.nextState).toEqual({
      lastReminderFireAtMs: undefined,
      lastReminderDayKey: undefined,
      pendingReminder: {
        pubId: PUB.id,
        pubName: PUB.name,
        enteredAtMs: EVENING_MS,
        scheduledAtMs: EVENING_MS,
        fireAtMs: EVENING_MS + PUB_REMINDER_DWELL_MS,
      },
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

  it('respects a global cooldown after a fired reminder', () => {
    const previousState: PubReminderState = {
      lastReminderFireAtMs: EVENING_MS,
      lastReminderDayKey: '2026-06-26',
    };

    const decision = decidePubReminderOnEnter({
      nowMs: EVENING_MS + PUB_REMINDER_GLOBAL_COOLDOWN_MS - 1,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: OTHER_PUB,
      previousState,
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.nextState).toEqual(previousState);
  });

  it('schedules again after the global cooldown on a later day', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: new Date(2026, 5, 27, 19, 0).getTime(),
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: OTHER_PUB,
      previousState: {
        lastReminderFireAtMs: EVENING_MS,
        lastReminderDayKey: '2026-06-26',
      },
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.notificationPub).toEqual(OTHER_PUB);
  });

  it('caps reminders to one fired reminder per local calendar day', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: new Date(2026, 5, 26, 23, 0).getTime(),
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: OTHER_PUB,
      previousState: {
        lastReminderFireAtMs: new Date(2026, 5, 26, 18, 0).getTime(),
        lastReminderDayKey: '2026-06-26',
      },
    });

    expect(decision.shouldNotify).toBe(false);
  });

  it('does not reset the dwell timer for repeated enters into the same pending pub', () => {
    const previousState: PubReminderState = {
      pendingReminder: {
        pubId: PUB.id,
        pubName: PUB.name,
        enteredAtMs: EVENING_MS,
        scheduledAtMs: EVENING_MS,
        fireAtMs: EVENING_MS + PUB_REMINDER_DWELL_MS,
        notificationId: 'pending-1',
      },
    };

    const decision = decidePubReminderOnEnter({
      nowMs: EVENING_MS + 60_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: PUB,
      previousState,
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.nextState).toEqual(previousState);
  });

  it('replaces a different pending pub when the new pub passes the rules', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: EVENING_MS + 60_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: OTHER_PUB,
      previousState: {
        pendingReminder: {
          pubId: PUB.id,
          pubName: PUB.name,
          enteredAtMs: EVENING_MS,
          scheduledAtMs: EVENING_MS,
          fireAtMs: EVENING_MS + PUB_REMINDER_DWELL_MS,
          notificationId: 'pending-1',
        },
      },
    });

    expect(decision.shouldNotify).toBe(true);
    expect(decision.cancelPendingNotificationId).toBe('pending-1');
    expect(decision.nextState.pendingReminder).toEqual({
      pubId: OTHER_PUB.id,
      pubName: OTHER_PUB.name,
      enteredAtMs: EVENING_MS + 60_000,
      scheduledAtMs: EVENING_MS + 60_000,
      fireAtMs: EVENING_MS + 60_000 + PUB_REMINDER_DWELL_MS,
    });
  });

  it('treats an elapsed pending reminder as fired for later decisions', () => {
    const state = normalizePubReminderState(
      {
        pendingReminder: {
          pubId: PUB.id,
          pubName: PUB.name,
          enteredAtMs: EVENING_MS,
          scheduledAtMs: EVENING_MS,
          fireAtMs: EVENING_MS + PUB_REMINDER_DWELL_MS,
          notificationId: 'pending-1',
        },
      },
      EVENING_MS + PUB_REMINDER_DWELL_MS + 1,
    );

    expect(state).toEqual({
      lastReminderFireAtMs: EVENING_MS + PUB_REMINDER_DWELL_MS,
      lastReminderDayKey: '2026-06-26',
    });
  });

  it('clears a pending reminder before it fires without starting cooldown', () => {
    const state = clearPendingPubReminder(
      {
        pendingReminder: {
          pubId: PUB.id,
          pubName: PUB.name,
          enteredAtMs: EVENING_MS,
          scheduledAtMs: EVENING_MS,
          fireAtMs: EVENING_MS + PUB_REMINDER_DWELL_MS,
          notificationId: 'pending-1',
        },
      },
      EVENING_MS + 60_000,
    );

    expect(state).toEqual({});
  });

  it('migrates old lastNotificationAtMs into the global cooldown', () => {
    const decision = decidePubReminderOnEnter({
      nowMs: EVENING_MS + 60_000,
      isEveningWindow: true,
      hasActiveCounterSession: false,
      pub: OTHER_PUB,
      previousState: { lastNotificationAtMs: EVENING_MS, lastNotificationPubId: PUB.id },
    });

    expect(decision.shouldNotify).toBe(false);
    expect(decision.nextState).toEqual({
      lastReminderFireAtMs: EVENING_MS,
      lastReminderDayKey: '2026-06-26',
    });
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
