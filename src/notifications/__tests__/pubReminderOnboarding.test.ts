import { shouldShowPubReminderOnboarding } from '../pubReminderOnboarding';

describe('shouldShowPubReminderOnboarding', () => {
  it('shows once for the current version when reminders are off', () => {
    expect(
      shouldShowPubReminderOnboarding({
        currentVersion: '1.2.0',
        seenVersion: null,
        pubReminderEnabled: false,
      }),
    ).toBe(true);
  });

  it('does not show again after the current version was seen', () => {
    expect(
      shouldShowPubReminderOnboarding({
        currentVersion: '1.2.0',
        seenVersion: '1.2.0',
        pubReminderEnabled: false,
      }),
    ).toBe(false);
  });

  it('can show again after an app update', () => {
    expect(
      shouldShowPubReminderOnboarding({
        currentVersion: '1.3.0',
        seenVersion: '1.2.0',
        pubReminderEnabled: false,
      }),
    ).toBe(true);
  });

  it('stays hidden when reminders are already enabled', () => {
    expect(
      shouldShowPubReminderOnboarding({
        currentVersion: '1.3.0',
        seenVersion: '1.2.0',
        pubReminderEnabled: true,
      }),
    ).toBe(false);
  });

  it('stays hidden when the app version is unavailable', () => {
    expect(
      shouldShowPubReminderOnboarding({
        currentVersion: null,
        seenVersion: null,
        pubReminderEnabled: false,
      }),
    ).toBe(false);
  });
});
