import {
  computeOpenState,
  isAllowedBeerVolume,
  isWeeklyHours,
  isValidHoursInterval,
  emptyWeeklyHours,
  parseHhMm,
  formatHhMm,
  parseOsmOpeningHoursToWeeklyHours,
  ALLOWED_BEER_VOLUMES_ML,
  type WeeklyHours,
} from '../communityHours';

/** Build a week where every day shares the same intervals. */
function everyDay(intervals: [string, string][]): WeeklyHours {
  return {
    mo: intervals,
    tu: intervals,
    we: intervals,
    th: intervals,
    fr: intervals,
    sa: intervals,
    su: intervals,
  };
}

// 2026-06-08 is a Monday; using fixed dates keeps the tests deterministic.
const MON_12_00 = new Date('2026-06-08T12:00:00');
const MON_10_00 = new Date('2026-06-08T10:00:00');
const MON_23_30 = new Date('2026-06-08T23:30:00');
const TUE_01_00 = new Date('2026-06-09T01:00:00');
const TUE_00_00 = new Date('2026-06-09T00:00:00');

describe('parseHhMm / formatHhMm', () => {
  it('parses valid HH:MM to minutes', () => {
    expect(parseHhMm('00:00')).toBe(0);
    expect(parseHhMm('11:30')).toBe(690);
    expect(parseHhMm('23:59')).toBe(1439);
  });

  it('rejects malformed or out-of-range values', () => {
    expect(parseHhMm('24:00')).toBe(1440);
    expect(parseHhMm('24:01')).toBeNull();
    expect(parseHhMm('11:60')).toBeNull();
    expect(parseHhMm('1:00')).toBeNull();
    expect(parseHhMm('abc')).toBeNull();
  });

  it('formats minutes back to HH:MM, wrapping past 24h', () => {
    expect(formatHhMm(0)).toBe('00:00');
    expect(formatHhMm(690)).toBe('11:30');
    expect(formatHhMm(1500)).toBe('01:00'); // 25:00 → 01:00
  });
});

describe('parseOsmOpeningHoursToWeeklyHours', () => {
  it('parses Firmy.cz weekday ranges into editable weekly hours', () => {
    expect(parseOsmOpeningHoursToWeeklyHours('Mo-Fr 11:00-23:00; Sa 12:00-00:00')).toEqual({
      mo: [['11:00', '23:00']],
      tu: [['11:00', '23:00']],
      we: [['11:00', '23:00']],
      th: [['11:00', '23:00']],
      fr: [['11:00', '23:00']],
      sa: [['12:00', '00:00']],
      su: [],
    });
  });

  it('parses comma day lists, single-digit hours, and multiple intervals', () => {
    expect(parseOsmOpeningHoursToWeeklyHours('Tu,We,Th 8:00-14:00,17:00-0:00')).toEqual({
      mo: [],
      tu: [
        ['08:00', '14:00'],
        ['17:00', '00:00'],
      ],
      we: [
        ['08:00', '14:00'],
        ['17:00', '00:00'],
      ],
      th: [
        ['08:00', '14:00'],
        ['17:00', '00:00'],
      ],
      fr: [],
      sa: [],
      su: [],
    });
  });

  it('parses nonstop hours without creating an invalid equal-time interval', () => {
    expect(parseOsmOpeningHoursToWeeklyHours('24/7')).toEqual(everyDay([['00:00', '24:00']]));
  });

  it('returns null for unsupported opening_hours constructs', () => {
    expect(parseOsmOpeningHoursToWeeklyHours('Mo-Fr sunrise-sunset')).toBeNull();
    expect(parseOsmOpeningHoursToWeeklyHours('Su off')).toBeNull();
    expect(parseOsmOpeningHoursToWeeklyHours('PH off')).toBeNull();
    expect(parseOsmOpeningHoursToWeeklyHours(null)).toBeNull();
  });
});

describe('isValidHoursInterval', () => {
  it('rejects empty equal-time intervals', () => {
    expect(isValidHoursInterval(['00:00', '00:00'])).toBe(false);
    expect(isValidHoursInterval(['17:00', '17:00'])).toBe(false);
  });

  it('accepts regular and overnight intervals', () => {
    expect(isValidHoursInterval(['17:00', '22:00'])).toBe(true);
    expect(isValidHoursInterval(['17:00', '02:00'])).toBe(true);
  });
});

