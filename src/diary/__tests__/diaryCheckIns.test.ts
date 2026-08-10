import type { BeerCheckIn } from '@/data/beerCheckinsClient';

import { mergeDiaryCheckIns } from '../diaryCheckIns';

function checkIn(clientId: string, checkedInAt: string, beerName = clientId): BeerCheckIn {
  return {
    id: `server-${clientId}`,
    account: {
      id: 'account-a',
      nickname: null,
      displayName: 'Test',
      avatarUrl: null,
      isPublic: false,
    },
    clientId,
    beerName,
    breweryName: '',
    beerStyle: '',
    abv: null,
    quantity: 1,
    priceCzk: null,
    rating: null,
    note: '',
    tags: [],
    pubCacheKey: '',
    pubName: '',
    pubCity: '',
    visitClientId: null,
    visibility: 'private',
    checkedInAt,
    endedAt: null,
    reactions: { cheers: 0 },
    myReaction: null,
    createdAt: checkedInAt,
    updatedAt: checkedInAt,
  };
}

describe('mergeDiaryCheckIns', () => {
  it('keeps queued rows, deduplicates synced rows and sorts newest first', () => {
    const remoteDuplicate = checkIn('same', '2026-08-08T20:00:00Z', 'Server name');
    const pendingDuplicate = checkIn('same', '2026-08-08T20:00:00Z', 'Queued name');

    expect(
      mergeDiaryCheckIns(
        [pendingDuplicate, checkIn('offline', '2026-08-10T20:00:00Z')],
        [remoteDuplicate, checkIn('old', '2026-08-01T20:00:00Z')],
      ).map((item) => [item.clientId, item.beerName]),
    ).toEqual([
      ['offline', 'offline'],
      ['same', 'Queued name'],
      ['old', 'old'],
    ]);
  });
});
