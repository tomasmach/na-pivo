import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';

import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import {
  getSeenPubReminderOnboardingVersion,
  shouldShowPubReminderOnboarding,
} from '@/notifications/pubReminderOnboarding';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';
import { shouldRequestAppReview, type ReviewPromptStamp } from './appReviewPolicy';

const REVIEW_PROMPT_STORAGE_KEY = 'na-pivo-app-review-prompt';

let requestInFlight = false;

function waitForTallyHydration(): Promise<void> {
  if (useTallyStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useTallyStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

function parseStamp(value: string | null): ReviewPromptStamp | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ReviewPromptStamp>;
    return typeof parsed.attemptedAt === 'string' && typeof parsed.appVersion === 'string'
      ? { attemptedAt: parsed.attemptedAt, appVersion: parsed.appVersion }
      : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort review request. Store policy decides whether the native card is
 * actually shown, so a successful call is treated as an attempt, not a rating.
 */
export async function requestAppReviewIfEligible(pathname: string): Promise<void> {
  if (requestInFlight) return;
  requestInFlight = true;

  try {
    await Promise.all([
      waitForTallyHydration(),
      waitForSettingsHydration(),
    ]);

    const release = useReleaseStore.getState();
    const onboarding = useOnboardingStore.getState();
    if (!release.checkSettled || release.pendingNote || onboarding.firstLaunchSession) return;

    const appVersion = getCurrentAppVersion();
    const seenReminderVersion = await getSeenPubReminderOnboardingVersion();
    if (
      shouldShowPubReminderOnboarding({
        currentVersion: appVersion,
        seenVersion: seenReminderVersion,
        pubReminderEnabled: useSettingsStore.getState().pubReminderEnabled,
      })
    ) {
      return;
    }

    let lastAttempt: ReviewPromptStamp | null = null;
    try {
      lastAttempt = parseStamp(await AsyncStorage.getItem(REVIEW_PROMPT_STORAGE_KEY));
    } catch {
      return;
    }

    const tally = useTallyStore.getState();
    const now = new Date();
    if (
      !shouldRequestAppReview({
        appVersion,
        current: tally.current,
        history: tally.history,
        lastAttempt,
        now,
        pathname,
      })
    ) {
      return;
    }

    if (!(await StoreReview.isAvailableAsync())) return;

    // Stamp before crossing into native code. The API intentionally doesn't say
    // whether a quota allowed the card, and repeated retries would become nagging.
    await AsyncStorage.setItem(
      REVIEW_PROMPT_STORAGE_KEY,
      JSON.stringify({ attemptedAt: now.toISOString(), appVersion }),
    );
    await StoreReview.requestReview();
  } catch {
    // Review prompts are optional. Storage/native failures must stay invisible.
  } finally {
    requestInFlight = false;
  }
}
