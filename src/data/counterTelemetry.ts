/**
 * Privacy-safe counter product telemetry.
 *
 * This module only records coarse usage signals. It never sends pub names,
 * beer names, coordinates, prices, account ids, or drink client ids.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { trackClientEvent } from './telemetryClient';

const STORAGE_KEY = 'na-pivo-counter-telemetry';

interface CounterTelemetryState {
  lastOpenedAt?: string;
}

function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function wholeDaysBetween(from: Date, to: Date): number {
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.max(0, Math.round((toDay - fromDay) / 86_400_000));
}

async function loadState(): Promise<CounterTelemetryState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const state = parsed as CounterTelemetryState;
    return typeof state.lastOpenedAt === 'string' ? { lastOpenedAt: state.lastOpenedAt } : {};
  } catch {
    return {};
  }
}

async function saveState(state: CounterTelemetryState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Telemetry state is best-effort only.
  }
}

export async function trackCounterTabOpened(hadActiveSession: boolean): Promise<void> {
  const now = new Date();
  const state = await loadState();
  const previousOpenedAt = state.lastOpenedAt ? new Date(state.lastOpenedAt) : null;

  void trackClientEvent({
    event: 'counter_tab_opened',
    context: { had_active_session: hadActiveSession },
  });

  if (previousOpenedAt && Number.isFinite(previousOpenedAt.getTime())) {
    const sameDay = localDayKey(previousOpenedAt) === localDayKey(now);
    void trackClientEvent({
      event: sameDay ? 'counter_returned_same_day' : 'counter_returned_later',
      context: sameDay ? undefined : { return_days: wholeDaysBetween(previousOpenedAt, now) },
    });
  }

  await saveState({ lastOpenedAt: now.toISOString() });
}

export async function clearCounterTelemetry(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export const resetCounterTelemetryForTests = clearCounterTelemetry;

/**
 * Where a logged drink was tapped.
 *
 * Closed enum, exactly like the UI interaction targets: the value is chosen by
 * the call site and must never be derived from a beer name, a pub, a route
 * param or anything the user typed. It answers one question — which door people
 * actually use to log a beer — and nothing about what they drank or where.
 */
export const DRINK_ADDED_SOURCES = [
  /** The one big button on the evening. */
  'hub',
  /** +1 in the strip riding above the tab bar. */
  'mini_bar',
  /** +1 while a game is on screen. */
  'game',
  /** "Zopakovat" from a row in the thread. */
  'repeat',
  /** Picked out of the drink sheet's list. */
  'picker',
  /** Submitted through the drink form. */
  'form',
  /** Submitted through the form after a menu scan proposed it. */
  'scan',
  /** Counted on the Live Activity / lock screen. */
  'live_activity',
  /** Added into an evening from its detail. */
  'evening_detail',
] as const;

export type DrinkAddedSource = (typeof DRINK_ADDED_SOURCES)[number];

export function trackDrinkAdded(
  source: DrinkAddedSource,
  context: {
    hadActiveSession: boolean;
    backdated?: boolean;
    /** Closed enum from `@/drinks/drinkTypes`, never free text. */
    drinkType?: string;
    /** Closed enum from `@/drinks/drinkTypes`, never a pub name. */
    placeContext?: string | null;
  },
): void {
  void trackClientEvent({
    event: 'drink_added',
    context: {
      source,
      had_active_session: context.hadActiveSession,
      ...(context.backdated ? { backdated: true } : {}),
      ...(context.drinkType && context.drinkType !== 'beer'
        ? { drink_type: context.drinkType }
        : {}),
      ...(context.placeContext ? { place_context: context.placeContext } : {}),
    },
  });
}
