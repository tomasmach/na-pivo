import type { PublishedNight } from '@/data/nightsClient';

import {
  feedAuthorLabel,
  feedDuration,
  feedFacts,
  feedNightRoute,
  feedNightTitle,
  feedOtherDrinks,
  feedWhen,
  mergeNightPages,
  replaceNightReaction,
} from '../feedModel';

function night(overrides: Partial<PublishedNight> = {}): PublishedNight {
  return {
    id: 'night-1',
    author: {
      id: 'author-1',
      nickname: null,
      displayName: 'Honza',
      avatarUrl: null,
      isPublic: true,
    },
    drinkingDay: '2026-08-05',
    startedAt: '2026-08-05T19:10:00',
    endedAt: '2026-08-05T23:17:00',
    beerCount: 0,
    wineCount: 0,
    softDrinkCount: 0,
    shotCount: 0,
    pubNames: [],
    city: '',
    durationMinutes: null,
    title: '',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    commentCount: 0,
    visibility: 'friends',
    createdAt: '2026-08-06T08:45:00',
    rounds: 0,
    myRound: false,
    isMine: false,
    ...overrides,
  };
}

describe('feed card model', () => {
  it('keeps a sparse published night sparse instead of inventing mock details', () => {
    const sparse = night();

    expect(feedAuthorLabel(sparse)).toBe('Honza');
    expect(feedNightTitle(sparse)).toBe('Pivní večer');
    expect(feedNightRoute(sparse)).toBeNull();
    expect(feedOtherDrinks(sparse)).toBeNull();
    expect(feedFacts(sparse)).toEqual([{ label: 'Piva', value: '0' }]);
  });

  it('exposes only facts that are present in the published-night response', () => {
    const complete = night({
      author: { ...night().author, nickname: 'honza' },
      beerCount: 6,
      wineCount: 1,
      softDrinkCount: 2,
      shotCount: 3,
      pubNames: ['U Zlatého tygra', 'Lokál'],
      city: 'Praha',
      durationMinutes: 247,
    });

    expect(feedAuthorLabel(complete)).toBe('@honza');
    expect(feedNightTitle(complete)).toBe('U Zlatého tygra');
    expect(feedNightRoute(complete)).toBe('U Zlatého tygra  →  Lokál');
    expect(feedOtherDrinks(complete)).toBe('1 víno · 3 panáky · 2 nealko');
    expect(feedFacts(complete)).toEqual([
      { label: 'Piva', value: '6' },
      { label: 'Večer', value: '4h 7m' },
      { label: 'Hospody', value: '2' },
    ]);
  });

  it('uses the real end time for a relative drinking-day label', () => {
    expect(feedWhen(night(), new Date(2026, 7, 6, 12))).toBe('včera 23:17');
  });

  it('formats only positive, finite durations', () => {
    expect(feedDuration(59.6)).toBe('1h');
    expect(feedDuration(60)).toBe('1h');
    expect(feedDuration(125)).toBe('2h 5m');
    expect(feedDuration(0)).toBeNull();
    expect(feedDuration(Number.NaN)).toBeNull();
  });
});

describe('feed list updates', () => {
  it('merges pages without duplicating a night already shown', () => {
    const first = night();
    const second = night({ id: 'night-2' });
    const duplicate = night({ beerCount: 99 });

    expect(mergeNightPages([first], [duplicate, second])).toEqual([first, second]);
  });

  it('updates one reaction and clamps a negative round count', () => {
    const first = night();
    const second = night({ id: 'night-2', rounds: 4 });

    expect(replaceNightReaction([first, second], 'night-2', -1, true)).toEqual([
      first,
      { ...second, rounds: 0, myRound: true },
    ]);
  });
});
