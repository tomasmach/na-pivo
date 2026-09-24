import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';

export type AddedPubLocation = { lat: number; lng: number; address: string; city: string };

/** Only an address-level result can confirm a new pub; never fall back to GPS. */
export async function lookupAddedPubLocation(
  input: { address: string; city: string } | { lat: number; lng: number },
  signal?: AbortSignal,
): Promise<AddedPubLocation | null> {
  const reverse = 'lat' in input;
  const endpoint = getBackendEndpoint(reverse ? '/v1/pubs/reverse-geocode' : '/v1/pubs/geocode');
  if (!endpoint || signal?.aborted) return null;
  const query = !reverse ? `${input.address}, ${input.city}` : '';
  // Do not truncate away the town and accidentally resolve a different street.
  if (!reverse && (!input.address || !input.city || query.length > 150)) return null;
  const abort = chainAbortSignal(signal, 8_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reverse ? { ...input, require_precise: true } : { query, address_lookup: true }),
      signal: abort.signal,
    });
    if (!response.ok || signal?.aborted) return null;
    const body = await response.json();
    if (!Array.isArray(body?.items)) return null;
    for (const item of body.items) {
      if (item?.type !== 'regional.address' || item.precise !== true) continue;
      const lat = item.position?.lat;
      const lng = item.position?.lon;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
          typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) continue;
      const parts = Array.isArray(item.regionalStructure) ? item.regionalStructure : [];
      const address = parts.find((part: { type?: string } | null) => part?.type === 'regional.street')?.name;
      const city = parts.find((part: { type?: string } | null) => part?.type === 'regional.municipality')?.name;
      if (typeof address !== 'string' || !address.trim() || typeof city !== 'string' || !city.trim()) continue;
      return { lat, lng, address: address.trim(), city: city.trim() };
    }
    return null;
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
