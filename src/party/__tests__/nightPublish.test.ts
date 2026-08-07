/**
 * Turning a night into a post (src/party/nightPublish.ts).
 *
 * This is the one place where a private evening becomes something other people
 * read, so what travels — and what does not — is the whole test. Counts and pub
 * names go; prices, coordinates and individual beer names stay at home.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { nightPhotoReferences, nightPublishPayload } from '@/party/nightPublish';
import { emptyNight, type NightDrink, type NightRecord } from '@/party/nightRecord';

const START = new Date(2026, 6, 30, 20, 0);
const END = new Date(2026, 6, 30, 23, 30);

let seq = 0;
function drink(over: Partial<NightDrink> = {}): NightDrink {
  seq += 1;
  return {
    id: `d${seq}`,
    at: new Date(2026, 6, 30, 20 + seq, 0).toISOString(),
    by: 'me',
    beerName: 'Plzeň',
    drinkType: 'beer',
    stopId: null,
    ...over,
  };
}

function night(over: Partial<NightRecord> = {}): NightRecord {
  return {
    ...emptyNight('n1', START.toISOString(), 'STUL24'),
    endedAt: END.toISOString(),
    ...over,
  };
}

beforeEach(() => {
  seq = 0;
});

describe('nightPublishPayload', () => {
  it('keeps an offline photo client id until the upload becomes a hero', () => {
    const pendingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const syncedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    expect(
      nightPhotoReferences(
        [
          {
            id: null,
            clientId: pendingId,
            visibility: 'friends',
            partyDrinkingDay: '2026-07-30',
          },
          {
            id: syncedId,
            clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            visibility: 'friends',
            partyCode: 'STUL24',
          },
          {
            id: null,
            clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            visibility: 'private',
            partyCode: 'STUL24',
          },
        ],
        'stul24',
        '2026-07-30',
      ),
    ).toEqual([pendingId, syncedId]);
  });

  it('publishes an offline-only Party photo by drinking day without a table code', () => {
    const pendingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    expect(
      nightPhotoReferences(
        [
          {
            id: null,
            clientId: pendingId,
            visibility: 'friends',
            partyDrinkingDay: '2026-07-30',
          },
        ],
        undefined,
        '2026-07-30',
      ),
    ).toEqual([pendingId]);
  });

  it('is keyed by the drinking day, so one night is one post', () => {
    // The same key the diary uses: publishing this night from the hub and from
    // Výčep must update one post, not argue in two.
    const payload = nightPublishPayload(night(), { visibility: 'friends', now: END.getTime() });

    expect(payload.clientId).toBe('night-2026-07-30');
    expect(payload.drinkingDay).toBe('2026-07-30');
  });

  it('files a 01:30 beer under the night it belongs to', () => {
    const late = night({ startedAt: new Date(2026, 6, 31, 1, 30).toISOString() });
    const payload = nightPublishPayload(late, { visibility: 'friends', now: END.getTime() });

    expect(payload.drinkingDay).toBe('2026-07-30');
  });

  it('counts each kind of drink separately', () => {
    const payload = nightPublishPayload(
      night({
        drinks: [
          drink(),
          drink(),
          drink({ drinkType: 'wine', beerName: 'Ryzlink' }),
          drink({ drinkType: 'shot', beerName: 'Slivovice' }),
          drink({ drinkType: 'soft_drink', beerName: 'Kofola' }),
        ],
      }),
      { visibility: 'friends', now: END.getTime() },
    );

    expect(payload).toMatchObject({
      beerCount: 2,
      wineCount: 1,
      shotCount: 1,
      softDrinkCount: 1,
    });
  });

  it('sends pub names and nothing else about where you were', () => {
    const payload = nightPublishPayload(
      night({
        stops: [
          {
            id: 's1',
            pubName: 'U Fleků',
            cacheKey: 'a',
            arrivedAt: START.toISOString(),
            lat: 50.0785,
            lng: 14.42,
          },
        ],
        drinks: [drink()],
      }),
      { visibility: 'friends', now: END.getTime() },
    );

    expect(payload.pubNames).toEqual(['U Fleků']);
    // No coordinates and no beer names: the post says where you were, never
    // where you stood or what was in the glass.
    expect(JSON.stringify(payload)).not.toContain('50.07');
    expect(JSON.stringify(payload)).not.toContain('Plzeň');
  });

  it('names a pub once, however many times you went back to the bar', () => {
    const stop = (id: string, pubName: string) => ({
      id,
      pubName,
      cacheKey: null,
      arrivedAt: START.toISOString(),
    });
    const payload = nightPublishPayload(
      night({ stops: [stop('a', 'U Fleků'), stop('b', 'U Fleků'), stop('c', 'Zlý časy')] }),
      { visibility: 'friends', now: END.getTime() },
    );

    expect(payload.pubNames).toEqual(['U Fleků', 'Zlý časy']);
  });

  it('caps a long crawl the way the server does', () => {
    const stops = Array.from({ length: 9 }, (_, index) => ({
      id: `s${index}`,
      pubName: `Hospoda ${index}`,
      cacheKey: null,
      arrivedAt: START.toISOString(),
    }));
    const payload = nightPublishPayload(night({ stops }), {
      visibility: 'friends',
      now: END.getTime(),
    });

    expect(payload.pubNames).toHaveLength(5);
  });

  it('measures a night that is still running up to now', () => {
    const running = night({ endedAt: null });
    const payload = nightPublishPayload(running, {
      visibility: 'public',
      now: new Date(2026, 6, 30, 22, 0).getTime(),
    });

    expect(payload.durationMinutes).toBe(120);
    expect(payload.endedAt).toBe(new Date(2026, 6, 30, 22, 0).toISOString());
    expect(payload.visibility).toBe('public');
  });

  it('publishes only the current account from a shared table', () => {
    const payload = nightPublishPayload(
      night({
        endedAt: '2026-07-31T02:00:00.000Z',
        people: [
          {
            id: 'me',
            name: 'Ty',
            avatarUrl: null,
            tint: '#E8A317',
            joinedAt: '2026-07-31T00:30:00.000Z',
          },
          { id: 'friend', name: 'Honza', avatarUrl: null, tint: '#fff' },
        ],
        stops: [
          {
            id: 'mine',
            by: 'me',
            pubName: 'Moje hospoda',
            cacheKey: null,
            arrivedAt: '2026-07-31T00:35:00.000Z',
          },
          {
            id: 'theirs',
            by: 'friend',
            pubName: 'Cizí štace',
            cacheKey: null,
            arrivedAt: '2026-07-30T20:00:00.000Z',
          },
        ],
        drinks: [
          drink({ by: 'me', stopId: 'mine', at: '2026-07-31T00:45:00.000Z' }),
          drink({ by: 'friend', stopId: 'theirs', at: '2026-07-30T20:30:00.000Z' }),
          drink({ by: 'friend', stopId: 'theirs', at: '2026-07-30T21:30:00.000Z' }),
        ],
      }),
      { visibility: 'friends', now: Date.parse('2026-07-31T02:00:00.000Z'), ownerId: 'me' },
    );

    expect(payload).toMatchObject({
      drinkingDay: '2026-07-30',
      beerCount: 1,
      pubNames: ['Moje hospoda'],
      startedAt: '2026-07-31T00:30:00.000Z',
      durationMinutes: 90,
    });
    expect(JSON.stringify(payload)).not.toContain('Cizí štace');
  });
});
