import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import countryToCurrency from 'country-to-currency';

import { getCurrencyRate, setCurrencyRate, type PriceCurrency } from '@/utils/currency';
import { useSettingsStore } from '@/stores/settingsStore';

const RATE_CACHE_KEY = 'na-pivo-currency-rates-v1';
const RATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COUNTRY_CELL_DEGREES = 0.25;

type CachedRate = { currency: string; czkPerUnit: number; fetchedAt: number };

let lastCell: string | null = null;
let lastDetectedCurrency: string | null = null;
let detectionInFlight = false;

/** A failed detection (offline, throttled geocoder, unknown currency) must not
 * retry on every GPS sample — iOS rate-limits CLGeocoder and makes the failure
 * permanent for the session. Retry only after a cooldown or in a new cell. */
const FAILED_DETECTION_COOLDOWN_MS = 5 * 60 * 1000;
let lastFailedCell: string | null = null;
let lastFailedAt = 0;

function coordinateCell(lat: number, lng: number): string {
  return `${Math.floor(lat / COUNTRY_CELL_DEGREES)}:${Math.floor(lng / COUNTRY_CELL_DEGREES)}`;
}

export function currencyForCountryCode(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return countryToCurrency[countryCode.toUpperCase() as keyof typeof countryToCurrency] ?? null;
}

async function readCachedRate(currency: string): Promise<CachedRate | null> {
  try {
    const raw = await AsyncStorage.getItem(RATE_CACHE_KEY);
    const entries = raw ? (JSON.parse(raw) as Record<string, CachedRate>) : {};
    const entry = entries[currency];
    if (!entry || !Number.isFinite(entry.czkPerUnit) || entry.czkPerUnit <= 0) return null;
    return entry;
  } catch {
    return null;
  }
}

async function persistRate(entry: CachedRate): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RATE_CACHE_KEY);
    const entries = raw ? (JSON.parse(raw) as Record<string, CachedRate>) : {};
    entries[entry.currency] = entry;
    await AsyncStorage.setItem(RATE_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // A rate is an optimization; never make beer logging depend on cache writes.
  }
}

async function fetchCzkPerUnit(currency: string): Promise<number | null> {
  if (currency === 'CZK') return 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${currency}/CZK`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { rate?: unknown };
    return typeof data.rate === 'number' && Number.isFinite(data.rate) && data.rate > 0
      ? data.rate
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRate(currency: PriceCurrency): Promise<number | null> {
  const cached = await readCachedRate(currency);
  if (cached) setCurrencyRate(currency, cached.czkPerUnit);
  if (cached && Date.now() - cached.fetchedAt < RATE_MAX_AGE_MS) return cached.czkPerUnit;

  const fresh = await fetchCzkPerUnit(currency);
  if (fresh) {
    setCurrencyRate(currency, fresh);
    void persistRate({ currency, czkPerUnit: fresh, fetchedAt: Date.now() });
    return fresh;
  }
  return cached?.czkPerUnit ?? getCurrencyRate(currency);
}

/**
 * Detects only a coarse country from an already-authorized foreground fix.
 * Coordinates never leave this function or get persisted.
 */
export async function updateCurrencyFromCoordinates(lat: number, lng: number): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const cell = coordinateCell(lat, lng);
  if (
    (cell === lastCell && useSettingsStore.getState().priceCurrency === lastDetectedCurrency) ||
    detectionInFlight
  ) return;
  if (cell === lastFailedCell && Date.now() - lastFailedAt < FAILED_DETECTION_COOLDOWN_MS) return;

  detectionInFlight = true;
  let detected = false;
  try {
    const addresses = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const currency = currencyForCountryCode(addresses[0]?.isoCountryCode);
    if (!currency) return;

    const rate = await resolveRate(currency);
    // Unknown/offline exotic rates must not silently treat local units as CZK.
    if (!rate) return;
    detected = true;
    lastCell = cell;
    lastDetectedCurrency = currency;
    useSettingsStore.getState().setPriceCurrency(currency, rate);
  } catch {
    // Keep the last working currency when reverse geocoding is unavailable.
  } finally {
    if (detected) {
      lastFailedCell = null;
    } else {
      lastFailedCell = cell;
      lastFailedAt = Date.now();
    }
    detectionInFlight = false;
  }
}

/** Refreshes from an OS-cached fix only; never prompts or starts a GPS reading. */
export async function refreshCurrencyFromLastKnownLocation(): Promise<void> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return;
    const location = await Location.getLastKnownPositionAsync();
    if (!location) return;
    await updateCurrencyFromCoordinates(location.coords.latitude, location.coords.longitude);
  } catch {
    // The next foreground GPS fix will retry.
  }
}
