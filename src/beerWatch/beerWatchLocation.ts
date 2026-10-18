/**
 * The only location "Hlídat pivo" ever sends: the centre of a ~500 m grid cell
 * around the OS-cached fix, never the fix itself. It is sent when the cell
 * changes, when the server has none, or once a day so the server knows the
 * place is still current. It never prompts for permission.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { updateBeerWatchSettings } from '@/data/beerWatchClient';
import { useAccountStore } from '@/stores/accountStore';
import { useBeerWatchStore } from '@/stores/beerWatchStore';

// Must match the backend grid: lat 0.0045° ≈ 500 m, lng 0.007° ≈ 500 m in Czechia.
const LAT_STEP = 0.0045;
const LNG_STEP = 0.007;
const RESEND_AFTER_MS = 24 * 60 * 60 * 1000;
const BEER_WATCH_LOCATION_KEY = 'na-pivo-beer-watch-location-v1';

interface SentCell {
  accountId: string;
  lat: number;
  lng: number;
  sentAt: number;
}

export function snapToGrid(value: number, step: number): number {
  const centre = (Math.floor(value / step) + 0.5) * step;
  return Math.round(centre * 1e5) / 1e5;
}

export function snapBeerWatchLocation(lat: number, lng: number): { lat: number; lng: number } {
  return { lat: snapToGrid(lat, LAT_STEP), lng: snapToGrid(lng, LNG_STEP) };
}

function shouldSendBeerWatchCell(
  last: SentCell | null,
  cell: { accountId: string; lat: number; lng: number },
  serverHasLocation: boolean,
  nowMs: number,
): boolean {
  if (!serverHasLocation || !last) return true;
  if (last.accountId !== cell.accountId || last.lat !== cell.lat || last.lng !== cell.lng) return true;
  return nowMs < last.sentAt || nowMs - last.sentAt > RESEND_AFTER_MS;
}

let lastSent: SentCell | null | undefined;
let syncInFlight: Promise<void> | null = null;

async function readLastSent(): Promise<SentCell | null> {
  if (lastSent !== undefined) return lastSent;
  try {
    const raw = await AsyncStorage.getItem(BEER_WATCH_LOCATION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SentCell>) : null;
    lastSent =
      parsed &&
      typeof parsed.accountId === 'string' &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      typeof parsed.sentAt === 'number'
        ? (parsed as SentCell)
        : null;
  } catch {
    lastSent = null;
  }
  return lastSent;
}

async function syncOnce(nowMs: number): Promise<void> {
  const accountId = useAccountStore.getState().session?.accountId;
  if (!accountId || useBeerWatchStore.getState().watches.length === 0) return;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return;
    const fix = await Location.getLastKnownPositionAsync();
    if (!fix) return;
    const cell = snapBeerWatchLocation(fix.coords.latitude, fix.coords.longitude);
    const last = await readLastSent();
    const serverHasLocation = useBeerWatchStore.getState().locationSet;
    if (!shouldSendBeerWatchCell(last, { accountId, ...cell }, serverHasLocation, nowMs)) return;
    const snapshot = await updateBeerWatchSettings(cell);
    if (!snapshot || useAccountStore.getState().session?.accountId !== accountId) return;
    useBeerWatchStore.getState().applySnapshot(snapshot);
    lastSent = { accountId, ...cell, sentAt: nowMs };
    await AsyncStorage.setItem(BEER_WATCH_LOCATION_KEY, JSON.stringify(lastSent));
  } catch {
    // The next foreground retries.
  }
}

/** Send the grid cell if needed. No-op without watches or location permission. */
export function syncBeerWatchLocation(nowMs = Date.now()): Promise<void> {
  syncInFlight ??= syncOnce(nowMs).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}
