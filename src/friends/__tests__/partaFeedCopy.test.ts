import type { PartaFeedDrink, PartaFeedSitting } from '@/data/partaFeedClient';

import {
  dayLabel,
  describeDrink,
  pluralize,
  sittingDetail,
  sittingHeadline,
  sittingPlace,
} from '../partaFeedCopy';

const BEERS: CzechCounts = { one: 'pivo', few: 'piva', many: 'piv' };
interface CzechCounts {
  one: string;
  few: string;
  many: string;
}

function drink(partial: Partial<PartaFeedDrink> = {}): PartaFeedDrink {
  return {
    drinkType: 'beer',
    servingType: 'draft',
    name: 'Pilsner Urquell',
    count: 1,
    ...partial,
  };
}

function sitting(partial: Partial<PartaFeedSitting> = {}): PartaFeedSitting {
  return {
    id: 'sitting-1',
    account: { id: 'a1', nickname: 'jarek', displayName: 'Jarek', avatarUrl: null, isPublic: true },
    mine: false,
    placeContext: 'pub',
    pubName: 'Restaurace Cisterna',
    pubCity: 'Trutnov',
    cacheKey: 'u2fkbfvz',
    lat: null,
    lng: null,
    startedAt: '2026-07-28T16:00:00.000Z',
    endedAt: '2026-07-28T21:00:00.000Z',
    total: 1,
    items: [drink()],
    ...partial,
  };
}

describe('pluralize', () => {
  it('splits Czech counts at 1 / 2-4 / 5+', () => {
    expect(pluralize(1, BEERS)).toBe('pivo');
    expect(pluralize(2, BEERS)).toBe('piva');
    expect(pluralize(4, BEERS)).toBe('piva');
    expect(pluralize(5, BEERS)).toBe('piv');
    expect(pluralize(11, BEERS)).toBe('piv');
  });

  it('uses the 5+ form for zero', () => {
    expect(pluralize(0, BEERS)).toBe('piv');
  });
});

describe('describeDrink', () => {
  it('leaves draft beer unmarked — it is the default in a pub', () => {
    expect(describeDrink(drink({ count: 6 }))).toBe('6 piv Pilsner Urquell');
    expect(describeDrink(drink({ count: 1 }))).toBe('1 pivo Pilsner Urquell');
  });

  it('names the serving type when it is not draft', () => {
    const staropramen = { servingType: 'bottle', name: 'Staropramen 10°' };
    expect(describeDrink(drink({ ...staropramen, count: 3 }))).toBe('3 lahváče Staropramen 10°');
    expect(describeDrink(drink({ ...staropramen, count: 1 }))).toBe('1 lahváč Staropramen 10°');
    expect(describeDrink(drink({ ...staropramen, count: 7 }))).toBe('7 lahváčů Staropramen 10°');
    expect(describeDrink(drink({ servingType: 'can', count: 2, name: 'Kozel 11' }))).toBe(
      '2 plechovky Kozel 11',
    );
    expect(describeDrink(drink({ servingType: 'plastic_bottle', count: 1, name: 'Krušovice' }))).toBe(
      '1 petka Krušovice',
    );
  });

  it('counts shots and wine with their own nouns', () => {
    expect(describeDrink(drink({ drinkType: 'shot', count: 3, name: 'Fernet' }))).toBe(
      '3 panáky Fernet',
    );
    expect(describeDrink(drink({ drinkType: 'wine', count: 1, name: 'Ryzlink' }))).toBe(
      '1 sklenka vína Ryzlink',
    );
  });

  it('falls back to "N×" where Czech has no natural counted noun', () => {
    expect(describeDrink(drink({ drinkType: 'soft_drink', count: 3, name: 'Kofola' }))).toBe(
      '3× Kofola',
    );
    expect(describeDrink(drink({ drinkType: 'soft_drink', count: 1, name: 'Kofola' }))).toBe('Kofola');
  });

  it('survives an unknown drink type from a newer server', () => {
    expect(describeDrink(drink({ drinkType: 'cider', count: 2, name: 'Kingswood' }))).toBe(
      '2× Kingswood',
    );
  });

  it('never renders a bare count when the name is missing', () => {
    expect(describeDrink(drink({ name: '', count: 4 }))).toBe('4 piva');
    expect(describeDrink(drink({ drinkType: 'soft_drink', name: '', count: 2 }))).toBe('2× nápoj');
  });
});

