import { deriveLocalBeerTrailTeaser, isPlusSubscription } from '../beerTrailModel';
import type { TallySession } from '@/stores/tallyStore';

function session(overrides: Partial<TallySession>): TallySession {
  return {
    clientId: overrides.clientId ?? 'session-1',
    pubKey: overrides.pubKey ?? 'pub-1',
    pubName: overrides.pubName ?? 'U Testu',
    startedAt: overrides.startedAt ?? '2026-06-12T18:00:00.000Z',
    drinks: overrides.drinks ?? [],
  };
}

describe('beerTrailModel', () => {
  it('derives local teaser numbers from tally sessions', () => {
    const teaser = deriveLocalBeerTrailTeaser([
      session({
        pubKey: 'pub-a',
        drinks: [
          { id: 'a', beerName: 'Pivo', priceCzk: 50, at: '2026-06-12T18:00:00.000Z' },
          { id: 'b', beerName: 'Pivo', priceCzk: 50, at: '2026-06-12T19:00:00.000Z' },
        ],
      }),
      session({
        clientId: 'session-2',
        pubKey: 'pub-a',
        drinks: [{ id: 'c', beerName: 'Pivo', priceCzk: 50, at: '2026-06-13T18:00:00.000Z' }],
      }),
      session({
        clientId: 'session-3',
        pubKey: 'pub-b',
        drinks: [{ id: 'd', beerName: 'Pivo', priceCzk: 50, at: '2026-06-14T18:00:00.000Z' }],
      }),
    ]);

    expect(teaser).toEqual({
      distinctPubs: 2,
      citiesCount: 0,
      visitsCount: 3,
      totalBeers: 4,
    });
  });

  it('treats only active or grace plus subscriptions as entitled', () => {
    expect(isPlusSubscription({ tier: 'free', status: 'active', platform: '', productId: '', originalTransactionId: '', expiresAt: null, updatedAt: null })).toBe(false);
    expect(isPlusSubscription({ tier: 'plus', status: 'pending_verification', platform: '', productId: '', originalTransactionId: '', expiresAt: null, updatedAt: null })).toBe(false);
    expect(isPlusSubscription({ tier: 'plus', status: 'active', platform: '', productId: '', originalTransactionId: '', expiresAt: null, updatedAt: null })).toBe(true);
  });
});
