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

export async function resetCounterTelemetryForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
