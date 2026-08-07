import type { NightPublishPayload, PublishedNight } from '@/data/nightsClient';
import {
  formatFeedDuration,
  mergeFeedNights,
  pendingPublishToFeedEntry,
  publishedNightToFeedEntry,
} from '@/feed/feedModel';

const night: PublishedNight = {
  id: 'night-1',
  clientId: 'day-1',
  author: {
    id: 'author-1',
    nickname: 'pena',
    displayName: 'Petr',
    avatarUrl: 'https://example.test/avatar.webp',
    isPublic: true,
  },
  drinkingDay: '2026-08-06',
  startedAt: '2026-08-06T18:00:00.000Z',
  endedAt: '2026-08-06T22:00:00.000Z',
  beerCount: 4,
  wineCount: 1,
  softDrinkCount: 2,
  shotCount: 0,
  pubNames: ['U Pěny', 'Lokál'],
  city: 'Praha',
  durationMinutes: 240,
  visibility: 'public',
  createdAt: '2026-08-06T22:05:00.000Z',
  rounds: 3,
  myRound: true,
  isMine: false,
};

const pending: NightPublishPayload = {
  clientId: 'day-1',
  drinkingDay: '2026-08-06',
  startedAt: '2026-08-06T18:00:00.000Z',
  endedAt: '2026-08-06T22:00:00.000Z',
  beerCount: 4,
  wineCount: 1,
  softDrinkCount: 2,
  shotCount: 0,
  pubNames: ['U Pěny', 'Lokál'],
  city: 'Praha',
  durationMinutes: 240,
  visibility: 'public',
  updatedAt: '2026-08-06T22:05:00.000Z',
};

describe('feedModel', () => {
  it('maps only published-night fields into the approved card shape', () => {
    expect(publishedNightToFeedEntry(night, Date.parse('2026-08-06T22:15:00.000Z'))).toEqual(
      expect.objectContaining({
        id: 'night-1',
        clientId: 'day-1',
        title: 'Večer v U Pěny',
        when: 'před 10 min',
        pubNames: ['U Pěny', 'Lokál'],
        city: 'Praha',
        beerCount: 4,
        wineCount: 1,
        softDrinkCount: 2,
        duration: '4h',
        rounds: 3,
        myRound: true,
        pending: false,
      }),
    );
  });

  it('formats compact durations without inventing a missing value', () => {
    expect(formatFeedDuration(null)).toBe('—');
    expect(formatFeedDuration(48)).toBe('48m');
    expect(formatFeedDuration(185)).toBe('3h 5m');
  });

  it('drops a queued overlay once the same client id arrives from the API', () => {
    const queued = pendingPublishToFeedEntry(pending, null);
    const published = publishedNightToFeedEntry(night);
    expect(mergeFeedNights([queued], [published])).toEqual([published]);
  });
});
