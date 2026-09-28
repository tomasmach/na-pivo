import {
  calendarDaysBetween,
  confirmedAmenityKeys,
  currentTaps,
  dayKeyOf,
  eventDay,
  eventStartTime,
  groupWeeklyHours,
  inPubTime,
  withCatalogDetails,
  isSamePubRecord,
  pubWallClock,
  roundedDistance,
  visibleEvents,
} from '../pubPageModel';
import type { WeeklyHours } from '@/data/communityHours';
import type { PubEvent } from '@/data/pubEventsClient';

function event(id: string, startsAt: Date, endsAt: Date): PubEvent {
  return {
    id,
    title: id,
    details: '',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    verifiedAt: startsAt.toISOString(),
  };
}

// Monday 28 September 2026, 18:12 local time.
const NOW = new Date(2026, 8, 28, 18, 12);

describe('groupWeeklyHours', () => {
  const weekly: WeeklyHours = {
    mo: [['15:00', '23:00']],
    tu: [['15:00', '23:00']],
    we: [['15:00', '23:00']],
    th: [['15:00', '23:00']],
    fr: [['15:00', '01:00']],
    sa: [['15:00', '01:00']],
    su: [],
  };

  it('collapses consecutive days with the same hours', () => {
    expect(groupWeeklyHours(weekly, 'mo')).toEqual([
      { from: 'mo', to: 'th', intervals: ['15:00–23:00'], today: true },
      { from: 'fr', to: 'sa', intervals: ['15:00–01:00'], today: false },
      { from: 'su', to: 'su', intervals: [], today: false },
    ]);
  });

  it('marks the run that contains today', () => {
    const rows = groupWeeklyHours(weekly, 'sa');
    expect(rows.map((row) => row.today)).toEqual([false, true, false]);
  });

  it('keeps split intervals apart from single ones', () => {
    const split: WeeklyHours = {
      ...weekly,
      mo: [['11:00', '14:00'], ['17:00', '23:00']],
    };
    expect(groupWeeklyHours(split, 'tu')[0]).toEqual({
      from: 'mo',
      to: 'mo',
      intervals: ['11:00–14:00', '17:00–23:00'],
      today: false,
    });
  });
});

describe('event days', () => {
  it('knows Monday from the JS day index', () => {
    expect(dayKeyOf(NOW)).toBe('mo');
  });

  it('counts calendar days, not 24 hour blocks', () => {
    expect(calendarDaysBetween(NOW, new Date(2026, 8, 29, 1, 0))).toBe(1);
  });

  it('labels running, today, tomorrow and later events', () => {
    const later = new Date(2026, 9, 1, 18, 0);
    expect(eventDay(event('a', new Date(2026, 8, 28, 17, 0), new Date(2026, 8, 28, 22, 0)), NOW)).toEqual({ kind: 'running' });
    expect(eventDay(event('b', new Date(2026, 8, 28, 19, 0), new Date(2026, 8, 28, 22, 0)), NOW)).toEqual({ kind: 'today' });
    expect(eventDay(event('c', new Date(2026, 8, 29, 19, 0), new Date(2026, 8, 29, 22, 0)), NOW)).toEqual({ kind: 'tomorrow' });
    expect(eventDay(event('d', later, new Date(2026, 9, 1, 22, 0)), NOW)).toEqual({ kind: 'date', day: 'th', date: later });
  });

  it('formats the local start time', () => {
    expect(eventStartTime(event('a', new Date(2026, 8, 28, 9, 5), new Date(2026, 8, 28, 10, 0)))).toBe('09:05');
  });

  it('drops ended events and sorts the rest by start', () => {
    const ended = event('ended', new Date(2026, 8, 28, 12, 0), new Date(2026, 8, 28, 13, 0));
    const saturday = event('sat', new Date(2026, 9, 3, 20, 0), new Date(2026, 9, 3, 23, 0));
    const tonight = event('tonight', new Date(2026, 8, 28, 19, 0), new Date(2026, 8, 28, 22, 0));
    expect(visibleEvents([saturday, ended, tonight], NOW).map((e) => e.id)).toEqual(['tonight', 'sat']);
  });
});

