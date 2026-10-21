import { parseBadgeProgress } from '@/data/achievements';
import type { AccountMapper } from '@/data/auth';
import { BADGE_RULES, badgeState, badgeStates, withMapperCounters } from '@/profile/badgeModel';

const rule = (key: string) => {
  const found = BADGE_RULES.find((candidate) => candidate.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('badgeState', () => {
  it('counts reached levels and names the next target', () => {
    const progress = parseBadgeProgress({ distinct_pubs: 31 });

    expect(badgeState(rule('pubs'), progress)).toMatchObject({ tier: 2, value: 31, next: 50 });
  });

  it('is locked below the first level and complete past the last one', () => {
    expect(badgeState(rule('pubs'), parseBadgeProgress({ distinct_pubs: 4 }))).toMatchObject({
      tier: 0,
      next: 5,
    });
    expect(badgeState(rule('pubs'), parseBadgeProgress({ distinct_pubs: 140 }))).toMatchObject({
      tier: 4,
      next: null,
    });
  });

  it('fills a collection slot by slot and unlocks it with the last one', () => {
    const almost = badgeState(rule('weekdays'), parseBadgeProgress({ beer_weekdays: [0, 1, 2, 4, 5, 6] }));
    expect(almost).toMatchObject({ tier: 0, value: 6, next: 7, slots: [0, 1, 2, 4, 5, 6] });

    const full = badgeState(rule('weekdays'), parseBadgeProgress({ beer_weekdays: [0, 1, 2, 3, 4, 5, 6] }));
    expect(full).toMatchObject({ tier: 1, next: null });
  });

  it('gives every rule a state, so an empty profile shows the whole collection locked', () => {
    const states = badgeStates(parseBadgeProgress({}));

    expect(states).toHaveLength(BADGE_RULES.length);
    expect(states.every((state) => state.tier === 0)).toBe(true);
  });
});

describe('withMapperCounters', () => {
  it('uses the fresher Mapér counters from a mapping answer', () => {
    const progress = parseBadgeProgress({ mapped_pubs: 9, facts: 120 });
    const mapper = {
      distinctMappedPubs: 10,
      firstMapperCount: 0,
      completedPubsCount: 0,
      amenityVotesCount: 100,
    } as AccountMapper;

    const merged = withMapperCounters(progress, mapper);

    expect(badgeState(rule('mapped'), merged).tier).toBe(1);
    expect(merged.facts).toBe(120);
  });
});
