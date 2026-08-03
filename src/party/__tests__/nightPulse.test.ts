import { buildPulse, fourthStat } from '@/party/nightPulse';

describe('buildPulse', () => {
  it('says nothing has happened before the first beer', () => {
    expect(buildPulse({ beerTimes: [], now: 0 }).kind).toBe('idle');
  });

  it('does not claim a tempo from one beer', () => {
    // One data point has no gap, so nothing may be said about rhythm.
    const pulse = buildPulse({ beerTimes: [0], now: 12 });
    expect(pulse.kind).toBe('first');
    expect(pulse.basis).toContain('12');
  });

  it('calls a shorter-than-usual gap a speed-up', () => {
    const pulse = buildPulse({ beerTimes: [0, 20, 40, 45], now: 45 });
    expect(pulse.kind).toBe('fast');
  });

  it('calls a longer-than-usual gap a slowdown', () => {
    const pulse = buildPulse({ beerTimes: [0, 10, 20, 55], now: 55 });
    expect(pulse.kind).toBe('slow');
  });

  it('reports steady when the last gap matches the night', () => {
    const pulse = buildPulse({ beerTimes: [0, 15, 30, 45], now: 45 });
    expect(pulse.kind).toBe('steady');
  });

  it('lets a long silence outrank the tempo', () => {
    // The last gap was fast, but nothing has happened for an hour since — the
    // pause is the interesting fact, not how quick it was before it.
    const pulse = buildPulse({ beerTimes: [0, 30, 35], now: 100 });
    expect(pulse.kind).toBe('paused');
    expect(pulse.basis).toContain('65');
  });

  it('never mentions how much was drunk', () => {
    const lines = [
      buildPulse({ beerTimes: [0, 5, 10, 12, 14, 15, 16], now: 16 }),
      buildPulse({ beerTimes: [0, 30, 60, 120], now: 130 }),
    ];
    for (const pulse of lines) {
      expect(pulse.headline).not.toMatch(/piv|hodně|moc|dost/i);
    }
  });
});

describe('fourthStat', () => {
  it('shows the average gap while the night is flowing', () => {
    const stat = fourthStat({ beerTimes: [0, 20, 40], now: 45 });
    expect(stat.label).toBe('pivo po');
    expect(stat.value).toBe('20 min');
  });

  it('switches to the silence once it is longer than the usual gap', () => {
    const stat = fourthStat({ beerTimes: [0, 20, 40], now: 75 });
    expect(stat.label).toBe('na jedno');
    expect(stat.value).toBe('35 min');
  });

  it('says nothing until two beers give it a gap to measure', () => {
    // One beer's "time since" IS the stopwatch, and the hub shows that already.
    expect(fourthStat({ beerTimes: [0], now: 26 }).value).toBe('—');
    expect(fourthStat({ beerTimes: [], now: 0 }).value).toBe('—');
  });
});
