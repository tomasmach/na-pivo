import { decodeGeohash8, geohash8 } from './geohash';
import { parseAppUrl } from './inviteLinkRoutes';

const PUB_SHARE_ORIGIN = 'https://na-pivo.cz';
const CELL = /^[0123456789bcdefghjkmnpqrstuvwxyz]{8}$/;
const MAX_NAME = 120;

export interface SharedPubLink {
  /** Geohash-8 cell of the pub, the same key the app uses everywhere. */
  key: string;
  /** Name hint; picks the right pub when one cell holds more of them. */
  name: string;
  /** Centre of the cell, about 19 m from the pub. */
  lat: number;
  lng: number;
}

/** The public web page of a pub, `https://na-pivo.cz/h/<cell>?n=<name>`. */
export function buildPubShareUrl(pub: { name: string; lat: number; lng: number }): string {
  const name = pub.name.trim().slice(0, MAX_NAME);
  const query = name ? `?n=${encodeURIComponent(name)}` : '';
  return `${PUB_SHARE_ORIGIN}/h/${geohash8(pub.lat, pub.lng)}${query}`;
}

/** Reads a pub link (web or `napivo://h/<cell>`); null for anything else. */
export function parsePubShareUrl(value: string | null | undefined): SharedPubLink | null {
  const parsed = parseAppUrl(value);
  if (!parsed) return null;
  const key = /^\/h\/([^/]+)\/?$/.exec(parsed.path)?.[1]?.toLowerCase();
  if (!key || !CELL.test(key)) return null;
  const name = (parsed.url.searchParams.get('n') ?? '').trim().slice(0, MAX_NAME);
  return { key, name, ...decodeGeohash8(key) };
}
