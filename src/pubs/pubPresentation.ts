import { formatDistanceCs } from '@/compass/distance';
import type { Pub } from '@/data/pubs';
import type { VisitedPubSummary } from '@/map/mapModel';

export interface PubListItem extends Pub {
  distanceMeters: number;
  distance: string;
  addressLine: string;
  open: boolean | null;
  hoursLabel: string;
  beerLabel: string;
  priceCzk: number | null;
  visit: VisitedPubSummary | null;
}

function transitionTime(nextChange: string | null | undefined): string | null {
  const match = nextChange?.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? null;
}

export function pubHoursLabel(pub: Pub): string {
  const time = transitionTime(pub.nextChange);
  if (pub.isOpenNow === true) return time ? `Otevřeno do ${time}` : 'Otevřeno';
  if (pub.isOpenNow === false) return time ? `Zavřeno, otevře v ${time}` : 'Zavřeno';
  if (pub.hoursStatus === 'loading' || pub.hoursStatus === 'pending') return 'Načítám otevíračku';
  return 'Otevíračka neznámá';
}

export function primaryBeer(pub: Pub): { label: string; priceCzk: number | null } {
  const beer = pub.beers?.[0];
  return {
    label: beer?.name ?? 'Piva zatím nikdo nezmapoval',
    priceCzk: beer?.priceCzk ?? pub.price?.czk ?? null,
  };
}

export function toPubListItem(
  pub: Pub,
  distanceMeters: number,
  visit: VisitedPubSummary | null,
): PubListItem {
  const beer = primaryBeer(pub);
  const addressLine = [pub.address, pub.city].filter(Boolean).join(', ') || 'Adresa není doplněná';
  return {
    ...pub,
    distanceMeters,
    distance: formatDistanceCs(distanceMeters),
    addressLine,
    open: typeof pub.isOpenNow === 'boolean' ? pub.isOpenNow : null,
    hoursLabel: pubHoursLabel(pub),
    beerLabel: beer.label,
    priceCzk: beer.priceCzk,
    visit,
  };
}

export function splitDistance(distance: string): { value: string; unit: string } {
  const [value, unit = ''] = distance.split(' ');
  return { value, unit: unit === 'm' ? 'metrů' : unit };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = (seed + 1) * 9301 + 49297;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const j = Math.floor((state / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
