import type { TallySession } from '@/stores/tallyStore';
import {
  REVIEW_PROMPT_COOLDOWN_MS,
  shouldRequestAppReview,
} from '../appReviewPolicy';

const NOW = new Date('2026-07-18T12:00:00');

function session(id: string, daysAgo: number): TallySession {
  const at = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return {
    clientId: id,
    pubKey: `pub-${id}`,
    pubName: `Hospoda ${id}`,
    startedAt: at,
    archivedReason: 'timeout',
    drinks: [{ id: `drink-${id}`, beerName: 'Pivo', at }],
  };
}

const eligibleHistory = [session('one', 10), session('two', 5), session('three', 1)];

function evaluate(overrides: Partial<Parameters<typeof shouldRequestAppReview>[0]> = {}) {
  return shouldRequestAppReview({
    appVersion: '1.4.1',
    current: null,
    history: eligibleHistory,
    lastAttempt: null,
    now: NOW,
    pathname: '/',
    ...overrides,
  });
}

describe('shouldRequestAppReview', () => {
  it('allows a calm daytime return after three established evenings', () => {
    expect(evaluate()).toBe(true);
  });

  it('does not interrupt an active evening or recent drinking activity', () => {
    expect(evaluate({ current: session('active', 0) })).toBe(false);
    expect(evaluate({ history: [session('one', 10), session('two', 5), session('three', 0.1)] })).toBe(false);
  });

  it('waits for three evenings and at least a week of history', () => {
    expect(evaluate({ history: eligibleHistory.slice(0, 2) })).toBe(false);
    expect(evaluate({ history: [session('one', 6), session('two', 4), session('three', 1)] })).toBe(false);
  });

  it('only runs in daytime on calm root tabs', () => {
    expect(evaluate({ now: new Date('2026-07-18T22:00:00') })).toBe(false);
    expect(evaluate({ pathname: '/onboarding' })).toBe(false);
    expect(evaluate({ pathname: '/evening' })).toBe(false);
  });

  it('uses both a per-version limit and a 120-day cooldown', () => {
    expect(evaluate({
      lastAttempt: { attemptedAt: new Date(NOW.getTime() - REVIEW_PROMPT_COOLDOWN_MS - 1).toISOString(), appVersion: '1.4.1' },
    })).toBe(false);
    expect(evaluate({
      lastAttempt: { attemptedAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), appVersion: '1.4.0' },
    })).toBe(false);
    expect(evaluate({
      lastAttempt: { attemptedAt: new Date(NOW.getTime() - REVIEW_PROMPT_COOLDOWN_MS - 1).toISOString(), appVersion: '1.4.0' },
    })).toBe(true);
  });
});
