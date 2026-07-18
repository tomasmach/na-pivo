import type { TallySession } from '@/stores/tallyStore';

export const REVIEW_PROMPT_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000;
export const REVIEW_PROMPT_MIN_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEW_PROMPT_RECENT_ACTIVITY_MS = 8 * 60 * 60 * 1000;
export const REVIEW_PROMPT_MIN_EVENINGS = 3;

const REVIEW_PROMPT_START_HOUR = 9;
const REVIEW_PROMPT_END_HOUR = 18;

export interface ReviewPromptStamp {
  attemptedAt: string;
  appVersion: string;
}

interface ReviewPromptEligibilityInput {
  appVersion: string | null;
  current: TallySession | null;
  history: TallySession[];
  lastAttempt: ReviewPromptStamp | null;
  now: Date;
  pathname: string;
}

const CALM_ROUTES = new Set(['/', '/beer', '/friends', '/profile']);

function lastDrinkMs(session: TallySession): number {
  const timestamps = session.drinks
    .map((drink) => Date.parse(drink.at))
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : Date.parse(session.startedAt);
}

/**
 * Keeps the store-controlled review card out of onboarding, active evenings and
 * late-night use. The native APIs apply their own private quotas on top of this.
 */
export function shouldRequestAppReview({
  appVersion,
  current,
  history,
  lastAttempt,
  now,
  pathname,
}: ReviewPromptEligibilityInput): boolean {
  if (!appVersion || !CALM_ROUTES.has(pathname)) return false;
  if (current && current.drinks.length > 0) return false;

  const hour = now.getHours();
  if (hour < REVIEW_PROMPT_START_HOUR || hour >= REVIEW_PROMPT_END_HOUR) return false;

  const completed = history.filter((session) => session.drinks.length > 0);
  if (completed.length < REVIEW_PROMPT_MIN_EVENINGS) return false;

  const activityTimes = completed.map(lastDrinkMs).filter(Number.isFinite);
  if (activityTimes.length < REVIEW_PROMPT_MIN_EVENINGS) return false;

  const nowMs = now.getTime();
  if (nowMs - Math.min(...activityTimes) < REVIEW_PROMPT_MIN_HISTORY_MS) return false;
  if (nowMs - Math.max(...activityTimes) < REVIEW_PROMPT_RECENT_ACTIVITY_MS) return false;

  if (lastAttempt) {
    if (lastAttempt.appVersion === appVersion) return false;
    const attemptedAtMs = Date.parse(lastAttempt.attemptedAt);
    if (Number.isFinite(attemptedAtMs) && nowMs - attemptedAtMs < REVIEW_PROMPT_COOLDOWN_MS) {
      return false;
    }
  }

  return true;
}
