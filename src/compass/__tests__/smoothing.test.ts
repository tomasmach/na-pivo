import { createAngleEMA } from '../smoothing';

describe('createAngleEMA', () => {
  it('returns next on first call', () => {
    const ema = createAngleEMA(0.5);
    expect(ema(90)).toBe(90);
  });

  it('converges via short arc: 350° → 10° goes through 350→0 direction', () => {
    const ema = createAngleEMA(0.5);
    let val = ema(350); // first call: returns 350

    // Feed 10° many times — should converge to ~10° via the short arc
    for (let i = 0; i < 20; i++) {
      val = ema(10);
    }

    // Should have converged close to 10° (not 180° away)
    // Acceptable range: within 5° of 10
    expect(val).toBeGreaterThan(5);
    expect(val).toBeLessThan(15);
  });

  it('converges via short arc going the other way: 10° → 350°', () => {
    const ema = createAngleEMA(0.5);
    let val = ema(10);

    for (let i = 0; i < 20; i++) {
      val = ema(350);
    }

    // Should converge close to 350° (not 170°)
    expect(val).toBeGreaterThan(345);
    expect(val).toBeLessThan(360);
  });

  it('does not cross the long arc when smoothing 350° → 10°', () => {
    // Short arc is 20° (from 350° going forward to 10°).
    // EMA must NEVER produce a value in the range (15°, 345°) — that would be the long arc.
    const ema = createAngleEMA(0.3);
    ema(350); // seed

    for (let i = 0; i < 10; i++) {
      const v = ema(10);
      // The value should stay on the short arc: either ≥ 345 or ≤ 15
      const onShortArc = v >= 345 || v <= 15;
      expect(onShortArc).toBe(true);
    }
  });

  it('.reset() clears state so next call is treated as first', () => {
    const ema = createAngleEMA(0.5);
    ema(180);
    ema.reset();
    // After reset, the very next call should return its input directly.
    expect(ema(45)).toBe(45);
  });

  it('output stays in [0, 360)', () => {
    const ema = createAngleEMA(0.2);
    let v = ema(359);
    for (let i = 0; i < 30; i++) {
      v = ema(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(360);
    }
  });
});
