import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';

export interface BeerBrandSuggestion {
  slug: string;
  name: string;
  kind?: 'product' | 'brand';
  brandSlug?: string;
  brandName?: string;
}

interface WireSuggestion {
  slug?: unknown;
  name?: unknown;
  kind?: unknown;
  brand_slug?: unknown;
  brand_name?: unknown;
}

interface WireResponse {
  suggestions?: unknown;
}

interface LocalBeerBrandSuggestion extends BeerBrandSuggestion {
  aliases?: string[];
}

const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 8;

const LOCAL_BEER_BRAND_SUGGESTIONS: LocalBeerBrandSuggestion[] = [
  {
    slug: 'pilsner-urquell',
    name: 'Pilsner Urquell',
    kind: 'product',
    brandSlug: 'pilsner-urquell',
    brandName: 'Pilsner Urquell',
    aliases: ['Plzeň', 'Plzen', 'Prazdroj'],
  },
  {
    slug: 'gambrinus-10',
    name: 'Gambrinus 10°',
    kind: 'product',
    brandSlug: 'gambrinus',
    brandName: 'Gambrinus',
    aliases: ['Gambrinus 10', 'Gambáč 10', 'Gambac 10'],
  },
  {
    slug: 'gambrinus-11',
    name: 'Gambrinus 11°',
    kind: 'product',
    brandSlug: 'gambrinus',
    brandName: 'Gambrinus',
    aliases: ['Gambrinus 11', 'Gambáč 11', 'Gambac 11'],
  },
  {
    slug: 'gambrinus-12',
    name: 'Gambrinus 12°',
    kind: 'product',
    brandSlug: 'gambrinus',
    brandName: 'Gambrinus',
    aliases: ['Gambrinus 12'],
  },
  {
    slug: 'velkopopovicky-kozel-10',
    name: 'Velkopopovický Kozel 10°',
    kind: 'product',
    brandSlug: 'velkopopovicky-kozel',
    brandName: 'Velkopopovický Kozel',
    aliases: ['Kozel 10'],
  },
  {
    slug: 'velkopopovicky-kozel-11',
    name: 'Velkopopovický Kozel 11°',
    kind: 'product',
    brandSlug: 'velkopopovicky-kozel',
    brandName: 'Velkopopovický Kozel',
    aliases: ['Kozel 11'],
  },
  {
    slug: 'velkopopovicky-kozel-12',
    name: 'Velkopopovický Kozel 12°',
    kind: 'product',
    brandSlug: 'velkopopovicky-kozel',
    brandName: 'Velkopopovický Kozel',
    aliases: ['Kozel 12'],
  },
  {
    slug: 'velkopopovicky-kozel-cerny',
    name: 'Velkopopovický Kozel Černý',
    kind: 'product',
    brandSlug: 'velkopopovicky-kozel',
    brandName: 'Velkopopovický Kozel',
    aliases: ['Kozel černý', 'Kozel cerny'],
  },
  {
    slug: 'radegast-razna-10',
    name: 'Radegast Rázná 10°',
    kind: 'product',
    brandSlug: 'radegast',
    brandName: 'Radegast',
    aliases: ['Radegast 10'],
  },
  {
    slug: 'radegast-ryze-horka-12',
    name: 'Radegast Ryzí hořká 12°',
    kind: 'product',
    brandSlug: 'radegast',
    brandName: 'Radegast',
    aliases: ['Radegast 12', 'Radegast Ryze horka'],
  },
  {
    slug: 'staropramen-10',
    name: 'Staropramen 10°',
    kind: 'product',
    brandSlug: 'staropramen',
    brandName: 'Staropramen',
    aliases: ['Staráč 10', 'Starac 10'],
  },
  {
    slug: 'staropramen-11',
    name: 'Staropramen 11°',
    kind: 'product',
    brandSlug: 'staropramen',
    brandName: 'Staropramen',
    aliases: ['Staráč 11', 'Starac 11'],
  },
  {
    slug: 'budweiser-budvar-original',
    name: 'Budweiser Budvar Original',
    kind: 'product',
    brandSlug: 'budweiser-budvar',
    brandName: 'Budweiser Budvar',
    aliases: ['Budvar', 'Budvar Original'],
  },
  {
    slug: 'krusovice-10',
    name: 'Krušovice 10°',
    kind: 'product',
    brandSlug: 'krusovice',
    brandName: 'Krušovice',
    aliases: ['Krusovice 10'],
  },
  {
    slug: 'krusovice-11',
    name: 'Krušovice 11°',
    kind: 'product',
    brandSlug: 'krusovice',
    brandName: 'Krušovice',
    aliases: ['Krusovice 11'],
  },
  {
    slug: 'starobrno-medium',
    name: 'Starobrno Medium',
    kind: 'product',
    brandSlug: 'starobrno',
    brandName: 'Starobrno',
    aliases: ['Starobrno 11'],
  },
  {
    slug: 'zlaty-bazant-10',
    name: 'Zlatý Bažant 10°',
    kind: 'product',
    brandSlug: 'zlaty-bazant',
    brandName: 'Zlatý Bažant',
    aliases: ['Zlaty Bazant 10', 'Bažant 10', 'Bazant 10'],
  },
  {
    slug: 'saris-10',
    name: 'Šariš 10°',
    kind: 'product',
    brandSlug: 'saris',
    brandName: 'Šariš',
    aliases: ['Saris 10'],
  },
];

