import { getBackendEndpoint } from './backendConfig';

export interface BeerBrandSuggestion {
  slug: string;
  name: string;
}

interface WireSuggestion {
  slug?: unknown;
  name?: unknown;
}

interface WireResponse {
  suggestions?: unknown;
}

interface LocalBeerBrandSuggestion extends BeerBrandSuggestion {
  aliases?: string[];
}

const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 8;

export const LOCAL_BEER_BRAND_SUGGESTIONS: LocalBeerBrandSuggestion[] = [
  { slug: 'pilsner-urquell', name: 'Pilsner Urquell', aliases: ['Plzeň', 'Plzen', 'Prazdroj'] },
  { slug: 'gambrinus', name: 'Gambrinus', aliases: ['Gambáč', 'Gambac'] },
  { slug: 'velkopopovicky-kozel', name: 'Velkopopovický Kozel', aliases: ['Kozel'] },
  { slug: 'radegast', name: 'Radegast' },
  { slug: 'staropramen', name: 'Staropramen', aliases: ['Staráč', 'Starac'] },
  { slug: 'budweiser-budvar', name: 'Budweiser Budvar', aliases: ['Budvar'] },
  { slug: 'krusovice', name: 'Krušovice', aliases: ['Krusovice'] },
  { slug: 'starobrno', name: 'Starobrno' },
  { slug: 'zlaty-bazant', name: 'Zlatý Bažant', aliases: ['Zlaty Bazant', 'Bažant', 'Bazant'] },
  { slug: 'saris', name: 'Šariš', aliases: ['Saris'] },
  { slug: 'topvar', name: 'Topvar' },
  { slug: 'corgon', name: 'Corgoň', aliases: ['Corgon'] },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function localSuggestions(query: string, limit: number): BeerBrandSuggestion[] {
  const normalizedQuery = normalizeText(query);
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
    .map(({ slug, name }) => ({ slug, name }));
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
    out.push({ slug, name });
    if (out.length >= limit) break;
  }
  return out;
}

function chainAbortSignal(signal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

export async function suggestBeerBrands(
  query: string,
  signal?: AbortSignal,
  limit = DEFAULT_LIMIT,
): Promise<BeerBrandSuggestion[]> {
  const trimmed = query.trim().slice(0, 80);
  const cappedLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  if (trimmed.length < 2 || signal?.aborted) return [];

  const fallback = localSuggestions(trimmed, cappedLimit);
  const endpoint = getBackendEndpoint('/v1/beer-brands/suggest');
  if (!endpoint) return fallback;

  const abort = chainAbortSignal(signal);
  try {
    const url = new URL(endpoint);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', String(cappedLimit));
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
