import { initialBearing } from '../bearing';

describe('initialBearing', () => {
  it('Prague → Vienna is approximately 145° (SE)', () => {
    const bearing = initialBearing({
      lat1: 50.0755,
      lng1: 14.4378,
      lat2: 48.2082,
      lng2: 16.3738,
    });
    expect(bearing).toBeGreaterThan(143);
    expect(bearing).toBeLessThan(147);
  });

  it('Prague → Berlin is approximately 345° (NNW)', () => {
    const bearing = initialBearing({
      lat1: 50.0755,
      lng1: 14.4378,
      lat2: 52.52,
      lng2: 13.405,
    });
    expect(bearing).toBeGreaterThan(343);
    expect(bearing).toBeLessThan(347);
  });

  it('returns a value in [0, 360)', () => {
    const b = initialBearing({ lat1: 0, lng1: 0, lat2: 1, lng2: 1 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  it('due north → 0°', () => {
    const b = initialBearing({ lat1: 0, lng1: 0, lat2: 10, lng2: 0 });
    expect(b).toBeCloseTo(0, 0);
  });

  it('due east → 90°', () => {
    const b = initialBearing({ lat1: 0, lng1: 0, lat2: 0, lng2: 10 });
    expect(b).toBeCloseTo(90, 0);
  });
});
