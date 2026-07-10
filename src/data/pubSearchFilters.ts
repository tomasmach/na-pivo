import { AMENITIES, type AmenityKey } from './amenities';

export const MAX_AMENITY_FILTERS = 5;

export interface BeerBrandFilterValue {
  key: string;
  label: string;
}

export interface PubSearchFilters {
  beerBrand: BeerBrandFilterValue | null;
  amenityKeys: AmenityKey[];
}

export const EMPTY_PUB_SEARCH_FILTERS: PubSearchFilters = {
  beerBrand: null,
  amenityKeys: [],
};

const AMENITY_ORDER = new Map(AMENITIES.map((amenity, index) => [amenity.key, index]));

export function normalizeAmenityFilterKeys(keys: readonly AmenityKey[]): AmenityKey[] {
  return Array.from(new Set(keys))
    .filter((key) => AMENITIES.some((amenity) => amenity.key === key && amenity.mapFilterable))
    .sort((a, b) => (AMENITY_ORDER.get(a) ?? 999) - (AMENITY_ORDER.get(b) ?? 999))
    .slice(0, MAX_AMENITY_FILTERS);
}

export function normalizePubSearchFilters(filters: PubSearchFilters): PubSearchFilters {
  const beerKey = filters.beerBrand?.key.trim() ?? '';
  const beerLabel = filters.beerBrand?.label.trim() ?? '';
  return {
    beerBrand: beerKey && beerLabel ? { key: beerKey, label: beerLabel } : null,
    amenityKeys: normalizeAmenityFilterKeys(filters.amenityKeys),
  };
}

export function pubSearchFilterKey(filters: PubSearchFilters): string {
  const normalized = normalizePubSearchFilters(filters);
  return `${normalized.beerBrand?.key ?? ''}|${normalized.amenityKeys.join(',')}`;
}

export function activePubSearchFilterCount(filters: PubSearchFilters): number {
  const normalized = normalizePubSearchFilters(filters);
  return normalized.amenityKeys.length + (normalized.beerBrand ? 1 : 0);
}