describe('isAllowedBeerVolume', () => {
  it('accepts exactly the volumes the write endpoint allows', () => {
    for (const volume of ALLOWED_BEER_VOLUMES_ML) {
      expect(isAllowedBeerVolume(volume)).toBe(true);
    }
    expect(ALLOWED_BEER_VOLUMES_ML).toEqual([300, 330, 400, 500, 1000]);
  });

  it('rejects in-range-but-disallowed volumes a menu scan can surface', () => {
    // The menu-scan canonicalization clamps volume over a wide 100–2000 range,
    // so it can hand back values that the write endpoint rejects. Dropping these
    // before submit stops a single beer from looping forever in the retry queue.
    expect(isAllowedBeerVolume(200)).toBe(false);
    expect(isAllowedBeerVolume(250)).toBe(false);
    expect(isAllowedBeerVolume(700)).toBe(false);
    expect(isAllowedBeerVolume(750)).toBe(false);
    expect(isAllowedBeerVolume(2000)).toBe(false);
  });

  it('rejects an absent volume', () => {
    expect(isAllowedBeerVolume(undefined)).toBe(false);
  });
});

describe('isWeeklyHours', () => {
  it('accepts a well-formed weekly object', () => {
    expect(isWeeklyHours(everyDay([['11:00', '23:00']]))).toBe(true);
    expect(isWeeklyHours(emptyWeeklyHours())).toBe(true);
  });

  it('rejects objects missing day keys or with bad intervals', () => {
    expect(isWeeklyHours({ mo: [['11:00', '23:00']] })).toBe(false);
    expect(isWeeklyHours({ ...emptyWeeklyHours(), mo: 'nope' })).toBe(false);
    expect(isWeeklyHours({ ...emptyWeeklyHours(), mo: [['11:00']] })).toBe(false);
    expect(isWeeklyHours({ ...emptyWeeklyHours(), mo: [['25:00', '23:00']] })).toBe(false);
    expect(isWeeklyHours({ ...emptyWeeklyHours(), mo: [['00:00', '00:00']] })).toBe(false);
    expect(isWeeklyHours(null)).toBe(false);
  });
});

describe('computeOpenState — basic open/closed', () => {
  it('reports open inside an interval and the closing time as nextChange', () => {
    const hours = everyDay([['11:00', '23:00']]);
    const state = computeOpenState(hours, MON_12_00);
    expect(state.isOpenNow).toBe(true);
    expect(state.nextChange?.slice(11, 16)).toBe('23:00');
  });

  it('reports closed before opening and the opening time as nextChange', () => {
    const hours = everyDay([['11:00', '23:00']]);
    const state = computeOpenState(hours, MON_10_00);
    expect(state.isOpenNow).toBe(false);
    expect(state.nextChange?.slice(11, 16)).toBe('11:00');
  });
});

describe('computeOpenState — closed day', () => {
  it('treats an empty interval list as closed all day', () => {
    const hours: WeeklyHours = { ...emptyWeeklyHours(), tu: [['11:00', '23:00']] };
    // Monday is closed → not open, next change is Tuesday 11:00.
    const state = computeOpenState(hours, MON_12_00);
    expect(state.isOpenNow).toBe(false);
    expect(state.nextChange?.slice(11, 16)).toBe('11:00');
  });

  it('returns null nextChange when the whole week is closed', () => {
    const state = computeOpenState(emptyWeeklyHours(), MON_12_00);
    expect(state.isOpenNow).toBe(false);
    expect(state.nextChange).toBeNull();
  });
});

describe('computeOpenState — overnight intervals', () => {
  const overnight = everyDay([['18:00', '02:00']]); // open 18:00 → 02:00 next day

  it('is open just before midnight', () => {
    const state = computeOpenState(overnight, MON_23_30);
    expect(state.isOpenNow).toBe(true);
    // Closes at 02:00 the next day.
    expect(state.nextChange?.slice(11, 16)).toBe('02:00');
  });

  it('is still open after midnight (carried from the previous day)', () => {
    const state = computeOpenState(overnight, TUE_01_00);
    expect(state.isOpenNow).toBe(true);
    expect(state.nextChange?.slice(11, 16)).toBe('02:00');
  });

  it('is open exactly at the midnight boundary', () => {
    const state = computeOpenState(overnight, TUE_00_00);
    expect(state.isOpenNow).toBe(true);
  });
});

describe('computeOpenState — multiple intervals per day', () => {
  it('handles a lunch gap (open, closed, open)', () => {
    const hours = everyDay([
      ['08:00', '11:00'],
      ['17:00', '23:00'],
    ]);
    // 12:00 falls in the gap → closed, reopens at 17:00.
    const state = computeOpenState(hours, MON_12_00);
    expect(state.isOpenNow).toBe(false);
    expect(state.nextChange?.slice(11, 16)).toBe('17:00');
  });
});
