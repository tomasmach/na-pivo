import { sessionCount, type TallySession } from '@/stores/tallyStore';
import type { AccountSubscription } from '@/data/auth';
import type { BeerTrailTeaser } from '@/beerTrail/beerTrailClient';

export function deriveLocalBeerTrailTeaser(sessions: TallySession[]): BeerTrailTeaser {
  const pubs = new Set<string>();
  let totalBeers = 0;
  for (const session of sessions) {
    pubs.add(session.pubKey);
    totalBeers += sessionCount(session);
  }
  return {
    distinctPubs: pubs.size,
    citiesCount: 0,
    visitsCount: sessions.length,
    totalBeers,
  };
}

export function isPlusSubscription(subscription?: AccountSubscription): boolean {
  if (!subscription) return false;
  if (subscription.tier !== 'plus') return false;
  if (subscription.status !== 'active' && subscription.status !== 'grace_period') return false;
  if (!subscription.expiresAt) return true;
  const expiresMs = Date.parse(subscription.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > Date.now();
}
