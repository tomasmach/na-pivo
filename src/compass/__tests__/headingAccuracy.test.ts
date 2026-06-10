import { isHeadingAccuracyLow } from '../headingAccuracy';

describe('isHeadingAccuracyLow', () => {
  it('returns false when accuracy is unknown', () => {
    expect(isHeadingAccuracyLow(null, 'ios')).toBe(false);
    expect(isHeadingAccuracyLow(null, 'android')).toBe(false);
  });

  describe('iOS (accuracy in degrees, larger = worse)', () => {
    it('flags accuracy worse than 20°', () => {
      expect(isHeadingAccuracyLow(25, 'ios')).toBe(true);
      expect(isHeadingAccuracyLow(180, 'ios')).toBe(true);
    });

    it('accepts accuracy of 20° or better', () => {
      expect(isHeadingAccuracyLow(20, 'ios')).toBe(false);
      expect(isHeadingAccuracyLow(5, 'ios')).toBe(false);
    });
  });

  describe('Android (SensorManager constants 0–3, smaller = worse)', () => {
    it('flags unreliable (0) and low (1) sensor accuracy', () => {
      expect(isHeadingAccuracyLow(0, 'android')).toBe(true);
      expect(isHeadingAccuracyLow(1, 'android')).toBe(true);
    });

    it('accepts medium (2) and high (3) sensor accuracy', () => {
      expect(isHeadingAccuracyLow(2, 'android')).toBe(false);
      expect(isHeadingAccuracyLow(3, 'android')).toBe(false);
    });
  });
});