/**
 * Curated brand-level quick picks for the filter sheet. These let the user tap
 * the dominant Czech/Slovak brands without typing — `key` is the brand slug sent
 * to the backend (`beer_brand`), `label` is the stored/shown name, `short` is the
 * compact chip caption. Anything outside this list is reachable via search.
 */
export interface PopularBeerBrand {
  key: string;
  label: string;
  short: string;
}

/** Canonical brand identity used by server-backed pub filters. */
export type BeerBrandFilterOption = Pick<PopularBeerBrand, 'key' | 'label'>;

export const POPULAR_BEER_BRANDS: PopularBeerBrand[] = [
  { key: 'pilsner-urquell', label: 'Pilsner Urquell', short: 'Plzeň' },
  { key: 'gambrinus', label: 'Gambrinus', short: 'Gambrinus' },
  { key: 'velkopopovicky-kozel', label: 'Velkopopovický Kozel', short: 'Kozel' },
  { key: 'radegast', label: 'Radegast', short: 'Radegast' },
  { key: 'staropramen', label: 'Staropramen', short: 'Staropramen' },
  { key: 'budweiser-budvar', label: 'Budweiser Budvar', short: 'Budvar' },
  { key: 'krusovice', label: 'Krušovice', short: 'Krušovice' },
  { key: 'starobrno', label: 'Starobrno', short: 'Starobrno' },
];

/** The nearby endpoint accepts at most five simultaneous brand filters. Keep
 * the quick-pick catalogue inside that same bound so every visible combination
 * can be submitted successfully. */
export const POPULAR_BEER_BRAND_FILTER_LIMIT = 5;

const POPULAR_BEER_BRAND_REQUEST_LIMIT = 20;

