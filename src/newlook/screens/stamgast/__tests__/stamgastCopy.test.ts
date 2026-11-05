import { partaCs } from '@/i18n/nv/parta.cs';
import { pivaCs } from '@/i18n/nv/piva.cs';
import { stamgastCs } from '@/i18n/nv/stamgast.cs';
import { stamgastEn } from '@/i18n/nv/stamgast.en';

import { distanceLabel } from '../../kompas/format';
import { nameStatesDegree } from '../stamgastFormat';

describe('diary hero labels', () => {
  it('decline the beers by count', () => {
    expect(stamgastCs.heroMonth(1, 'listopadu')).toBe('pivo v listopadu');
    expect(stamgastCs.heroMonth(3, 'listopadu')).toBe('piva v listopadu');
    expect(stamgastCs.heroMonth(5, 'listopadu')).toBe('piv v listopadu');
    expect(stamgastCs.heroWeek(2)).toBe('piva za týden');
    expect(stamgastCs.heroYear(0, 2026)).toBe('piv v roce 2026');
    expect(stamgastEn.heroMonth(1, 'November')).toBe('beer in November');
    expect(stamgastEn.heroWeek(3)).toBe('beers this week');
  });
});

describe('"all" links', () => {
  it('agree with the count', () => {
    expect(stamgastCs.statsAllPubs(3)).toBe('Všechny 3 ›');
    expect(stamgastCs.statsAllPubs(5)).toBe('Všech 5 ›');
    expect(partaCs.allPhotos(4)).toBe('Všechny 4');
    expect(partaCs.allPhotos(12)).toBe('Všech 12');
    expect(pivaCs.beer.allReviews('3')).toBe('Všechny 3 recenze');
    expect(pivaCs.beer.allReviews('1 234')).toBe('Všech 1 234 recenzí');
  });
});

describe('quick second beer question', () => {
  it('asks in minutes', () => {
    expect(stamgastCs.rapidAgain(0)).toBe('Další pivo hned po tom minulém?');
    expect(stamgastCs.rapidAgain(1)).toBe('Další pivo už po minutě?');
    expect(stamgastCs.rapidAgain(3)).toBe('Další pivo už po 3 minutách?');
    expect(stamgastEn.rapidAgain(1)).toBe('Another beer after just a minute?');
  });
});

describe('degree question', () => {
  it('is skipped when the name already says the degrees', () => {
    expect(nameStatesDegree('Pilsner Urquell 12°')).toBe(true);
    expect(nameStatesDegree('Kozel 11 °')).toBe(true);
    expect(nameStatesDegree('Pilsner Urquell')).toBe(false);
  });
});

describe('pub distance', () => {
  it('is written the way the compass writes it', () => {
    expect(distanceLabel(364)).toBe('364 m');
  });
});
