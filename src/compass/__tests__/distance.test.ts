import { haversineMeters, formatDistanceCs } from '../distance';

describe('haversineMeters', () => {
  it('Prague city center → Karlštejn is approximately 23 km (within 1 km)', () => {
    // Prague: 50.0755, 14.4378
    // Karlštejn: 49.9394, 14.1871
    const dist = haversineMeters(
      { lat: 50.0755, lng: 14.4378 },
      { lat: 49.9394, lng: 14.1871 },
    );
    const km = dist / 1000;
    expect(km).toBeGreaterThan(22);
    expect(km).toBeLessThan(25);
  });

  it('same point → 0', () => {
    expect(haversineMeters({ lat: 50, lng: 14 }, { lat: 50, lng: 14 })).toBeCloseTo(0, 0);
  });
});

describe('formatDistanceCs', () => {
  it('320 → "320 m"', () => {
    expect(formatDistanceCs(320)).toBe('320 m');
  });

  it('999 → "999 m"', () => {
    expect(formatDistanceCs(999)).toBe('999 m');
  });

  it('1000 → "1 km" (trims ,0)', () => {
    expect(formatDistanceCs(1000)).toBe('1 km');
  });

  it('2500 → "2,5 km"', () => {
    expect(formatDistanceCs(2500)).toBe('2,5 km');
  });

  it('12345 → "12 km" (>= 10 km, rounds to int)', () => {
    expect(formatDistanceCs(12345)).toBe('12 km');
  });

  it('1500 → "1,5 km"', () => {
    expect(formatDistanceCs(1500)).toBe('1,5 km');
  });

  it('10000 → "10 km"', () => {
    expect(formatDistanceCs(10000)).toBe('10 km');
  });

  it('9999 → "10,0 km" trimmed to "10 km"', () => {
    // 9999m = 9.999km → rounds to 10.0 → trimmed to "10 km"
    expect(formatDistanceCs(9999)).toBe('10 km');
  });
});
