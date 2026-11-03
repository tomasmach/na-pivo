import { parseBadgeProgress } from '@/data/achievements';

import { buildNvBadges, nightBadge, nvStillLine, observeLevel } from '../profilModel';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('observeLevel', () => {
  it('shows a level-up once, only for a level the account has not seen', async () => {
    await expect(observeLevel('a', 3)).resolves.toBeNull();
    await expect(observeLevel('a', 3)).resolves.toBeNull();
    const up = await observeLevel('a', 4);
    expect(up?.since).toEqual(expect.any(String));
    await expect(observeLevel('a', 4)).resolves.toBeNull();
  });

  it('starts over without a sheet when another account signs in', async () => {
    await observeLevel('a', 5);
    await expect(observeLevel('b', 6)).resolves.toBeNull();
    await expect(observeLevel('b', 7)).resolves.not.toBeNull();
  });
});

describe('buildNvBadges', () => {
  it('adds "Večer s partou" next to the crew badges, locked until five evenings', () => {
    const badges = buildNvBadges(parseBadgeProgress({ party_evenings: 3 }), new Date('2026-11-01T12:00:00Z'));
    const party = badges.find((badge) => badge.key === 'partyEvenings');
    expect(party?.group).toBe('social');
    expect(party?.state.tier).toBe(0);
    expect(party?.status).toBe('3/5');
    expect(nvStillLine(party!)).toBe('Ještě 2 večery');
  });

  it('keeps every old badge', () => {
    const badges = buildNvBadges(parseBadgeProgress({}), new Date());
    expect(badges).toHaveLength(27);
  });
});

describe('nightBadge', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const progress = (raw: Record<string, unknown>) => parseBadgeProgress({ beers: 40, distinct_pubs: 3, ...raw });

  it('names the medal the night unlocked', () => {
    const result = nightBadge(progress({}), progress({ beers: 43, distinct_pubs: 5 }), now);
    expect(result?.earned).toBe(true);
    expect(result?.badge.key).toBe('pubs');
    expect(result?.badge.state.tier).toBe(1);
  });

  it('without a new medal picks the next level the night moved closest', () => {
    const result = nightBadge(progress({ distinct_pubs: 20 }), progress({ beers: 42, distinct_pubs: 24 }), now);
    expect(result?.earned).toBe(false);
    expect(result?.badge.key).toBe('pubs');
    expect(result?.badge.state.next).toBe(25);
  });

  it('says nothing when the night moved no badge', () => {
    expect(nightBadge(progress({}), progress({}), now)).toBeNull();
  });
});