export function fallbackPopularBeerBrands(): BeerBrandFilterOption[] {
  return POPULAR_BEER_BRANDS.slice(0, POPULAR_BEER_BRAND_FILTER_LIMIT).map(
    ({ key, label }) => ({ key, label }),
  );
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function localSuggestions(query: string, limit: number, brewery = ''): BeerBrandSuggestion[] {
  const normalizedQuery = normalizeText(`${brewery} ${query}`);
  if (normalizedQuery.length < 2) return [];
  return LOCAL_BEER_BRAND_SUGGESTIONS.filter((item) => {
    const values = [item.name, ...(item.aliases ?? [])].map(normalizeText);
    return values.some(
      (value) =>
        value === normalizedQuery ||
        value.startsWith(normalizedQuery) ||
        normalizedQuery.startsWith(`${value} `) ||
        value.includes(normalizedQuery),
    );
  })
    .slice(0, limit)
    .map(({ slug, name, kind, brandSlug, brandName }) => ({
      slug,
      name,
      ...(kind ? { kind } : {}),
      ...(brandSlug ? { brandSlug } : {}),
      ...(brandName ? { brandName } : {}),
    }));
}

function normalizeSuggestions(raw: unknown, limit: number): BeerBrandSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: BeerBrandSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of raw as WireSuggestion[]) {
    if (typeof item?.slug !== 'string' || typeof item?.name !== 'string') continue;
    const slug = item.slug.trim();
    const name = item.name.trim();
    if (!slug || !name || seen.has(slug)) continue;
    seen.add(slug);
    const kind = item.kind === 'product' || item.kind === 'brand' ? item.kind : undefined;
    const brandSlug = typeof item.brand_slug === 'string' ? item.brand_slug.trim() : undefined;
    const brandName = typeof item.brand_name === 'string' ? item.brand_name.trim() : undefined;
    out.push({
      slug,
      name,
      ...(kind ? { kind } : {}),
      ...(brandSlug ? { brandSlug } : {}),
      ...(brandName ? { brandName } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Load the ranked quick-pick brands used by the redesigned Hospody filter.
 *
 * The suggestion endpoint is product-first, so a blank query can contain
 * several products from one brewery. Collapse those rows to their canonical
 * `brand_slug` / `brand_name` identity and keep a small, deterministic list.
 * On any unavailable/malformed response the bundled Czech/Slovak popular list
 * keeps the filter usable offline.
 */
export async function fetchPopularBeerBrands(
  signal?: AbortSignal,
): Promise<BeerBrandFilterOption[]> {
  const fallback = fallbackPopularBeerBrands();
  if (signal?.aborted) return fallback;

  const endpoint = getBackendEndpoint('/v1/beer-brands/suggest');
  if (!endpoint) return fallback;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(endpoint);
    url.searchParams.set('q', '');
    url.searchParams.set('limit', String(POPULAR_BEER_BRAND_REQUEST_LIMIT));
    const resp = await fetch(url.toString(), {
      method: 'GET',
      signal: abort.signal,
    });
    if (!resp.ok) return fallback;

    const data = (await resp.json()) as WireResponse;
    const suggestions = normalizeSuggestions(data?.suggestions, POPULAR_BEER_BRAND_REQUEST_LIMIT);
    const brands: BeerBrandFilterOption[] = [];
    const seen = new Set<string>();
    for (const suggestion of suggestions) {
      const key = suggestion.brandSlug?.trim() ||
        (suggestion.kind === 'brand' ? suggestion.slug.trim() : '');
      const label = suggestion.brandName?.trim() ||
        (suggestion.kind === 'brand' ? suggestion.name.trim() : '');
      if (!key || !label || seen.has(key)) continue;
      seen.add(key);
      brands.push({ key, label });
      if (brands.length >= POPULAR_BEER_BRAND_FILTER_LIMIT) break;
    }
    return brands.length > 0 ? brands : fallback;
  } catch {
    return fallback;
  } finally {
    abort.cleanup();
  }
}

export async function suggestBeerBrands(
  query: string,
  signal?: AbortSignal,
  limit = DEFAULT_LIMIT,
  brewery = '',
): Promise<BeerBrandSuggestion[]> {
  const trimmed = query.trim().slice(0, 80);
  const cappedLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  if (trimmed.length < 2 || signal?.aborted) return [];

  const cleanBrewery = brewery.trim().slice(0, 80);
  const fallback = localSuggestions(trimmed, cappedLimit, cleanBrewery);
  const endpoint = getBackendEndpoint('/v1/beer-brands/suggest');
  if (!endpoint) return fallback;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(endpoint);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', String(cappedLimit));
    if (cleanBrewery) url.searchParams.set('brewery', cleanBrewery);
    const resp = await fetch(url.toString(), {
      method: 'GET',
      signal: abort.signal,
    });

    if (!resp.ok) return fallback;
    const data = (await resp.json()) as WireResponse;
    const suggestions = normalizeSuggestions(data?.suggestions, cappedLimit);
    return suggestions.length > 0 ? suggestions : fallback;
  } catch {
    return fallback;
  } finally {
    abort.cleanup();
  }
}
