import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as ExpoNotifications from 'expo-notifications';

const STORAGE_KEY = 'na-pivo-handled-notification-responses-v1';
const STORAGE_VERSION = 1;
const MAX_ENTRIES = 128;
const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

interface HandledResponseEntry {
  id: string;
  handledAt: number;
}

interface HandledResponseLedger {
  version: typeof STORAGE_VERSION;
  entries: HandledResponseEntry[];
}

export type NotificationResponseClaim = 'claimed' | 'handled' | 'unavailable';

export interface NotificationResponseEvent {
  isCurrent(): boolean;
  release(): void;
}

type NotificationResponse = ExpoNotifications.NotificationResponse;
interface NotificationResponseApi {
  getLastNotificationResponseAsync(): Promise<NotificationResponse | null>;
  clearLastNotificationResponseAsync(): Promise<void>;
}

let ledgerQueue: Promise<void> = Promise.resolve();
let nativeClearQueue: Promise<void> = Promise.resolve();
let responseEventSequence = 0;
const activeResponseEvents = new Map<string, number>();

function serialize<T>(
  current: Promise<void>,
  replace: (next: Promise<void>) => void,
  operation: () => Promise<T>,
): Promise<T> {
  const result = current.then(operation, operation);
  replace(result.then(() => undefined, () => undefined));
  return result;
}

function parseLedger(raw: string | null, now: number): HandledResponseEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<HandledResponseLedger>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter((entry): entry is HandledResponseEntry =>
        !!entry &&
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        typeof entry.handledAt === 'number' &&
        Number.isFinite(entry.handledAt) &&
        entry.handledAt - now <= MAX_CLOCK_SKEW_MS &&
        now - entry.handledAt <= ENTRY_TTL_MS,
      )
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Record notification arrival synchronously, before any durable await. Newer
 * response events invalidate older ones, while a concurrent duplicate of the
 * same native response stays with its first handler.
 */
export function beginNotificationResponseEvent(
  response: NotificationResponse,
): NotificationResponseEvent | null {
  const id = response.notification.request.identifier;
  if (!id || activeResponseEvents.has(id)) return null;
  responseEventSequence += 1;
  const sequence = responseEventSequence;
  activeResponseEvents.set(id, sequence);
  let released = false;
  return {
    isCurrent: () => !released && responseEventSequence === sequence,
    release: () => {
      if (released) return;
      released = true;
      if (activeResponseEvents.get(id) === sequence) activeResponseEvents.delete(id);
    },
  };
}

/** Persist the response identity before navigation so a restart cannot replay it. */
export function claimHandledNotificationResponse(
  response: NotificationResponse,
): Promise<NotificationResponseClaim> {
  const id = response.notification.request.identifier;
  if (!id) return Promise.resolve('unavailable');
  return serialize(
    ledgerQueue,
    (next) => { ledgerQueue = next; },
    async () => {
      try {
        const now = Date.now();
        const entries = parseLedger(await AsyncStorage.getItem(STORAGE_KEY), now);
        if (entries.some((entry) => entry.id === id)) return 'handled';
        const next: HandledResponseLedger = {
          version: STORAGE_VERSION,
          entries: [...entries, { id, handledAt: now }].slice(-MAX_ENTRIES),
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return 'claimed';
      } catch {
        return 'unavailable';
      }
    },
  );
}

/**
 * Expo clears the current native response without accepting an identifier.
 * Serialize every caller and re-read inside that chain immediately before the
 * clear, so an older A cannot erase a B installed by another handler.
 */
export function clearNotificationResponseIfStillLast(
  notifications: NotificationResponseApi,
  response: NotificationResponse,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const expectedId = response.notification.request.identifier;
  return serialize(
    nativeClearQueue,
    (next) => { nativeClearQueue = next; },
    async () => {
      if (!isCurrent()) return false;
      try {
        const current = await notifications.getLastNotificationResponseAsync();
        if (!isCurrent()) return false;
        if (current?.notification.request.identifier !== expectedId) return false;
        await notifications.clearLastNotificationResponseAsync();
        return isCurrent();
      } catch {
        return false;
      }
    },
  );
}

/** Reset process mutexes only; the durable ledger intentionally survives restart. */
export function resetNotificationResponseRuntimeForTests(): void {
  ledgerQueue = Promise.resolve();
  nativeClearQueue = Promise.resolve();
  responseEventSequence = 0;
  activeResponseEvents.clear();
}