describe('sittingHeadline', () => {
  it('reads as the sentence the feedback asked for', () => {
    const row = sitting({ total: 6, items: [drink({ count: 6 })] });
    expect(sittingHeadline(row)).toBe('6 piv Pilsner Urquell');
  });

  it('leads with the biggest drink regardless of server order', () => {
    const row = sitting({
      total: 7,
      items: [drink({ drinkType: 'shot', count: 1, name: 'Fernet' }), drink({ count: 6 })],
    });
    expect(sittingHeadline(row)).toBe('6 piv Pilsner Urquell + 1 další');
    expect(sittingDetail(row)).toBe('1 panák Fernet');
  });

  it('counts drinks the server truncated out of items', () => {
    // total says 12, but only two lines survived the server's cap.
    const row = sitting({
      total: 12,
      items: [drink({ count: 6 }), drink({ count: 2, name: 'Kozel' })],
    });
    expect(sittingHeadline(row)).toBe('6 piv Pilsner Urquell + 6 dalších');
  });

  it('still says something when only the total survived', () => {
    expect(sittingHeadline(sitting({ total: 5, items: [] }))).toBe('5 piv');
  });
});

describe('sittingPlace', () => {
  it('prefers the pub name', () => {
    expect(sittingPlace(sitting())).toBe('Restaurace Cisterna');
  });

  it('is honest about drinking outside a pub', () => {
    expect(sittingPlace(sitting({ pubName: '', placeContext: 'private' }))).toBe('U někoho doma');
    expect(sittingPlace(sitting({ pubName: '', placeContext: 'outdoors' }))).toBe('Venku');
    expect(sittingPlace(sitting({ pubName: '', placeContext: 'other' }))).toBe('Mimo hospodu');
    expect(sittingPlace(sitting({ pubName: '', placeContext: 'spaceship' }))).toBe('Mimo hospodu');
  });
});

describe('dayLabel', () => {
  // 2026-07-28 22:00 local — a normal evening, nowhere near the rollover.
  const evening = new Date(2026, 6, 28, 22, 0, 0).getTime();

  it('names the last few days the way people do', () => {
    const at = (d: number, h = 20) => new Date(2026, 6, d, h, 0, 0).toISOString();
    expect(dayLabel(at(28), evening)).toBe('dneska');
    expect(dayLabel(at(27), evening)).toBe('včera');
    expect(dayLabel(at(26), evening)).toBe('předevčírem');
    expect(dayLabel(at(24), evening)).toBe('před 4 dny');
  });

  it('switches to a date once "před N dny" stops helping', () => {
    const old = new Date(2026, 6, 12, 20, 0, 0).toISOString();
    expect(dayLabel(old, evening)).toBe('12. 7.');
  });

  it('counts drinking days, so a 01:30 beer still belongs to last night', () => {
    const afterMidnight = new Date(2026, 6, 29, 1, 30, 0).toISOString();

    // Still 02:00 and still the same evening — the calendar rolled over, the
    // night did not.
    const stillOut = new Date(2026, 6, 29, 2, 0, 0).getTime();
    expect(dayLabel(afterMidnight, stillOut)).toBe('dneska');

    // By the next morning that beer is last night's, not this morning's.
    const morning = new Date(2026, 6, 29, 10, 0, 0).getTime();
    expect(dayLabel(afterMidnight, morning)).toBe('včera');
  });

  it('returns nothing for an unparseable timestamp', () => {
    expect(dayLabel('', evening)).toBe('');
    expect(dayLabel('not a date', evening)).toBe('');
  });
});
