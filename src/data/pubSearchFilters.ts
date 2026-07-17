import { AMENITIES, type AmenityKey } from './amenities';
import { isPriceFresh } from '@/utils/priceAge';

export const MAX_AMENITY_FILTERS = 5;

/** Slider positions for the price filter, in CZK; null = no limit. */
export const PRICE_FILTER_STEPS: (number | null)[] = [
  30, 35, 40, 45, 50, 55, 60, 65, 70, null,
];
export const PRICE_FILTER_MIN_CZK = 30;
export const PRICE_FILTER_MAX_CZK = 75;

export interface BeerBrandFilterValue {
  key: string;
  label: string;
}

export interface PubSearchFilters {
  beerBrand: BeerBrandFilterValue | null;
  amenityKeys: AmenityKey[];
  /**
   * Reference beer price range in CZK. A null boundary is open. Unlike
   * beerBrand/amenityKeys this filter is applied CLIENT-SIDE over the prices
   * the nearby endpoint attaches to each pub — it never reaches the wire.
   */
  priceMinCzk: number | null;
  priceMaxCzk: number | null;
}

export const EMPTY_PUB_SEARCH_FILTERS: PubSearchFilters = {
  beerBrand: null,
  amenityKeys: [],
  priceMinCzk: null,
  priceMaxCzk: null,
};

const AMENITY_ORDER = new Map(AMENITIES.map((amenity, index) => [amenity.key, index]));

export function normalizeAmenityFilterKeys(keys: readonly AmenityKey[]): AmenityKey[] {
  return Array.from(new Set(keys))
    .filter((key) => AMENITIES.some((amenity) => amenity.key === key && amenity.mapFilterable))
    .sort((a, b) => (AMENITY_ORDER.get(a) ?? 999) - (AMENITY_ORDER.get(b) ?? 999))
    .slice(0, MAX_AMENITY_FILTERS);
}

function normalizePriceMax(priceMaxCzk: number | null | undefined): number | null {
  if (typeof priceMaxCzk !== 'number' || !Number.isFinite(priceMaxCzk)) return null;
  // At-or-above the slider ceiling means "no limit" — never store a cap that
  // silently filters nothing.
  if (priceMaxCzk >= PRICE_FILTER_MAX_CZK) return null;
  return Math.max(PRICE_FILTER_MIN_CZK, Math.round(priceMaxCzk));
}

function normalizePriceMin(priceMinCzk: number | null | undefined): number | null {
  if (typeof priceMinCzk !== 'number' || !Number.isFinite(priceMinCzk)) return null;
  // The left-most thumb is the open lower boundary. Numeric values begin at
  // the next 5 Kč step so the UI never has two meanings for the same position.
  if (priceMinCzk <= PRICE_FILTER_MIN_CZK) return null;
  return Math.min(PRICE_FILTER_MAX_CZK - 5, Math.round(priceMinCzk));
}

export function normalizePubSearchFilters(filters: PubSearchFilters): PubSearchFilters {
  const beerKey = filters.beerBrand?.key.trim() ?? '';
  const beerLabel = filters.beerBrand?.label.trim() ?? '';
  let priceMinCzk = normalizePriceMin(filters.priceMinCzk);
  let priceMaxCzk = normalizePriceMax(filters.priceMaxCzk);
  if (priceMinCzk !== null && priceMaxCzk !== null && priceMinCzk > priceMaxCzk) {
    [priceMinCzk, priceMaxCzk] = [normalizePriceMin(priceMaxCzk), priceMinCzk];
  }
  return {
    beerBrand: beerKey && beerLabel ? { key: beerKey, label: beerLabel } : null,
    amenityKeys: normalizeAmenityFilterKeys(filters.amenityKeys),
    priceMinCzk,
    priceMaxCzk,
  };
}

export function pubSearchFilterKey(filters: PubSearchFilters): string {
  const normalized = normalizePubSearchFilters(filters);
  return `${normalized.beerBrand?.key ?? ''}|${normalized.amenityKeys.join(',')}|${normalized.priceMinCzk ?? ''}:${normalized.priceMaxCzk ?? ''}`;
}

/**
 * Cache/request identity of the filters that actually go to the backend. The
 * price filter is client-side only, so two filter states differing only in
 * price must share one backend fetch.
 */
export function backendPubSearchFilterKey(filters: PubSearchFilters): string {
  return pubSearchFilterKey({ ...filters, priceMinCzk: null, priceMaxCzk: null });
}

export function activePubSearchFilterCount(filters: PubSearchFilters): number {
  const normalized = normalizePubSearchFilters(filters);
  return (
    normalized.amenityKeys.length +
    (normalized.beerBrand ? 1 : 0) +
    (normalized.priceMinCzk !== null || normalized.priceMaxCzk !== null ? 1 : 0)
  );
}

/**
 * Client-side price gate. With an active boundary, pubs WITHOUT a known price
 * are excluded too — the filter must never present unknown as affordable.
 */
export function pubMatchesPriceFilter(
  pub: { price?: { czk: number; observedAt: string } | null },
  priceMinCzk: number | null,
  priceMaxCzk: number | null,
): boolean {
  if (priceMinCzk === null && priceMaxCzk === null) return true;
  return (
    pub.price != null &&
    isPriceFresh(pub.price.observedAt) &&
    (priceMinCzk === null || pub.price.czk >= priceMinCzk) &&
    (priceMaxCzk === null || pub.price.czk <= priceMaxCzk)
  );
}
