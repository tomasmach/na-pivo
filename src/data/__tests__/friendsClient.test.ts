import { parseSharedNight } from '../friendsClient';

describe('parseSharedNight', () => {
  it('maps the additive shared-night payload and normalizes beer counts', () => {
    expect(
      parseSharedNight({
        id: 'night-1',
        cache_key: 'u2fkbnjm',
        name: 'U Zlatého tygra',
        city: 'Praha',
        started_at: '2026-07-18T18:00:00Z',
        expires_at: '2026-07-18T22:00:00Z',
        activity_ids: ['activity-1', 12, 'activity-2'],
        my_activity_id: 'activity-1',
        join_activity_id: 'activity-2',
        my_response: 'going',
        total_beers: 5.9,
        participants: [
          {
            account: {
              id: 'me',
              nickname: 'janek',
              display_name: 'Janek',
              avatar_url: null,
              is_public: true,
            },
            beer_count: 3.8,
            is_me: true,
          },
          {
            account: {
              id: 'friend',
              nickname: 'petr',
              display_name: 'Petr',
            },
            beer_count: -4,
          },
        ],
      }),
    ).toEqual({
      id: 'night-1',
      cacheKey: 'u2fkbnjm',
      name: 'U Zlatého tygra',
      city: 'Praha',
      startedAt: '2026-07-18T18:00:00Z',
      expiresAt: '2026-07-18T22:00:00Z',
      activityIds: ['activity-1', 'activity-2'],
      myActivityId: 'activity-1',
      joinActivityId: 'activity-2',
      myResponse: 'going',
      participants: [
        {
          account: {
            id: 'me',
            nickname: 'janek',
            displayName: 'Janek',
            avatarUrl: null,
            isPublic: true,
          },
          beerCount: 3,
          isMe: true,
        },
        {
          account: {
            id: 'friend',
            nickname: 'petr',
            displayName: 'Petr',
            avatarUrl: null,
            isPublic: true,
          },
          beerCount: 0,
          isMe: false,
        },
      ],
      totalBeers: 5,
    });
  });

  it('falls back to an empty forward-compatible shape', () => {
    expect(parseSharedNight({})).toEqual({
      id: '',
      cacheKey: '',
      name: '',
      city: '',
      startedAt: '',
      expiresAt: '',
      activityIds: [],
      myActivityId: null,
      joinActivityId: '',
      myResponse: null,
      participants: [],
      totalBeers: 0,
    });
  });
});