describe('confirmedAmenityKeys', () => {
  it('keeps only what the crowd agrees is there', () => {
    const base = { confidence: 1, yes_count: 3, no_count: 0, distinct_voter_count: 3 };
    expect(
      confirmedAmenityKeys([
        { ...base, amenity_key: 'seating_garden', status: 'yes' },
        { ...base, amenity_key: 'game_darts', status: 'disputed' },
        { ...base, amenity_key: 'wifi', status: 'no' },
        { ...base, amenity_key: 'payment_card', status: 'yes' },
      ]),
    ).toEqual(['seating_garden', 'payment_card']);
    expect(confirmedAmenityKeys(undefined)).toEqual([]);
  });
});

describe('roundedDistance', () => {
  it('rounds metres to tens and kilometres to one decimal', () => {
    expect(roundedDistance(3)).toEqual({ unit: 'm', value: 10 });
    expect(roundedDistance(346)).toEqual({ unit: 'm', value: 350 });
    expect(roundedDistance(1387)).toEqual({ unit: 'km', value: 1.4 });
  });
});

describe('currentTaps', () => {
  const server = [{ name: 'Pilsner Urquell 12°', priceCzk: 59 }];

  it('keeps the server taps when a current local edit changed only the hours', () => {
    expect(currentTaps({}, true, server)).toEqual(server);
  });

  it('uses a current local tap list, even an emptied one', () => {
    expect(currentTaps({ beers: [{ name: 'Kozel 11°' }] }, true, server)).toEqual([{ name: 'Kozel 11°' }]);
    expect(currentTaps({ beers: [] }, true, server)).toEqual([]);
  });

  it('ignores a stale local tap list', () => {
    expect(currentTaps({ beers: [{ name: 'Kozel 11°' }] }, false, server)).toEqual(server);
    expect(currentTaps(undefined, false, undefined)).toEqual([]);
  });
});

describe('pubWallClock', () => {
  it('reads Prague wall-clock time from an absolute instant', () => {
    // 17:00 UTC on 28 September 2026 is 19:00 in Prague (summer time).
    const wall = pubWallClock(new Date(Date.UTC(2026, 8, 28, 17, 0)));
    expect([wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([28, 19, 0]);
  });
});

describe('isSamePubRecord', () => {
  const pub = { id: 'mapy:1', name: 'U Zlatého tygra' };
  it('matches by provider id or by name, not the neighbour in the cell', () => {
    expect(isSamePubRecord({ externalId: 'mapy:1', name: 'Tygr' }, pub)).toBe(true);
    expect(isSamePubRecord({ name: 'u zlatého tygra ' }, pub)).toBe(true);
    expect(isSamePubRecord({ externalId: 'mapy:2', name: 'Vinárna vedle' }, pub)).toBe(false);
  });
});

describe('inPubTime', () => {
  it('shows a Prague event at Prague wall-clock time', () => {
    // 17:00 UTC is 19:00 in Prague on 28 September 2026.
    const shown = inPubTime(event('quiz', new Date(Date.UTC(2026, 8, 28, 17, 0)), new Date(Date.UTC(2026, 8, 28, 20, 0))));
    expect(eventStartTime(shown)).toBe('19:00');
  });
});

describe('withCatalogDetails', () => {
  it('lets the catalog own identity and place, the opener fill the rest', () => {
    const merged = withCatalogDetails(
      { id: 'p1', name: 'Starý název z trasy', lat: 50, lng: 14, openingHours: 'Mo-Su 10:00-22:00', userAddedClientId: undefined as string | undefined },
      { id: 'p1', name: 'Opravený název', lat: 50.1, lng: 14.1, openingHours: undefined as string | undefined, userAddedClientId: 'client-1' },
    );
    expect(merged).toEqual({
      id: 'p1',
      name: 'Opravený název',
      lat: 50.1,
      lng: 14.1,
      openingHours: 'Mo-Su 10:00-22:00',
      userAddedClientId: 'client-1',
    });
  });
});
