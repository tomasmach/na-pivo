import { levelForXp, FALLBACK_LEVELS, FALLBACK_XP_RULES } from '../mapperXp';

describe('levelForXp', () => {
  it('maps xp to the highest rung at or below it', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(49).level).toBe(1);
    expect(levelForXp(50).level).toBe(2);
    expect(levelForXp(150).level).toBe(3);
    expect(levelForXp(399).level).toBe(3);
    expect(levelForXp(400).level).toBe(4);
    expect(levelForXp(10_000).level).toBe(5);
  });

  it('returns the locked title for each level', () => {
    expect(levelForXp(0).title).toBe('Nováček');
    expect(levelForXp(900).title).toBe('Hospodský mudrc');
  });

  it('respects a custom (server) ladder', () => {
    const ladder = [
      { level: 1, title: 'A', xp: 0 },
      { level: 2, title: 'B', xp: 100 },
    ];
    expect(levelForXp(99, ladder).title).toBe('A');
    expect(levelForXp(100, ladder).title).toBe('B');
  });

  it('exposes the locked 5-level ladder and the env-default rules', () => {
    expect(FALLBACK_LEVELS).toHaveLength(5);
    expect(FALLBACK_XP_RULES.firstFact).toBeGreaterThan(FALLBACK_XP_RULES.confirm);
  });
});
