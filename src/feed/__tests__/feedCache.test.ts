import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PublishedNight } from '@/data/nightsClient';

import {
  clearNightFeedCaches,
  loadNightFeedCache,
  parseNightFeedCache,
  removeAccountFromNightFeedCaches,
  saveNightFeedCache,
} from '../feedCache';

jest.mock('@react-native-async-storage/async-storage', () =>

  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function night(id: string): PublishedNight {
  return {
    id,
    author: {
      id: `author-${id}`,
      nickname: null,
      displayName: 'Pivař',
      avatarUrl: null,
      isPublic: true,
    },
    drinkingDay: '2026-08-05',
    startedAt: '2026-08-05T18:00:00.000Z',
    endedAt: '2026-08-05T22:00:00.000Z',
    beerCount: 4,
    wineCount: 0,
    softDrinkCount: 1,
    shotCount: 0,
    pubNames: ['U Testu'],
    city: 'Brno',
    durationMinutes: 240,
    title: '',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    commentCount: 0,
    visibility: 'friends',
    createdAt: '2026-08-05T22:05:00.000Z',
    rounds: 2,
    myRound: false,
    isMine: false,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('night feed cache', () => {
  it('isolates the last-good feed by account and scope', async () => {
    const snapshot = { nights: [night('night-1')], nextCursor: 'next', savedAt: 1234 };
    await saveNightFeedCache('account-a', 'friends', snapshot);

    expect(await loadNightFeedCache('account-a', 'friends')).toEqual(snapshot);
    expect(await loadNightFeedCache('account-a', 'global')).toBeNull();
    expect(await loadNightFeedCache('account-b', 'friends')).toBeNull();
  });

  it('drops malformed cached nights while retaining valid entries', () => {
    const valid = night('night-1');

    expect(
      parseNightFeedCache({
        version: 1,
        nights: [valid, { ...valid, id: '' }, { madeUp: true }],
        nextCursor: null,
        savedAt: 1234,
      }),
    ).toEqual({ nights: [valid], nextCursor: null, savedAt: 1234 });
  });

  it('clears every account feed on logout without touching unrelated storage', async () => {
    await AsyncStorage.setItem('keep-me', 'yes');
    await saveNightFeedCache('account-a', 'friends', {
      nights: [night('night-1')],
      nextCursor: null,
      savedAt: 1,
    });
    await saveNightFeedCache('account-b', 'global', {
      nights: [night('night-2')],
      nextCursor: null,
      savedAt: 2,
    });

    await clearNightFeedCaches();

    expect(await loadNightFeedCache('account-a', 'friends')).toBeNull();
    expect(await loadNightFeedCache('account-b', 'global')).toBeNull();
    expect(await AsyncStorage.getItem('keep-me')).toBe('yes');
  });

  it('removes a blocked account as author or participant for only the active viewer', async () => {
    const blockedNight = night('blocked');
    const survivingNight = night('surviving');
    blockedNight.author.id = 'blocked-author';
    survivingNight.participants = [{ ...blockedNight.author }];

    for (const scope of ['friends', 'global', 'mine'] as const) {
      await saveNightFeedCache('account-a', scope, {
        nights: [blockedNight, survivingNight],
        nextCursor: 'next',
        savedAt: 1234,
      });
      await saveNightFeedCache('account-b', scope, {
        nights: [blockedNight],
        nextCursor: null,
        savedAt: 5678,
      });
    }

    await removeAccountFromNightFeedCaches('account-a', 'blocked-author');

    for (const scope of ['friends', 'global', 'mine'] as const) {
      expect(await loadNightFeedCache('account-a', scope)).toEqual({
        nights: [{ ...survivingNight, participants: [] }],
        nextCursor: 'next',
        savedAt: 1234,
      });
      expect((await loadNightFeedCache('account-b', scope))?.nights).toEqual([blockedNight]);
    }
  });
});
