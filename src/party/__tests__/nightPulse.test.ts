import fs from 'node:fs';
import path from 'node:path';
import { buildPulse, fourthStat, hubStats } from '@/party/nightPulse';

describe('buildPulse', () => {
  it('says nothing has happened before the first beer', () => {
    expect(buildPulse({ beerTimes: [], now: 0 }).kind).toBe('idle');
  });

  it('states the time since the one beer', () => {
    const pulse = buildPulse({ beerTimes: [0], now: 12 });
    expect(pulse.kind).toBe('first');
    expect(pulse.basis).toContain('12');
  });

  it('calls a long silence a pause and states how long', () => {
    const pulse = buildPulse({ beerTimes: [0, 30, 35], now: 100 });
    expect(pulse.kind).toBe('paused');
    expect(pulse.basis).toContain('65');
  });

  it.each([
    ['fast input', [0, 20, 40, 45], 45],
    ['slow input', [0, 10, 20, 55], 55],
    ['steady input', [0, 15, 30, 45], 45],
  ])('reports the same steady line for the %s input', (_name, beerTimes, now) => {
    const pulse = buildPulse({ beerTimes, now });
    expect(pulse.kind).toBe('steady');
    expect(pulse.headline).toBe('Večer běží');
    // The basis states time since the last beer as a fact, never a tempo claim.
    const last = Math.max(...beerTimes);
    const since = now - last;
    expect(pulse.basis).toContain(String(since));
    expect(pulse.basis).not.toMatch(/tempo|zrych|zpomal|rychl|pomalu/i);
  });
});

describe('fourthStat', () => {
  it.each([[3], [1], [0]])('counts written beers for %i entries', (count) => {
    const stat = fourthStat({
      beerTimes: Array.from({ length: count }, (_, i) => i * 15),
      now: count * 15,
    });
    expect(stat.label).toBe('zapsaná piva');
    expect(stat.value).toBe(String(count));
  });
});

describe('hubStats', () => {
  it('shows the table only when someone else is at it', () => {
    const stats = hubStats({ beerTimes: [0, 20], now: 25, mine: 2, table: 5, others: 2 });
    expect(stats.map((stat) => stat.label)).toEqual(['tvoje piva', 'celkem piv']);
    expect(stats[1].value).toBe('5');
  });

  it('stands on one number when you are alone with two beers', () => {
    const stats = hubStats({ beerTimes: [0, 20], now: 25, mine: 2, table: 2, others: 0 });
    expect(stats).toEqual([{ label: 'piva', value: '2' }]);
  });

  it('stands on one number when you are alone with one beer', () => {
    const stats = hubStats({ beerTimes: [0], now: 12, mine: 1, table: 1, others: 0 });
    expect(stats).toEqual([{ label: 'piva', value: '1' }]);
  });
});

describe('nightPulse source', () => {
  it('keeps tempo labels out of the source', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'nightPulse.ts'),
      'utf8',
    );
    for (const literal of ['Drží se tempo', 'Zrychlilo se to', 'Zvolnili jste', 'pivo po', 'na jedno']) {
      expect(source).not.toContain(literal);
    }
  });
});
