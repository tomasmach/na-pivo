import AsyncStorage from '@react-native-async-storage/async-storage';

export const PUB_REMINDER_ONBOARDING_SEEN_VERSION_KEY = 'na-pivo-pub-reminder-onboarding-seen-version';

interface ShouldShowPubReminderOnboardingInput {
  currentVersion: string | null;
  seenVersion: string | null;
  pubReminderEnabled: boolean;
}

export function shouldShowPubReminderOnboarding({
  currentVersion,
  seenVersion,
  pubReminderEnabled,
}: ShouldShowPubReminderOnboardingInput): boolean {
  if (pubReminderEnabled) return false;
  if (!currentVersion) return false;
  return seenVersion !== currentVersion;
}

export async function getSeenPubReminderOnboardingVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUB_REMINDER_ONBOARDING_SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

export async function markPubReminderOnboardingSeen(version: string | null): Promise<void> {
  if (!version) return;
  try {
    await AsyncStorage.setItem(PUB_REMINDER_ONBOARDING_SEEN_VERSION_KEY, version);
  } catch {
    // Best effort only. A failed write may show the explainer again next launch.
  }
}
