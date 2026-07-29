import type { BeerCheckIn } from '@/data/beerCheckinsClient';
import type { PartaFeedSitting } from '@/data/partaFeedClient';

import { mergeCheckInsIntoFeed } from '../partaFeedMerge';

const JAREK = { id: 'jarek', nickname: 'jarek', displayName: 'Jarek', avatarUrl: null, isPublic: true };
const PEGISEK = {
  id: 'pegisek',
  nickname: 'pegisek',
  displayName: 'Pegisek',
  avatarUrl: null,
  isPublic: true,
};

function sitting(partial: Partial<PartaFeedSitting> = {}): PartaFeedSitting {
  return {
    id: 'sitting-cisterna',
    account: JAREK,
    mine: false,
    placeContext: 'pub',
    pubName: 'Restaurace Cisterna',
    pubCity: 'Trutnov',
    cacheKey: 'cisterna8',
    lat: null,
    lng: null,
    startedAt: '2026-07-28T16:00:00.000Z',
    endedAt: '2026-07-28T21:00:00.000Z',
    total: 6,
    items: [{ drinkType: 'beer', servingType: 'draft', name: 'Pilsner Urquell', count: 6 }],
    ...partial,
  };
}

function checkIn(partial: Partial<BeerCheckIn> = {}): BeerCheckIn {
  return {
    id: 'check-1',
    account: JAREK,
    clientId: 'c1',
    beerName: 'Pilsner Urquell',
    breweryName: 'Plzeňský Prazdroj',
    beerStyle: '',
    abv: null,
    quantity: 1,
    priceCzk: null,
    rating: 5,
    note: 'Top české pivo',
    tags: [],
    pubCacheKey: 'cisterna8',
    pubName: 'Restaurace Cisterna',
    pubCity: 'Trutnov',
    visitClientId: null,
    visibility: 'friends',
    checkedInAt: '2026-07-28T18:00:00.000Z',
    endedAt: null,
    reactions: { cheers: 0 },
    myReaction: null,
    createdAt: '2026-07-28T18:00:00.000Z',
    updatedAt: '2026-07-28T18:00:00.000Z',
    ...partial,
  };
}

describe('mergeCheckInsIntoFeed', () => {
  it('files a rating onto the evening it was written in', () => {
    const merged = mergeCheckInsIntoFeed([sitting()], [checkIn()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].checkIns.map((c) => c.id)).toEqual(['check-1']);
    // The sitting keeps its own tally — the rating annotates, it does not count.
    expect(merged[0].sitting.total).toBe(6);
  });

  it('never files a rating onto somebody else evening', () => {
    const merged = mergeCheckInsIntoFeed([sitting()], [checkIn({ account: PEGISEK })]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.sitting.id === 'sitting-cisterna')?.checkIns).toEqual([]);
  });

  it('keeps a rating from another pub apart even on the same night', () => {
    const elsewhere = checkIn({ id: 'check-2', pubCacheKey: 'napile88', pubName: 'Bar Na Pile' });
    const merged = mergeCheckInsIntoFeed([sitting()], [elsewhere]);
    expect(merged).toHaveLength(2);
  });

  it('attaches a pub-less rating by time, which is what a next-day entry looks like', () => {
    const typedUpLater = checkIn({ id: 'check-3', pubCacheKey: '', pubName: '' });
    const merged = mergeCheckInsIntoFeed([sitting()], [typedUpLater]);
    expect(merged).toHaveLength(1);
    expect(merged[0].checkIns[0].id).toBe('check-3');
  });

  it('does not stretch to a rating from a different night', () => {
    const lastWeek = checkIn({ id: 'check-4', checkedInAt: '2026-07-20T18:00:00.000Z' });
    const merged = mergeCheckInsIntoFeed([sitting()], [lastWeek]);
    expect(merged).toHaveLength(2);
  });

  it('gives an unmatched rating a row of its own rather than dropping it', () => {
    const orphan = checkIn({
      id: 'check-5',
      account: PEGISEK,
      beerName: 'Lomnická 12',
      quantity: 3,
      pubName: 'Lomnická pivovarská zahrada',
      pubCacheKey: 'lomnicka1',
      checkedInAt: '2026-07-29T19:00:00.000Z',
    });
    const merged = mergeCheckInsIntoFeed([sitting()], [orphan]);
    const synthesized = merged.find((row) => row.sitting.id === 'checkin:check-5');
    expect(synthesized).toBeDefined();
    expect(synthesized?.sitting.total).toBe(3);
    expect(synthesized?.sitting.items).toEqual([
      // Serving type stays unknown: a check-in does not record how it was poured.
      { drinkType: 'beer', servingType: 'unknown', name: 'Lomnická 12', count: 3 },
    ]);
    expect(synthesized?.sitting.pubName).toBe('Lomnická pivovarská zahrada');
  });

  it('marks a synthesized row as mine when it is mine', () => {
    const orphan = checkIn({ id: 'check-6', checkedInAt: '2026-07-29T19:00:00.000Z' });
    const merged = mergeCheckInsIntoFeed([], [orphan], 'jarek');
    expect(merged[0].sitting.mine).toBe(true);
  });

  it('returns one chronological stream, newest first', () => {
    const older = sitting({ id: 'older', endedAt: '2026-07-20T21:00:00.000Z' });
    const newer = sitting({ id: 'newer', endedAt: '2026-07-29T21:00:00.000Z' });
    const orphan = checkIn({
      id: 'check-7',
      account: PEGISEK,
      checkedInAt: '2026-07-25T19:00:00.000Z',
    });
    const merged = mergeCheckInsIntoFeed([older, newer], [orphan]);
    expect(merged.map((row) => row.sitting.id)).toEqual(['newer', 'checkin:check-7', 'older']);
  });

  it('handles both feeds being empty', () => {
    expect(mergeCheckInsIntoFeed([], [])).toEqual([]);
  });

  it('ignores a rating with an unparseable timestamp instead of guessing', () => {
    const broken = checkIn({ id: 'check-8', checkedInAt: 'nonsense' });
    const merged = mergeCheckInsIntoFeed([sitting()], [broken]);
    expect(merged.find((row) => row.sitting.id === 'sitting-cisterna')?.checkIns).toEqual([]);
  });
});
