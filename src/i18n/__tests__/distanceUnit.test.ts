/**
 * The unit under the big distance numeral has to decline with the number.
 *
 * Czech does not treat a decimal like a small whole number: 1 is "kilometr",
 * but 1,5 and 2,5 are "kilometru". The settings slider used to pass a hardcoded
 * 1 for every decimal stop and printed "2,5 KILOMETR".
 */

import { cs } from '../cs';
import { en } from '../en';

describe('cs distanceUnitKm', () => {
  it('uses the nominative for a single whole kilometre', () => {
    expect(cs.compass.distanceUnitKm(1)).toBe('KILOMETR');
  });

  it('uses the genitive singular for every decimal', () => {
    for (const value of [1.5, 2.5, 3.5, 7.5]) {
      expect(cs.compass.distanceUnitKm(value)).toBe('KILOMETRU');
    }
  });

  it('declines whole numbers the Czech way', () => {
    expect(cs.compass.distanceUnitKm(2)).toBe('KILOMETRY');
    expect(cs.compass.distanceUnitKm(4)).toBe('KILOMETRY');
    expect(cs.compass.distanceUnitKm(5)).toBe('KILOMETRŮ');
    expect(cs.compass.distanceUnitKm(12)).toBe('KILOMETRŮ');
  });
});

describe('en distanceUnitKm', () => {
  it('is singular only at exactly one', () => {
    expect(en.compass.distanceUnitKm(1)).toBe('KILOMETRE');
    expect(en.compass.distanceUnitKm(1.5)).toBe('KILOMETRES');
    expect(en.compass.distanceUnitKm(5)).toBe('KILOMETRES');
  });
});
